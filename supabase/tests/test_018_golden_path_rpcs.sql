-- ═══════════════════════════════════════════════════════════════════════════
-- test_018 · The golden-path RPC pack
-- ═══════════════════════════════════════════════════════════════════════════
--
-- AN AUTHORED PIN THAT WAS NEVER RUN IS NOT A PIN. This file was executed
-- against a PostgreSQL 17.11 shim with 001–013 + 018 applied, and its output
-- was read, before it was committed. It ends in ROLLBACK and writes nothing
-- durable.
--
-- HOW TO RUN IT:
--   psql "<shim>" -v ON_ERROR_STOP=1 -f supabase/tests/test_018_golden_path_rpcs.sql
--
-- WHAT IT DOES AND DOES NOT PROVE, stated here rather than discovered later:
--
--   IT PROVES the SQL executes, that every envelope has the shape the contract
--   in `packages/contract` declares, that refusals carry the right codes, that
--   the posture and grant invariants hold structurally off `pg_proc`, that the
--   money rule reconciles and the floor refuses, and that a rollback restores
--   the prior state.
--
--   IT DOES NOT PROVE behaviour under 014's RLS policies, because THEY DO NOT
--   EXIST YET — see T0, which measures that and says so out loud. Nor does it
--   prove PostgREST's own argument binding, GoTrue's custom-access-token hook,
--   or that `core` is exposed on the hosted project (doc 09 §0a: it is not).
--
-- FIXTURES. This file builds its own, including `core.ref_formats` rows: 004
-- allocates every `ref` from that table and 001–013 seed none, so a test that
-- did not insert them would die on the first INSERT with
-- "no ref_format for prefix ORG in this tenant". Found by running it.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET client_min_messages = notice;

BEGIN;

\set tenant_a  '11111111-1111-4111-8111-111111111111'
\set tenant_b  '99999999-9999-4999-8999-999999999999'
\set alex      '22222222-2222-4222-8222-222222222222'
\set mei       '33333333-3333-4333-8333-333333333333'
\set intruder  '88888888-8888-4888-8888-888888888888'

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Real `auth.users` rows, because `public.memberships.user_id` and
-- `public.user_profiles.user_id` both FK to `auth.users(id)`. A pin that
-- skipped them would die on the FK before reaching a single assertion.
INSERT INTO auth.users (id, email) VALUES
  (:'alex','alex@example.test'),
  (:'mei','mei@example.test'),
  (:'intruder','intruder@other.test');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  (:'tenant_a','apsb','Akademi Perdana','ACTIVE','Asia/Kuala_Lumpur','en-MY'),
  (:'tenant_b','other','Other Tenant','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  (:'tenant_a',:'alex','SALES','HUMAN','ALL','ALL',false,'ACTIVE',true),
  (:'tenant_a',:'mei','MD','HUMAN','ALL','ALL',true,'ACTIVE',true),
  (:'tenant_b',:'intruder','SALES','HUMAN','ALL','ALL',false,'ACTIVE',true);

INSERT INTO public.user_profiles
  (tenant_id,user_id,display_name,email,locale,timezone,theme)
VALUES
  (:'tenant_a',:'alex','Alex Selvarajah','alex@example.test','en-MY','Asia/Kuala_Lumpur','DARK'),
  (:'tenant_a',:'mei','Mei Ling','mei@example.test','en-MY','Asia/Kuala_Lumpur','LIGHT'),
  (:'tenant_b',:'intruder','Intruder','intruder@other.test','en-MY','Asia/Kuala_Lumpur','LIGHT');

INSERT INTO core.ref_formats (tenant_id,prefix,entity,dated,width,gapless)
SELECT t.id, spec.prefix, spec.entity, spec.dated, 4, false
  FROM public.tenants t,
       (VALUES ('ORG','organisations',false),('ENQ','enquiries',true),
               ('OPP','opportunities',true),('TNA','tnas',true),
               ('PRO','proposals',true),('QUO','quotations',true),
               ('CON','contacts',false),('PRG','programmes',false),
               ('APV','approval_requests',true),('ACT','action_requests',true),
               ('DRF','suggested_drafts',true),('TPL','templates',false),
               ('ENG','engagements',true),('INV','invoices',true),
               ('PIP','pipelines',false),('SVW','saved_views',false),
               ('TRN','trainers',false),('HPK','hrdc_packets',true),
               ('RUN','runs',true)) AS spec(prefix,entity,dated);

-- Pipeline configuration. STAGE NAMES AND ORDER LIVE HERE, which is the whole
-- point of T9: the nav and the config endpoint must render these rows and not
-- a list compiled into a function.
INSERT INTO core.pipelines (id,tenant_id,object,name,is_default,version,status,
                            created_by_kind,created_by_id)
VALUES ('aaaaaaa1-0000-4000-8000-000000000001',:'tenant_a','OPPORTUNITY',
        'Standard deal board',true,1,'ACTIVE','HUMAN',:'alex'),
       ('aaaaaaa1-0000-4000-8000-000000000002',:'tenant_a','ENGAGEMENT',
        'Delivery lifecycle',true,1,'ACTIVE','HUMAN',:'alex');

INSERT INTO core.pipeline_steps (tenant_id,pipeline_id,step_key,label,position,terminal,blocking_check_keys)
VALUES
  (:'tenant_a','aaaaaaa1-0000-4000-8000-000000000001','NEW','New',1,false,'{}'),
  (:'tenant_a','aaaaaaa1-0000-4000-8000-000000000001','QUALIFYING','Qualifying',2,false,'{}'),
  (:'tenant_a','aaaaaaa1-0000-4000-8000-000000000001','WON','Won',3,true,'{}'),
  (:'tenant_a','aaaaaaa1-0000-4000-8000-000000000001','LOST','Lost',4,true,'{}'),
  (:'tenant_a','aaaaaaa1-0000-4000-8000-000000000002','WON','Won',1,false,'{}'),
  (:'tenant_a','aaaaaaa1-0000-4000-8000-000000000002','DELIVERED','Delivered',2,false,'{}'),
  (:'tenant_a','aaaaaaa1-0000-4000-8000-000000000002','PAID','Paid',3,true,'{}');

INSERT INTO core.organisations
  (id,tenant_id,name,industry,location,owner_id,status,hrdc_registered,hrdc_employer_code,country_code)
VALUES ('bbbbbbb1-0000-4000-8000-000000000001',:'tenant_a','Chrome Manufacturing',
        'MANUFACTURING','Shah Alam',:'alex','ACTIVE_CLIENT',true,'E-12345','MYS'),
       ('bbbbbbb1-0000-4000-8000-000000000002',:'tenant_b','Other Co',
        'SERVICES','Penang',:'intruder','PROSPECT',false,NULL,'MYS');

INSERT INTO core.contacts
  (id,tenant_id,organisation_id,name,job_title,email,phone,is_primary,created_by_kind,created_by_id)
VALUES ('ccccccc1-0000-4000-8000-000000000001',:'tenant_a',
        'bbbbbbb1-0000-4000-8000-000000000001','Siti Rahman','HR Director',
        'siti@chrome.test','+60 12-448 9021',true,'HUMAN',:'alex');

INSERT INTO core.contact_consents
  (tenant_id,contact_id,channel,granted,recorded_at,created_by_kind,created_by_id)
VALUES (:'tenant_a','ccccccc1-0000-4000-8000-000000000001','EMAIL',true,pg_catalog.now(),'HUMAN',:'alex');

-- Three enquiries in tenant A, ONE in tenant B. The tenant-B row is the whole
-- basis of T11: if a single assertion can see it, the pack leaks.
INSERT INTO core.enquiries
  (id,tenant_id,channel,status,received_at,from_name,from_email,subject,preview,body,
   classification_label,classification_confidence,needs_human_review,estimated_value_sen,
   currency,matched_organisation_id,matched_contact_id,match_reason,assigned_to_user_id,
   created_by_kind,created_by_id,created_by_name)
VALUES
  ('ddddddd1-0000-4000-8000-000000000001',:'tenant_a','EMAIL','OPEN',
   '2026-09-10T09:00:00+08','Siti Rahman','siti@chrome.test',
   'Leadership training for 40','Line managers, November','Full body one',
   'TRAINING_ENQUIRY',0.860,false,4000000,'MYR',
   'bbbbbbb1-0000-4000-8000-000000000001','ccccccc1-0000-4000-8000-000000000001',
   'EXACT_DOMAIN',:'alex','AGENT','agent:classifier','Classifier'),
  ('ddddddd1-0000-4000-8000-000000000002',:'tenant_a','WHATSAPP','OPEN',
   '2026-09-11T09:00:00+08','Ravi','+60123334444',
   'Safety refresher','Plant floor','Full body two',
   'TRAINING_ENQUIRY',0.500,true,NULL,'MYR',NULL,NULL,NULL,NULL,'HUMAN',:'alex','Alex Selvarajah'),
  ('ddddddd1-0000-4000-8000-000000000003',:'tenant_a','WEB_FORM','OPEN',
   '2026-09-12T09:00:00+08','Anon','web@chrome.test',
   'Coaching','Exec coaching','Full body three',
   NULL,NULL,false,NULL,'MYR',NULL,NULL,NULL,NULL,'HUMAN',:'alex','Alex Selvarajah'),
  ('ddddddd1-0000-4000-8000-000000000009',:'tenant_b','EMAIL','OPEN',
   '2026-09-12T09:00:00+08','Leak','leak@other.test',
   'TENANT B SECRET','secret','secret body',
   'TRAINING_ENQUIRY',0.900,false,99999999,'MYR',NULL,NULL,NULL,NULL,
   'HUMAN',:'intruder','Intruder');

-- 011's transition gate refuses a row BORN in a non-initial state: the only
-- legal (new) target for an enquiry is OPEN, and for a TNA it is DRAFT. So the
-- fixtures WALK the registry instead of writing a state the product could not
-- reach. Found by running this file, not by reading the migration.
UPDATE core.enquiries SET status = 'ASSIGNED'
 WHERE id = 'ddddddd1-0000-4000-8000-000000000002';

-- Extraction: `topic` HAS a provenance row, `audience` has a value and NO
-- provenance row. That asymmetry is T6's subject — absent provenance means
-- human-authored and must emit NO key.
INSERT INTO core.enquiry_extraction_fields
  (id,tenant_id,enquiry_id,field_key,value,created_by_kind,created_by_id)
VALUES ('eeeeeee1-0000-4000-8000-000000000001',:'tenant_a',
        'ddddddd1-0000-4000-8000-000000000001','topic','Leadership','AGENT','agent:extractor'),
       ('eeeeeee1-0000-4000-8000-000000000002',:'tenant_a',
        'ddddddd1-0000-4000-8000-000000000001','audience','Line managers','HUMAN',:'alex'),
       ('eeeeeee1-0000-4000-8000-000000000003',:'tenant_a',
        'ddddddd1-0000-4000-8000-000000000001','budget','4000000','AGENT','agent:extractor');

INSERT INTO core.provenance
  (tenant_id,subject_table,subject_id,field,origin,confidence,tier,model,
   generated_at,needs_review,sources,created_by_kind,created_by_id)
VALUES (:'tenant_a','enquiry_extraction_fields','eeeeeee1-0000-4000-8000-000000000001','topic',
        'AI_GENERATED',0.860,'MID','claude-3','2026-09-10T09:01:00+08',false,
        '[{"type":"EMAIL","ref":"ENQ-2026-0001","excerpt":"leadership"}]'::jsonb,
        'AGENT','agent:extractor'),
       (:'tenant_a','enquiries','ddddddd1-0000-4000-8000-000000000001','classification_label',
        'AI_GENERATED',0.860,'MID','claude-3','2026-09-10T09:01:00+08',false,'[]'::jsonb,
        'AGENT','agent:classifier');

INSERT INTO core.opportunities
  (id,tenant_id,ref,organisation_id,primary_contact_id,source_enquiry_id,owner_id,stage,
   value_sen,currency,probability,created_by_kind,created_by_id)
VALUES ('fffffff1-0000-4000-8000-000000000001',:'tenant_a','OPP-2026-0001',
        'bbbbbbb1-0000-4000-8000-000000000001','ccccccc1-0000-4000-8000-000000000001',
        'ddddddd1-0000-4000-8000-000000000001',:'alex','NEW',4000000,'MYR',0.400,
        'HUMAN',:'alex');

-- 011 gates `(new) -> QUALIFYING` behind OPPORTUNITY_CONVERT — a deal may not
-- be BORN qualified, it has to be converted into that state through the action
-- envelope. The ungated `NEW -> QUALIFYING` edge is the honest fixture path.
-- THE GATE IS NOT WIDENED TO SUIT THE TEST: this pack changes nothing in 011,
-- and the fixture bends to the registry rather than the other way round.
UPDATE core.opportunities SET stage = 'QUALIFYING'
 WHERE id = 'fffffff1-0000-4000-8000-000000000001';

INSERT INTO core.tnas
  (id,tenant_id,opportunity_id,status,sent_at,completed_at,completed_by_kind,completed_by_id,
   completed_by_name,audience_headcount,audience_level,audience_sites,audience_language,
   budget_sen,currency,created_by_kind,created_by_id)
VALUES ('a1111111-0000-4000-8000-000000000001',:'tenant_a','fffffff1-0000-4000-8000-000000000001',
        'DRAFT','2026-09-10T10:00:00+08','2026-09-11T10:00:00+08','CLIENT',
        'ccccccc1-0000-4000-8000-000000000001','Siti Rahman',40,'LINE_MANAGER',
        ARRAY['Shah Alam'],'EN',4000000,'MYR','HUMAN',:'alex');

-- DRAFT -> SENT -> COMPLETE, one legal edge at a time.
UPDATE core.tnas SET status = 'SENT'     WHERE id = 'a1111111-0000-4000-8000-000000000001';
UPDATE core.tnas SET status = 'COMPLETE' WHERE id = 'a1111111-0000-4000-8000-000000000001';

INSERT INTO core.tna_gaps (tenant_id,tna_id,name,description,priority,evidence_refs,
                           created_by_kind,created_by_id)
VALUES (:'tenant_a','a1111111-0000-4000-8000-000000000001','Delegation',
        'Managers do not delegate','HIGH',ARRAY['Q4','Q7'],'AGENT','agent:tna');

INSERT INTO core.tna_constraints (tenant_id,tna_id,code,label,severity,created_by_kind,created_by_id)
VALUES (:'tenant_a','a1111111-0000-4000-8000-000000000001','NO_FRIDAY','No Friday sessions',NULL,
        'HUMAN',:'alex'),
       (:'tenant_a','a1111111-0000-4000-8000-000000000001','BUDGET_TIGHT','Budget is tight','WARN',
        'HUMAN',:'alex');

INSERT INTO core.programmes
  (id,tenant_id,name,category,days,version,status,hrdc_scheme,hrdc_claimable,
   list_price_sen,list_price_pax,floor_price_sen,floor_margin_rate,currency,outcomes,
   deliveries_count,created_by_kind,created_by_id)
VALUES ('b2222222-0000-4000-8000-000000000001',:'tenant_a','Leading Teams','LEADERSHIP',
        2,1,'ACTIVE','SBL_KHAS',true,4000000,25,2800000,0.3000,'MYR',
        ARRAY['Delegate effectively'],3,'HUMAN',:'alex');

INSERT INTO core.programme_modules (tenant_id,programme_id,n,title,format,duration_minutes,
                                    created_by_kind,created_by_id)
VALUES (:'tenant_a','b2222222-0000-4000-8000-000000000001',1,'Foundations','FACILITATED',180,
        'HUMAN',:'alex');

INSERT INTO core.tna_recommendations
  (tenant_id,tna_id,programme_id,fit_score,rationale,price_indication_sen,currency,rank,
   scoring_model_version,scoring_weights,created_by_kind,created_by_id)
VALUES (:'tenant_a','a1111111-0000-4000-8000-000000000001','b2222222-0000-4000-8000-000000000001',
        0.910,'Closes the delegation gap',4000000,'MYR',1,'fit-v2',
        '{"gapMatch":0.6,"history":0.4}'::jsonb,'AGENT','agent:tna');

INSERT INTO core.templates
  (id,tenant_id,template_type,version,label,merge_fields,status,created_by_kind,created_by_id)
VALUES ('c3333333-0000-4000-8000-000000000001',:'tenant_a','PROPOSAL',1,'Standard proposal',
        ARRAY['organisation.name'],'ACTIVE','HUMAN',:'alex');

INSERT INTO core.template_sections (tenant_id,template_id,n,title,ai_enabled,default_body)
VALUES (:'tenant_a','c3333333-0000-4000-8000-000000000001',1,'Understanding',true,'Draft one'),
       (:'tenant_a','c3333333-0000-4000-8000-000000000001',2,'Approach',true,'Draft two');

INSERT INTO core.rate_cards
  (id,tenant_id,version,currency,status,effective_from,created_by_kind,created_by_id)
VALUES ('d4444444-0000-4000-8000-000000000001',:'tenant_a','2026.1','MYR','ACTIVE',
        '2026-01-01','HUMAN',:'alex');

INSERT INTO core.saved_views
  (tenant_id,object,label,filters,columns,is_default,owner_id,visibility,
   created_by_kind,created_by_id)
VALUES (:'tenant_a','ENQUIRY','Open only',
        '[{"field":"status","op":"eq","value":"OPEN"}]'::jsonb,
        ARRAY['ref','subject'],false,:'alex','TEAM','HUMAN',:'alex');

\echo ''
\echo '════════ T0 · THE 014 ORDERING HAZARD, MEASURED ════════'
-- This is the first assertion on purpose. Everything below it passes on this
-- shim BECAUSE the definer's owner is a superuser here. On a project whose
-- owner is not BYPASSRLS, FORCE ROW LEVEL SECURITY with zero policies makes
-- every read in 018 return ZERO ROWS — silently, as an empty list.
DO $t0$
DECLARE v_forced_no_policy integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_forced_no_policy
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relkind = 'r'
     AND c.relforcerowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS p WHERE p.polrelid = c.oid);

  IF v_forced_no_policy > 0 THEN
    RAISE NOTICE 'T0 DEPENDENCY: % core tables are FORCE RLS with NO POLICY. 014 has not '
                 'been applied to this database. Every assertion below therefore passes '
                 'only because this cluster''s definer owner carries BYPASSRLS. '
                 '018 MUST NOT be applied to a hosted project before 014.',
                 v_forced_no_policy;
  ELSE
    RAISE NOTICE 'T0 PASS: every core table with FORCE RLS carries at least one policy '
                 '(014 is applied).';
  END IF;

  IF NOT (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER) THEN
    RAISE NOTICE 'T0b: the current user does NOT carry BYPASSRLS, so the reads below are '
                 'a genuine test of the policy layer.';
  ELSE
    RAISE NOTICE 'T0b CAVEAT: the current user carries BYPASSRLS. RLS is not being '
                 'exercised by this run.';
  END IF;
END
$t0$;

\echo ''
\echo '════════ T1 · RULING R-C · no tax policy exists, and none is invented ════════'
DO $t1$
BEGIN
  IF pg_catalog.to_regclass('core.tax_policies') IS NOT NULL THEN
    RAISE EXCEPTION 'T1: core.tax_policies now exists — 018 was written on the finding '
                    'that it does not. Re-check the quotation SST path.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
               JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
              WHERE n.nspname = 'app' AND p.proname = 'resolve_tax_policy') THEN
    RAISE EXCEPTION 'T1b: app.resolve_tax_policy now exists — wire core.put_quotation to it.';
  END IF;
  RAISE NOTICE 'T1 SKIPPED-BY-DEPENDENCY: neither core.tax_policies nor '
               'app.resolve_tax_policy() exists in 001-013, so the SST assertion ruling '
               'R-C asks for CANNOT BE MADE. 018 invents neither. It also does not need '
               'them: the contract''s Quotation carries no tax field — SST lives on '
               'core.invoices.sst_rate, which is 010''s. Re-open this assertion when a '
               'later pack adds the table and the resolver.';
  IF pg_catalog.to_regclass('core.tenant_tax_profiles') IS NULL THEN
    RAISE EXCEPTION 'T1c: core.tenant_tax_profiles is missing; doc 09 §10 names it.';
  END IF;
END
$t1$;

-- ── Become Alex, in tenant A. Every RPC assertion below runs as this
--    principal; `app.current_tenant_id()` reads `request.jwt.claims`. ───────
SELECT pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object(
    'sub', :'alex', 'tenant_id', :'tenant_a', 'app_role','SALES',
    'actor_kind','HUMAN', 'role','authenticated')::text, true);

\echo ''
\echo '════════ T2 · core.me — identity, and never a partial one ════════'
DO $t2$
DECLARE v jsonb; v_data jsonb;
BEGIN
  v := core.me();
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T2: me failed: %', v; END IF;
  -- THE ENVELOPE, exactly: `success` plus `data` and NOTHING ELSE. A third
  -- top-level key flips every client in the app from auto-unwrap to
  -- pass-through at once, which is the incident check:rpc E1 exists for.
  IF (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(v) AS k)
     <> ARRAY['data','success'] THEN
    RAISE EXCEPTION 'T2a: me envelope has keys beside data: %',
      (SELECT pg_catalog.array_agg(k) FROM pg_catalog.jsonb_object_keys(v) AS k);
  END IF;

  v_data := v -> 'data';
  -- doc 09 §3's pin, as behaviour rather than as text: a client that gets `me`
  -- WITHOUT `permissions` silently falls back to showing everything.
  IF NOT (v_data ? 'permissions') THEN RAISE EXCEPTION 'T2b: me has no permissions key'; END IF;
  IF pg_catalog.jsonb_array_length(v_data -> 'permissions') = 0 THEN
    RAISE EXCEPTION 'T2c: me returned an empty permission list for SALES';
  END IF;
  IF NOT (v_data -> 'permissions' @> '["enquiry:read"]'::jsonb) THEN
    RAISE EXCEPTION 'T2d: SALES is missing enquiry:read';
  END IF;
  -- Every REQUIRED key of the contract's `Me`, present.
  IF NOT (v_data ?& ARRAY['id','name','role','permissions','dataScope','locale','timezone','theme']) THEN
    RAISE EXCEPTION 'T2e: me is missing a required contract key: %', v_data;
  END IF;
  IF v_data ->> 'role' <> 'SALES' THEN RAISE EXCEPTION 'T2f: wrong role: %', v_data ->> 'role'; END IF;
  IF v_data ->> 'name' <> 'Alex Selvarajah' THEN RAISE EXCEPTION 'T2g: wrong name'; END IF;
  RAISE NOTICE 'T2 PASS: me is complete, envelope has exactly {success,data}, permissions non-empty.';
END
$t2$;

\echo ''
\echo '════════ T3 · core.me refuses a principal with no role ════════'
DO $t3$
DECLARE v jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub','22222222-2222-4222-8222-222222222222',
      'tenant_id','11111111-1111-4111-8111-111111111111',
      'actor_kind','HUMAN','role','authenticated')::text, true);
  v := core.me();
  -- NEVER A PARTIAL `me`: a shell that renders with a null role renders every
  -- gate OPEN, so the refusal must be a refusal and not a thin success.
  IF v -> 'success' <> 'false'::jsonb OR v #>> '{error,code}' <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T3: a roleless principal did not get FORBIDDEN: %', v;
  END IF;
  IF v ? 'data' THEN RAISE EXCEPTION 'T3b: a refusal carries a data key: %', v; END IF;
  RAISE NOTICE 'T3 PASS: no app_role -> FORBIDDEN, with no data key.';
END
$t3$;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object(
    'sub', :'alex', 'tenant_id', :'tenant_a', 'app_role','SALES',
    'actor_kind','HUMAN', 'role','authenticated')::text, true);

\echo ''
\echo '════════ T4 · list_enquiries — the pagination convention ════════'
DO $t4$
DECLARE v jsonb; v1 jsonb; v2 jsonb; v_cursor text; v_ids text[];
BEGIN
  v := core.list_enquiries('[]'::jsonb, NULL, '{"size":50}'::jsonb, NULL);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T4: %', v; END IF;

  -- TENANT ISOLATION: three rows, not four. The fourth lives in tenant B.
  IF (v #>> '{data,page,total}')::integer <> 3 THEN
    RAISE EXCEPTION 'T4a: expected 3 enquiries in tenant A, got %', v #>> '{data,page,total}';
  END IF;

  -- THE PIN doc 09 §5 SAYS A TEST CATCHES AND A REVIEWER DOES NOT:
  -- `next` is PRESENT-AND-NULL on a terminal page, never absent. The client's
  -- unwrap rule is sensitive to key sets and an omitted key changes the shape.
  IF NOT ((v -> 'data' -> 'page') ? 'next') THEN
    RAISE EXCEPTION 'T4b: page.next is ABSENT on the last page; it must be present and null';
  END IF;
  IF (v #> '{data,page,next}') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'T4c: page.next is not null on the last page: %', v #> '{data,page,next}';
  END IF;

  -- KEYSET PAGING actually pages: two pages of two and one, no repeats.
  v1 := core.list_enquiries('[]'::jsonb, NULL, '{"size":2}'::jsonb, NULL);
  IF (v1 #> '{data,page,next}') = 'null'::jsonb THEN
    RAISE EXCEPTION 'T4d: page.next is null on a non-terminal page';
  END IF;
  v_cursor := v1 #>> '{data,page,next}';
  v2 := core.list_enquiries('[]'::jsonb, NULL,
          pg_catalog.jsonb_build_object('size',2,'cursor',v_cursor), NULL);
  IF pg_catalog.jsonb_array_length(v2 -> 'data' -> 'data') <> 1 THEN
    RAISE EXCEPTION 'T4e: page 2 returned % rows, expected 1',
      pg_catalog.jsonb_array_length(v2 -> 'data' -> 'data');
  END IF;
  SELECT pg_catalog.array_agg(e ->> 'id') INTO v_ids
    FROM pg_catalog.jsonb_array_elements(
           (v1 -> 'data' -> 'data') || (v2 -> 'data' -> 'data')) AS e;
  IF pg_catalog.array_length(v_ids,1) <> 3
     OR (SELECT pg_catalog.count(DISTINCT u) FROM pg_catalog.unnest(v_ids) AS u) <> 3 THEN
    RAISE EXCEPTION 'T4f: keyset paging repeated or dropped a row: %', v_ids;
  END IF;
  IF (v2 #> '{data,page,next}') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'T4g: page.next is not null on the final page';
  END IF;
  RAISE NOTICE 'T4 PASS: 3 rows, next present-and-null at the end, keyset paging exact.';
END
$t4$;

\echo ''
\echo '════════ T5 · list_enquiries FAILS CLOSED and records filter source ════════'
DO $t5$
DECLARE v jsonb; v_view text;
BEGIN
  -- An UNRECOGNISED FILTER MUST NOT BE IGNORED. Ignoring it shows rows the
  -- reader explicitly asked to exclude, which reads as missing data rather
  -- than as a refusal.
  v := core.list_enquiries('[{"field":"nonesuch","op":"eq","value":"x"}]'::jsonb, NULL, NULL, NULL);
  IF v -> 'success' <> 'false'::jsonb OR v #>> '{error,code}' <> 'VALIDATION_FAILED' THEN
    RAISE EXCEPTION 'T5a: an unknown filter field was not refused: %', v;
  END IF;
  IF v #>> '{error,details,fields,0,reason}' <> 'UNKNOWN_FILTER_FIELD' THEN
    RAISE EXCEPTION 'T5b: no details.fields[] on the refusal: %', v;
  END IF;

  v := core.list_enquiries('[{"field":"status","op":"wat","value":"OPEN"}]'::jsonb, NULL, NULL, NULL);
  IF v -> 'success' <> 'false'::jsonb THEN RAISE EXCEPTION 'T5c: an unknown op was accepted: %', v; END IF;

  v := core.list_enquiries('[]'::jsonb, '-nonesuch', NULL, NULL);
  IF v -> 'success' <> 'false'::jsonb OR v #>> '{error,details,fields,0,field}' <> 'sort' THEN
    RAISE EXCEPTION 'T5d: a malformed SORT did not read as a malformed sort: %', v;
  END IF;

  v := core.list_enquiries('[]'::jsonb, NULL, '{"size":2,"cursor":"not-a-cursor"}'::jsonb, NULL);
  IF v -> 'success' <> 'false'::jsonb
     OR v #>> '{error,details,fields,0,reason}' <> 'MALFORMED_CURSOR' THEN
    RAISE EXCEPTION 'T5e: a malformed cursor was not refused: %', v;
  END IF;

  -- The filter actually filters, and `appliedFilters[].source` says who asked.
  v := core.list_enquiries('[{"field":"status","op":"eq","value":"OPEN"}]'::jsonb,
                           '-receivedAt', '{"size":50}'::jsonb, NULL);
  IF (v #>> '{data,page,total}')::integer <> 2 THEN
    RAISE EXCEPTION 'T5f: status=OPEN returned %, expected 2', v #>> '{data,page,total}';
  END IF;
  IF v #>> '{data,appliedFilters,0,source}' <> 'REQUEST' THEN
    RAISE EXCEPTION 'T5g: a request filter is not sourced REQUEST: %', v -> 'data' -> 'appliedFilters';
  END IF;

  -- A SAVED VIEW contributes filters and is sourced VIEW, so the UI can show a
  -- reader WHY rows are missing.
  SELECT id::text INTO v_view FROM core.saved_views
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111' LIMIT 1;
  v := core.list_enquiries('[]'::jsonb, NULL, '{"size":50}'::jsonb, v_view);
  IF (v #>> '{data,page,total}')::integer <> 2 THEN
    RAISE EXCEPTION 'T5h: the saved view did not apply: %', v -> 'data' -> 'page';
  END IF;
  IF v #>> '{data,appliedFilters,0,source}' <> 'VIEW' THEN
    RAISE EXCEPTION 'T5i: a view filter is not sourced VIEW: %', v -> 'data' -> 'appliedFilters';
  END IF;

  -- REQUEST FILTERS WIN over the view's on the same field.
  v := core.list_enquiries('[{"field":"status","op":"eq","value":"ASSIGNED"}]'::jsonb,
                           NULL, '{"size":50}'::jsonb, v_view);
  IF (v #>> '{data,page,total}')::integer <> 1 THEN
    RAISE EXCEPTION 'T5j: the request filter did not beat the view''s: %', v -> 'data' -> 'page';
  END IF;
  IF pg_catalog.jsonb_array_length(v -> 'data' -> 'appliedFilters') <> 1 THEN
    RAISE EXCEPTION 'T5k: both filters were applied to the same field';
  END IF;
  RAISE NOTICE 'T5 PASS: fail-closed on field/op/sort/cursor; source recorded; request beats view.';
END
$t5$;

\echo ''
\echo '════════ T6 · get_enquiry — ABSENT PROVENANCE MEANS HUMAN-AUTHORED ════════'
DO $t6$
DECLARE v jsonb; d jsonb;
BEGIN
  v := core.get_enquiry('ddddddd1-0000-4000-8000-000000000001');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T6: %', v; END IF;
  d := v -> 'data';

  -- doc 09 §6's pin. `topic` HAS a provenance row; `audience` does not. The AI
  -- badge renders on PRESENCE, so a null provenance would badge every
  -- hand-typed field in the product.
  IF NOT (d #> '{extraction,topic}' ? 'provenance') THEN
    RAISE EXCEPTION 'T6a: topic has a provenance row but emits no provenance key';
  END IF;
  IF (d #> '{extraction,audience}') ? 'provenance' THEN
    RAISE EXCEPTION 'T6b: audience has NO provenance row but emitted a provenance key — '
                    'that badges a hand-typed field as AI';
  END IF;
  -- `value` is ALWAYS present even when it is null: the contract's own example
  -- is a budget the model is confident is absent.
  IF NOT (d #> '{extraction,timing}' ? 'value') THEN
    RAISE EXCEPTION 'T6c: an unextracted field dropped its value key entirely';
  END IF;
  IF (d #> '{extraction,timing,value}') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'T6d: timing should be null, got %', d #> '{extraction,timing,value}';
  END IF;
  -- §4 types `budget` as Money, not as a string.
  IF (d #>> '{extraction,budget,value,amount}')::bigint <> 4000000
     OR d #>> '{extraction,budget,value,currency}' <> 'MYR' THEN
    RAISE EXCEPTION 'T6e: budget is not Money: %', d #> '{extraction,budget,value}';
  END IF;
  IF d #>> '{extraction,topic,provenance,origin}' <> 'AI_GENERATED'
     OR (d #>> '{extraction,topic,provenance,confidence}')::numeric <> 0.860 THEN
    RAISE EXCEPTION 'T6f: provenance did not project: %', d #> '{extraction,topic,provenance}';
  END IF;
  IF pg_catalog.jsonb_array_length(d #> '{extraction,topic,provenance,sources}') <> 1 THEN
    RAISE EXCEPTION 'T6g: sources did not project';
  END IF;
  IF NOT (d ?& ARRAY['body','extraction','related','classification','matchedOrganisation']) THEN
    RAISE EXCEPTION 'T6h: EnquiryDetail is missing a required key';
  END IF;
  -- Accepts a REF as well as a uuid; the app routes on refs.
  IF core.get_enquiry(d ->> 'ref') #>> '{data,id}' <> (d ->> 'id') THEN
    RAISE EXCEPTION 'T6i: lookup by ref did not return the same row';
  END IF;
  RAISE NOTICE 'T6 PASS: provenance present on AI fields and ABSENT on human ones; '
               'value always present; budget is Money; id-or-ref both resolve.';
END
$t6$;

\echo ''
\echo '════════ T7 · NOT_FOUND is not a cross-tenant existence oracle ════════'
DO $t7$
DECLARE v_other jsonb; v_absent jsonb;
BEGIN
  -- The tenant-B enquiry EXISTS. A caller in tenant A must get a refusal that
  -- is BYTE-IDENTICAL to the one for a row that does not exist at all, because
  -- any difference is an existence oracle for another tenant's data.
  v_other  := core.get_enquiry('ddddddd1-0000-4000-8000-000000000009');
  v_absent := core.get_enquiry('00000000-0000-4000-8000-00000000dead');
  IF v_other #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T7a: a cross-tenant read did not refuse: %', v_other;
  END IF;
  IF (v_other -> 'error' -> 'code') IS DISTINCT FROM (v_absent -> 'error' -> 'code') THEN
    RAISE EXCEPTION 'T7b: cross-tenant and not-found refuse differently';
  END IF;
  IF v_other ? 'data' THEN RAISE EXCEPTION 'T7c: a refusal leaked a data key'; END IF;
  IF v_other::text LIKE '%TENANT B SECRET%' THEN
    RAISE EXCEPTION 'T7d: the refusal leaked the other tenant''s subject line';
  END IF;
  IF core.get_organisation('bbbbbbb1-0000-4000-8000-000000000002') #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T7e: get_organisation read across tenants';
  END IF;
  RAISE NOTICE 'T7 PASS: cross-tenant and not-found are the same refusal, and neither leaks.';
END
$t7$;

\echo ''
\echo '════════ T8 · Organisation 360, contacts, opportunities ════════'
DO $t8$
DECLARE v jsonb; d jsonb;
BEGIN
  v := core.get_organisation('bbbbbbb1-0000-4000-8000-000000000001');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T8: %', v; END IF;
  d := v -> 'data';
  IF NOT (d -> 'metrics' ?& ARRAY['lifetimeValue','openPipeline','arOverdue',
                                  'hrdcLevyAvailable','healthScore']) THEN
    RAISE EXCEPTION 'T8a: the §5 metric strip is incomplete: %', d -> 'metrics';
  END IF;
  -- Four metrics are Money; `healthScore` is a 0-100 composite and is a BARE
  -- NUMBER. A screen that formatted it as currency would print RM 0.72.
  IF pg_catalog.jsonb_typeof(d #> '{metrics,lifetimeValue,value}') <> 'object'
     OR NOT (d #> '{metrics,lifetimeValue,value}' ?& ARRAY['amount','currency']) THEN
    RAISE EXCEPTION 'T8b: lifetimeValue is not Money: %', d #> '{metrics,lifetimeValue,value}';
  END IF;
  IF pg_catalog.jsonb_typeof(d #> '{metrics,healthScore,value}') <> 'number' THEN
    RAISE EXCEPTION 'T8c: healthScore is not a bare number: %', d #> '{metrics,healthScore,value}';
  END IF;
  -- Each metric carries its own drillTo: the UI never hardcodes a drill route.
  IF NOT (d #> '{metrics,arOverdue}' ? 'drillTo') THEN
    RAISE EXCEPTION 'T8d: a metric has no drillTo';
  END IF;
  -- openPipeline counts the QUALIFYING deal.
  IF (d #>> '{metrics,openPipeline,value,amount}')::bigint <> 4000000 THEN
    RAISE EXCEPTION 'T8e: openPipeline = %, expected 4000000', d #> '{metrics,openPipeline,value}';
  END IF;

  d := core.get_contact('ccccccc1-0000-4000-8000-000000000001') -> 'data';
  IF (d #> '{consent,email}') <> 'true'::jsonb OR (d #> '{consent,whatsapp}') <> 'false'::jsonb THEN
    RAISE EXCEPTION 'T8f: consent did not project per channel: %', d -> 'consent';
  END IF;

  d := core.get_opportunity('OPP-2026-0001') -> 'data';
  IF d ->> 'organisationRef' <> 'ORG-0001' THEN
    RAISE EXCEPTION 'T8g: opportunity did not resolve its organisation ref: %', d ->> 'organisationRef';
  END IF;
  -- OPTIONAL KEYS ARE OMITTED, NOT NULLED. `expectedCloseDate` has no column
  -- in 001-013, so it must be absent rather than present-and-null.
  IF d ? 'expectedCloseDate' THEN
    RAISE EXCEPTION 'T8h: expectedCloseDate is emitted but has no source column';
  END IF;
  IF NOT (d ? 'probability') THEN RAISE EXCEPTION 'T8i: a scored deal dropped probability'; END IF;

  -- The §7 relations VIEW, read the way rpcClient.ts reads it.
  IF NOT EXISTS (SELECT 1 FROM core.v_organisation_relations
                  WHERE organisation_id = 'bbbbbbb1-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'T8j: v_organisation_relations returned no row for a real organisation';
  END IF;
  IF (SELECT pg_catalog.jsonb_array_length(contacts) FROM core.v_organisation_relations
       WHERE organisation_id = 'bbbbbbb1-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'T8k: the relations view did not compose contacts';
  END IF;
  RAISE NOTICE 'T8 PASS: metric strip complete, healthScore a bare number, consent per '
               'channel, optional keys omitted, relations view composes.';
END
$t8$;

\echo ''
\echo '════════ T9 · STAGE NAMES AND ORDER RENDER FROM CONFIGURATION ════════'
DO $t9$
DECLARE v jsonb; d jsonb; v_nav jsonb;
BEGIN
  v := core.get_pipeline_config('OPPORTUNITY');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T9: %', v; END IF;
  d := v -> 'data';
  IF pg_catalog.jsonb_array_length(d -> 'stages') <> 4 THEN
    RAISE EXCEPTION 'T9a: expected 4 configured stages, got %',
      pg_catalog.jsonb_array_length(d -> 'stages');
  END IF;
  -- The LABEL is the configured word, not a prettified key. If this ever
  -- returns 'New' for a row labelled 'Brand new', a stage list has been inlined.
  IF d #>> '{stages,0,label}' <> 'New' OR d #>> '{stages,1,label}' <> 'Qualifying' THEN
    RAISE EXCEPTION 'T9b: labels did not come from core.pipeline_steps: %', d -> 'stages';
  END IF;
  IF (d #>> '{stages,0,order}')::int <> 1 OR (d #>> '{stages,3,order}')::int <> 4 THEN
    RAISE EXCEPTION 'T9c: stage order did not come from position';
  END IF;
  -- Ruling R16: `terminal` is STORED, not inferred from `order`. Inferring an
  -- ending from the highest order puts LOST after WON rather than beside it.
  IF (d #> '{stages,2,terminal}') <> 'true'::jsonb OR (d #> '{stages,0,terminal}') <> 'false'::jsonb THEN
    RAISE EXCEPTION 'T9d: terminal was inferred rather than read: %', d -> 'stages';
  END IF;
  -- `outcome` has no source column in 001-013 and must be ABSENT, not guessed.
  IF (d #> '{stages,2}') ? 'outcome' THEN
    RAISE EXCEPTION 'T9e: outcome is emitted but core.pipeline_steps has no outcome column';
  END IF;

  -- PROVE THE FUNCTION READS THE TABLE, by changing the table. This is the
  -- assertion a text-grep pin cannot make.
  UPDATE core.pipeline_steps SET label = 'Renamed By The Pin'
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
     AND pipeline_id = 'aaaaaaa1-0000-4000-8000-000000000001' AND step_key = 'NEW';
  IF core.get_pipeline_config('OPPORTUNITY') #>> '{data,stages,0,label}' <> 'Renamed By The Pin' THEN
    RAISE EXCEPTION 'T9f: renaming a pipeline_steps row did NOT change the config output — '
                    'a stage list is inlined somewhere';
  END IF;
  v_nav := core.navigation();
  IF v_nav::text NOT LIKE '%Renamed By The Pin%' THEN
    RAISE EXCEPTION 'T9g: core.navigation does not render stage labels from core.pipeline_steps';
  END IF;
  UPDATE core.pipeline_steps SET label = 'New'
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
     AND pipeline_id = 'aaaaaaa1-0000-4000-8000-000000000001' AND step_key = 'NEW';

  -- KNOWN DIVERGENCE, asserted so it cannot be forgotten: the contract names
  -- DEAL_CHAIN and 004's CHECK does not allow it.
  IF core.get_pipeline_config('DEAL_CHAIN') #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T9h: DEAL_CHAIN now resolves — 004 and the contract have been '
                    'reconciled; revisit get_pipeline_config';
  END IF;
  RAISE NOTICE 'T9 PASS: stages render from core.pipeline_steps (proved by renaming one), '
               'terminal is stored, outcome omitted, DEAL_CHAIN divergence pinned.';
END
$t9$;

\echo ''
\echo '════════ T10 · navigation and badge_counts ════════'
DO $t10$
DECLARE v jsonb; d jsonb; v_badges jsonb;
BEGIN
  v := core.navigation();
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T10: %', v; END IF;
  d := v -> 'data';
  IF NOT (d ? 'groups') OR pg_catalog.jsonb_array_length(d -> 'groups') = 0 THEN
    RAISE EXCEPTION 'T10a: an empty nav tree is a bug, not an empty state: %', d;
  END IF;
  IF NOT (d #> '{groups,0}' ?& ARRAY['caption','parents']) THEN
    RAISE EXCEPTION 'T10b: a nav group is not {caption,parents}: %', d #> '{groups,0}';
  END IF;
  -- ROLE-FILTERED FROM app.role_permissions: SALES holds enquiry:read and does
  -- NOT hold agent:read, so one item appears and the other does not.
  IF d::text NOT LIKE '%"key": "enquiries"%' THEN
    RAISE EXCEPTION 'T10c: SALES holds enquiry:read but has no enquiries item';
  END IF;
  IF d::text LIKE '%"key": "agents"%' THEN
    RAISE EXCEPTION 'T10d: SALES does not hold agent:read but was given the agents item — '
                    'the nav is not role-filtered';
  END IF;

  v_badges := core.badge_counts();
  IF v_badges -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T10e: %', v_badges; END IF;
  IF NOT (v_badges -> 'data' ?& ARRAY['approvals','hrdcDeadlines','agentFailures']) THEN
    RAISE EXCEPTION 'T10f: BadgeCounts is incomplete: %', v_badges -> 'data';
  END IF;
  IF pg_catalog.jsonb_typeof(v_badges #> '{data,approvals}') <> 'number' THEN
    RAISE EXCEPTION 'T10g: a badge count is not a number';
  END IF;
  RAISE NOTICE 'T10 PASS: nav is grouped, role-filtered (enquiries in, agents out); '
               'badge counts complete and numeric.';
END
$t10$;

\echo ''
\echo '════════ T11 · TNA — read-only, never generate on demand ════════'
DO $t11$
DECLARE v jsonb; d jsonb;
BEGIN
  d := core.get_tna('a1111111-0000-4000-8000-000000000001') -> 'data';
  IF d ->> 'status' <> 'COMPLETE' THEN RAISE EXCEPTION 'T11a: wrong status'; END IF;
  -- §12 widens completedBy to AnyActor, which includes CLIENT.
  IF d #>> '{completedBy,kind}' <> 'CLIENT' THEN
    RAISE EXCEPTION 'T11b: completedBy.kind did not carry CLIENT: %', d -> 'completedBy';
  END IF;
  IF (d #>> '{audience,headcount}')::int <> 40 THEN RAISE EXCEPTION 'T11c: audience did not project'; END IF;
  IF (d #>> '{budget,amount}')::bigint <> 4000000 THEN RAISE EXCEPTION 'T11d: budget is not Money'; END IF;
  -- §6: `severity` appears ONLY on a constraint that is at risk.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(d -> 'constraints') AS c
       WHERE c.value ? 'severity') <> 1 THEN
    RAISE EXCEPTION 'T11e: severity is emitted on constraints that are not at risk: %',
      d -> 'constraints';
  END IF;

  v := core.get_tna_recommendations('a1111111-0000-4000-8000-000000000001');
  d := v -> 'data';
  IF NOT (d ?& ARRAY['data','provenance','scoringModel']) THEN
    RAISE EXCEPTION 'T11f: TnaRecommendationsResponse is incomplete: %', d;
  END IF;
  IF d #>> '{scoringModel,version}' <> 'fit-v2' THEN
    RAISE EXCEPTION 'T11g: scoringModel.version did not project';
  END IF;
  IF (d #>> '{data,0,fitScore}')::numeric <> 0.910 THEN
    RAISE EXCEPTION 'T11h: fitScore did not project';
  END IF;

  -- AN EMPTY RECOMMENDATION LIST IS A LEGITIMATE ANSWER, NOT A 404: the worker
  -- has not run yet. This is the difference between "no fit found" and "this
  -- TNA does not exist", and conflating them sends a reader hunting a record
  -- that is right in front of them.
  DELETE FROM core.tna_recommendations
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
  v := core.get_tna_recommendations('a1111111-0000-4000-8000-000000000001');
  IF v -> 'success' <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T11i: an unscored TNA returned an error instead of an empty list: %', v;
  END IF;
  IF pg_catalog.jsonb_array_length(v #> '{data,data}') <> 0 THEN
    RAISE EXCEPTION 'T11j: expected an empty recommendation list';
  END IF;
  IF NOT (v #> '{data}' ? 'provenance') THEN
    RAISE EXCEPTION 'T11k: provenance is required on this response and went missing';
  END IF;
  RAISE NOTICE 'T11 PASS: TNA reads worker rows, CLIENT completedBy, severity only when '
               'at risk, empty recommendations are a 200 and not a 404.';
END
$t11$;

\echo ''
\echo '════════ T12 · create_proposal — the key can never be decorative ════════'
DO $t12$
DECLARE v jsonb; v2 jsonb; v_id text; v_keys integer; v_body jsonb; v_detail jsonb;
BEGIN
  v_body := pg_catalog.jsonb_build_object(
    'opportunityRef','OPP-2026-0001',
    'templateId','c3333333-0000-4000-8000-000000000001',
    'programmeId','b2222222-0000-4000-8000-000000000001');

  -- IDEMPOTENCY IS REQUIRED, NOT OPTIONAL. Two governed writes were already
  -- found sending no key at all, which is how a double-click becomes two
  -- proposals.
  BEGIN
    PERFORM core.create_proposal(v_body, NULL);
    RAISE EXCEPTION 'T12a: create_proposal accepted a missing idempotency key';
  EXCEPTION WHEN sqlstate 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb) ->> 'code' <> 'VALIDATION_FAILED' THEN
      RAISE EXCEPTION 'T12b: wrong code for a missing key: %', v_detail;
    END IF;
  END;

  v := core.create_proposal(v_body, 'key-alpha');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T12c: %', v; END IF;
  v_id := v #>> '{data,id}';
  -- Sections come from the TEMPLATE, in the template's own order.
  IF pg_catalog.jsonb_array_length(v #> '{data,sections}') <> 2 THEN
    RAISE EXCEPTION 'T12d: sections did not come from the template: %', v #> '{data,sections}';
  END IF;
  IF v #>> '{data,sections,0,title}' <> 'Understanding' THEN
    RAISE EXCEPTION 'T12e: section order did not follow the template';
  END IF;

  -- doc 09 §9's pin, as behaviour: the key is written, so it cannot be decorative.
  SELECT pg_catalog.count(*)::integer INTO v_keys FROM app.idempotency_keys
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
     AND endpoint = 'POST /v1/proposals' AND key = 'key-alpha';
  IF v_keys <> 1 THEN RAISE EXCEPTION 'T12f: create_proposal wrote no idempotency key'; END IF;

  -- A RETRY WITH THE SAME BODY RETURNS THE ORIGINAL, and creates no second row.
  v2 := core.create_proposal(v_body, 'key-alpha');
  IF v2 #>> '{data,id}' <> v_id THEN
    RAISE EXCEPTION 'T12g: a replay created a SECOND proposal — this is the double-click bug';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.proposals
       WHERE tenant_id = '11111111-1111-4111-8111-111111111111') <> 1 THEN
    RAISE EXCEPTION 'T12h: a replay wrote a second proposal row';
  END IF;

  -- THE SAME KEY WITH A DIFFERENT BODY IS `IDEMPOTENT_REPLAY`, not a silent
  -- second write and not a silent first answer.
  BEGIN
    PERFORM core.create_proposal(v_body || '{"templateId":"c3333333-0000-4000-8000-000000000001",
                                             "programmeId":"b2222222-0000-4000-8000-000000000001",
                                             "opportunityRef":"OPP-2026-0001",
                                             "extra":"changed"}'::jsonb, 'key-alpha');
    RAISE EXCEPTION 'T12i: a reused key with a different body was accepted';
  EXCEPTION WHEN sqlstate 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb) ->> 'code' <> 'IDEMPOTENT_REPLAY' THEN
      RAISE EXCEPTION 'T12j: wrong code for a changed body: %', v_detail;
    END IF;
  END;

  -- An unknown opportunityRef is NOT_FOUND, raised (so nothing is left behind).
  BEGIN
    PERFORM core.create_proposal(
      v_body || '{"opportunityRef":"OPP-2026-9999"}'::jsonb, 'key-beta');
    RAISE EXCEPTION 'T12k: an unknown opportunityRef was accepted';
  EXCEPTION WHEN sqlstate 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb) ->> 'code' <> 'NOT_FOUND' THEN
      RAISE EXCEPTION 'T12l: wrong code for an unknown opportunity: %', v_detail;
    END IF;
  END;
  RAISE NOTICE 'T12 PASS: key required, key written, same-body replay returns the original '
               'and writes no second row, changed body is IDEMPOTENT_REPLAY.';
END
$t12$;

\echo ''
\echo '════════ T13 · put_quotation — LINES ARE TRUTH ════════'
DO $t13$
DECLARE
  v jsonb; d jsonb; v_quote uuid; v_prop uuid; v_lines jsonb; v_detail jsonb;
BEGIN
  SELECT id INTO v_prop FROM core.proposals
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111' LIMIT 1;

  INSERT INTO core.quotations
    (tenant_id, proposal_id, rate_card_id, pax, programme_floor_price_sen,
     floor_margin_rate, commission_rate, commission_payable_on, status,
     created_by_kind, created_by_id)
  VALUES ('11111111-1111-4111-8111-111111111111', v_prop,
          'd4444444-0000-4000-8000-000000000001', 40, 2800000, 0.3000, 0.0500,
          'COLLECTION', 'DRAFT', 'HUMAN', '22222222-2222-4222-8222-222222222222')
  RETURNING id INTO v_quote;

  -- 3 days x RM 12,000.00 = RM 36,000.00 sell; 1 x RM 2,000.00 cost.
  -- Absolute floor RM 28,000.00; margin floor ceil(200000 / 0.7) = RM 2,857.15.
  -- The HIGHER of the two binds, so ABSOLUTE binds and RM 36,000 clears it.
  v_lines := '{"lines":[
     {"item":"Trainer days","qty":3,"unit":"DAY","basis":"PER_DAY",
      "rate":{"amount":1200000,"currency":"MYR"},
      "total":{"amount":3600000,"currency":"MYR"},"isCost":false},
     {"item":"Materials","qty":1,"unit":"PAX","basis":"PER_UNIT",
      "rate":{"amount":200000,"currency":"MYR"},
      "total":{"amount":200000,"currency":"MYR"},"isCost":true}]}'::jsonb;

  v := core.put_quotation(v_quote::text, v_lines, 'quote-key-1');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T13a: %', v; END IF;
  d := v -> 'data';

  -- TOTALS SUM THE ROUNDED LINES. The header is not written by this function;
  -- 007's recalc trigger produces it from the lines, and that is the point.
  IF (d #>> '{sellPrice,amount}')::bigint <> 3600000 THEN
    RAISE EXCEPTION 'T13b: sellPrice = %, expected 3600000', d #> '{sellPrice}';
  END IF;
  IF (d #>> '{directCost,amount}')::bigint <> 200000 THEN
    RAISE EXCEPTION 'T13c: directCost = %, expected 200000', d #> '{directCost}';
  END IF;

  -- RULING R6: BOTH floors are published and the BINDING one is named, mapped
  -- from 007's 'PROGRAMME' to the contract's 'ABSOLUTE'.
  IF NOT (d ?& ARRAY['absoluteFloorPrice','marginFloorPrice','bindingFloorBasis','floorPrice']) THEN
    RAISE EXCEPTION 'T13d: the R6 floor block is incomplete: %', d;
  END IF;
  IF d ->> 'bindingFloorBasis' NOT IN ('ABSOLUTE','MARGIN') THEN
    RAISE EXCEPTION 'T13e: bindingFloorBasis leaked 007''s PROGRAMME spelling: %',
      d ->> 'bindingFloorBasis';
  END IF;
  -- marginFloor = ceil(200000 / 0.7) = 285715; absolute = 2800000. The HIGHER
  -- one binds (DECISIONS §5 + doc 04), so the basis must read ABSOLUTE.
  IF (d #>> '{absoluteFloorPrice,amount}')::bigint <> 2800000 THEN
    RAISE EXCEPTION 'T13f: absoluteFloorPrice = %', d #> '{absoluteFloorPrice}';
  END IF;
  IF d ->> 'bindingFloorBasis' <> 'ABSOLUTE' THEN
    RAISE EXCEPTION 'T13g: the higher floor did not bind: %', d ->> 'bindingFloorBasis';
  END IF;

  -- A PER-PAX FIGURE IS DISPLAY ONLY and lives under `display`, never as a line.
  IF NOT (d #> '{display}' ? 'perPax') THEN
    RAISE EXCEPTION 'T13h: display.perPax is missing';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(d -> 'lines') AS l
       WHERE l.value ->> 'item' ILIKE '%pax%' AND l.value ->> 'unit' IS NULL) > 0 THEN
    RAISE EXCEPTION 'T13i: a per-pax display figure became a line';
  END IF;
  IF pg_catalog.jsonb_array_length(d -> 'lines') <> 2 THEN
    RAISE EXCEPTION 'T13j: expected 2 lines, got %', pg_catalog.jsonb_array_length(d -> 'lines');
  END IF;

  -- A LINE TOTAL THAT IS NOT rate x qty ROUNDED HALF-UP IS REFUSED. Getting
  -- this wrong does not look like a bug; it looks like an invoice one sen out.
  BEGIN
    PERFORM core.put_quotation(v_quote::text,
      '{"lines":[{"item":"Trainer days","qty":3,"basis":"PER_DAY",
                  "rate":{"amount":1200000,"currency":"MYR"},
                  "total":{"amount":3600001,"currency":"MYR"},"isCost":false}]}'::jsonb,
      'quote-key-2');
    RAISE EXCEPTION 'T13k: a line one sen out was ACCEPTED';
  EXCEPTION WHEN sqlstate 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb) ->> 'reason' <> 'TOTAL_NOT_RECONCILED' THEN
      RAISE EXCEPTION 'T13l: wrong reason for an unreconciled line: %', v_detail;
    END IF;
  END;

  -- HALF-UP, NOT BANKER'S: 2.5 sen rounds to 3, away from zero.
  IF app.round_half_up_sen(2.5) <> 3 OR app.round_half_up_sen(3.5) <> 4 THEN
    RAISE EXCEPTION 'T13m: rounding is not half-up';
  END IF;
  RAISE NOTICE 'T13 PASS: totals sum the rounded lines, R6 floors complete and mapped to '
               'ABSOLUTE, per-pax is display-only, a one-sen line is refused.';
END
$t13$;

\echo ''
\echo '════════ T14 · FLOOR_PRICE_BREACH carries the whole R6 bag ════════'
DO $t14$
DECLARE v_quote uuid; v_prop uuid; v_detail jsonb;
BEGIN
  SELECT id INTO v_prop FROM core.proposals
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111' LIMIT 1;
  -- version 2: (tenant_id, proposal_id, version) is UNIQUE, and T13 already
  -- took version 1 on this proposal. A quotation is versioned per proposal by
  -- design — a re-price supersedes rather than overwrites.
  INSERT INTO core.quotations
    (tenant_id, proposal_id, rate_card_id, pax, version, programme_floor_price_sen,
     floor_margin_rate, status, created_by_kind, created_by_id)
  VALUES ('11111111-1111-4111-8111-111111111111', v_prop,
          'd4444444-0000-4000-8000-000000000001', 40, 2, 2800000, 0.3000,
          'DRAFT', 'HUMAN', '22222222-2222-4222-8222-222222222222')
  RETURNING id INTO v_quote;

  -- RM 1,000.00 sell against an RM 28,000.00 absolute floor, with no
  -- DISCOUNT_APPROVE behind it.
  BEGIN
    PERFORM core.put_quotation(v_quote::text,
      '{"lines":[{"item":"Discounted package","qty":1,"basis":"PACKAGE",
                  "rate":{"amount":100000,"currency":"MYR"},
                  "total":{"amount":100000,"currency":"MYR"},"isCost":false}]}'::jsonb,
      'quote-key-floor');
    RAISE EXCEPTION 'T14a: a below-floor price was ACCEPTED with no approval behind it';
  EXCEPTION WHEN sqlstate 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF v_detail ->> 'code' <> 'FLOOR_PRICE_BREACH' THEN
      RAISE EXCEPTION 'T14b: wrong code: %', v_detail;
    END IF;
    -- The FULL R6 bag. `floorPrice` alone says a price is too low; it does not
    -- say WHICH constraint made it too low, and the two are acted on
    -- differently — an absolute breach is a conversation about the tier, a
    -- margin breach is a conversation about cost.
    IF NOT (v_detail ?& ARRAY['floorPrice','resultingMarginRate','requiresPolicy',
                              'absoluteFloorPrice','marginFloorPrice','bindingFloorBasis']) THEN
      RAISE EXCEPTION 'T14c: the R6 detail bag is incomplete: %', v_detail;
    END IF;
    IF v_detail ->> 'bindingFloorBasis' NOT IN ('ABSOLUTE','MARGIN') THEN
      RAISE EXCEPTION 'T14d: the refusal leaked 007''s PROGRAMME spelling: %', v_detail;
    END IF;
    -- POLICY_APPROVAL_REQUIRED IS NOT RAISED HERE. A discount that needs
    -- approval goes through DISCOUNT_APPROVE on core.perform_action, which is
    -- the one endpoint that gates approvals.
    IF v_detail ->> 'code' = 'POLICY_APPROVAL_REQUIRED' THEN
      RAISE EXCEPTION 'T14e: put_quotation raised POLICY_APPROVAL_REQUIRED; that belongs '
                      'to core.perform_action';
    END IF;
  END;
  RAISE NOTICE 'T14 PASS: below-floor refused with the complete R6 bag, basis mapped, and '
               'no POLICY_APPROVAL_REQUIRED from this endpoint.';
END
$t14$;

\echo ''
\echo '════════ T15 · Approvals — list, groups, detail, and the wrappers ════════'
DO $t15$
DECLARE v jsonb; d jsonb; v_req uuid; v_apv uuid;
BEGIN
  INSERT INTO core.action_requests
    (id,tenant_id,action_type,target_ref,payload,requested_by_kind,requested_by_id,
     requested_by_role,evidence,context_flags,evaluation_trace,status,effects)
  VALUES (pg_catalog.gen_random_uuid(),'11111111-1111-4111-8111-111111111111',
          'PROPOSAL_SEND','PRO-2026-0001','{}'::jsonb,'HUMAN',
          '22222222-2222-4222-8222-222222222222','SALES','[]'::jsonb,'{}'::jsonb,
          '[]'::jsonb,'QUEUED_FOR_APPROVAL','[]'::jsonb)
  RETURNING id INTO v_req;

  INSERT INTO core.approval_requests
    (tenant_id,action_request_id,policy_id,action_type,subject,target_ref,value_sen,currency,
     requested_by_kind,requested_by_id,requested_by_name,reason,recommendation,evidence,
     deviations,risk,diff,diff_hash,approver_role,assigned_to_id,assigned_to_name,
     sla_due_at,expires_at,bulk_approvable,status)
  VALUES ('11111111-1111-4111-8111-111111111111',v_req,'APV-01','PROPOSAL_SEND',
          'Send proposal to Chrome Manufacturing','PRO-2026-0001',4000000,'MYR',
          'HUMAN','22222222-2222-4222-8222-222222222222','Alex Selvarajah',
          'First proposal to this organisation',
          '{"verdict":"APPROVE","rationale":"Within band"}'::jsonb,
          '[{"n":1,"type":"PROPOSAL","ref":"PRO-2026-0001","label":"Draft"}]'::jsonb,
          '["First proposal to this org"]'::jsonb,
          '{"level":"LOW","note":"Standard"}'::jsonb,
          '[{"op":"UPDATE","entity":"proposal","ref":"PRO-2026-0001","description":"Mark sent"}]'::jsonb,
          'deadbeef','MD','33333333-3333-4333-8333-333333333333','Mei Ling',
          pg_catalog.now() + interval '30 minutes', pg_catalog.now() + interval '24 hours',
          true,'PENDING')
  RETURNING id INTO v_apv;

  v := core.list_approvals('[]'::jsonb, NULL, '{"size":50}'::jsonb, NULL);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T15a: %', v; END IF;
  d := v -> 'data';
  -- `groups` sits BESIDE `data` INSIDE the data object — one level down from
  -- the envelope. One level UP it would flip every client to pass-through.
  IF NOT (d ?& ARRAY['data','page','groups']) THEN
    RAISE EXCEPTION 'T15b: ApprovalListResponse is incomplete: %', d;
  END IF;
  IF (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(v) AS k)
     <> ARRAY['data','success'] THEN
    RAISE EXCEPTION 'T15c: groups escaped to the TOP level of the envelope';
  END IF;
  IF pg_catalog.jsonb_array_length(d -> 'groups') = 0 THEN
    RAISE EXCEPTION 'T15d: no urgency groups were computed';
  END IF;
  -- The view's computed columns are READ, not recomputed.
  IF NOT (d #> '{data,0}' ?& ARRAY['slaBreached','urgencyGroup','slaDueAt','bulkApprovable']) THEN
    RAISE EXCEPTION 'T15e: the view''s computed columns did not project: %', d #> '{data,0}';
  END IF;
  -- `bulkApprovable` is FALSE for any action carrying a monetary value, even
  -- though the stored column says true.
  IF (d #> '{data,0,bulkApprovable}') <> 'false'::jsonb THEN
    RAISE EXCEPTION 'T15f: a money-carrying approval was marked bulk-approvable';
  END IF;
  -- `slaBreached` NEVER BLOCKS: it is a flag on a success, not an error.
  IF (d #> '{data,0,slaBreached}') <> 'false'::jsonb THEN
    RAISE EXCEPTION 'T15g: slaBreached did not project as a flag';
  END IF;

  d := core.get_approval(v_apv::text) -> 'data';
  IF NOT (d ?& ARRAY['reason','recommendation','evidence','deviations','risk','diff']) THEN
    RAISE EXCEPTION 'T15h: ApprovalDetail is incomplete: %', d;
  END IF;
  IF pg_catalog.jsonb_array_length(d -> 'diff') <> 1 THEN
    RAISE EXCEPTION 'T15i: diff did not project — it is the contract that matters most';
  END IF;
  -- §17 modelAgreement renders ONLY when a jury actually ran.
  IF d ? 'modelAgreement' THEN
    RAISE EXCEPTION 'T15j: modelAgreement is emitted when no jury ran';
  END IF;
  IF core.get_approval('00000000-0000-4000-8000-00000000dead') #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T15k: an unknown approval did not refuse';
  END IF;
  RAISE NOTICE 'T15 PASS: groups inside data (not beside it), view columns read not '
               'recomputed, money approvals not bulk-approvable, detail complete.';
END
$t15$;

\echo ''
\echo '════════ T16 · The three wrappers widen no identity ════════'
DO $t16$
DECLARE v_def text;
BEGIN
  -- doc 09 §2's pin: the body CALLS the gate and does nothing else, so a later
  -- edit cannot quietly inline a second policy evaluation beside it.
  v_def := pg_catalog.regexp_replace(
    app._body_sql('core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure),
    '\s+','','g');
  IF pg_catalog.strpos(v_def, 'app.ok(app.perform_action(') = 0 THEN
    RAISE EXCEPTION 'T16a: core.perform_action does not wrap app.perform_action';
  END IF;
  IF pg_catalog.strpos(v_def, 'core.action_policies') > 0
     OR pg_catalog.strpos(v_def, 'core.autonomy_grants') > 0 THEN
    RAISE EXCEPTION 'T16b: the wrapper reads the policy tables — a second policy '
                    'evaluation has been inlined beside the gate';
  END IF;

  -- doc 09 §11's pin: ALL FIVE arguments. A wrapper that dropped the hash
  -- argument silently disables the §7 diff guarantee AND STILL TYPECHECKS.
  v_def := pg_catalog.regexp_replace(
    app._body_sql('core.decide_approval(uuid,text,text,text)'::regprocedure), '\s+','','g');
  IF pg_catalog.strpos(v_def,
       'app.decide_approval(p_approval_id,p_decision,p_note,NULL::text,p_idempotency_key)') = 0 THEN
    RAISE EXCEPTION 'T16c: core.decide_approval does not pass five arguments';
  END IF;

  -- THE SPLIT IS INTACT. Granting the app functions to `authenticated` to make
  -- a wrapper work is the exact failure the core/app split exists to prevent.
  IF pg_catalog.has_function_privilege('authenticated',
       'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'T16d: app.perform_action was granted to authenticated';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated',
       'core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'T16e: authenticated cannot call the wrapper';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated','core.v_approval_requests','SELECT') THEN
    RAISE EXCEPTION 'T16f: core.v_approval_requests was granted to authenticated — it '
                    'carries every approval''s diff and evidence regardless of role';
  END IF;
  RAISE NOTICE 'T16 PASS: wrappers are one call each, five arguments preserved, the '
               'core/app split and the approval view''s revocation both intact.';
END
$t16$;

\echo ''
\echo '════════ T17 · Posture, off pg_proc — not read off the DDL ════════'
DO $t17$
DECLARE v_bad text[]; v_names text[] := ARRAY[
  'perform_action','decide_approval','bulk_decide_approvals','me','navigation','badge_counts',
  'list_enquiries','get_enquiry','get_organisation','get_opportunity','get_contact','get_tna',
  'get_tna_recommendations','create_proposal','get_proposal','get_quotation','put_quotation',
  'list_approvals','get_approval','get_policy','get_pipeline_config','get_programme',
  'get_compliance_rule'];
BEGIN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core' AND p.proname = ANY (v_names)) <> 23 THEN
    RAISE EXCEPTION 'T17a: expected exactly 23 functions, found %',
      (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'core' AND p.proname = ANY (v_names));
  END IF;

  -- THE EXACT STORED STRING. `search_path=""` is what PostgreSQL stores for
  -- `SET search_path = ''`. Never `proconfig IS NOT NULL`: that also passes
  -- `SET search_path = 'a, b'`, one quoted string containing a comma, which
  -- names a single schema and is not a path at all.
  --
  -- NOTE FOR THE NEXT READER: doc 09 §0's own pin example asserts
  -- `proconfig @> ARRAY['search_path=']`, WITHOUT the quotes. That string is
  -- never stored, so that pin fails against 001-013 as well as against 018.
  -- `supabase/CLAUDE.md` rule 1 has it right; the doc does not.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_names)
     AND NOT p.proconfig @> ARRAY['search_path=""'];
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T17b: not SET search_path = '''': %', pg_catalog.array_to_string(v_bad,', ');
  END IF;

  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_names) AND NOT p.prosecdef;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T17c: not SECURITY DEFINER: %', pg_catalog.array_to_string(v_bad,', ');
  END IF;

  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_names)
     AND NOT p.proconfig @> ARRAY['statement_timeout=10s'];
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T17d: missing statement_timeout=10s: %', pg_catalog.array_to_string(v_bad,', ');
  END IF;

  -- EXACTLY ONE OVERLOAD EACH. Adding even a defaulted parameter creates a
  -- SECOND function rather than replacing the first, and two overloads
  -- differing only by a defaulted trailing argument make every short call
  -- ambiguous (PGRST203).
  SELECT pg_catalog.array_agg(x.proname) INTO v_bad
    FROM (SELECT p.proname FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'core' AND p.proname = ANY (v_names)
           GROUP BY p.proname HAVING pg_catalog.count(*) > 1) AS x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T17e: overloads exist for: %', pg_catalog.array_to_string(v_bad,', ');
  END IF;

  -- GRANTS, measured with has_function_privilege.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_names)
     AND (NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T17f: wrong grants on: %', pg_catalog.array_to_string(v_bad,', ');
  END IF;

  -- NO TENANT ARGUMENT ANYWHERE. Tenant is implicit from auth; a p_tenant_id
  -- is a cross-tenant read waiting for a caller to pass the wrong value.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_names)
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) ILIKE '%tenant%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T17g: a tenant argument appears on: %', pg_catalog.array_to_string(v_bad,', ');
  END IF;
  RAISE NOTICE 'T17 PASS: 23 functions, definer, search_path="" exactly, 10s timeout, one '
               'overload each, granted to authenticated only, no tenant argument.';
END
$t17$;

\echo ''
\echo '════════ T18 · anon is genuinely refused — by BECOMING anon ════════'
-- Asserted by IMPERSONATION, not only by reading has_function_privilege.
-- Each probe is ONE STATEMENT: a batched matrix can be folded by the planner,
-- which does not see the role-swap side effect, and then returns a
-- silently-wrong all-denied result.
SET LOCAL ROLE anon;
DO $t18$
BEGIN
  BEGIN
    PERFORM core.me();
    RAISE EXCEPTION 'T18a: anon successfully called core.me()';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- expected
  END;
END
$t18$;
DO $t18b$
BEGIN
  BEGIN
    PERFORM core.list_enquiries('[]'::jsonb, NULL, NULL, NULL);
    RAISE EXCEPTION 'T18b: anon successfully called core.list_enquiries()';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$t18b$;
DO $t18c$
BEGIN
  BEGIN
    PERFORM core.perform_action('PROPOSAL_SEND','PRO-2026-0001');
    RAISE EXCEPTION 'T18c: anon successfully called the action gate';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$t18c$;
DO $t18d$
BEGIN
  BEGIN
    PERFORM 1 FROM core.v_organisation_relations LIMIT 1;
    RAISE EXCEPTION 'T18d: anon can SELECT core.v_organisation_relations';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$t18d$;
RESET ROLE;
\echo 'T18 PASS: anon is refused me, list_enquiries, perform_action and the relations view.'

\echo ''
\echo '════════ T19 · Configuration reads ════════'
DO $t19$
DECLARE d jsonb;
BEGIN
  d := core.get_programme('b2222222-0000-4000-8000-000000000001') -> 'data';
  IF NOT (d ?& ARRAY['listPrice','floorPrice','floorMarginRate','modules','pricingTiers',
                     'trainerPool','materials','stats','outcomes']) THEN
    RAISE EXCEPTION 'T19a: Programme is incomplete: %', d;
  END IF;
  -- `floorPrice` is the SERVER value the costing screen validates against,
  -- never a client constant. That is why it is on the record at all.
  IF (d #>> '{floorPrice,amount}')::bigint <> 2800000 THEN
    RAISE EXCEPTION 'T19b: floorPrice did not project: %', d -> 'floorPrice';
  END IF;
  IF pg_catalog.jsonb_array_length(d -> 'modules') <> 1 THEN
    RAISE EXCEPTION 'T19c: modules did not project';
  END IF;

  IF core.get_programme('00000000-0000-4000-8000-00000000dead') #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T19d: an unknown programme did not refuse';
  END IF;

  -- 004 seeds action policies on tenant insert, so a real policy id exists.
  IF EXISTS (SELECT 1 FROM core.action_policies
              WHERE tenant_id = '11111111-1111-4111-8111-111111111111') THEN
    d := core.get_policy((SELECT id FROM core.action_policies
                           WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
                           ORDER BY id LIMIT 1)) -> 'data';
    IF NOT (d ?& ARRAY['id','actionType','description','conditions','combinator',
                       'approverRole','slaMinutes']) THEN
      RAISE EXCEPTION 'T19e: Policy is incomplete: %', d;
    END IF;
  ELSE
    RAISE NOTICE 'T19e SKIPPED: no action_policies rows seeded for this tenant.';
  END IF;

  IF core.get_policy('NO-SUCH-POLICY') #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T19f: an unknown policy did not refuse';
  END IF;
  IF core.get_compliance_rule('NO-SUCH-RULE') #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T19g: an unknown compliance rule did not refuse';
  END IF;
  RAISE NOTICE 'T19 PASS: programme complete with a server floor price; policy complete; '
               'unknown ids refuse.';
END
$t19$;

\echo ''
\echo '════════ T20 · EVERY RPC RETURNS ONLY THROUGH app.ok / app.err ════════'
DO $t20$
DECLARE v_name text; v jsonb; v_keys text[];
DECLARE v_calls text[] := ARRAY[
  'SELECT core.me()',
  'SELECT core.navigation()',
  'SELECT core.badge_counts()',
  'SELECT core.list_enquiries()',
  'SELECT core.get_enquiry(''ddddddd1-0000-4000-8000-000000000001'')',
  'SELECT core.get_organisation(''bbbbbbb1-0000-4000-8000-000000000001'')',
  'SELECT core.get_opportunity(''OPP-2026-0001'')',
  'SELECT core.get_contact(''ccccccc1-0000-4000-8000-000000000001'')',
  'SELECT core.get_tna(''a1111111-0000-4000-8000-000000000001'')',
  'SELECT core.get_tna_recommendations(''a1111111-0000-4000-8000-000000000001'')',
  'SELECT core.list_approvals()',
  'SELECT core.get_programme(''b2222222-0000-4000-8000-000000000001'')',
  'SELECT core.get_pipeline_config(''OPPORTUNITY'')',
  'SELECT core.get_enquiry(''no-such-thing'')',
  'SELECT core.get_policy(''no-such-thing'')',
  'SELECT core.get_compliance_rule(''no-such-thing'')'];
BEGIN
  FOREACH v_name IN ARRAY v_calls LOOP
    EXECUTE v_name INTO v;
    -- THE UNWRAP RULE. `data` auto-unwraps only while it is the SOLE
    -- non-`success` key. ANY third top-level key flips every caller in the app
    -- from auto-unwrap to pass-through AT ONCE — and, in the incident this
    -- guards, only on the session-restore path, not on first load.
    SELECT pg_catalog.array_agg(k ORDER BY k) INTO v_keys
      FROM pg_catalog.jsonb_object_keys(v) AS k;
    IF v_keys <> ARRAY['data','success'] AND v_keys <> ARRAY['error','success'] THEN
      RAISE EXCEPTION 'T20: % returned top-level keys %', v_name, v_keys;
    END IF;
    IF (v -> 'success') = 'true'::jsonb AND v ? 'error' THEN
      RAISE EXCEPTION 'T20b: % returned both data and error', v_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'T20 PASS: all 16 probed calls return exactly {success,data} or {success,error}.';
END
$t20$;

\echo ''
\echo '════════ T21 · The internal helpers are unreachable from a browser ════════'
DO $t21$
DECLARE v_bad text[];
BEGIN
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname LIKE '\_%'
     AND (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T21: app._* helpers are reachable by a client role: %',
      pg_catalog.array_to_string(v_bad,', ');
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND p.proname IN
         ('_money','_actor','_provenance','_provenanced','_cursor_encode','_cursor_decode',
          '_page_size','_predicate','_body_sql')) <> 9 THEN
    RAISE EXCEPTION 'T21b: expected 9 app._* helpers from 018';
  END IF;
  RAISE NOTICE 'T21 PASS: 9 internal helpers exist and none is callable by anon or authenticated.';
END
$t21$;

\echo ''
\echo '════════ T22 · app._predicate cannot be injected through ════════'
DO $t22$
DECLARE v jsonb;
BEGIN
  -- The COLUMN always comes from a caller-side whitelist and is emitted with
  -- %I; the VALUE always goes through %L. A value carrying SQL is a value, not
  -- SQL — asserted rather than assumed, because this is the one place in the
  -- pack that builds a query as text.
  v := core.list_enquiries(
    '[{"field":"subject","op":"eq","value":"x'' OR 1=1 --"}]'::jsonb,
    NULL, '{"size":50}'::jsonb, NULL);
  IF v -> 'success' <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T22a: a quoted value broke the query builder: %', v;
  END IF;
  IF (v #>> '{data,page,total}')::integer <> 0 THEN
    RAISE EXCEPTION 'T22b: AN INJECTED PREDICATE EXECUTED — expected 0 rows, got %',
      v #>> '{data,page,total}';
  END IF;
  v := core.list_enquiries(
    '[{"field":"status","op":"in","value":["OPEN","ASSIGNED"]}]'::jsonb,
    NULL, '{"size":50}'::jsonb, NULL);
  IF (v #>> '{data,page,total}')::integer <> 3 THEN
    RAISE EXCEPTION 'T22c: the `in` operator did not match both values: %', v -> 'data' -> 'page';
  END IF;
  v := core.list_enquiries(
    '[{"field":"receivedAt","op":"between","value":["2026-09-10T00:00:00+08","2026-09-10T23:59:59+08"]}]'::jsonb,
    NULL, '{"size":50}'::jsonb, NULL);
  IF (v #>> '{data,page,total}')::integer <> 1 THEN
    RAISE EXCEPTION 'T22d: `between` did not bound the range: %', v -> 'data' -> 'page';
  END IF;
  RAISE NOTICE 'T22 PASS: a value carrying SQL stays a value; in/between behave.';
END
$t22$;

\echo ''
\echo '════════ ALL ASSERTIONS EXECUTED — rolling back, nothing durable ════════'
ROLLBACK;
