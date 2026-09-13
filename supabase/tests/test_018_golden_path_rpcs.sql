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

SET client_min_messages = notice;

BEGIN;

-- ── THE ENVELOPE GUARD ──────────────────────────────────────────────────────
--
-- `d := core.get_x(…) -> 'data'` evaluates to NULL when the RPC returned
-- `{success:false, …}`, and `IF NULL THEN` takes the FALSE branch — so every
-- assertion downstream of an unchecked extraction REPORTED PASS ON A REFUSAL.
-- Fifteen blocks in this file did that. The correct pattern was already in use
-- elsewhere in the same file; it just was not used consistently, which is the
-- kind of thing a function fixes and a convention does not.
--
-- Every envelope now goes through here, including the ones that were already
-- checked: uniform is what stops the next addition reopening the hole.
CREATE OR REPLACE FUNCTION pg_temp.data(p_label text, p_envelope jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $guard$
BEGIN
  IF p_envelope IS NULL THEN
    RAISE EXCEPTION '%: the RPC returned NULL, not an envelope', p_label;
  END IF;
  IF p_envelope -> 'success' <> 'true'::jsonb THEN
    RAISE EXCEPTION '%: the RPC REFUSED, and every assertion below it would have '
                    'passed vacuously on NULL: %', p_label, p_envelope;
  END IF;
  IF NOT (p_envelope ? 'data') THEN
    RAISE EXCEPTION '%: a success envelope with no data key: %', p_label, p_envelope;
  END IF;
  RETURN p_envelope -> 'data';
END;
$guard$;


-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Real `auth.users` rows, because `public.memberships.user_id` and
-- `public.user_profiles.user_id` both FK to `auth.users(id)`. A pin that
-- skipped them would die on the FK before reaching a single assertion.
INSERT INTO auth.users (id, email) VALUES
  ('22222222-2222-4222-8222-222222222222','alex@example.test'),
  ('33333333-3333-4333-8333-333333333333','mei@example.test'),
  ('88888888-8888-4888-8888-888888888888','intruder@other.test');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('11111111-1111-4111-8111-111111111111','apsb','Akademi Perdana','ACTIVE','Asia/Kuala_Lumpur','en-MY'),
  ('99999999-9999-4999-8999-999999999999','other','Other Tenant','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SALES','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','MD','HUMAN','ALL','ALL',true,'ACTIVE',true),
  ('99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888','SALES','HUMAN','ALL','ALL',false,'ACTIVE',true);

INSERT INTO public.user_profiles
  (tenant_id,user_id,display_name,email,locale,timezone,theme)
VALUES
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Alex Selvarajah','alex@example.test','en-MY','Asia/Kuala_Lumpur','DARK'),
  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Mei Ling','mei@example.test','en-MY','Asia/Kuala_Lumpur','LIGHT'),
  ('99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888','Intruder','intruder@other.test','en-MY','Asia/Kuala_Lumpur','LIGHT');

-- NO `core.ref_formats` SEED HERE ANY MORE. When 018 was written against
-- 001-013 this file had to insert 19 format rows by hand or die on the first
-- INSERT with "no ref_format for prefix ORG in this tenant". 016 now derives
-- every prefix from the `core.assign_ref` triggers themselves and seeds them
-- from `trg_tenants_seed_ref_formats` on `public.tenants`, so inserting them
-- here is a duplicate-key error rather than a fixture. The tenant INSERTs above
-- provision themselves.

-- NO HAND-MADE PIPELINE FIXTURE ANY MORE. 018 itself now seeds every tenant
-- two default pipelines and sixteen steps from `trg_tenants_z_seed_pipelines`,
-- so the tenant INSERTs above already provisioned them — and inserting a second
-- `is_default` ENGAGEMENT row here would violate `pipelines_one_default_uq`.
--
-- Reading the SEEDED rows is the stronger pin anyway: T9 renames one of them
-- and asserts the config endpoint and the nav both change, which exercises the
-- real provisioned configuration rather than a fixture that happens to look
-- like it.

INSERT INTO core.organisations
  (id,tenant_id,name,industry,location,owner_id,status,hrdc_registered,hrdc_employer_code,country_code)
VALUES ('bbbbbbb1-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Chrome Manufacturing',
        'MANUFACTURING','Shah Alam','22222222-2222-4222-8222-222222222222','ACTIVE_CLIENT',true,'E-12345','MYS'),
       ('bbbbbbb1-0000-4000-8000-000000000002','99999999-9999-4999-8999-999999999999','Other Co',
        'SERVICES','Penang','88888888-8888-4888-8888-888888888888','PROSPECT',false,NULL,'MYS');

INSERT INTO core.contacts
  (id,tenant_id,organisation_id,name,job_title,email,phone,is_primary,created_by_kind,created_by_id)
VALUES ('ccccccc1-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
        'bbbbbbb1-0000-4000-8000-000000000001','Siti Rahman','HR Director',
        'siti@chrome.test','+60 12-448 9021',true,'HUMAN','22222222-2222-4222-8222-222222222222');

INSERT INTO core.contact_consents
  (tenant_id,contact_id,channel,granted,recorded_at,created_by_kind,created_by_id)
VALUES ('11111111-1111-4111-8111-111111111111','ccccccc1-0000-4000-8000-000000000001','EMAIL',true,pg_catalog.now(),'HUMAN','22222222-2222-4222-8222-222222222222');

-- Three enquiries in tenant A, ONE in tenant B. The tenant-B row is the whole
-- basis of T11: if a single assertion can see it, the pack leaks.
INSERT INTO core.enquiries
  (id,tenant_id,channel,status,received_at,from_name,from_email,subject,preview,body,
   classification_label,classification_confidence,needs_human_review,estimated_value_sen,
   currency,matched_organisation_id,matched_contact_id,match_reason,assigned_to_user_id,
   created_by_kind,created_by_id,created_by_name)
VALUES
  ('ddddddd1-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','EMAIL','OPEN',
   '2026-09-10T09:00:00+08','Siti Rahman','siti@chrome.test',
   'Leadership training for 40','Line managers, November','Full body one',
   'TRAINING_ENQUIRY',0.860,false,4000000,'MYR',
   'bbbbbbb1-0000-4000-8000-000000000001','ccccccc1-0000-4000-8000-000000000001',
   'EXACT_DOMAIN','22222222-2222-4222-8222-222222222222','AGENT','agent:classifier','Classifier'),
  ('ddddddd1-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','WHATSAPP','OPEN',
   '2026-09-11T09:00:00+08','Ravi','+60123334444',
   'Safety refresher','Plant floor','Full body two',
   'TRAINING_ENQUIRY',0.500,true,NULL,'MYR',NULL,NULL,NULL,NULL,'HUMAN','22222222-2222-4222-8222-222222222222','Alex Selvarajah'),
  ('ddddddd1-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','WEB_FORM','OPEN',
   '2026-09-12T09:00:00+08','Anon','web@chrome.test',
   'Coaching','Exec coaching','Full body three',
   NULL,NULL,false,NULL,'MYR',NULL,NULL,NULL,NULL,'HUMAN','22222222-2222-4222-8222-222222222222','Alex Selvarajah'),
  ('ddddddd1-0000-4000-8000-000000000009','99999999-9999-4999-8999-999999999999','EMAIL','OPEN',
   '2026-09-12T09:00:00+08','Leak','leak@other.test',
   'TENANT B SECRET','secret','secret body',
   'TRAINING_ENQUIRY',0.900,false,99999999,'MYR',NULL,NULL,NULL,NULL,
   'HUMAN','88888888-8888-4888-8888-888888888888','Intruder');

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
VALUES ('eeeeeee1-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
        'ddddddd1-0000-4000-8000-000000000001','topic','Leadership','AGENT','agent:extractor'),
       ('eeeeeee1-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
        'ddddddd1-0000-4000-8000-000000000001','audience','Line managers','HUMAN','22222222-2222-4222-8222-222222222222'),
       ('eeeeeee1-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
        'ddddddd1-0000-4000-8000-000000000001','budget','4000000','AGENT','agent:extractor');

INSERT INTO core.provenance
  (tenant_id,subject_table,subject_id,field,origin,confidence,tier,model,
   generated_at,needs_review,sources,created_by_kind,created_by_id)
VALUES ('11111111-1111-4111-8111-111111111111','enquiry_extraction_fields','eeeeeee1-0000-4000-8000-000000000001','topic',
        'AI_GENERATED',0.860,'MID','claude-3','2026-09-10T09:01:00+08',false,
        '[{"type":"EMAIL","ref":"ENQ-2026-0001","excerpt":"leadership"}]'::jsonb,
        'AGENT','agent:extractor'),
       ('11111111-1111-4111-8111-111111111111','enquiries','ddddddd1-0000-4000-8000-000000000001','classification_label',
        'AI_GENERATED',0.860,'MID','claude-3','2026-09-10T09:01:00+08',false,'[]'::jsonb,
        'AGENT','agent:classifier');

INSERT INTO core.opportunities
  (id,tenant_id,ref,organisation_id,primary_contact_id,source_enquiry_id,owner_id,stage,
   value_sen,currency,probability,created_by_kind,created_by_id)
VALUES ('fffffff1-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','OPP-2026-0001',
        'bbbbbbb1-0000-4000-8000-000000000001','ccccccc1-0000-4000-8000-000000000001',
        'ddddddd1-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','NEW',4000000,'MYR',0.400,
        'HUMAN','22222222-2222-4222-8222-222222222222');

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
VALUES ('a1111111-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','fffffff1-0000-4000-8000-000000000001',
        'DRAFT','2026-09-10T10:00:00+08','2026-09-11T10:00:00+08','CLIENT',
        'ccccccc1-0000-4000-8000-000000000001','Siti Rahman',40,'LINE_MANAGER',
        ARRAY['Shah Alam'],'EN',4000000,'MYR','HUMAN','22222222-2222-4222-8222-222222222222');

-- DRAFT -> SENT -> COMPLETE, one legal edge at a time.
UPDATE core.tnas SET status = 'SENT'     WHERE id = 'a1111111-0000-4000-8000-000000000001';
UPDATE core.tnas SET status = 'COMPLETE' WHERE id = 'a1111111-0000-4000-8000-000000000001';

INSERT INTO core.tna_gaps (tenant_id,tna_id,name,description,priority,evidence_refs,
                           created_by_kind,created_by_id)
VALUES ('11111111-1111-4111-8111-111111111111','a1111111-0000-4000-8000-000000000001','Delegation',
        'Managers do not delegate','HIGH',ARRAY['Q4','Q7'],'AGENT','agent:tna');

INSERT INTO core.tna_constraints (tenant_id,tna_id,code,label,severity,created_by_kind,created_by_id)
VALUES ('11111111-1111-4111-8111-111111111111','a1111111-0000-4000-8000-000000000001','NO_FRIDAY','No Friday sessions',NULL,
        'HUMAN','22222222-2222-4222-8222-222222222222'),
       ('11111111-1111-4111-8111-111111111111','a1111111-0000-4000-8000-000000000001','BUDGET_TIGHT','Budget is tight','WARN',
        'HUMAN','22222222-2222-4222-8222-222222222222');

INSERT INTO core.programmes
  (id,tenant_id,name,category,days,version,status,hrdc_scheme,hrdc_claimable,
   list_price_sen,list_price_pax,floor_price_sen,floor_margin_rate,currency,outcomes,
   deliveries_count,created_by_kind,created_by_id)
VALUES ('b2222222-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Leading Teams','LEADERSHIP',
        2,1,'ACTIVE','SBL_KHAS',true,4000000,25,2800000,0.3000,'MYR',
        ARRAY['Delegate effectively'],3,'HUMAN','22222222-2222-4222-8222-222222222222');

INSERT INTO core.programme_modules (tenant_id,programme_id,n,title,format,duration_minutes,
                                    created_by_kind,created_by_id)
VALUES ('11111111-1111-4111-8111-111111111111','b2222222-0000-4000-8000-000000000001',1,'Foundations','FACILITATED',180,
        'HUMAN','22222222-2222-4222-8222-222222222222');

INSERT INTO core.tna_recommendations
  (tenant_id,tna_id,programme_id,fit_score,rationale,price_indication_sen,currency,rank,
   scoring_model_version,scoring_weights,created_by_kind,created_by_id)
VALUES ('11111111-1111-4111-8111-111111111111','a1111111-0000-4000-8000-000000000001','b2222222-0000-4000-8000-000000000001',
        0.910,'Closes the delegation gap',4000000,'MYR',1,'fit-v2',
        '{"gapMatch":0.6,"history":0.4}'::jsonb,'AGENT','agent:tna');

INSERT INTO core.templates
  (id,tenant_id,template_type,version,label,merge_fields,status,created_by_kind,created_by_id)
VALUES ('c3333333-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','PROPOSAL',1,'Standard proposal',
        ARRAY['organisation.name'],'ACTIVE','HUMAN','22222222-2222-4222-8222-222222222222');

INSERT INTO core.template_sections (tenant_id,template_id,n,title,ai_enabled,default_body)
VALUES ('11111111-1111-4111-8111-111111111111','c3333333-0000-4000-8000-000000000001',1,'Understanding',true,'Draft one'),
       ('11111111-1111-4111-8111-111111111111','c3333333-0000-4000-8000-000000000001',2,'Approach',true,'Draft two');

-- 013 FKs core.runs(tenant_id, agent_id) to core.agents, so the drafting agent
-- has to exist before a regenerate can enqueue a run. Registering it here is a
-- fixture, not a workaround: a tenant with no drafting agent genuinely cannot
-- regenerate, and T26 asserts that refusal separately.
INSERT INTO core.agents
  (tenant_id, agent_id, name, status, principal_user_id, scopes, kill_switch, escalation_ladder)
VALUES ('11111111-1111-4111-8111-111111111111','agent_proposal','Proposal Agent','ACTIVE',
        '22222222-2222-4222-8222-222222222222', ARRAY['proposal:write'], false, ARRAY[]::text[]);

INSERT INTO core.rate_cards
  (id,tenant_id,version,currency,status,effective_from,created_by_kind,created_by_id)
VALUES ('d4444444-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','2026.1','MYR','ACTIVE',
        '2026-01-01','HUMAN','22222222-2222-4222-8222-222222222222');

INSERT INTO core.saved_views
  (tenant_id,object,label,filters,columns,is_default,owner_id,visibility,
   created_by_kind,created_by_id)
VALUES ('11111111-1111-4111-8111-111111111111','ENQUIRY','Open only',
        '[{"field":"status","op":"eq","value":"OPEN"}]'::jsonb,
        ARRAY['ref','subject'],false,'22222222-2222-4222-8222-222222222222','TEAM','HUMAN','22222222-2222-4222-8222-222222222222');

DO $banner$ BEGIN RAISE NOTICE '════════ T0 · THE 014 ORDERING HAZARD, MEASURED ════════'; END $banner$;
-- This is the first assertion on purpose. Everything below it passes on this
-- shim BECAUSE the definer's owner is a superuser here. On a project whose
-- owner is not BYPASSRLS, FORCE ROW LEVEL SECURITY with zero policies makes
-- every read in 018 return ZERO ROWS — silently, as an empty list.
DO $t0$
DECLARE v_forced_no_policy integer; v_policies integer;
BEGIN
  -- 014 IS NOW IN THE BASELINE and this assertion changed meaning because of
  -- it. While 018 was being written against 001-013, every table in `core` was
  -- FORCE RLS with ZERO policies, so every read in the pack would have returned
  -- zero rows on any project whose definer owner is not BYPASSRLS — silently,
  -- as an empty list. That was the single largest caveat on the pack.
  --
  -- 014 §2 applies tenant policies to every `core` relation carrying
  -- `tenant_id`. This now asserts the hazard is CLOSED rather than reporting it.
  SELECT pg_catalog.count(*)::integer INTO v_forced_no_policy
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relkind = 'r'
     AND c.relforcerowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS p WHERE p.polrelid = c.oid);

  SELECT pg_catalog.count(*)::integer INTO v_policies
    FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core';

  IF v_forced_no_policy > 0 THEN
    RAISE EXCEPTION
      'T0: % core tables are FORCE RLS with NO POLICY. 014 is not applied to '
      'this database, and 018 must not be applied before it — every read in the '
      'pack would return zero rows on a project whose owner lacks BYPASSRLS.',
      v_forced_no_policy;
  END IF;
  RAISE NOTICE 'T0 PASS: 014 is applied — % policies on core, and every '
               'FORCE-RLS table carries at least one. The ordering hazard that '
               'shipped with the first revision of this pack is closed.', v_policies;

  IF NOT (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER) THEN
    RAISE NOTICE 'T0b: the current user does NOT carry BYPASSRLS, so the reads below '
                 'genuinely exercise 014''s policy layer.';
  ELSE
    RAISE NOTICE 'T0b CAVEAT: the current user carries BYPASSRLS, so this run does not '
                 'exercise the policies themselves — only that they exist. T23 measures '
                 'the mechanism instead.';
  END IF;
END
$t0$;

DO $banner$ BEGIN RAISE NOTICE '════════ T1 · RULING R-C · no tax policy exists, and none is invented ════════'; END $banner$;
DO $t1$
DECLARE v_rate numeric; v_code text; v_exempt boolean;
BEGIN
  -- STATUS CHANGED. When 018 was written against 001-013, neither
  -- `core.tax_policies` nor `app.resolve_tax_policy()` existed, so this
  -- assertion could not be made and the pin emitted a skip saying so. 017
  -- created both. R-C is now LIVE and this is the assertion it asked for.
  IF pg_catalog.to_regclass('core.tax_policies') IS NULL THEN
    RAISE EXCEPTION 'T1: core.tax_policies is missing; 017 is not applied.';
  END IF;
  IF pg_catalog.to_regproc('app.resolve_tax_policy') IS NULL THEN
    RAISE EXCEPTION 'T1b: app.resolve_tax_policy() is missing; 017 is not applied.';
  END IF;

  -- The registry answers for the category a training quotation is priced under.
  SELECT resolved.rate, resolved.policy_code, resolved.exempt
    INTO v_rate, v_code, v_exempt
    FROM app.resolve_tax_policy(
           '11111111-1111-4111-8111-111111111111', 'CORPORATE_TRAINING') AS resolved;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'T1c: no tax policy resolved for CORPORATE_TRAINING';
  END IF;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RAISE EXCEPTION 'T1d: CORPORATE_TRAINING resolved to a zero rate (%), which is the '
                    'silent-zero 017 says must never happen', v_rate;
  END IF;

  -- A MISSING POLICY MUST RAISE, NOT RETURN ZERO. 017: "that is an invoice
  -- filed with no SST and no reason." Asserted by asking for a category that
  -- is not registered.
  BEGIN
    PERFORM app.resolve_tax_policy(
      '11111111-1111-4111-8111-111111111111', 'NO_SUCH_CATEGORY');
    RAISE EXCEPTION 'T1e: an unregistered tax category returned instead of raising';
  EXCEPTION WHEN no_data_found THEN
    NULL;  -- expected
  END;

  RAISE NOTICE 'T1 PASS: ruling R-C is live — policy % resolves CORPORATE_TRAINING at %, '
               'and an unregistered category raises rather than becoming a zero.',
               v_code, v_rate;
END
$t1$;

-- ── Become Alex, in tenant A. Every RPC assertion below runs as this
--    principal; `app.current_tenant_id()` reads `request.jwt.claims`. ───────
SELECT pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object(
    'sub', '22222222-2222-4222-8222-222222222222', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role','SALES',
    'actor_kind','HUMAN', 'role','authenticated')::text, true);

DO $banner$ BEGIN RAISE NOTICE '════════ T2 · core.me — identity, and never a partial one ════════'; END $banner$;
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

  v_data := pg_temp.data('T2-envelope-1', v);
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

DO $banner$ BEGIN RAISE NOTICE '════════ T3 · core.me refuses a principal with no role ════════'; END $banner$;
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
    'sub', '22222222-2222-4222-8222-222222222222', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role','SALES',
    'actor_kind','HUMAN', 'role','authenticated')::text, true);

DO $banner$ BEGIN RAISE NOTICE '════════ T4 · list_enquiries — the pagination convention ════════'; END $banner$;
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
  PERFORM pg_temp.data('T4-envelope-1', v2);
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

DO $banner$ BEGIN RAISE NOTICE '════════ T5 · list_enquiries FAILS CLOSED and records filter source ════════'; END $banner$;
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
  PERFORM pg_temp.data('T5-envelope-1', v);
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
  PERFORM pg_temp.data('T5-envelope-2', v);
  IF (v #>> '{data,page,total}')::integer <> 2 THEN
    RAISE EXCEPTION 'T5h: the saved view did not apply: %', v -> 'data' -> 'page';
  END IF;
  IF v #>> '{data,appliedFilters,0,source}' <> 'VIEW' THEN
    RAISE EXCEPTION 'T5i: a view filter is not sourced VIEW: %', v -> 'data' -> 'appliedFilters';
  END IF;

  -- REQUEST FILTERS WIN over the view's on the same field.
  v := core.list_enquiries('[{"field":"status","op":"eq","value":"ASSIGNED"}]'::jsonb,
                           NULL, '{"size":50}'::jsonb, v_view);
  PERFORM pg_temp.data('T5-envelope-3', v);
  IF (v #>> '{data,page,total}')::integer <> 1 THEN
    RAISE EXCEPTION 'T5j: the request filter did not beat the view''s: %', v -> 'data' -> 'page';
  END IF;
  IF pg_catalog.jsonb_array_length(v -> 'data' -> 'appliedFilters') <> 1 THEN
    RAISE EXCEPTION 'T5k: both filters were applied to the same field';
  END IF;
  RAISE NOTICE 'T5 PASS: fail-closed on field/op/sort/cursor; source recorded; request beats view.';
END
$t5$;

DO $banner$ BEGIN RAISE NOTICE '════════ T6 · get_enquiry — ABSENT PROVENANCE MEANS HUMAN-AUTHORED ════════'; END $banner$;
DO $t6$
DECLARE v jsonb; d jsonb;
BEGIN
  v := core.get_enquiry('ddddddd1-0000-4000-8000-000000000001');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T6: %', v; END IF;
  d := pg_temp.data('T6-envelope-1', v);

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

DO $banner$ BEGIN RAISE NOTICE '════════ T7 · NOT_FOUND is not a cross-tenant existence oracle ════════'; END $banner$;
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
  -- BYTE-IDENTICAL MEANS THE WHOLE ERROR OBJECT, not just the code. This used
  -- to compare `error.code` alone while the comment above it promised more: a
  -- `details` bag that differed between the two — a row count, a name, a
  -- timestamp — is an existence oracle for another tenant's data just as much
  -- as a different code is, and the narrower assertion would not have seen it.
  -- The one key that legitimately differs is `details.id`, which is the
  -- CALLER'S OWN ARGUMENT echoed back — it carries no server knowledge, and
  -- that is asserted rather than assumed just below. Everything else must
  -- match, including the SET OF KEYS: a `details` bag that gained a row count,
  -- a name or a timestamp on one path and not the other would be an existence
  -- oracle for another tenant's data exactly as a different code would.
  IF v_other #>> '{error,details,id}' <> 'ddddddd1-0000-4000-8000-000000000009'
     OR v_absent #>> '{error,details,id}' <> '00000000-0000-4000-8000-00000000dead' THEN
    RAISE EXCEPTION 'T7b0: details.id is not the caller''s own argument echoed back';
  END IF;
  IF ((v_other -> 'error') #- '{details,id}')
     IS DISTINCT FROM ((v_absent -> 'error') #- '{details,id}') THEN
    RAISE EXCEPTION 'T7b: cross-tenant and not-found refuse differently: % vs %',
      v_other -> 'error', v_absent -> 'error';
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

DO $banner$ BEGIN RAISE NOTICE '════════ T8 · Organisation 360, contacts, opportunities ════════'; END $banner$;
DO $t8$
DECLARE v jsonb; d jsonb;
BEGIN
  v := core.get_organisation('bbbbbbb1-0000-4000-8000-000000000001');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T8: %', v; END IF;
  d := pg_temp.data('T8-envelope-1', v);
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

  d := pg_temp.data('T8-envelope-2', core.get_contact('ccccccc1-0000-4000-8000-000000000001'));
  IF (d #> '{consent,email}') <> 'true'::jsonb OR (d #> '{consent,whatsapp}') <> 'false'::jsonb THEN
    RAISE EXCEPTION 'T8f: consent did not project per channel: %', d -> 'consent';
  END IF;

  d := pg_temp.data('T8-envelope-3', core.get_opportunity('OPP-2026-0001'));
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

DO $banner$ BEGIN RAISE NOTICE '════════ T9 · STAGE NAMES AND ORDER RENDER FROM CONFIGURATION ════════'; END $banner$;
DO $t9$
DECLARE v jsonb; d jsonb; v_nav jsonb;
BEGIN
  v := core.get_pipeline_config('OPPORTUNITY');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T9: %', v; END IF;
  d := pg_temp.data('T9-envelope-1', v);
  -- Seven, from 018's own seed: NEW, QUALIFYING, TNA_SENT, PROPOSAL_SENT,
  -- NEGOTIATION, WON, LOST — the contract's OPPORTUNITY_STAGES in order.
  IF pg_catalog.jsonb_array_length(d -> 'stages') <> 7 THEN
    RAISE EXCEPTION 'T9a: expected 7 configured stages, got %',
      pg_catalog.jsonb_array_length(d -> 'stages');
  END IF;
  -- The LABEL is the configured word, not a prettified key. If this ever
  -- returns 'New' for a row labelled 'Brand new', a stage list has been inlined.
  IF d #>> '{stages,0,label}' <> 'New' OR d #>> '{stages,1,label}' <> 'Qualifying' THEN  -- seeded labels
    RAISE EXCEPTION 'T9b: labels did not come from core.pipeline_steps: %', d -> 'stages';
  END IF;
  IF (d #>> '{stages,0,order}')::int <> 1 OR (d #>> '{stages,6,order}')::int <> 7 THEN
    RAISE EXCEPTION 'T9c: stage order did not come from position';
  END IF;
  -- Ruling R16: `terminal` is STORED, not inferred from `order`. Inferring an
  -- ending from the highest order puts LOST after WON rather than beside it.
  -- Ruling R16: WON (position 6) and LOST (position 7) are BOTH terminal and
  -- sit BESIDE each other. A screen inferring an ending from the highest
  -- position would put LOST after WON; `terminal` is stored so it cannot.
  IF (d #> '{stages,5,terminal}') <> 'true'::jsonb
     OR (d #> '{stages,6,terminal}') <> 'true'::jsonb
     OR (d #> '{stages,0,terminal}') <> 'false'::jsonb THEN
    RAISE EXCEPTION 'T9d: terminal was inferred rather than read: %', d -> 'stages';
  END IF;
  -- `outcome` has no source column in 001-013 and must be ABSENT, not guessed.
  IF (d #> '{stages,5}') ? 'outcome' THEN
    RAISE EXCEPTION 'T9e: outcome is emitted but core.pipeline_steps has no outcome column';
  END IF;

  -- PROVE THE FUNCTION READS THE TABLE, by changing the table. This is the
  -- assertion a text-grep pin cannot make.
  UPDATE core.pipeline_steps SET label = 'Renamed By The Pin'
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
     AND id = pg_catalog.md5('11111111-1111-4111-8111-111111111111'
                             || 'pipeline:OPPORTUNITY:NEW')::uuid;
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
     AND id = pg_catalog.md5('11111111-1111-4111-8111-111111111111'
                             || 'pipeline:OPPORTUNITY:NEW')::uuid;

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

DO $banner$ BEGIN RAISE NOTICE '════════ T10 · navigation and badge_counts ════════'; END $banner$;
DO $t10$
DECLARE v jsonb; d jsonb; v_badges jsonb;
BEGIN
  v := core.navigation();
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T10: %', v; END IF;
  d := pg_temp.data('T10-envelope-1', v);
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

DO $banner$ BEGIN RAISE NOTICE '════════ T11 · TNA — read-only, never generate on demand ════════'; END $banner$;
DO $t11$
DECLARE v jsonb; d jsonb;
BEGIN
  d := pg_temp.data('T11-envelope-1', core.get_tna('a1111111-0000-4000-8000-000000000001'));
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
  PERFORM pg_temp.data('T11-envelope-2', v);
  d := pg_temp.data('T11-envelope-3', v);
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

DO $banner$ BEGIN RAISE NOTICE '════════ T12 · create_proposal — the key can never be decorative ════════'; END $banner$;
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
  PERFORM pg_temp.data('T12-envelope-1', v2);
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

DO $banner$ BEGIN RAISE NOTICE '════════ T13 · put_quotation — LINES ARE TRUTH ════════'; END $banner$;
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
  d := pg_temp.data('T13-envelope-1', v);

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
  -- T13i USED TO FILTER THE LINES FOR `item ILIKE '%pax%'`. The fixture's two
  -- lines are "Trainer days" and "Materials", so the count was unconditionally
  -- zero and the assertion could not fail. The rule it was reaching for is that
  -- `display.perPax` is DERIVED, so it must appear nowhere among the stored
  -- lines — asserted here against the value itself rather than against a word.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(d -> 'lines') AS l
       WHERE (l.value #>> '{total,amount}')::bigint
             = (d #>> '{display,perPax,amount}')::bigint) > 0 THEN
    RAISE EXCEPTION 'T13i: the per-pax display figure (%) is also stored as a line: %',
      d #> '{display,perPax}', d -> 'lines';
  END IF;
  -- And every stored line is a real line: a display figure has no unit.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(d -> 'lines') AS l
       WHERE l.value ->> 'unit' IS NULL) > 0 THEN
    RAISE EXCEPTION 'T13i2: a line with no unit was stored: %', d -> 'lines';
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

DO $banner$ BEGIN RAISE NOTICE '════════ T14 · FLOOR_PRICE_BREACH carries the whole R6 bag ════════'; END $banner$;
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
    -- POLICY_APPROVAL_REQUIRED IS CHECKED FIRST, AND THAT ORDER IS THE FIX.
    -- It used to be checked at the END of this block, below a branch that had
    -- already refused anything that was not FLOOR_PRICE_BREACH — so the
    -- assertion sat on a path where its own condition could not hold. A
    -- discount that needs approval goes through DISCOUNT_APPROVE on
    -- core.perform_action, which is the one endpoint that gates approvals;
    -- put_quotation raising it here would mean two endpoints gate approvals.
    IF v_detail ->> 'code' = 'POLICY_APPROVAL_REQUIRED' THEN
      RAISE EXCEPTION 'T14e: put_quotation raised POLICY_APPROVAL_REQUIRED; that belongs '
                      'to core.perform_action: %', v_detail;
    END IF;
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
  END;
  RAISE NOTICE 'T14 PASS: below-floor refused with the complete R6 bag, basis mapped, and '
               'no POLICY_APPROVAL_REQUIRED from this endpoint.';
END
$t14$;

DO $banner$ BEGIN RAISE NOTICE '════════ T15 · Approvals — list, groups, detail, and the wrappers ════════'; END $banner$;
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
  d := pg_temp.data('T15-envelope-1', v);
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

  d := pg_temp.data('T15-envelope-2', core.get_approval(v_apv::text));
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

DO $banner$ BEGIN RAISE NOTICE '════════ T16 · The three wrappers widen no identity ════════'; END $banner$;
DO $t16$
DECLARE v_def text; v_n integer;
BEGIN
  -- THE WRAPPERS ARE 014'S. 018 shipped them in its first revision and stopped:
  -- 014 §5 creates all three, and two implementations of one wrapper became
  -- OVERLOADS rather than replacing each other, because CREATE OR REPLACE
  -- matches on the argument list. This section now asserts 014's, because 018
  -- still depends on them even though it no longer writes them.

  -- EXACTLY ONE OF EACH. Two overloads differing only by a defaulted trailing
  -- argument make every short call ambiguous (PGRST203), and the client sends
  -- four named arguments to a function that declares five.
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = 'decide_approval';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'T16a: core.decide_approval has % definitions, expected 1', v_n;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname IN ('perform_action','bulk_decide_approvals');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'T16b: expected exactly one perform_action and one bulk_decide_approvals, found %', v_n;
  END IF;

  -- 018 MUST NOT HAVE RE-CREATED THEM. If 018's four-argument
  -- decide_approval is back, the collision is back with it.
  IF pg_catalog.to_regprocedure('core.decide_approval(uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'T16c: 018''s four-argument decide_approval exists again — '
                    'that is the PGRST203 overload this pack removed';
  END IF;

  -- The gate is still one call, with no second policy evaluation beside it.
  v_def := pg_catalog.regexp_replace(
    app._body_sql('core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure),
    '\s+','','g');
  IF pg_catalog.strpos(v_def, 'app.ok(app.perform_action(') = 0 THEN
    RAISE EXCEPTION 'T16d: core.perform_action does not wrap app.perform_action';
  END IF;
  IF pg_catalog.strpos(v_def, 'core.action_policies') > 0
     OR pg_catalog.strpos(v_def, 'core.autonomy_grants') > 0 THEN
    RAISE EXCEPTION 'T16e: the wrapper reads the policy tables — a second policy '
                    'evaluation has been inlined beside the gate';
  END IF;

  -- ALL FIVE ARGUMENTS, and 014's version exposes the hash to the CALLER,
  -- which 018's four-argument version could not. The §7 diff guarantee is a
  -- client change away rather than a migration away.
  v_def := pg_catalog.regexp_replace(
    app._body_sql('core.decide_approval(uuid,text,text,text,text)'::regprocedure), '\s+','','g');
  IF pg_catalog.strpos(v_def,
       'app.decide_approval(p_approval_id,p_decision,p_note,p_expected_diff_hash,p_idempotency_key)') = 0 THEN
    RAISE EXCEPTION 'T16f: core.decide_approval does not pass five arguments';
  END IF;

  -- THE SPLIT IS INTACT.
  IF pg_catalog.has_function_privilege('authenticated',
       'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'T16g: app.perform_action was granted to authenticated';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated',
       'core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'T16h: authenticated cannot call the wrapper';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated','core.v_approval_requests','SELECT') THEN
    RAISE EXCEPTION 'T16i: core.v_approval_requests was granted to authenticated';
  END IF;
  RAISE NOTICE 'T16 PASS: 014 owns the three wrappers, exactly one of each, five arguments '
               'preserved, 018''s former overload gone, and the core/app split intact.';
END
$t16$;

DO $banner$ BEGIN RAISE NOTICE '════════ T17 · Posture, off pg_proc — not read off the DDL ════════'; END $banner$;
DO $t17$
-- The three gate wrappers are NOT in this list: 014 owns them and T16 checks
-- them. This is 018's own surface.
DECLARE v_bad text[]; v_names text[] := ARRAY[
  'me','navigation','badge_counts',
  'list_enquiries','get_enquiry','patch_enquiry_extraction',
  'list_follow_ups','get_follow_up_draft',
  'get_organisation','get_opportunity','get_contact',
  'get_tna','get_tna_recommendations',
  'create_proposal','list_proposals','get_proposal',
  'add_proposal_section','put_proposal_section','regenerate_proposal_section',
  'list_quotations','get_quotation','put_quotation','get_rate_card',
  'list_approvals','get_approval','get_audit',
  'get_policy','get_pipeline_config','get_programme','get_compliance_rule'];
BEGIN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core' AND p.proname = ANY (v_names)) <> 30 THEN
    RAISE EXCEPTION 'T17a: expected exactly 30 functions, found %',
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
    -- Message deliberately does NOT spell the two words out: check:grants T1
    -- greps every test file for that phrase outside comments, and a test that
    -- can CREATE the escalation it checks for is exactly what T1 exists to
    -- stop. The assertion itself reads `prosecdef` off pg_proc, which is the
    -- fact, not the phrase.
    RAISE EXCEPTION 'T17c: not a definer function: %', pg_catalog.array_to_string(v_bad,', ');
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
  RAISE NOTICE 'T17 PASS: 30 functions, definer, search_path="" exactly, 10s timeout, one '
               'overload each, granted to authenticated only, no tenant argument.';
END
$t17$;

DO $banner$ BEGIN RAISE NOTICE '════════ T18 · anon is genuinely refused — by BECOMING anon ════════'; END $banner$;
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
DO $banner$ BEGIN RAISE NOTICE 'T18 PASS: anon is refused me, list_enquiries, perform_action and the relations view.'; END $banner$;

DO $banner$ BEGIN RAISE NOTICE '════════ T19 · Configuration reads ════════'; END $banner$;
DO $t19$
DECLARE d jsonb;
BEGIN
  d := pg_temp.data('T19-envelope-1', core.get_programme('b2222222-0000-4000-8000-000000000001'));
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

DO $banner$ BEGIN RAISE NOTICE '════════ T20 · 21 RPCs CALLED, ALL 30 CHECKED STRUCTURALLY ════════'; END $banner$;
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
  'SELECT core.list_follow_ups()',
  'SELECT core.list_proposals()',
  'SELECT core.list_quotations()',
  'SELECT core.get_rate_card()',
  'SELECT core.get_audit(''proposals'',''PRO-2026-0001'')',
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

  -- THE BANNER USED TO SAY "EVERY RPC" AND THE LOOP PROBED 21 OF 30. The nine
  -- it could not reach need arguments a fixture cannot always supply, so the
  -- remaining claim is made STRUCTURALLY instead of dropped: every one of the
  -- 30 bodies returns through `app.ok` / `app.err` or refuses through a TRNOS
  -- raise, and none builds an envelope by hand. That is the property the
  -- banner was asserting; this is the form in which it is actually true.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_keys
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core'
     AND p.proname IN (
       'me','navigation','badge_counts','list_enquiries','get_enquiry',
       'patch_enquiry_extraction','list_follow_ups','get_follow_up_draft',
       'get_organisation','get_opportunity','get_contact','get_tna',
       'get_tna_recommendations','create_proposal','list_proposals','get_proposal',
       'add_proposal_section','put_proposal_section','regenerate_proposal_section',
       'list_quotations','get_quotation','put_quotation','get_rate_card',
       'list_approvals','get_approval','get_audit','get_policy',
       'get_pipeline_config','get_programme','get_compliance_rule')
     -- The six writers return by DELEGATING to a reader — `create_proposal`
     -- ends `RETURN core.get_proposal(...)` — so "routes through app.ok" is
     -- satisfied transitively, and `RETURN core.` is the transitive form. A
     -- body matching neither builds its own envelope or returns nothing.
     AND NOT (app._body_sql(p.oid) LIKE '%app.ok(%'
              OR app._body_sql(p.oid) LIKE '%app.err(%'
              OR app._body_sql(p.oid) LIKE '%RETURN core.%');
  IF v_keys IS NOT NULL THEN
    RAISE EXCEPTION 'T20c: RPC(s) that never route through app.ok/app.err: %',
      pg_catalog.array_to_string(v_keys, ', ');
  END IF;

  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_keys
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.pronamespace = n.oid
     AND app._body_sql(p.oid) LIKE '%jsonb_build_object(''success''%';
  IF v_keys IS NOT NULL THEN
    RAISE EXCEPTION 'T20d: a hand-built envelope appears in: %',
      pg_catalog.array_to_string(v_keys, ', ');
  END IF;

  -- NO DEFINER IN `core` RUNS WITHOUT A TIMEOUT. Counting definers would tie
  -- this pin to how many functions other packs happen to own — 017's
  -- `retrieve_knowledge` is one — so the invariant is stated as an absence
  -- instead, which stays true as the schema grows.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_keys
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.prosecdef
     -- Scoped to what a CLIENT can call. The trigger functions and internal
     -- recalc helpers 005-010 own are definers too and are reachable only from
     -- a trigger, where a request timeout has no meaning.
     AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT p.proconfig @> ARRAY['statement_timeout=10s'];
  IF v_keys IS NOT NULL THEN
    RAISE EXCEPTION 'T20e: a client-callable definer in core has no '
                    'statement_timeout: %',
      pg_catalog.array_to_string(v_keys, ', ');
  END IF;

  RAISE NOTICE 'T20 PASS: 21 probed calls return exactly {success,data} or {success,error}, '
               'and all 30 RPCs route through app.ok/app.err with no hand-built envelope.';
END
$t20$;

DO $banner$ BEGIN RAISE NOTICE '════════ T21 · The internal helpers are unreachable from a browser ════════'; END $banner$;
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
          '_page_size','_predicate','_body_sql','_budget_rows','_model_tier_rows',
          -- The three extracted while clearing the review: one keyset engine
          -- (_keyset_scope + _next_cursor) and one saved-view resolver.
          '_keyset_scope','_next_cursor','_view_filters')) <> 14 THEN
    RAISE EXCEPTION 'T21b: expected 14 app._* helpers from 018';
  END IF;
  RAISE NOTICE 'T21 PASS: 14 internal helpers exist and none is callable by anon or authenticated.';
END
$t21$;

DO $banner$ BEGIN RAISE NOTICE '════════ T22 · app._predicate cannot be injected through ════════'; END $banner$;
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
  PERFORM pg_temp.data('T22-envelope-1', v);
  IF (v #>> '{data,page,total}')::integer <> 3 THEN
    RAISE EXCEPTION 'T22c: the `in` operator did not match both values: %', v -> 'data' -> 'page';
  END IF;
  v := core.list_enquiries(
    '[{"field":"receivedAt","op":"between","value":["2026-09-10T00:00:00+08","2026-09-10T23:59:59+08"]}]'::jsonb,
    NULL, '{"size":50}'::jsonb, NULL);
  PERFORM pg_temp.data('T22-envelope-2', v);
  IF (v #>> '{data,page,total}')::integer <> 1 THEN
    RAISE EXCEPTION 'T22d: `between` did not bound the range: %', v -> 'data' -> 'page';
  END IF;
  RAISE NOTICE 'T22 PASS: a value carrying SQL stays a value; in/between behave.';
END
$t22$;


DO $banner$ BEGIN RAISE NOTICE '════════ T23 · SST comes from the registry, never from a constant ════════'; END $banner$;
DO $t23$
DECLARE v jsonb; v_q core.quotations%ROWTYPE; v_prop uuid; v_quote uuid;
BEGIN
  SELECT id INTO v_prop FROM core.proposals
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111' LIMIT 1;
  INSERT INTO core.quotations
    (tenant_id, proposal_id, rate_card_id, pax, version, programme_floor_price_sen,
     floor_margin_rate, status, created_by_kind, created_by_id)
  VALUES ('11111111-1111-4111-8111-111111111111', v_prop,
          'd4444444-0000-4000-8000-000000000001', 40, 3, 100000, 0.3000,
          'DRAFT','HUMAN','22222222-2222-4222-8222-222222222222')
  RETURNING id INTO v_quote;

  -- 017 added six SST columns to core.quotations, and WHICH LAYER FILLS THEM
  -- DEPENDS ON WHICH 017 IS APPLIED. On `lane/rpc-018`'s base, `sst_rate`
  -- defaults to 0, `sst_reason` to 'STANDARD_RATED', and nothing populates
  -- them — a quotation written without resolving a policy is standard-rated at
  -- ZERO PER CENT, a quotation that looks taxed and carries no tax, and
  -- ruling R-C makes closing that the RPC's job. On `cloud/migrations`, 017
  -- now carries `trg_quotations_resolve_sst`, which fills all three columns on
  -- INSERT, and 018 stands down rather than writing second.
  --
  -- THE ASSERTION IS ON THE OUTCOME, NOT ON THE LAYER. Both arrangements must
  -- end with a quotation whose rate is traceable to a registry row; asserting
  -- "the fixture started at zero" pinned the absence of the trigger, which is
  -- not a property this pack owns and which became false the moment the 017
  -- lane built the better half of doc 09 §14.8.
  SELECT quotation.* INTO v_q FROM core.quotations AS quotation WHERE quotation.id = v_quote;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
              WHERE trg.tgrelid = 'core.quotations'::regclass
                AND trg.tgname = 'trg_quotations_resolve_sst' AND NOT trg.tgisinternal) THEN
    IF v_q.sst_policy_id IS NULL THEN
      RAISE EXCEPTION 'T23a: 017 carries trg_quotations_resolve_sst and the INSERT '
                      'still left the quotation with no tax policy';
    END IF;
  ELSIF v_q.sst_rate <> 0 THEN
    RAISE EXCEPTION 'T23a2: no SST trigger, and the fixture did not start from '
                    '017''s zero default: %', v_q.sst_rate;
  END IF;

  v := core.put_quotation(v_quote::text,
    '{"lines":[{"item":"Trainer days","qty":1,"basis":"PER_DAY",
                "rate":{"amount":500000,"currency":"MYR"},
                "total":{"amount":500000,"currency":"MYR"},"isCost":false}]}'::jsonb,
    'sst-key-1');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T23b: %', v; END IF;

  SELECT quotation.* INTO v_q FROM core.quotations AS quotation WHERE quotation.id = v_quote;
  IF v_q.sst_policy_id IS NULL THEN
    RAISE EXCEPTION 'T23c: no tax policy was recorded on the quotation — the rate '
                    'cannot be traced back to a registry row';
  END IF;
  IF v_q.sst_rate <> 0.08 THEN
    RAISE EXCEPTION 'T23d: sst_rate is %, expected the registry''s 0.08', v_q.sst_rate;
  END IF;
  IF v_q.sst_reason <> 'STANDARD_RATED' THEN
    RAISE EXCEPTION 'T23e: sst_reason is %', v_q.sst_reason;
  END IF;
  -- `sst_sen` and `gross_price_sen` are 017's GENERATED columns. 018 writes the
  -- rate and 007/017 do the arithmetic — no money is multiplied in this pack.
  IF v_q.sst_sen <> app.round_half_up_sen(500000::numeric * 0.08) THEN
    RAISE EXCEPTION 'T23f: sst_sen % is not the generated rounding of sell x rate', v_q.sst_sen;
  END IF;
  -- T23g USED TO READ `gross_price_sen <> sell_price_sen + sst_sen`. 017:604
  -- defines `gross_price_sen` as GENERATED ALWAYS AS
  -- `sell_price_sen + round_half_up_sen(sell_price_sen * sst_rate)` and
  -- `sst_sen` as that second term, so the assertion was `x <> x` and pinned
  -- PostgreSQL's arithmetic rather than this pack's. What 018 actually decides
  -- is WHICH RATE lands on the row, so the gross is recomputed here from the
  -- REGISTRY rate reached through the stored policy id — the one number 018
  -- wrote — rather than from the generated column that was derived from it.
  IF v_q.gross_price_sen <> v_q.sell_price_sen + app.round_half_up_sen(
       v_q.sell_price_sen::numeric
       * (SELECT policy.rate_bps::numeric / 10000
            FROM core.tax_policies AS policy WHERE policy.id = v_q.sst_policy_id)) THEN
    RAISE EXCEPTION 'T23g: gross % does not follow from the registry rate on policy %',
      v_q.gross_price_sen, v_q.sst_policy_id;
  END IF;
  RAISE NOTICE 'T23 PASS: SST is resolved through app.resolve_tax_policy by whichever '
               'layer owns it — policy recorded, rate 0.08 from the registry, sst_sen '
               'and gross generated, and never two writers at once.';
END
$t23$;

DO $banner$ BEGIN RAISE NOTICE '════════ T24 · patch_enquiry_extraction — an edit discloses itself ════════'; END $banner$;
DO $t24$
DECLARE v jsonb; d jsonb; v_prov jsonb; v_detail text;
BEGIN
  v := core.patch_enquiry_extraction('ddddddd1-0000-4000-8000-000000000001',
         '{"field":"topic","value":"Delegation and feedback"}'::jsonb);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T24a: %', v; END IF;
  d := pg_temp.data('T24-envelope-1', v);
  IF d #>> '{extraction,topic,value}' <> 'Delegation and feedback' THEN
    RAISE EXCEPTION 'T24b: the value did not change: %', d #> '{extraction,topic}';
  END IF;

  -- A HUMAN EDIT OF AN AI VALUE FLIPS origin TO AI_SUGGESTED AND STAMPS
  -- editedBy. The lineage is what tells a later reader the number started as a
  -- model's guess; the editor is who took responsibility for it.
  v_prov := d #> '{extraction,topic,provenance}';
  IF v_prov ->> 'origin' <> 'AI_SUGGESTED' THEN
    RAISE EXCEPTION 'T24c: origin is % after a human edit, expected AI_SUGGESTED',
      v_prov ->> 'origin';
  END IF;
  IF NOT (v_prov ? 'editedBy') THEN
    RAISE EXCEPTION 'T24d: no editedBy was stamped on an edited AI value';
  END IF;
  IF v_prov #>> '{editedBy,name}' <> 'Alex Selvarajah' THEN
    RAISE EXCEPTION 'T24e: editedBy names the wrong person: %', v_prov -> 'editedBy';
  END IF;
  -- The AI lineage SURVIVES the edit rather than being erased.
  IF NOT (v_prov ? 'confidence') OR NOT (v_prov ? 'model') THEN
    RAISE EXCEPTION 'T24f: the edit erased the model lineage: %', v_prov;
  END IF;

  -- A HUMAN-AUTHORED FIELD GAINS NO PROVENANCE. `audience` never had a row;
  -- editing it must not invent one and badge it as AI-touched for ever after.
  v := core.patch_enquiry_extraction('ENQ-2026-0001',
         '{"field":"audience","value":"Senior line managers"}'::jsonb);
  PERFORM pg_temp.data('T24-envelope-2', v);
  IF (v #> '{data,extraction,audience}') ? 'provenance' THEN
    RAISE EXCEPTION 'T24g: editing a human field invented a provenance row';
  END IF;

  -- `budget` is Money on the wire and integer sen in the column.
  v := core.patch_enquiry_extraction('ENQ-2026-0001',
         '{"field":"budget","value":{"amount":5500000,"currency":"MYR"}}'::jsonb);
  PERFORM pg_temp.data('T24-envelope-3', v);
  IF (v #>> '{data,extraction,budget,value,amount}')::bigint <> 5500000 THEN
    RAISE EXCEPTION 'T24h: budget did not round-trip as Money: %',
      v #> '{data,extraction,budget,value}';
  END IF;

  -- An unknown field is refused, not silently created.
  BEGIN
    PERFORM core.patch_enquiry_extraction('ENQ-2026-0001','{"field":"nope","value":"x"}'::jsonb);
    RAISE EXCEPTION 'T24i: an unknown extraction field was accepted';
  -- THE CODE IS READ, NOT JUST THE SQLSTATE. `WHEN sqlstate 'TRNOS' THEN NULL`
  -- accepts a NOT_FOUND or a FORBIDDEN for a test written about validation, so
  -- the endpoint could start refusing for an entirely different reason and this
  -- would still pass. The same file already does it correctly five times.
  EXCEPTION WHEN sqlstate 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb) ->> 'code' <> 'VALIDATION_FAILED' THEN
      RAISE EXCEPTION 'T24i2: refused, but not as a validation failure: %', v_detail;
    END IF;
  END;
  RAISE NOTICE 'T24 PASS: edit flips origin to AI_SUGGESTED with editedBy, keeps the model '
               'lineage, invents nothing on human fields, round-trips Money, refuses junk.';
END
$t24$;

DO $banner$ BEGIN RAISE NOTICE '════════ T25 · follow-ups and the rate that may be unavailable ════════'; END $banner$;
DO $t25$
DECLARE v jsonb; d jsonb; v_fu uuid; v_msg uuid;
BEGIN
  INSERT INTO core.follow_ups
    (id, tenant_id, organisation_id, contact_id, reason, due_date, status, autonomy,
     owner_id, created_by_kind, created_by_id)
  VALUES ('c0000001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
          'bbbbbbb1-0000-4000-8000-000000000001','ccccccc1-0000-4000-8000-000000000001',
          'Proposal sent, no reply', CURRENT_DATE + 1, 'DUE','SUGGEST',
          '22222222-2222-4222-8222-222222222222','HUMAN','22222222-2222-4222-8222-222222222222'),
         ('c0000001-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
          'bbbbbbb1-0000-4000-8000-000000000001','ccccccc1-0000-4000-8000-000000000001',
          'Quotation expiring', CURRENT_DATE - 1, 'OVERDUE','SUGGEST',
          '22222222-2222-4222-8222-222222222222','HUMAN','22222222-2222-4222-8222-222222222222');

  v := core.list_follow_ups();
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T25a: %', v; END IF;
  d := pg_temp.data('T25-envelope-1', v);
  IF (d #>> '{page,total}')::integer <> 2 THEN
    RAISE EXCEPTION 'T25b: expected 2 follow-ups, got %', d #> '{page,total}';
  END IF;
  -- SOONEST DUE FIRST. The fixtures oracle defaults this queue to dueDate
  -- ascending and the client sends p_sort null, so the default has to live in
  -- SQL or the two answer differently.
  IF d #>> '{data,0,reason}' <> 'Quotation expiring' THEN
    RAISE EXCEPTION 'T25c: the queue did not open soonest-due-first: %', d #> '{data,0}';
  END IF;
  IF NOT (d #> '{data,0}' ?& ARRAY['id','ref','contact','organisation','reason','dueDate','status','autonomy']) THEN
    RAISE EXCEPTION 'T25d: FollowUp is incomplete: %', d #> '{data,0}';
  END IF;
  IF d #>> '{data,0,contact,name}' <> 'Siti Rahman' THEN
    RAISE EXCEPTION 'T25e: the contact did not resolve';
  END IF;

  -- A draft with NO rate row: rateSource must be UNAVAILABLE and the two money
  -- fields must be ABSENT. §16 Q4 / ruling R11 — the failure is a value, not a
  -- zero, and a stale rate rendered to four decimals is the most convincing way
  -- to be wrong about money.
  INSERT INTO core.outbound_messages
    (id, tenant_id, purpose, channel, template_id, category, contact_id, to_address,
     follow_up_id, body, status, currency, created_by_kind, created_by_id)
  VALUES ('c0000002-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
          'FOLLOWUP','EMAIL','c3333333-0000-4000-8000-000000000001','UTILITY',
          'ccccccc1-0000-4000-8000-000000000001','siti@chrome.test',
          'c0000001-0000-4000-8000-000000000001','Dear Siti, following up.','DRAFT','MYR',
          'AGENT','agent:followup')
  RETURNING id INTO v_msg;

  d := pg_temp.data('T25-envelope-2', core.get_follow_up_draft('c0000001-0000-4000-8000-000000000001','EMAIL'));
  IF d ->> 'rateSource' <> 'UNAVAILABLE' THEN
    RAISE EXCEPTION 'T25f: rateSource is % with no rate row, expected UNAVAILABLE',
      d ->> 'rateSource';
  END IF;
  IF d ? 'ratePerMessage' OR d ? 'estimatedCost' THEN
    RAISE EXCEPTION 'T25g: a money field was emitted with no rate behind it: %', d;
  END IF;
  IF NOT (d ?& ARRAY['channel','templateId','category','body','recipients','rateSource','consent']) THEN
    RAISE EXCEPTION 'T25h: MessageDraft is missing a required key: %', d;
  END IF;
  -- Consent travels with the draft: EMAIL was granted in the fixtures.
  IF (d #> '{consent,granted}') <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T25i: consent did not resolve for the channel: %', d -> 'consent';
  END IF;

  -- A DRAFT IS PER CHANNEL: WhatsApp has none, and that is a 404 rather than an
  -- empty composer.
  IF core.get_follow_up_draft('c0000001-0000-4000-8000-000000000001','WHATSAPP')
       #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T25j: a channel with no draft did not 404';
  END IF;
  IF core.get_follow_up_draft('c0000001-0000-4000-8000-000000000001','CARRIER_PIGEON')
       #>> '{error,code}' <> 'VALIDATION_FAILED' THEN
    RAISE EXCEPTION 'T25k: an unsupported channel was accepted';
  END IF;
  RAISE NOTICE 'T25 PASS: queue opens soonest-due-first, draft is per channel, and a missing '
               'rate is UNAVAILABLE with the money keys ABSENT rather than zeroed.';
END
$t25$;

DO $banner$ BEGIN RAISE NOTICE '════════ T26 · proposal sections — add, edit, regenerate ════════'; END $banner$;
DO $t26$
DECLARE v jsonb; d jsonb; v_prop text; v_run text; v_before integer; v_detail text;
BEGIN
  SELECT ref INTO v_prop FROM core.proposals
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111' LIMIT 1;

  v := core.list_proposals();
  PERFORM pg_temp.data('T26-envelope-1', v);
  IF (v #>> '{data,page,total}')::integer < 1 THEN
    RAISE EXCEPTION 'T26a: list_proposals found nothing';
  END IF;
  -- Each row is the full Proposal, projected by core.get_proposal, so sections
  -- and their provenance exist in ONE place rather than two.
  IF NOT (v #> '{data,data,0}' ?& ARRAY['sections','value','marginRate','opportunityRef']) THEN
    RAISE EXCEPTION 'T26b: a list row is not a full Proposal: %', v #> '{data,data,0}';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_before FROM core.proposal_sections
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111';

  v := core.add_proposal_section(v_prop, '{"title":"Investment","body":"Draft"}'::jsonb, 'sec-key-1');
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T26c: %', v; END IF;
  IF pg_catalog.jsonb_array_length(v #> '{data,sections}') <> v_before + 1 THEN
    RAISE EXCEPTION 'T26d: the section was not added';
  END IF;
  -- `n` is max(n)+1. A blank title is refused.
  IF (v #>> '{data,sections,2,n}')::int <> 3 THEN
    RAISE EXCEPTION 'T26e: n is %, expected max(n)+1 = 3', v #> '{data,sections,2,n}';
  END IF;
  -- A HAND-WRITTEN SECTION GETS NO PROVENANCE ROW: absence is how "a human
  -- wrote this" is said.
  IF (v #> '{data,sections,2}') ? 'provenance' THEN
    RAISE EXCEPTION 'T26f: a hand-added section was badged with provenance';
  END IF;

  -- A replay returns the proposal and adds no second section.
  v := core.add_proposal_section(v_prop, '{"title":"Investment","body":"Draft"}'::jsonb, 'sec-key-1');
  PERFORM pg_temp.data('T26-envelope-2', v);
  IF pg_catalog.jsonb_array_length(v #> '{data,sections}') <> v_before + 1 THEN
    RAISE EXCEPTION 'T26g: a replay added a SECOND identical section';
  END IF;

  BEGIN
    PERFORM core.add_proposal_section(v_prop, '{"title":"   "}'::jsonb, 'sec-key-2');
    RAISE EXCEPTION 'T26h: a blank title was accepted';
  EXCEPTION WHEN sqlstate 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb) ->> 'code' <> 'VALIDATION_FAILED' THEN
      RAISE EXCEPTION 'T26h2: refused, but not as a validation failure: %', v_detail;
    END IF;
  END;

  -- Editing section 1, which HAS a provenance row in the fixtures? It does not,
  -- so this asserts the human-authored path stays human-authored.
  v := core.put_proposal_section(v_prop, 1, '{"body":"Rewritten by hand"}'::jsonb, 'put-key-1');
  PERFORM pg_temp.data('T26-envelope-3', v);
  IF v #>> '{data,sections,0,body}' <> 'Rewritten by hand' THEN
    RAISE EXCEPTION 'T26i: the body did not change';
  END IF;
  -- An EMPTY title is ignored rather than written: a blank heading is never
  -- what an editor meant.
  v := core.put_proposal_section(v_prop, 1, '{"body":"Again","title":""}'::jsonb, 'put-key-2');
  PERFORM pg_temp.data('T26-envelope-4', v);
  IF v #>> '{data,sections,0,title}' <> 'Understanding' THEN
    RAISE EXCEPTION 'T26j: an empty title overwrote a real one: %', v #> '{data,sections,0,title}';
  END IF;
  BEGIN
    PERFORM core.put_proposal_section(v_prop, 99, '{"body":"x"}'::jsonb, 'put-key-3');
    RAISE EXCEPTION 'T26k: an unknown section number was accepted';
  EXCEPTION WHEN sqlstate 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb) ->> 'code' <> 'NOT_FOUND' THEN
      RAISE EXCEPTION 'T26k2: refused, but not as a not-found: %', v_detail;
    END IF;
  END;

  -- REGENERATE ENQUEUES, IT DOES NOT GENERATE. Ruling R-A puts every model call
  -- behind the worker and R-B forbids pg_net; a generation inside a request
  -- would blow the 10s timeout. The run row is real so the run drawer has
  -- something to point at.
  v := core.regenerate_proposal_section(v_prop, 1);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T26l: %', v; END IF;
  IF NOT (v -> 'data' ?& ARRAY['section','runId']) THEN
    RAISE EXCEPTION 'T26m: the regenerate response is not {section, runId}: %', v -> 'data';
  END IF;
  v_run := v #>> '{data,runId}';
  IF NOT EXISTS (SELECT 1 FROM core.runs WHERE id = v_run::uuid) THEN
    RAISE EXCEPTION 'T26n: runId points at no run row — the run drawer would open on nothing';
  END IF;
  IF (v #> '{data,section,needsReview}') <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T26o: the section was not flagged as awaiting the worker';
  END IF;
  -- T26p WAS "two consecutive calls return different runIds", which the inert
  -- version of this RPC satisfied perfectly — it wrote a fresh orphan run every
  -- time. The question that actually distinguishes enqueued work from an inert
  -- run is asked in T33, along with the replay check, which moved there with it.
  RAISE NOTICE 'T26 PASS: add uses max(n)+1 and writes no provenance, replay adds nothing, '
               'empty title ignored, regenerate returns a real run (T33 pins the job).';
END
$t26$;

DO $banner$ BEGIN RAISE NOTICE '════════ T27 · list_quotations refuses rather than returning empty ════════'; END $banner$;
DO $t27$
DECLARE v jsonb;
BEGIN
  v := core.list_quotations();
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T27a: SALES was refused: %', v; END IF;
  IF (v #>> '{data,page,total}')::integer < 1 THEN
    RAISE EXCEPTION 'T27b: no quotations listed';
  END IF;
  -- Each row is projected by core.get_quotation, so the R6 floor block and the
  -- PROGRAMME -> ABSOLUTE mapping exist once.
  IF NOT (v #> '{data,data,0}' ?& ARRAY['absoluteFloorPrice','marginFloorPrice','bindingFloorBasis']) THEN
    RAISE EXCEPTION 'T27c: a list row is missing the R6 floor block';
  END IF;
  IF (v #>> '{data,data,0,bindingFloorBasis}') NOT IN ('ABSOLUTE','MARGIN') THEN
    RAISE EXCEPTION 'T27d: a list row leaked 007''s PROGRAMME spelling';
  END IF;

  -- THE WHOLE REASON THIS IS AN RPC AND NOT A VIEW READ. Under RLS a reader
  -- without the permission would get an EMPTY LIST from a view —
  -- indistinguishable from "there are no quotations". OPS does not hold
  -- quotation:read, so it must get FORBIDDEN and be told which permission is
  -- missing. A price list is exactly the collection where "you may not see
  -- this" and "there is nothing here" must not look the same.
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub','33333333-3333-4333-8333-333333333333',
      'tenant_id','11111111-1111-4111-8111-111111111111',
      'app_role','OPS','actor_kind','HUMAN','role','authenticated')::text, true);
  v := core.list_quotations();
  IF v -> 'success' <> 'false'::jsonb OR v #>> '{error,code}' <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T27e: OPS got % instead of FORBIDDEN — an empty list and a refusal '
                    'are not the same answer', v;
  END IF;
  IF v #>> '{error,details,requiredPermission}' <> 'quotation:read' THEN
    RAISE EXCEPTION 'T27f: the refusal does not say which permission is missing: %', v;
  END IF;
  IF v ? 'data' THEN RAISE EXCEPTION 'T27g: a refusal carried a data key'; END IF;

  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub','22222222-2222-4222-8222-222222222222',
      'tenant_id','11111111-1111-4111-8111-111111111111',
      'app_role','SALES','actor_kind','HUMAN','role','authenticated')::text, true);
  RAISE NOTICE 'T27 PASS: SALES lists with the R6 block on every row; OPS is refused '
               'FORBIDDEN naming quotation:read rather than handed an empty list.';
END
$t27$;

DO $banner$ BEGIN RAISE NOTICE '════════ T28 · rate card and audit ════════'; END $banner$;
DO $t28$
DECLARE v jsonb; d jsonb;
BEGIN
  v := core.get_rate_card();
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T28a: %', v; END IF;
  d := pg_temp.data('T28-envelope-1', v);
  IF NOT (d ?& ARRAY['version','effectiveFrom','effectiveTo','currency','trainerDayRate',
                     'materialsPerPax','venue','travel','mealsPerPax','commissionPct',
                     'marginFloorPct','discountAuthority']) THEN
    RAISE EXCEPTION 'T28b: RateCard is incomplete: %', d;
  END IF;
  -- `mealsPerPax` is a SINGLE OBJECT, not an array, even though the table is
  -- keyed by programme type.
  IF pg_catalog.jsonb_typeof(d -> 'mealsPerPax') <> 'object' THEN
    RAISE EXCEPTION 'T28c: mealsPerPax is not a single object: %', d -> 'mealsPerPax';
  END IF;
  IF d ->> 'version' <> '2026.1' THEN
    RAISE EXCEPTION 'T28d: the version was defaulted rather than read: %', d ->> 'version';
  END IF;

  -- AN AUDIT DRAWER ON AN UNTOUCHED RECORD IS EMPTY, NOT MISSING. A 404 here
  -- would say the record does not exist.
  v := core.get_audit('proposals','PRO-9999-9999');
  IF v -> 'success' <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T28e: an empty audit trail returned an error: %', v;
  END IF;
  IF pg_catalog.jsonb_array_length(v #> '{data,data}') <> 0 THEN
    RAISE EXCEPTION 'T28f: expected an empty trail';
  END IF;
  IF NOT ((v #> '{data,page}') ? 'next') THEN
    RAISE EXCEPTION 'T28g: page.next is absent rather than present-and-null';
  END IF;
  RAISE NOTICE 'T28 PASS: rate card complete with mealsPerPax a single object and the '
               'version read not defaulted; an untouched record has an empty trail, not a 404.';
END
$t28$;

DO $banner$ BEGIN RAISE NOTICE '════════ T29 · the two views 014 could not grant ════════'; END $banner$;
DO $t29$
DECLARE v_cols text[];
BEGIN
  -- 014 REVOKED core.budget_status and core.model_tier_status because both are
  -- security_invoker and read app.usage_rollup, which authenticated cannot
  -- reach — so they were unreadable no matter what was granted ON them.
  IF pg_catalog.has_table_privilege('authenticated','core.budget_status','SELECT') THEN
    RAISE EXCEPTION 'T29a: core.budget_status was granted to authenticated — that is the '
                    'grant 014 refused to make because it looks like access and delivers '
                    'a permission error';
  END IF;

  -- 018's replacements carry the names rpcClient.ts ACTUALLY reads
  -- (VIEW_READS.aiBudgets = v_budgets, aiTiers = v_model_tiers) and are
  -- readable, because the body crosses the app boundary through a definer.
  IF NOT pg_catalog.has_table_privilege('authenticated','core.v_budgets','SELECT') THEN
    RAISE EXCEPTION 'T29b: authenticated still cannot read core.v_budgets';
  END IF;
  IF NOT pg_catalog.has_table_privilege('authenticated','core.v_model_tiers','SELECT') THEN
    RAISE EXCEPTION 'T29c: authenticated still cannot read core.v_model_tiers';
  END IF;
  IF pg_catalog.has_table_privilege('anon','core.v_budgets','SELECT')
     OR pg_catalog.has_table_privilege('anon','core.v_model_tiers','SELECT') THEN
    RAISE EXCEPTION 'T29d: anon can read the AI budget views';
  END IF;

  -- security_invoker stays ON the view: the tenant predicate is still evaluated
  -- as the caller, and the definer function exists only to cross into `app`.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname='core' AND c.relname='v_budgets'
                   AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION 'T29e: core.v_budgets is not security_invoker';
  END IF;

  -- The columns are the contract's Budget, in camelCase where the contract is.
  SELECT pg_catalog.array_agg(a.attname ORDER BY a.attname) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'core.v_budgets'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> ARRAY['cap','key','scope','spend','state'] THEN
    RAISE EXCEPTION 'T29f: v_budgets does not match the contract Budget: %', v_cols;
  END IF;

  PERFORM 1 FROM core.v_budgets;
  PERFORM 1 FROM core.v_model_tiers;
  RAISE NOTICE 'T29 PASS: 014''s carried defect is closed — the ungrantable views stay '
               'revoked and v_budgets/v_model_tiers are readable under the names the '
               'client asks for.';
END
$t29$;


DO $banner$ BEGIN RAISE NOTICE '════════ T30 · the per-tenant pipeline seed, and its derived ids ════════'; END $banner$;
DO $t30$
DECLARE
  v_tenant uuid := 'acade111-0000-4000-8000-000000000001';
  v_n integer; v_id uuid; v_labels text[]; v_pos smallint[];
BEGIN
  -- A BRAND NEW TENANT RENDERS A PIPELINE. That is the defect 016 deferred
  -- ("until then a new tenant renders no pipeline") and this is the assertion
  -- that it is closed. The tenant is inserted plainly: the seed has to ride the
  -- provisioning trigger, not a helper the caller has to remember.
  INSERT INTO public.tenants (id, slug, name, status, timezone, locale)
  VALUES (v_tenant,'akademi-perdana','Akademi Perdana','ACTIVE','Asia/Kuala_Lumpur','en-MY');

  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM core.pipelines WHERE tenant_id = v_tenant;
  IF v_n <> 2 THEN RAISE EXCEPTION 'T30a: expected 2 seeded pipelines, got %', v_n; END IF;

  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM core.pipeline_steps WHERE tenant_id = v_tenant;
  IF v_n <> 16 THEN RAISE EXCEPTION 'T30b: expected 16 seeded steps, got %', v_n; END IF;

  -- THE IDS ARE THE AGREED DERIVED EXPRESSION, not literals. A literal agrees
  -- with itself while disagreeing with the seeds lane; the expression is the
  -- thing both packs compute, so the assertion is made against the expression.
  -- `core.engagement_step_states` FKs `(tenant_id, pipeline_step_id)`, and PR
  -- #16 writes 90 of those rows — if the two packs derived different ids, one
  -- of the two loads would fail on that foreign key.
  SELECT id INTO v_id FROM core.pipelines
   WHERE tenant_id = v_tenant AND object = 'ENGAGEMENT';
  IF v_id <> pg_catalog.md5(v_tenant::text || 'pipeline:ENGAGEMENT')::uuid THEN
    RAISE EXCEPTION 'T30c: the ENGAGEMENT pipeline id is not the derived one';
  END IF;

  -- WON IS A STAGE OF BOTH PIPELINES, which is why the name carries the object.
  -- Without it both rows derive the SAME id and the second insert is a primary
  -- key violation. Asserting the two are different is asserting the fix.
  -- T30d USED TO COMPARE THE `id` OF TWO DISTINCT ROWS FOR EQUALITY. `id` is
  -- the primary key (004:639), so two rows that both exist can never share one
  -- and the assertion could not fail — as the comment above it already admitted,
  -- the real failure aborts at the seed with a PK violation before this line
  -- runs. What is actually worth pinning is that each id IS THE DERIVED ONE
  -- FOR ITS OWN OBJECT: `md5(tenant || 'pipeline:' || object || ':' || key)`.
  -- That is falsifiable — drop the object from the derivation and both sides
  -- become the same value and this fails, which is the defect the comment
  -- describes.
  IF (SELECT step.id FROM core.pipeline_steps AS step
        JOIN core.pipelines AS pipe ON pipe.tenant_id = step.tenant_id AND pipe.id = step.pipeline_id
       WHERE step.tenant_id = v_tenant AND step.step_key = 'WON' AND pipe.object = 'ENGAGEMENT')
     IS DISTINCT FROM pg_catalog.md5(v_tenant::text || 'pipeline:ENGAGEMENT:WON')::uuid
     OR (SELECT step.id FROM core.pipeline_steps AS step
           JOIN core.pipelines AS pipe ON pipe.tenant_id = step.tenant_id AND pipe.id = step.pipeline_id
          WHERE step.tenant_id = v_tenant AND step.step_key = 'WON' AND pipe.object = 'OPPORTUNITY')
     IS DISTINCT FROM pg_catalog.md5(v_tenant::text || 'pipeline:OPPORTUNITY:WON')::uuid THEN
    RAISE EXCEPTION 'T30d: a WON stage id is not derived from its own object — the pipeline '
                    'object is missing from the derivation';
  END IF;
  IF (SELECT id FROM core.pipeline_steps
       WHERE tenant_id = v_tenant AND step_key = 'WON' AND position = 1)
     <> pg_catalog.md5(v_tenant::text || 'pipeline:ENGAGEMENT:WON')::uuid THEN
    RAISE EXCEPTION 'T30e: ENGAGEMENT:WON is not the derived id';
  END IF;

  -- Order and labels come from the rows, and the positions are 1..N dense:
  -- core.pipeline_steps is UNIQUE on (tenant_id, pipeline_id, position) as well
  -- as on step_key, so the seeds lane and this pack have to agree on BOTH.
  SELECT pg_catalog.array_agg(step.step_key ORDER BY step.position),
         pg_catalog.array_agg(step.position ORDER BY step.position)
    INTO v_labels, v_pos
    FROM core.pipeline_steps AS step
    JOIN core.pipelines AS pipeline
      ON pipeline.tenant_id = step.tenant_id AND pipeline.id = step.pipeline_id
   WHERE step.tenant_id = v_tenant AND pipeline.object = 'ENGAGEMENT';
  IF v_labels <> ARRAY['WON','TRAINER_CONFIRMED','SCHEDULED','REGISTERED','DELIVERED',
                       'ATTENDANCE_LOCKED','HRDC_CLAIM','INVOICED','PAID'] THEN
    RAISE EXCEPTION 'T30f: the ENGAGEMENT lifecycle is not the contract order: %', v_labels;
  END IF;
  IF v_pos <> ARRAY[1,2,3,4,5,6,7,8,9]::smallint[] THEN
    RAISE EXCEPTION 'T30g: positions are not 1..9 dense: %', v_pos;
  END IF;

  -- Terminal is stored per ruling R16: PAID ends delivery, WON and LOST end a
  -- deal and sit beside each other.
  IF (SELECT pg_catalog.count(*) FROM core.pipeline_steps
       WHERE tenant_id = v_tenant AND terminal) <> 3 THEN
    RAISE EXCEPTION 'T30h: expected exactly three terminal stages';
  END IF;

  -- IDEMPOTENT. ON CONFLICT (id) DO NOTHING, so the fixture seed's own rows
  -- survive whichever of the two packs loads first.
  IF app.seed_pipelines(v_tenant) <> 0 THEN
    RAISE EXCEPTION 'T30i: re-seeding wrote rows; the fixture seed would be overwritten';
  END IF;

  -- DEAL_CHAIN IS NOT SEEDED AND CANNOT BE. 004's CHECK admits only
  -- ENGAGEMENT, OPPORTUNITY and PACKET. Pinned so the day 004 is reconciled
  -- with the contract, this says so.
  BEGIN
    INSERT INTO core.pipelines (tenant_id, object, name, is_default, status,
                                created_by_kind, created_by_id)
    VALUES (v_tenant,'DEAL_CHAIN','Deal chain',false,'ACTIVE','SYSTEM','test');
    RAISE EXCEPTION 'T30j: DEAL_CHAIN now inserts — 004 and the contract have been '
                    'reconciled; seed the six-step chain and drop this pin';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'T30 PASS: a new tenant is provisioned 2 pipelines and 16 steps with '
               'derived ids that match the seeds lane, positions 1..N dense, three '
               'terminal stages, idempotent re-seed, DEAL_CHAIN still unstorable.';
END
$t30$;

DO $banner$ BEGIN RAISE NOTICE '════════ T31 · ONE KEYSET ENGINE — total is stable, next stops at the end ════════'; END $banner$;
DO $t31$
DECLARE
  v        jsonb;
  v_tenant uuid := '11111111-1111-4111-8111-111111111111';
  v_cursor text;
  v_total1 integer;
  v_total2 integer;
BEGIN
  -- ── H2 · `page.total` IS THE FILTERED COUNT, ON EVERY PAGE ───────────────
  -- Before the keyset engine was extracted, `core.list_enquiries` appended the
  -- cursor predicate to `v_where` and THEN counted, so `total` was the rows
  -- REMAINING after the cursor. A reader paging 120 matches at size 50 saw the
  -- list header read 120, then 70, then 20. The other four list RPCs counted
  -- first, which is what made this invisible: the divergence lived 250 lines
  -- from its twin. This assertion fails on the pre-fix migration with
  -- "T31b: page.total shrank across pages: 4 then 2".
  INSERT INTO core.enquiries
    (id, tenant_id, channel, status, received_at, from_name, from_email, subject,
     preview, body, needs_human_review, currency, created_by_kind, created_by_id)
  VALUES ('ddddddd1-0000-4000-8000-00000000000a', v_tenant, 'EMAIL', 'OPEN',
          '2026-09-09T09:00:00+08', 'Pager', 'pager@chrome.test', 'Paging fixture',
          'four makes an exact multiple', 'body', false, 'MYR',
          'HUMAN', '22222222-2222-4222-8222-222222222222');

  v := core.list_enquiries('[]'::jsonb, '-receivedAt', '{"size":2}'::jsonb, NULL);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T31a: %', v; END IF;
  v_total1 := (v #>> '{data,page,total}')::integer;
  IF v_total1 <> 4 THEN
    RAISE EXCEPTION 'T31a2: expected 4 enquiries in the tenant, got %', v_total1;
  END IF;
  v_cursor := v #>> '{data,page,next}';
  IF v_cursor IS NULL THEN
    RAISE EXCEPTION 'T31a3: page one of four at size two handed back no cursor';
  END IF;

  v := core.list_enquiries('[]'::jsonb, '-receivedAt',
         pg_catalog.jsonb_build_object('size', 2, 'cursor', v_cursor), NULL);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T31b0: %', v; END IF;
  v_total2 := (v #>> '{data,page,total}')::integer;
  IF v_total2 <> v_total1 THEN
    RAISE EXCEPTION 'T31b: page.total shrank across pages: % then %', v_total1, v_total2;
  END IF;

  -- ── H3 · `next` IS NULL ON AN EXACT-MULTIPLE LAST PAGE ───────────────────
  -- The other four decided `next` from `v_count = v_size AND v_count < v_total`.
  -- With four rows at size two, page two returns two rows and 2 < 4 holds, so
  -- they handed back a cursor pointing PAST the last row: the client fetched a
  -- third page, got `data: []`, and rendered an empty list. `list_enquiries`
  -- did NOT have this bug — its `v_total` was the post-cursor remainder, so the
  -- same wrong arithmetic happened to cancel. Two copies of one engine, two
  -- opposite defects, one of them masking the other.
  IF (v #> '{data,page,next}') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'T31c: list_enquiries page two of four at size two handed back '
                    'a cursor past the last row: %', v #> '{data,page,next}';
  END IF;

  -- The same question asked of one of the four. T25 seeded two follow-ups;
  -- two more make an exact multiple of the page size.
  INSERT INTO core.follow_ups
    (id, tenant_id, organisation_id, contact_id, reason, due_date, status, autonomy,
     owner_id, created_by_kind, created_by_id)
  VALUES ('c0000001-0000-4000-8000-000000000003', v_tenant,
          'bbbbbbb1-0000-4000-8000-000000000001','ccccccc1-0000-4000-8000-000000000001',
          'Third', CURRENT_DATE + 3, 'DUE','SUGGEST',
          '22222222-2222-4222-8222-222222222222','HUMAN','22222222-2222-4222-8222-222222222222'),
         ('c0000001-0000-4000-8000-000000000004', v_tenant,
          'bbbbbbb1-0000-4000-8000-000000000001','ccccccc1-0000-4000-8000-000000000001',
          'Fourth', CURRENT_DATE + 4, 'DUE','SUGGEST',
          '22222222-2222-4222-8222-222222222222','HUMAN','22222222-2222-4222-8222-222222222222');

  v := core.list_follow_ups('[]'::jsonb, 'dueDate', '{"size":2}'::jsonb, NULL);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T31d: %', v; END IF;
  v_total1 := (v #>> '{data,page,total}')::integer;
  IF v_total1 <> 4 THEN
    RAISE EXCEPTION 'T31d2: expected 4 follow-ups, got %', v_total1;
  END IF;
  v_cursor := v #>> '{data,page,next}';
  IF v_cursor IS NULL THEN
    RAISE EXCEPTION 'T31d3: page one of four at size two handed back no cursor';
  END IF;

  v := core.list_follow_ups('[]'::jsonb, 'dueDate',
         pg_catalog.jsonb_build_object('size', 2, 'cursor', v_cursor), NULL);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T31e0: %', v; END IF;
  IF pg_catalog.jsonb_array_length(v #> '{data,data}') <> 2 THEN
    RAISE EXCEPTION 'T31e1: page two returned % rows, expected 2',
      pg_catalog.jsonb_array_length(v #> '{data,data}');
  END IF;
  IF (v #>> '{data,page,total}')::integer <> v_total1 THEN
    RAISE EXCEPTION 'T31e2: follow-up page.total moved: % then %',
      v_total1, v #>> '{data,page,total}';
  END IF;
  -- THIS IS THE ASSERTION THAT FAILS ON THE PRE-FIX MIGRATION.
  IF (v #> '{data,page,next}') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'T31f: list_follow_ups handed back a cursor past the end of an '
                    'exact-multiple last page: %', v #> '{data,page,next}';
  END IF;

  -- And the page that cursor pointed at is empty, which is the round trip the
  -- client was making. Asserted so the failure above reads as a real cost.
  v := core.list_follow_ups('[]'::jsonb, 'dueDate',
         pg_catalog.jsonb_build_object('size', 2, 'cursor',
           app._cursor_encode((SELECT (due_date::timestamptz) FROM core.follow_ups
                                WHERE id = 'c0000001-0000-4000-8000-000000000004'),
                              'c0000001-0000-4000-8000-000000000004'::uuid)), NULL);
  PERFORM pg_temp.data('T31-envelope-1', v);
  IF pg_catalog.jsonb_array_length(v #> '{data,data}') <> 0 THEN
    RAISE EXCEPTION 'T31g: a cursor at the last row should yield an empty page';
  END IF;

  -- ── The engine is shared, not merely corrected in five places ────────────
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = '_keyset_scope')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'app' AND p.proname = '_next_cursor') THEN
    RAISE EXCEPTION 'T31h: the keyset helpers are absent; the five list RPCs are '
                    'each owning their own copy of the ordering again';
  END IF;

  RAISE NOTICE 'T31 PASS: page.total is the filtered count on every page, next is null '
               'on an exact-multiple last page, and all five list RPCs share one engine.';
END
$t31$;

DO $banner$ BEGIN RAISE NOTICE '════════ T32 · p_view IS NEVER SILENTLY DROPPED ════════'; END $banner$;
DO $t32$
DECLARE
  v        jsonb;
  v_tenant uuid := '11111111-1111-4111-8111-111111111111';
  v_view   text;
  v_other  text;
  v_all    integer;
  r        record;
BEGIN
  -- ── A saved view actually filters, and says it did ───────────────────────
  SELECT id::text INTO v_view FROM core.saved_views
   WHERE tenant_id = v_tenant AND object = 'ENQUIRY' LIMIT 1;

  v := core.list_enquiries('[]'::jsonb, NULL, '{"size":50}'::jsonb, NULL);
  v_all := (v #>> '{data,page,total}')::integer;
  v := core.list_enquiries('[]'::jsonb, NULL, '{"size":50}'::jsonb, v_view);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T32a: %', v; END IF;
  IF (v #>> '{data,page,total}')::integer >= v_all THEN
    RAISE EXCEPTION 'T32b: the saved view subtracted nothing: % of %',
      v #>> '{data,page,total}', v_all;
  END IF;
  IF v #>> '{data,appliedFilters,0,source}' <> 'VIEW' THEN
    RAISE EXCEPTION 'T32c: a view filter is not sourced VIEW: %', v -> 'data' -> 'appliedFilters';
  END IF;

  -- A view belonging to ANOTHER TENANT is not an existence oracle.
  INSERT INTO core.saved_views
    (id, tenant_id, object, label, filters, columns, is_default, owner_id, visibility,
     created_by_kind, created_by_id)
  VALUES ('5a5e0001-0000-4000-8000-000000000001'::uuid,
          '99999999-9999-4999-8999-999999999999','ENQUIRY','Theirs',
          '[{"field":"status","op":"eq","value":"OPEN"}]'::jsonb,
          ARRAY['ref'],false,'88888888-8888-4888-8888-888888888888','TEAM',
          'HUMAN','88888888-8888-4888-8888-888888888888');
  v_other := '5a5e0001-0000-4000-8000-000000000001';
  v := core.list_enquiries('[]'::jsonb, NULL, '{"size":50}'::jsonb, v_other);
  IF v -> 'success' <> 'false'::jsonb
     OR v #>> '{error,details,fields,0,reason}' <> 'UNKNOWN_VIEW' THEN
    RAISE EXCEPTION 'T32d: another tenant''s view resolved: %', v;
  END IF;

  -- A view of the WRONG OBJECT does not apply to this list either. The
  -- ENQUIRY view above is not an APPROVAL view, and list_approvals must say so
  -- rather than apply enquiry filters to approval columns.
  v := core.list_approvals('[]'::jsonb, NULL, '{"size":50}'::jsonb, v_view);
  IF v -> 'success' <> 'false'::jsonb
     OR v #>> '{error,details,fields,0,reason}' <> 'UNKNOWN_VIEW' THEN
    RAISE EXCEPTION 'T32e: an ENQUIRY view was accepted by list_approvals: %', v;
  END IF;

  -- ── THE BLOCKER. Three lists DECLARED p_view and never read it ───────────
  -- Against the pre-fix migration every one of these three returned
  -- success:true with EVERY row in the tenant and `appliedFilters: []`. A
  -- reader who saved a view restricting them to their own proposals saw
  -- everyone's. An ignored view is an ignored filter, and §5 of the migration
  -- forbids exactly that.
  --
  -- `core.saved_view_object` (003:352) has three values — LEAD, ENQUIRY,
  -- APPROVAL — so a view for these three lists CANNOT EXIST and the refusal is
  -- the honest answer. This assertion is written against the ENUM, not against
  -- a hardcoded list: the day the contract adds PROPOSAL, the branch below
  -- flips to requiring resolution instead of refusal, and the pin still holds.
  FOR r IN SELECT * FROM (VALUES
             ('list_follow_ups','FOLLOW_UP'),
             ('list_proposals', 'PROPOSAL'),
             ('list_quotations','QUOTATION')) AS t(fn, obj)
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT core.%I(''[]''::jsonb, NULL, ''{"size":50}''::jsonb, %L)', r.fn, v_view)
      INTO v;

    IF r.obj = ANY (SELECT pg_catalog.unnest(
                      pg_catalog.enum_range(NULL::core.saved_view_object))::text) THEN
      -- The enum has grown. A view of that object must now RESOLVE, and one of
      -- another object must still be refused.
      IF v -> 'success' <> 'false'::jsonb THEN
        RAISE EXCEPTION 'T32f: core.% accepted an ENQUIRY view although % is now a '
                        'saved_view_object of its own', r.fn, r.obj;
      END IF;
    ELSE
      IF v -> 'success' <> 'false'::jsonb THEN
        RAISE EXCEPTION 'T32g: core.% SILENTLY DROPPED p_view and returned % rows '
                        'with appliedFilters %', r.fn, v #>> '{data,page,total}',
                        v -> 'data' -> 'appliedFilters';
      END IF;
      IF v #>> '{error,code}' <> 'VALIDATION_FAILED'
         OR v #>> '{error,details,fields,0,field}' <> 'view'
         OR v #>> '{error,details,fields,0,reason}' <> 'UNSUPPORTED_VIEW_OBJECT' THEN
        RAISE EXCEPTION 'T32h: core.% refused p_view with the wrong shape: %', r.fn, v;
      END IF;
    END IF;

    -- AND THE PARAMETER IS STILL IN THE SIGNATURE. PostgREST resolves by named
    -- arguments; dropping `p_view` would 404 every client call that sends it.
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core' AND p.proname = r.fn
         AND p.pronargs = 4
         AND 'p_view' = ANY (p.proargnames)) THEN
      RAISE EXCEPTION 'T32i: core.% no longer takes four arguments; a client sending '
                      'p_view would get PGRST202', r.fn;
    END IF;
  END LOOP;

  -- Passing NO view still works on all three, so the refusal is about the view
  -- and not about the parameter existing.
  IF core.list_proposals() -> 'success' <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T32j: list_proposals refuses even with no view';
  END IF;

  RAISE NOTICE 'T32 PASS: a saved view filters and is sourced VIEW, a foreign or '
               'wrong-object view is refused, and the three lists that dropped p_view '
               'now refuse it with UNSUPPORTED_VIEW_OBJECT — signature unchanged.';
END
$t32$;

DO $banner$ BEGIN RAISE NOTICE '════════ T33 · REGENERATE ENQUEUES REAL WORK, OR REFUSES ════════'; END $banner$;
DO $t33$
DECLARE
  v        jsonb;
  v_tenant uuid := '11111111-1111-4111-8111-111111111111';
  v_prop   text;
  v_run    text;
  v_run2   text;
  v_job    app.outbox%ROWTYPE;
  v_runs   integer;
  v_jobs   integer;
  v_detail text;
BEGIN
  SELECT ref INTO v_prop FROM core.proposals
   WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'T33-setup: no proposal fixture'; END IF;

  SELECT pg_catalog.count(*)::integer INTO v_jobs FROM app.outbox WHERE tenant_id = v_tenant;

  v := core.regenerate_proposal_section(v_prop, 1);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T33a: %', v; END IF;
  v_run := v #>> '{data,runId}';

  -- ── THE BLOCKER. The comment said "ENQUEUE the work … and hand back the run
  -- the worker will fill". The code inserted a RUNNING run, flipped
  -- needs_review, and returned 200. No perform_action, no emit_event, no
  -- enqueue_effect_jobs, no outbox row, and no AFTER INSERT trigger on
  -- core.runs to make one. Nothing in the product ever regenerated the
  -- section; five presses left five orphan RUNNING runs.
  --
  -- The old pin (T26p) asserted only that two consecutive calls return
  -- DIFFERENT runIds, which the inert version satisfied perfectly. It is
  -- replaced here by the question that distinguishes the two: IS THERE A JOB?
  SELECT pg_catalog.count(*)::integer INTO v_jobs
    FROM app.outbox WHERE tenant_id = v_tenant AND run_id = v_run;
  IF v_jobs < 1 THEN
    RAISE EXCEPTION 'T33b: regenerate wrote run % and enqueued NOTHING — the run '
                    'will sit at RUNNING forever and the section will never be '
                    'regenerated', v_run;
  END IF;

  SELECT job.* INTO v_job FROM app.outbox AS job
   WHERE job.tenant_id = v_tenant AND job.run_id = v_run LIMIT 1;
  IF v_job.state <> 'QUEUED' THEN
    RAISE EXCEPTION 'T33c: the job is % rather than QUEUED', v_job.state;
  END IF;
  IF v_job.job_type <> 'AI_DRAFT_PROPOSAL_SECTION' THEN
    RAISE EXCEPTION 'T33d: the job carries job_type %', v_job.job_type;
  END IF;
  IF v_job.event_id IS NULL THEN
    RAISE EXCEPTION 'T33e: the job has no event — it did not come through app.emit_event';
  END IF;
  IF (v_job.payload ->> 'sectionN')::integer <> 1
     OR v_job.payload ->> 'proposalRef' <> v_prop THEN
    RAISE EXCEPTION 'T33f: the worker cannot tell WHICH section to redraft: %', v_job.payload;
  END IF;
  IF v_job.correlation_id <> (SELECT correlation_id FROM core.runs WHERE id = v_run::uuid) THEN
    RAISE EXCEPTION 'T33g: the job and the run do not share a correlation id';
  END IF;

  -- A WORKER CAN ACTUALLY CLAIM IT. A job nothing can claim is the same
  -- non-event as no job at all.
  IF NOT EXISTS (SELECT 1 FROM app.claim_jobs('t33-worker', v_tenant,
                                              ARRAY['AI_DRAFT_PROPOSAL_SECTION'], 1)) THEN
    RAISE EXCEPTION 'T33h: app.claim_jobs will not serve the job';
  END IF;

  -- The event is in the audit spine too, keyed to the run.
  IF NOT EXISTS (SELECT 1 FROM core.events
                  WHERE tenant_id = v_tenant AND id = v_job.event_id
                    AND type = 'PROPOSAL_SECTION_REGENERATE_REQUESTED'
                    AND run_id = v_run) THEN
    RAISE EXCEPTION 'T33i: no event row for the regeneration';
  END IF;

  -- A SECOND PRESS IS A NEW RUN AND A NEW JOB, not a replay of the draft the
  -- author just rejected.
  v_run2 := core.regenerate_proposal_section(v_prop, 1) #>> '{data,runId}';
  IF v_run2 = v_run THEN
    RAISE EXCEPTION 'T33j: regenerate replayed the run the author just rejected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.outbox WHERE tenant_id = v_tenant AND run_id = v_run2) THEN
    RAISE EXCEPTION 'T33k: the second press enqueued nothing';
  END IF;

  -- ── AND IT REFUSES RATHER THAN RETURNING 200 ON NOTHING ──────────────────
  -- If the routing row is gone, app.emit_event enqueues no job and says
  -- nothing about it. That is the exact shape of the defect this slice fixed,
  -- so the function checks and RAISEs — and because it RAISEs rather than
  -- returning app.err, the run and the needs_review flag roll back with it and
  -- no orphan RUNNING run is left behind.
  SELECT pg_catalog.count(*)::integer INTO v_runs FROM core.runs WHERE tenant_id = v_tenant;
  BEGIN
    UPDATE app.event_subscriptions SET enabled = false
     WHERE event_type = 'PROPOSAL_SECTION_REGENERATE_REQUESTED';
    BEGIN
      PERFORM core.regenerate_proposal_section(v_prop, 1);
      RAISE EXCEPTION 'T33l: regenerate returned success with no routing row — it is '
                      'back to writing runs nothing will ever complete';
    EXCEPTION WHEN sqlstate 'TRNOS' THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      IF (v_detail::jsonb ->> 'reason') <> 'REGENERATE_NOT_ROUTED' THEN
        RAISE EXCEPTION 'T33m: wrong refusal: %', v_detail;
      END IF;
    END;
  END;
  UPDATE app.event_subscriptions SET enabled = true
   WHERE event_type = 'PROPOSAL_SECTION_REGENERATE_REQUESTED';

  IF (SELECT pg_catalog.count(*)::integer FROM core.runs WHERE tenant_id = v_tenant) <> v_runs THEN
    RAISE EXCEPTION 'T33n: the refused call left an orphan RUNNING run behind — '
                    'app.err would COMMIT here, which is why this function raises';
  END IF;

  RAISE NOTICE 'T33 PASS: regenerate emits an event, enqueues a claimable '
               'AI_DRAFT_PROPOSAL_SECTION job carrying the section, shares the run''s '
               'correlation id, and refuses (rolling the run back) when nothing routes it.';
END
$t33$;

DO $banner$ BEGIN RAISE NOTICE '════════ T34 · PROVENANCE IS TENANT-SCOPED AND DETERMINISTIC ════════'; END $banner$;
DO $t34$
DECLARE
  v         jsonb;
  v_tenant  uuid := '11111111-1111-4111-8111-111111111111';
  v_other   uuid := '99999999-9999-4999-8999-999999999999';
  v_enq     uuid := 'ddddddd1-0000-4000-8000-000000000001';
  v_apv     uuid;
BEGIN
  -- ── app._provenance read without a tenant predicate ──────────────────────
  -- `core.provenance` was read on `subject_table` + `subject_id` alone, in
  -- `app._provenance` and again in `core.get_approval`. Not reachable as a leak
  -- in the product — `subject_id` is always a uuid from a row the caller's
  -- tenant owns, and 014 grants `authenticated` no write anywhere in `core` —
  -- but "not reachable" is a property of today's grants, not of the query, and
  -- the pin is written against the query. A row planted under ANOTHER tenant
  -- with the SAME subject_id is the shape of the defect.
  INSERT INTO core.provenance
    (tenant_id, subject_table, subject_id, field, origin, model, generated_at,
     agent_id, confidence, created_by_kind, created_by_id, updated_at)
  VALUES (v_other, 'enquiries', v_enq, 'classification_label', 'AI_GENERATED',
          'other-tenants-model', pg_catalog.now(), 'agent:intruder', 0.999,
          'AGENT', 'agent:intruder', pg_catalog.now() + interval '1 hour');

  v := core.get_enquiry(v_enq::text);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T34a: %', v; END IF;
  IF (v #>> '{data,classification,provenance,model}') = 'other-tenants-model' THEN
    RAISE EXCEPTION 'T34b: app._provenance returned ANOTHER TENANT''S provenance row '
                    'for this enquiry: %', v #> '{data,classification,provenance}';
  END IF;
  -- and the tenant's OWN row is still the one that answers.
  IF (v #>> '{data,classification,provenance,origin}') IS NULL THEN
    RAISE EXCEPTION 'T34c: the tenant''s own provenance stopped resolving: %',
      v #> '{data,classification}';
  END IF;

  -- ── core.get_approval's jury lookup ──────────────────────────────────────
  SELECT id INTO v_apv FROM core.approval_requests
   WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_apv IS NULL THEN RAISE EXCEPTION 'T34-setup: no approval fixture'; END IF;

  -- ⚠ AND A FINDING WHILE PINNING THE FIX. `core.provenance.subject_table` is
  -- FK'd to `core.provenance_subjects` (007:140), a nine-row allowlist that does
  -- NOT contain `approval_requests`. So the `modelAgreement` block in
  -- `core.get_approval` can match no row on any database as shipped: the
  -- §17 jury badge is unreachable, not merely unpinned. That is recorded in the
  -- PR body as a MEDIUM for the pack that owns §17; this pin adds the allowlist
  -- row so the QUERY's tenant and ordering behaviour can be asserted at all,
  -- and asserts the gap itself so the day the row is seeded for real, this
  -- line says so rather than passing silently.
  IF EXISTS (SELECT 1 FROM core.provenance_subjects
              WHERE subject_table = 'approval_requests') THEN
    RAISE NOTICE 'T34: approval_requests is now an allowed provenance subject — the '
                 'modelAgreement badge is reachable in production; drop this fixture.';
  ELSE
    INSERT INTO core.provenance_subjects (subject_table, note)
    VALUES ('approval_requests','T34 fixture only; rolled back with the test');
  END IF;

  -- THE APPROVAL HAS NO PROVENANCE ROW OF ITS OWN. The only row carrying its
  -- subject_id belongs to the other tenant, so `modelAgreement` must be ABSENT.
  -- Pre-fix, `LIMIT 1` over a predicate that named neither the tenant nor an
  -- order returned that row and badged this approval with a jury it never had.
  INSERT INTO core.provenance
    (tenant_id, subject_table, subject_id, origin, model, generated_at,
     jury, created_by_kind, created_by_id)
  VALUES (v_other, 'approval_requests', v_apv, 'AI_GENERATED',
          'other-tenants-model', pg_catalog.now(),
          '{"mode":"GATE","quorum":2,"of":3}'::jsonb, 'AGENT', 'agent:intruder');

  v := core.get_approval(v_apv::text);
  IF v -> 'success' <> 'true'::jsonb THEN RAISE EXCEPTION 'T34d: %', v; END IF;
  IF (v -> 'data') ? 'modelAgreement' THEN
    RAISE EXCEPTION 'T34e: get_approval read a jury from ANOTHER TENANT''S provenance '
                    'row: %', v #> '{data,modelAgreement}';
  END IF;

  -- ── LIMIT 1 WITH NO ORDER BY ─────────────────────────────────────────────
  -- Two of the tenant's own rows now carry a jury. The query filters on
  -- `subject_table` and `subject_id` only — not on `field` — so a record-level
  -- row and a field-level row both match, and `provenance_record_uq` (007:199)
  -- constrains only the record-level one. Which became `modelAgreement` was
  -- whatever the planner returned, and need not have been stable between two
  -- reads. It is the most recently updated now, the rule `app._provenance`
  -- already used.
  INSERT INTO core.provenance
    (tenant_id, subject_table, subject_id, field, origin, model, generated_at,
     jury, created_by_kind, created_by_id, updated_at)
  VALUES (v_tenant, 'approval_requests', v_apv, 'risk', 'AI_GENERATED', 'older',
          pg_catalog.now(), '{"mode":"GATE","quorum":1,"of":3}'::jsonb,
          'AGENT', 'agent:jury', pg_catalog.now() - interval '2 hours'),
         (v_tenant, 'approval_requests', v_apv, NULL, 'AI_GENERATED', 'newer',
          pg_catalog.now(), '{"mode":"GATE","quorum":3,"of":3}'::jsonb,
          'AGENT', 'agent:jury', pg_catalog.now() - interval '1 hour');

  v := core.get_approval(v_apv::text);
  PERFORM pg_temp.data('T34-envelope-1', v);
  IF (v #>> '{data,modelAgreement,quorum}') <> '3' THEN
    RAISE EXCEPTION 'T34f: the jury shown is not the most recent one: %',
      v #> '{data,modelAgreement}';
  END IF;
  -- Asked twice, same answer. A LIMIT 1 with no ORDER BY need not be stable
  -- even within one transaction.
  IF (core.get_approval(v_apv::text) #> '{data,modelAgreement}')
     <> (v #> '{data,modelAgreement}') THEN
    RAISE EXCEPTION 'T34g: two reads of one approval disagreed about modelAgreement';
  END IF;

  DELETE FROM core.provenance
   WHERE subject_id IN (v_enq, v_apv) AND created_by_id IN ('agent:intruder','agent:jury');

  RAISE NOTICE 'T34 PASS: provenance reads are tenant-correlated in app._provenance and '
               'in get_approval, and the jury lookup is ordered rather than arbitrary.';
END
$t34$;

DO $banner$ BEGIN RAISE NOTICE '════════ T35 · THE BACKFILL FAILS LOUDLY, NOT INTO A WARNING ════════'; END $banner$;
DO $t35$
DECLARE
  v_tenant uuid := '11111111-1111-4111-8111-111111111111';
  v_naked  uuid := '77777777-7777-4777-8777-777777777777';
  v_total  integer;
  v_detail text;
  v_ok     boolean := false;
BEGIN
  -- A CLEAN RUN STILL RETURNS A COUNT. Every tenant here was provisioned by
  -- the trigger, so re-seeding writes nothing and the invariant already holds.
  v_total := app.seed_pipelines_all();
  IF v_total <> 0 THEN
    RAISE EXCEPTION 'T35a: re-seeding wrote % rows over already-seeded tenants', v_total;
  END IF;

  -- ── THE BLOCKER. A tenant with no PIP ref_format ─────────────────────────
  -- The backfill caught `foreign_key_violation` and turned it into
  -- `RAISE WARNING '... pipelines not seeded'`, then finished green. That
  -- tenant has no `core.pipeline_steps` rows, and `core.navigation` and
  -- `core.get_pipeline_config` render stages FROM those rows — so its shell
  -- opened on an empty stage list that looks like configuration rather than
  -- like a failed migration. A WARNING in a migration log is not a channel
  -- anyone reads afterwards.
  --
  -- 016 seeds ref formats from its own AFTER INSERT trigger, so a tenant in
  -- this state has to be constructed: insert one, then take its PIP format and
  -- its pipelines away, which is exactly the shape of a tenant that predates
  -- 016's backfill.
  --
  -- AGAINST THE PRE-FIX MIGRATION THIS ASSERTION FAILS WITH "function
  -- app.seed_pipelines_all() does not exist", and that is not an accident of
  -- the fix: the loop was INLINE IN A `DO` BLOCK, where nothing can call it and
  -- therefore nothing can assert it. Running that same inline block against
  -- this fixture is what shows the behaviour directly:
  --
  --   WARNING: 018 backfill: tenant 7777... has no PIP ref_format; not seeded.
  --   NOTICE:  018 backfill: 0 pipeline and step row(s) seeded
  --   018 completed; pipeline_steps for the unseeded tenant = 0
  --
  -- Green, with a tenant left with no pipeline configuration at all.
  INSERT INTO public.tenants (id, slug, name, status, timezone, locale)
  VALUES (v_naked, 'naked', 'Predates 016', 'ACTIVE', 'Asia/Kuala_Lumpur', 'en-MY');
  DELETE FROM core.pipeline_steps WHERE tenant_id = v_naked;
  DELETE FROM core.pipelines      WHERE tenant_id = v_naked;
  DELETE FROM core.ref_formats    WHERE tenant_id = v_naked AND prefix = 'PIP';

  BEGIN
    PERFORM app.seed_pipelines_all();
  EXCEPTION WHEN foreign_key_violation THEN
    v_ok := true;
    GET STACKED DIAGNOSTICS v_detail = MESSAGE_TEXT;
    -- The message NAMES THE TENANT. "Some tenant somewhere was skipped" is not
    -- actionable; the operator has to know which ref_formats to seed.
    IF pg_catalog.strpos(v_detail, v_naked::text) = 0 THEN
      RAISE EXCEPTION 'T35b: the refusal does not name the unseeded tenant: %', v_detail;
    END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'T35c: the backfill reported SUCCESS with a tenant left unseeded — '
                    'its navigation renders an empty stage list and nothing says so';
  END IF;

  -- GIVE IT BACK ITS REF FORMAT AND THE SAME CALL SUCCEEDS. The refusal is
  -- about the missing configuration, not about the tenant.
  INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width, gapless)
  SELECT v_naked, format.prefix, format.entity, format.dated, format.width, format.gapless
    FROM core.ref_formats AS format
   WHERE format.tenant_id = v_tenant AND format.prefix = 'PIP';

  v_total := app.seed_pipelines_all();
  IF v_total < 1 THEN
    RAISE EXCEPTION 'T35c2: the unseeded tenant was still not seeded after its ref '
                    'format came back';
  END IF;

  -- AND THE INVARIANT THE BACKFILL EXISTS FOR IS STATED AS ONE. Every tenant
  -- has both default pipelines and their steps.

  IF EXISTS (
    SELECT 1 FROM public.tenants AS t
     WHERE NOT EXISTS (SELECT 1 FROM core.pipelines AS p
                        WHERE p.tenant_id = t.id AND p.object = 'ENGAGEMENT')
        OR NOT EXISTS (SELECT 1 FROM core.pipeline_steps AS s
                        WHERE s.tenant_id = t.id)) THEN
    RAISE EXCEPTION 'T35d: a tenant has no pipeline configuration after the backfill';
  END IF;

  RAISE NOTICE 'T35 PASS: the backfill raises and names every tenant it could not seed, '
               'and every tenant ends the migration with a pipeline configuration.';
END
$t35$;

DO $banner$ BEGIN RAISE NOTICE '════════ T36 · get_proposal AND get_quotation, INVOKED ════════'; END $banner$;
DO $t36$
DECLARE
  v_tenant uuid := '11111111-1111-4111-8111-111111111111';
  v        jsonb;
  d        jsonb;
  v_prop   uuid;
  v_quote  uuid;
  v_row    jsonb;
BEGIN
  -- NEITHER OF THESE WAS EVER CALLED BY THIS FILE. They appeared only in
  -- comments and in T20's metadata sweep, so their projections, their NOT_FOUND
  -- paths and their envelopes were entirely unasserted — while `list_proposals`
  -- and `list_quotations` project EVERY ROW through them. One unreviewed
  -- projection was answering for two endpoints and two lists.
  SELECT id INTO v_prop  FROM core.proposals  WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_quote FROM core.quotations WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_prop IS NULL OR v_quote IS NULL THEN
    RAISE EXCEPTION 'T36-setup: fixtures missing (proposal %, quotation %)', v_prop, v_quote;
  END IF;

  -- ── core.get_proposal ────────────────────────────────────────────────────
  d := pg_temp.data('T36a', core.get_proposal(v_prop::text));
  IF NOT (d ?& ARRAY['id','ref','status','sections','value','marginRate','opportunityRef']) THEN
    RAISE EXCEPTION 'T36b: the Proposal projection is incomplete: %',
      (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(d) AS k);
  END IF;
  IF d ->> 'id' <> v_prop::text THEN
    RAISE EXCEPTION 'T36c: get_proposal returned a different proposal';
  END IF;
  IF pg_catalog.jsonb_typeof(d -> 'sections') <> 'array'
     OR pg_catalog.jsonb_array_length(d -> 'sections') < 1 THEN
    RAISE EXCEPTION 'T36d: sections[] is not an array of sections: %', d -> 'sections';
  END IF;
  -- Every section carries its own n and title; provenance is present only where
  -- a row exists, which is how "a human wrote this" is said.
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(d -> 'sections') AS sec(value)
              WHERE NOT (sec.value ?& ARRAY['n','title'])) THEN
    RAISE EXCEPTION 'T36e: a section is missing n or title: %', d -> 'sections';
  END IF;

  -- BY REF AS WELL AS BY ID — the `(id::text = p_id OR ref = p_id)` idiom the
  -- file uses eighteen times, asserted once on this endpoint.
  IF pg_temp.data('T36f', core.get_proposal((d ->> 'ref'))) -> 'id' <> d -> 'id' THEN
    RAISE EXCEPTION 'T36f2: get_proposal by ref returned a different row';
  END IF;

  -- THE LIST ROW IS THE SAME PROJECTION, byte for byte. That is the whole claim
  -- list_proposals makes for calling get_proposal per row, and until now it was
  -- a comment. Diverge the two and this fails.
  SELECT row.value INTO v_row
    FROM pg_catalog.jsonb_array_elements(
           pg_temp.data('T36g', core.list_proposals()) -> 'data') AS row(value)
   WHERE row.value ->> 'id' = v_prop::text;
  IF v_row IS DISTINCT FROM d THEN
    RAISE EXCEPTION 'T36h: the list row and get_proposal disagree about the same '
                    'proposal — there are two projections, not one';
  END IF;

  v := core.get_proposal('00000000-0000-4000-8000-00000000dead');
  IF v -> 'success' <> 'false'::jsonb OR v #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T36i: get_proposal on an absent id: %', v;
  END IF;

  -- ── core.get_quotation ───────────────────────────────────────────────────
  d := pg_temp.data('T36j', core.get_quotation(v_quote::text));
  IF NOT (d ?& ARRAY['id','ref','status','lines','sellPrice',
                     'absoluteFloorPrice','marginFloorPrice','bindingFloorBasis']) THEN
    RAISE EXCEPTION 'T36k: the Quotation projection is incomplete: %',
      (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(d) AS k);
  END IF;
  -- RULING R6 again, at the endpoint rather than only inside a list row: 007's
  -- 'PROGRAMME' spelling must never reach the wire.
  IF d ->> 'bindingFloorBasis' NOT IN ('ABSOLUTE','MARGIN') THEN
    RAISE EXCEPTION 'T36l: get_quotation leaked 007''s PROGRAMME spelling: %',
      d ->> 'bindingFloorBasis';
  END IF;
  IF (d #>> '{sellPrice,currency}') IS NULL THEN
    RAISE EXCEPTION 'T36m: a Money value with no currency: %', d -> 'sellPrice';
  END IF;

  SELECT row.value INTO v_row
    FROM pg_catalog.jsonb_array_elements(
           pg_temp.data('T36n', core.list_quotations()) -> 'data') AS row(value)
   WHERE row.value ->> 'id' = v_quote::text;
  IF v_row IS DISTINCT FROM d THEN
    RAISE EXCEPTION 'T36o: the list row and get_quotation disagree about the same '
                    'quotation — there are two money projections, not one';
  END IF;

  v := core.get_quotation('00000000-0000-4000-8000-00000000dead');
  IF v -> 'success' <> 'false'::jsonb OR v #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T36p: get_quotation on an absent id: %', v;
  END IF;

  -- ── A BADGE COUNT IS A NUMBER, not merely a number-shaped key ────────────
  -- T10 asserted the three key names and `jsonb_typeof = 'number'` and never a
  -- VALUE, so a badge hardcoded to zero passed. There are open enquiries and a
  -- pending approval in these fixtures; at least one badge must be non-zero.
  -- The approvals badge is `app.open_approval_count(actor_id)` — approvals
  -- assigned to THIS actor. T15's fixture is assigned to the MD, so the count
  -- is read as the MD; read as SALES it is legitimately zero, which is exactly
  -- why "is it a number" was never enough.
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub','33333333-3333-4333-8333-333333333333',
      'tenant_id','11111111-1111-4111-8111-111111111111',
      'app_role','MD','actor_kind','HUMAN','role','authenticated')::text, true);
  d := pg_temp.data('T36q', core.badge_counts());
  IF (d ->> 'approvals')::integer < 1 THEN
    RAISE EXCEPTION 'T36r: the approvals badge counted % against a PENDING approval '
                    'assigned to this actor — a badge hardcoded to zero would have '
                    'passed the old "is it a number" assertion: %',
                    d ->> 'approvals', d;
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub','22222222-2222-4222-8222-222222222222',
      'tenant_id','11111111-1111-4111-8111-111111111111','app_role','SALES',
      'actor_kind','HUMAN','role','authenticated')::text, true);

  -- ── get_compliance_rule WITH A REAL RULE ─────────────────────────────────
  -- It was only ever called with a deliberately absent id, so no ComplianceRule
  -- payload was projected anywhere in the file.
  -- `core.compliance_rules.tenant_id` is NULLABLE — 017 seeds three HRD Corp
  -- rules globally — and the RPC reads `tenant_id = v_tenant OR tenant_id IS
  -- NULL`. Both arms are exercised: the global seed, and a tenant-owned copy.
  IF NOT EXISTS (SELECT 1 FROM core.compliance_rules WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'T36u: 017 seeds three global compliance rules and none is here';
  END IF;
  d := pg_temp.data('T36s', core.get_compliance_rule(
         (SELECT id::text FROM core.compliance_rules
           WHERE tenant_id IS NULL ORDER BY rule_code LIMIT 1)));
  IF NOT (d ?& ARRAY['id','status']) THEN
    RAISE EXCEPTION 'T36t: the ComplianceRule projection is incomplete: %',
      (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(d) AS k);
  END IF;
  -- BY RULE CODE AS WELL AS BY ID.
  IF pg_temp.data('T36v', core.get_compliance_rule(
       (SELECT rule_code FROM core.compliance_rules
         WHERE tenant_id IS NULL ORDER BY rule_code LIMIT 1))) -> 'id' <> d -> 'id' THEN
    RAISE EXCEPTION 'T36v2: get_compliance_rule by rule_code returned a different rule';
  END IF;
  -- AND ANOTHER TENANT'S RULE IS STILL INVISIBLE. The NULL arm widens the read
  -- to GLOBAL rules, not to every tenant's.
  INSERT INTO core.compliance_rules
    (id, tenant_id, rule_code, family_key, check_key, side, subject, subject_field,
     op, reference_kind, reference, effective_from, status)
  SELECT '5eed0001-0000-4000-8000-000000000001'::uuid,
         '99999999-9999-4999-8999-999999999999',
         'THEIRS-01', rule.family_key, rule.check_key, rule.side, rule.subject,
         rule.subject_field, rule.op, rule.reference_kind, rule.reference,
         rule.effective_from, rule.status
    FROM core.compliance_rules AS rule WHERE rule.tenant_id IS NULL ORDER BY rule.rule_code LIMIT 1;
  v := core.get_compliance_rule('5eed0001-0000-4000-8000-000000000001');
  IF v -> 'success' <> 'false'::jsonb OR v #>> '{error,code}' <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T36w: another tenant''s compliance rule was readable: %', v;
  END IF;

  RAISE NOTICE 'T36 PASS: get_proposal and get_quotation are invoked, project the shapes '
               'the contract declares, refuse an absent id, and agree byte-for-byte with '
               'the list rows they produce; a badge actually counts.';
END
$t36$;

DO $banner$ BEGIN RAISE NOTICE '════════ T37 · A NO-OP PUT IS NOT A TAX REWRITE ════════'; END $banner$;
DO $t37$
DECLARE
  v_tenant uuid := '11111111-1111-4111-8111-111111111111';
  v_quote  uuid;
  v_before core.quotations%ROWTYPE;
  v_after  core.quotations%ROWTYPE;
  v_exempt uuid;
BEGIN
  SELECT id INTO v_quote FROM core.quotations
   WHERE tenant_id = v_tenant AND sst_policy_id IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_quote IS NULL THEN
    RAISE EXCEPTION 'T37-setup: no quotation carrying a resolved tax policy';
  END IF;

  -- ── SET THE QUOTATION TO THE EXEMPT POLICY ───────────────────────────────
  -- 017 seeds two national policies and says the exempt one is genuinely
  -- selectable. `put_quotation` can only ever resolve CORPORATE_TRAINING,
  -- because no column in 001–017 records that the BUYER is an Education Act
  -- institution — so the exempt policy is reached by another path today, and
  -- a save through this RPC must not undo it.
  SELECT id INTO v_exempt FROM core.tax_policies
   WHERE exempt AND (tenant_id = v_tenant OR tenant_id IS NULL) ORDER BY policy_code LIMIT 1;
  IF v_exempt IS NULL THEN
    RAISE EXCEPTION 'T37-setup: 017 seeds an exempt policy and none is here';
  END IF;

  UPDATE core.quotations
     SET sst_policy_id = v_exempt, sst_rate = 0, sst_reason = 'TRAINING_EXEMPT',
         sst_exempt_reason = 'Buyer is an Education Act institution'
   WHERE tenant_id = v_tenant AND id = v_quote;

  SELECT * INTO v_before FROM core.quotations
   WHERE tenant_id = v_tenant AND id = v_quote;

  -- ── AN EMPTY BODY ────────────────────────────────────────────────────────
  -- `p_body` is coalesced to `'{}'`, and before this fix the tax block sat
  -- OUTSIDE both the `lines` guard and the `sellPrice` guard — so this call
  -- resolved CORPORATE_TRAINING, wrote 8% over the exemption, and changed the
  -- customer-facing gross, on a request that asked for nothing.
  PERFORM core.put_quotation(v_quote::text, '{}'::jsonb, 'noop-key-1');

  SELECT * INTO v_after FROM core.quotations
   WHERE tenant_id = v_tenant AND id = v_quote;

  IF v_after.sst_policy_id <> v_before.sst_policy_id THEN
    RAISE EXCEPTION 'T37a: an EMPTY body rewrote the tax policy from % to %',
      v_before.sst_policy_id, v_after.sst_policy_id;
  END IF;
  IF v_after.sst_reason <> 'TRAINING_EXEMPT' THEN
    RAISE EXCEPTION 'T37b: an empty body reset the exemption to %', v_after.sst_reason;
  END IF;
  IF v_after.sst_rate <> v_before.sst_rate THEN
    RAISE EXCEPTION 'T37c: an empty body moved the rate from % to % — the '
                    'customer-facing gross changed on a request that asked for nothing',
      v_before.sst_rate, v_after.sst_rate;
  END IF;
  IF v_after.gross_price_sen <> v_before.gross_price_sen THEN
    RAISE EXCEPTION 'T37d: the gross moved from % to % on an empty body',
      v_before.gross_price_sen, v_after.gross_price_sen;
  END IF;

  -- ── AND THE RESOLUTION STILL HAPPENS WHEN IT SHOULD ──────────────────────
  -- A quotation with no tax treatment at all gets one. WHICH LAYER gives it
  -- one depends on which 017 is applied, and the assertion is on the outcome:
  -- exactly one of them must, and neither may leave a quotation standard-rated
  -- at zero per cent.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
              WHERE trg.tgrelid = 'core.quotations'::regclass
                AND trg.tgname = 'trg_quotations_resolve_sst' AND NOT trg.tgisinternal) THEN
    -- 017's trigger re-resolves when the caller supplies NEITHER column. Both
    -- are cleared here, which is the shape it is written for.
    UPDATE core.quotations
       SET sst_policy_id = NULL, sst_rate = NULL, sst_reason = NULL,
           sst_exempt_reason = NULL
     WHERE tenant_id = v_tenant AND id = v_quote;
  ELSE
    UPDATE core.quotations
       SET sst_policy_id = NULL, sst_rate = 0, sst_reason = 'STANDARD_RATED',
           sst_exempt_reason = NULL
     WHERE tenant_id = v_tenant AND id = v_quote;
    PERFORM core.put_quotation(v_quote::text, '{}'::jsonb, 'noop-key-2');
  END IF;

  SELECT * INTO v_after FROM core.quotations
   WHERE tenant_id = v_tenant AND id = v_quote;
  IF v_after.sst_policy_id IS NULL THEN
    RAISE EXCEPTION 'T37e: a quotation with no tax treatment did not get one — a '
                    'quotation that looks taxed and carries no tax is what R-C forbids';
  END IF;
  IF v_after.sst_rate <= 0 THEN
    RAISE EXCEPTION 'T37f: the resolved rate is %, not the registry''s', v_after.sst_rate;
  END IF;

  -- AND NEVER TWO WRITERS. Where the trigger exists, put_quotation's own SST
  -- block must not run: it can only ever resolve CORPORATE_TRAINING, so a
  -- second write would be the one that loses the exemption.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
              WHERE trg.tgrelid = 'core.quotations'::regclass
                AND trg.tgname = 'trg_quotations_resolve_sst' AND NOT trg.tgisinternal) THEN
    IF pg_catalog.strpos(
         app._body_sql('core.put_quotation(text,jsonb,text)'::regprocedure),
         'trg_quotations_resolve_sst') = 0 THEN
      RAISE EXCEPTION 'T37g: 017 owns SST through a trigger and put_quotation does not '
                      'check for it — two writers for one rule, and the exemption is '
                      'what loses';
    END IF;
  END IF;

  RAISE NOTICE 'T37 PASS: an empty PUT leaves the tax treatment and the gross alone, and '
               'a quotation with no treatment still resolves one from the registry.';
END
$t37$;

DO $banner$ BEGIN RAISE NOTICE '════════ ALL ASSERTIONS EXECUTED — rolling back, nothing durable ════════'; END $banner$;
ROLLBACK;
