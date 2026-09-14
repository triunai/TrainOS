-- ═══════════════════════════════════════════════════════════════════════════
-- test_021 · Role authorization
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001–021. Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_021_golden_path_authz.sql
--
-- EXECUTED before commit on a PostgreSQL 17 shim where every migration and
-- this pin ran as a NOSUPERUSER BYPASSRLS role (hosted `postgres`).
--
-- IMPERSONATION IS REAL: every RPC probe runs as `authenticated` with the JWT
-- claims of a real `auth.users` row, and assertions run after RESET ROLE.
-- T1–T3 read many RPCs in ONE statement per principal, each call in its own
-- subtransaction (`pg_temp.try`). No claim or role changes inside a statement,
-- so the planner-folding hazard G4 describes (identical calls across a claim
-- swap) cannot arise. Every other probe is one statement.
--
-- T1  A principal holding no permission (CLIENT) is FORBIDDEN on all 23 gated
--     RPCs, with `requiredPermission`, before any argument is looked at: a
--     real id and an invented one give byte-identical answers, and so does a
--     malformed argument.
-- T2  The matrix, not a blanket: OPS is refused enquiries, quotations and the
--     rate card but reads compliance rules; SALES is the reverse; FINANCE is
--     refused a TNA. Holders get past the gate (NOT_FOUND / data, never
--     FORBIDDEN).
-- T3  badge_counts answers every staff role, and the HRDC count is 0 for a
--     role without hrdc:read while an at-risk packet exists.
-- T3b get_audit exactly as rpcClient.ts calls it, `aggregateTypeOf(segment)`:
--     APPROVAL returns the approval's correlated trail (the same rows as
--     `approvals`); ENQUIRIE and OPPORTUNITIE return their records' trails.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers ────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text,
                               p_kind text DEFAULT 'HUMAN', p_session uuid DEFAULT NULL)
RETURNS text
LANGUAGE sql AS $fn$
  SELECT (pg_catalog.jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', p_kind, 'aal', 'aal1')
    || CASE WHEN p_session IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('session_id', p_session, 'aal', 'aal2') END)::text;
$fn$;

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_detail text;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'value', v);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE,
    'message', SQLERRM, 'detail', v_detail);
END;
$fn$;

CREATE FUNCTION pg_temp.got(p_key text) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('a21.' || p_key)::jsonb; $fn$;

-- The refusal code of a probe result, whichever channel it came back on:
-- `app.err` inside a success, or a TRNOS raise with a DETAIL bag.
CREATE FUNCTION pg_temp.code(p jsonb) RETURNS text
LANGUAGE sql AS $fn$
  SELECT CASE WHEN p -> 'ok' = 'true'::jsonb THEN p #>> '{value,error,code}'
              WHEN p ->> 'sqlstate' = 'TRNOS' THEN (p ->> 'detail')::jsonb ->> 'code'
              ELSE 'SQLSTATE ' || (p ->> 'sqlstate') END;
$fn$;

-- Every gated RPC, called once with an id that exists and once with one that
-- does not. Writers are called with bodies that would pass validation.
CREATE FUNCTION pg_temp.gated_calls(p_real boolean) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_id  text := CASE WHEN p_real THEN 'REAL' ELSE 'FAKE' END;
  r     record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('list_enquiries',  $$SELECT core.list_enquiries()$$, $$SELECT core.list_enquiries('[{"field":"nope","op":"eq","value":1}]'::jsonb)$$),
    ('get_enquiry',     $$SELECT core.get_enquiry('a0210000-eeee-4000-8000-000000000001')$$, $$SELECT core.get_enquiry('ENQ-9999-9999')$$),
    ('patch_enquiry_extraction', $$SELECT core.patch_enquiry_extraction('a0210000-eeee-4000-8000-000000000001','{"topic":"x"}'::jsonb)$$, $$SELECT core.patch_enquiry_extraction('ENQ-9999-9999','{}'::jsonb)$$),
    ('list_follow_ups', $$SELECT core.list_follow_ups()$$, $$SELECT core.list_follow_ups(NULL, 'nope')$$),
    ('get_follow_up_draft', $$SELECT core.get_follow_up_draft('a0210000-eeee-4000-8000-000000000001','EMAIL')$$, $$SELECT core.get_follow_up_draft('x','NOT_A_CHANNEL')$$),
    ('get_organisation', $$SELECT core.get_organisation('a0210000-2222-4000-8000-000000000001')$$, $$SELECT core.get_organisation('ORG-9999-9999')$$),
    ('get_opportunity', $$SELECT core.get_opportunity('a0210000-3333-4000-8000-000000000001')$$, $$SELECT core.get_opportunity('OPP-9999-9999')$$),
    ('get_contact',     $$SELECT core.get_contact('a0210000-6666-4000-8000-000000000001')$$, $$SELECT core.get_contact('CON-9999-9999')$$),
    ('get_tna',         $$SELECT core.get_tna('TNA-9999-0001')$$, $$SELECT core.get_tna('TNA-9999-9999')$$),
    ('get_tna_recommendations', $$SELECT core.get_tna_recommendations('TNA-9999-0001')$$, $$SELECT core.get_tna_recommendations('TNA-9999-9999')$$),
    ('create_proposal', $$SELECT core.create_proposal('{"opportunityRef":"OPP-A21-0001"}'::jsonb, 'a21-create')$$, $$SELECT core.create_proposal('{}'::jsonb, NULL)$$),
    ('list_proposals',  $$SELECT core.list_proposals()$$, $$SELECT core.list_proposals(NULL, 'nope')$$),
    ('get_proposal',    $$SELECT core.get_proposal('a0210000-5555-4000-8000-000000000001')$$, $$SELECT core.get_proposal('PRO-9999-9999')$$),
    ('add_proposal_section', $$SELECT core.add_proposal_section('a0210000-5555-4000-8000-000000000001','{"title":"x"}'::jsonb,'a21-add')$$, $$SELECT core.add_proposal_section('PRO-9999-9999','{}'::jsonb,NULL)$$),
    ('put_proposal_section', $$SELECT core.put_proposal_section('a0210000-5555-4000-8000-000000000001',1,'{"body":"x"}'::jsonb,'a21-put')$$, $$SELECT core.put_proposal_section('PRO-9999-9999',99,'{}'::jsonb,NULL)$$),
    ('regenerate_proposal_section', $$SELECT core.regenerate_proposal_section('a0210000-5555-4000-8000-000000000001',1)$$, $$SELECT core.regenerate_proposal_section('PRO-9999-9999',99)$$),
    ('get_quotation',   $$SELECT core.get_quotation('QUO-9999-0001')$$, $$SELECT core.get_quotation('QUO-9999-9999')$$),
    ('put_quotation',   $$SELECT core.put_quotation('QUO-9999-0001','{}'::jsonb,'a21-quote')$$, $$SELECT core.put_quotation('QUO-9999-9999','{"lines":"bad"}'::jsonb,NULL)$$),
    ('get_rate_card',   $$SELECT core.get_rate_card()$$, $$SELECT core.get_rate_card()$$),
    ('get_policy',      $$SELECT core.get_policy('APV-01')$$, $$SELECT core.get_policy('NOPE-01')$$),
    ('get_pipeline_config', $$SELECT core.get_pipeline_config('OPPORTUNITY')$$, $$SELECT core.get_pipeline_config('NOT_AN_OBJECT')$$),
    ('get_programme',   $$SELECT core.get_programme('PRG-9999-0001')$$, $$SELECT core.get_programme('PRG-9999-9999')$$),
    ('get_compliance_rule', $$SELECT core.get_compliance_rule('RULE-0001')$$, $$SELECT core.get_compliance_rule('RULE-9999')$$)
  ) AS t(name, real_sql, fake_sql)
  LOOP
    v_out := v_out || pg_catalog.jsonb_build_object(r.name,
      pg_temp.try(CASE WHEN p_real THEN r.real_sql ELSE r.fake_sql END));
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- ── Fixtures ───────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('a0210000-0000-4000-8000-0000000000a1','sales@a21.test'),
  ('a0210000-0000-4000-8000-0000000000a2','sm@a21.test'),
  ('a0210000-0000-4000-8000-0000000000a3','md@a21.test'),
  ('a0210000-0000-4000-8000-0000000000a4','ops@a21.test'),
  ('a0210000-0000-4000-8000-0000000000a5','finance@a21.test'),
  ('a0210000-0000-4000-8000-0000000000a6','client@a21.test');

INSERT INTO auth.sessions (id, user_id, aal) VALUES
  ('a0210000-5e55-4000-8000-0000000000a6','a0210000-0000-4000-8000-0000000000a6','aal2');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('a0210000-1111-4000-8000-000000000001','a21-akademi','Akademi Perdana A21','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0210000-1111-4000-8000-000000000001','a0210000-0000-4000-8000-0000000000a1','SALES','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0210000-1111-4000-8000-000000000001','a0210000-0000-4000-8000-0000000000a2','SALES_MANAGER','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0210000-1111-4000-8000-000000000001','a0210000-0000-4000-8000-0000000000a3','MD','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0210000-1111-4000-8000-000000000001','a0210000-0000-4000-8000-0000000000a4','OPS','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0210000-1111-4000-8000-000000000001','a0210000-0000-4000-8000-0000000000a5','FINANCE','HUMAN','ALL','ALL',false,'ACTIVE',true);

INSERT INTO core.organisations
  (id,tenant_id,name,industry,location,owner_id,status,hrdc_registered,hrdc_employer_code,country_code)
VALUES
  ('a0210000-2222-4000-8000-000000000001','a0210000-1111-4000-8000-000000000001','Chrome A21',
   'MANUFACTURING','Shah Alam','a0210000-0000-4000-8000-0000000000a1','ACTIVE_CLIENT',true,'E-A21','MYS');

INSERT INTO core.contacts (id,tenant_id,organisation_id,name,email,created_by_kind,created_by_id)
VALUES ('a0210000-6666-4000-8000-000000000001','a0210000-1111-4000-8000-000000000001',
        'a0210000-2222-4000-8000-000000000001','Siti A21','siti@a21.test','HUMAN','a0210000-0000-4000-8000-0000000000a1');

INSERT INTO core.enquiries
  (id,tenant_id,channel,status,received_at,from_name,from_email,subject,created_by_kind,created_by_id)
VALUES ('a0210000-eeee-4000-8000-000000000001','a0210000-1111-4000-8000-000000000001','EMAIL','OPEN',
        pg_catalog.now(),'Siti','siti@a21.test','Leadership','HUMAN','a0210000-0000-4000-8000-0000000000a1');

INSERT INTO core.opportunities
  (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen,currency,probability,created_by_kind,created_by_id)
VALUES
  ('a0210000-3333-4000-8000-000000000001','a0210000-1111-4000-8000-000000000001','OPP-A21-0001',
   'a0210000-2222-4000-8000-000000000001','a0210000-0000-4000-8000-0000000000a1','NEW',1000000,'MYR',0.400,
   'HUMAN','a0210000-0000-4000-8000-0000000000a1'),
  ('a0210000-3333-4000-8000-000000000002','a0210000-1111-4000-8000-000000000001','OPP-A21-0002',
   'a0210000-2222-4000-8000-000000000001','a0210000-0000-4000-8000-0000000000a1','NEW',1000000,'MYR',0.400,
   'HUMAN','a0210000-0000-4000-8000-0000000000a1');

INSERT INTO core.templates
  (id,tenant_id,template_type,version,label,merge_fields,status,created_by_kind,created_by_id)
VALUES ('a0210000-4444-4000-8000-000000000001','a0210000-1111-4000-8000-000000000001','PROPOSAL',1,'Standard A21',
        ARRAY['organisation.name'],'ACTIVE','HUMAN','a0210000-0000-4000-8000-0000000000a1');

INSERT INTO core.proposals
  (id,tenant_id,ref,opportunity_id,organisation_id,template_id,status,value_sen)
VALUES ('a0210000-5555-4000-8000-000000000001','a0210000-1111-4000-8000-000000000001','PRO-A21-0001',
        'a0210000-3333-4000-8000-000000000001','a0210000-2222-4000-8000-000000000001',
        'a0210000-4444-4000-8000-000000000001','DRAFT',1000000);

-- An at-risk HRDC packet, for the badge count (T3).
INSERT INTO core.programmes (id,tenant_id,name,category,days,version,status,hrdc_scheme,hrdc_claimable,
  list_price_sen,list_price_pax,floor_price_sen,floor_margin_rate,currency,created_by_kind,created_by_id)
VALUES ('a0210000-8888-4000-8000-000000000001','a0210000-1111-4000-8000-000000000001','Programme A21','LEADERSHIP',
        2,1,'ACTIVE','SBL_KHAS',true,4000000,25,2800000,0.3000,'MYR','HUMAN','a0210000-0000-4000-8000-0000000000a1');

INSERT INTO core.engagements (id,tenant_id,organisation_id,programme_id,owner_id,pipeline_id,title,created_by_kind,created_by_id)
SELECT 'a0210000-aaaa-4000-8000-000000000001','a0210000-1111-4000-8000-000000000001',
       'a0210000-2222-4000-8000-000000000001','a0210000-8888-4000-8000-000000000001',
       'a0210000-0000-4000-8000-0000000000a1', pipeline.id, 'Engagement A21','HUMAN','a0210000-0000-4000-8000-0000000000a1'
  FROM core.pipelines AS pipeline
 WHERE pipeline.tenant_id = 'a0210000-1111-4000-8000-000000000001' AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default;

INSERT INTO core.hrdc_packets (tenant_id,engagement_id,organisation_id,scheme,employer_code,claim_value_sen,completeness,panel_state,deadline_at)
VALUES ('a0210000-1111-4000-8000-000000000001','a0210000-aaaa-4000-8000-000000000001',
        'a0210000-2222-4000-8000-000000000001','SBL_KHAS','E-A21',1000000,0.500,'DEADLINE_AT_RISK',
        pg_catalog.now() + interval '3 days');

-- ════════ T1 · No permission, no answer — and the same answer for every id ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a6','a0210000-1111-4000-8000-000000000001','CLIENT','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.client_real', pg_temp.gated_calls(true)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a6','a0210000-1111-4000-8000-000000000001','CLIENT','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.client_fake', pg_temp.gated_calls(false)::text, true);
RESET ROLE;

DO $t1$
DECLARE
  v_real jsonb := pg_temp.got('client_real');
  v_fake jsonb := pg_temp.got('client_fake');
  v_name text;
  v_perm text;
  v_writes text[] := ARRAY['patch_enquiry_extraction','create_proposal','add_proposal_section',
                           'put_proposal_section','regenerate_proposal_section','put_quotation'];
BEGIN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_real)) <> 23 THEN
    RAISE EXCEPTION 'T1 SETUP: expected 23 gated RPCs probed, got %', v_real;
  END IF;
  FOR v_name IN SELECT pg_catalog.jsonb_object_keys(v_real) LOOP
    IF pg_temp.code(v_real -> v_name) IS DISTINCT FROM 'FORBIDDEN' THEN
      RAISE EXCEPTION 'T1a: CLIENT reached % past the gate: %', v_name, v_real -> v_name;
    END IF;
    -- WRITES RAISE, READS RETURN — 018's rule, kept.
    IF (v_name = ANY (v_writes)) <> (v_real -> v_name ->> 'sqlstate' = 'TRNOS') THEN
      RAISE EXCEPTION 'T1b: % refused on the wrong channel: %', v_name, v_real -> v_name;
    END IF;
    v_perm := COALESCE(v_real #>> ARRAY[v_name,'value','error','details','requiredPermission'],
                       ((v_real -> v_name ->> 'detail')::jsonb) ->> 'requiredPermission');
    IF v_perm IS NULL THEN
      RAISE EXCEPTION 'T1c: % refused without naming the permission: %', v_name, v_real -> v_name;
    END IF;
    -- NON-ENUMERABLE: a real id, an invented id and a malformed argument get the
    -- same bytes (the raise message is compared through its code and detail).
    IF (v_real -> v_name) - 'message' <> (v_fake -> v_name) - 'message' THEN
      RAISE EXCEPTION 'T1d: % answers a real and a fake/malformed call differently: % vs %',
        v_name, v_real -> v_name, v_fake -> v_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'T1 PASS: all 23 gated RPCs refuse a permissionless principal FORBIDDEN, naming the '
               'permission, on 018''s read/write channel, identically for real, fake and malformed input.';
END
$t1$;

-- ════════ T2 · The matrix, not a blanket ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a4','a0210000-1111-4000-8000-000000000001','OPS'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.ops', pg_temp.gated_calls(false)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a1','a0210000-1111-4000-8000-000000000001','SALES'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.sales', pg_temp.gated_calls(false)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a5','a0210000-1111-4000-8000-000000000001','FINANCE'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.finance', pg_temp.gated_calls(false)::text, true);
RESET ROLE;

DO $t2$
DECLARE
  v     jsonb;
  v_row record;
BEGIN
  -- (principal, rpc, forbidden?) from 002 §11.
  FOR v_row IN SELECT * FROM (VALUES
      ('ops','list_enquiries',true), ('ops','get_quotation',true), ('ops','get_rate_card',true),
      ('ops','create_proposal',true), ('ops','get_compliance_rule',false), ('ops','get_tna',false),
      ('ops','get_programme',false), ('ops','get_pipeline_config',false),
      ('sales','get_compliance_rule',true), ('sales','list_enquiries',false), ('sales','get_quotation',false),
      ('sales','get_rate_card',false), ('sales','regenerate_proposal_section',false),
      ('finance','get_tna',true), ('finance','get_tna_recommendations',true), ('finance','list_enquiries',true),
      ('finance','put_quotation',false), ('finance','get_compliance_rule',false)
    ) AS t(who, rpc, forbidden)
  LOOP
    v := pg_temp.got(v_row.who) -> v_row.rpc;
    IF (pg_temp.code(v) IS NOT DISTINCT FROM 'FORBIDDEN') <> v_row.forbidden THEN
      RAISE EXCEPTION 'T2: % on % — expected forbidden=% but got %', v_row.who, v_row.rpc, v_row.forbidden, v;
    END IF;
  END LOOP;
  RAISE NOTICE 'T2 PASS: OPS, SALES and FINANCE are each refused exactly what 002 withholds and pass the gate elsewhere.';
END
$t2$;

-- ════════ T3 · badge_counts answers everyone, counting only what each may read ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a1','a0210000-1111-4000-8000-000000000001','SALES'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.badges_sales', pg_temp.try($$SELECT core.badge_counts()$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a4','a0210000-1111-4000-8000-000000000001','OPS'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.badges_ops', pg_temp.try($$SELECT core.badge_counts()$$)::text, true);
RESET ROLE;

DO $t3$
BEGIN
  IF pg_temp.got('badges_sales') #> '{value,success}' <> 'true'::jsonb
     OR pg_temp.got('badges_sales') #> '{value,data,hrdcDeadlines}' <> '0'::jsonb THEN
    RAISE EXCEPTION 'T3a: SALES (no hrdc:read) was refused or counted HRDC deadlines: %', pg_temp.got('badges_sales');
  END IF;
  IF (pg_temp.got('badges_ops') #>> '{value,data,hrdcDeadlines}')::integer < 1 THEN
    RAISE EXCEPTION 'T3b: OPS holds hrdc:read and the at-risk packet was not counted: %', pg_temp.got('badges_ops');
  END IF;
  RAISE NOTICE 'T3 PASS: badge_counts answers SALES and OPS; the HRDC count is 0 without hrdc:read.';
END
$t3$;

-- ════════ T3b · The web's audit spelling reaches the approval trail ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a1','a0210000-1111-4000-8000-000000000001','SALES'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.send', pg_temp.try($$SELECT core.perform_action('PROPOSAL_SEND','PRO-A21-0001',
  '{"channel":"EMAIL"}'::jsonb, NULL, NULL, NULL, NULL, 'a21-send-1')$$)::text, true);
RESET ROLE;

SELECT app.emit_event('a0210000-1111-4000-8000-000000000001'::uuid, 'ProposalSent',
  (SELECT approval.action_request_id FROM core.approval_requests AS approval
    WHERE approval.target_ref = 'PRO-A21-0001')) IS NOT NULL AS emitted;
SELECT app.emit_event('a0210000-1111-4000-8000-000000000001'::uuid, 'EnquiryClassified', 'ENQUIRY',
  'a0210000-eeee-4000-8000-000000000001'::uuid, NULL, '{}'::jsonb, 'Classified A21',
  '{"kind":"SYSTEM","id":"t021","name":"t021"}'::jsonb) IS NOT NULL AS emitted_enquiry;
SELECT app.emit_event('a0210000-1111-4000-8000-000000000001'::uuid, 'OpportunityCreated', 'OPPORTUNITY',
  'a0210000-3333-4000-8000-000000000001'::uuid, 'OPP-A21-0001', '{}'::jsonb, 'Created A21',
  '{"kind":"SYSTEM","id":"t021","name":"t021"}'::jsonb) IS NOT NULL AS emitted_opportunity;
SELECT pg_catalog.set_config('a21.send_ref',
  (SELECT approval.ref FROM core.approval_requests AS approval WHERE approval.target_ref = 'PRO-A21-0001'), true);

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a2','a0210000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.audit_upper', pg_temp.try(pg_catalog.format(
  $$SELECT core.get_audit('APPROVAL', %L)$$, pg_catalog.current_setting('a21.send_ref')))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a2','a0210000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.audit_plural', pg_temp.try(pg_catalog.format(
  $$SELECT core.get_audit('approvals', %L)$$, pg_catalog.current_setting('a21.send_ref')))::text, true);
RESET ROLE;

-- aggregateTypeOf('enquiries') and aggregateTypeOf('opportunities'), verbatim.
SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a2','a0210000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.audit_enquirie', pg_temp.try(
  $$SELECT core.get_audit('ENQUIRIE', 'a0210000-eeee-4000-8000-000000000001')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0210000-0000-4000-8000-0000000000a2','a0210000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a21.audit_opportunitie', pg_temp.try(
  $$SELECT core.get_audit('OPPORTUNITIE', 'OPP-A21-0001')$$)::text, true);
RESET ROLE;

DO $t3b$
BEGIN
  IF pg_temp.got('send') #>> '{value,data,status}' IS DISTINCT FROM 'QUEUED_FOR_APPROVAL' THEN
    RAISE EXCEPTION 'T3b SETUP: PROPOSAL_SEND did not queue: %', pg_temp.got('send');
  END IF;
  IF (pg_temp.got('audit_upper') #>> '{value,data,page,total}')::integer IS DISTINCT FROM 1
     OR pg_temp.got('audit_upper') #>> '{value,data,data,0,event}' <> 'ProposalSent' THEN
    RAISE EXCEPTION 'T3b: get_audit(APPROVAL, ref) did not return the correlated trail: %', pg_temp.got('audit_upper');
  END IF;
  IF pg_temp.got('audit_upper') #> '{value,data}' <> pg_temp.got('audit_plural') #> '{value,data}' THEN
    RAISE EXCEPTION 'T3b: APPROVAL and approvals answer differently: % vs %',
      pg_temp.got('audit_upper'), pg_temp.got('audit_plural');
  END IF;
  IF pg_temp.got('audit_enquirie') #>> '{value,data,data,0,event}' IS DISTINCT FROM 'EnquiryClassified' THEN
    RAISE EXCEPTION 'T3b: get_audit(ENQUIRIE, id) did not reach the ENQUIRY trail: %', pg_temp.got('audit_enquirie');
  END IF;
  IF pg_temp.got('audit_opportunitie') #>> '{value,data,data,0,event}' IS DISTINCT FROM 'OpportunityCreated' THEN
    RAISE EXCEPTION 'T3b: get_audit(OPPORTUNITIE, ref) did not reach the OPPORTUNITY trail: %', pg_temp.got('audit_opportunitie');
  END IF;
  RAISE NOTICE 'T3b PASS: get_audit answers what rpcClient.ts sends: APPROVAL (correlated trail, as approvals), ENQUIRIE and OPPORTUNITIE.';
END
$t3b$;

ROLLBACK;
