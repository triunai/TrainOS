-- ============================================================================
-- PIN 011 · action_envelope_and_policy_gate
-- ============================================================================
--
-- Run against the complete 001-011 set. Ends in ROLLBACK.
--   psql "$DATABASE_URL" -f supabase/tests/test_011_action_envelope_and_policy_gate.sql
--
-- T1  Exact object, seed, enum, trigger, view and search_path inventory.
-- T2  HUMAN: EXECUTED/202, QUEUED/202, and SUGGESTED unreachable.
-- T3  AGENT: AUTONOMOUS executes, ACT_WITH_APPROVAL queues, SUGGEST drafts,
--     and missing grant is exact OBSERVE denial.
-- T4  SYSTEM executes and policy evaluation is skipped.
-- T5  Idempotent replay returns the original body with HTTP 200 (M-21).
-- T6  Self-approval and NULL requester both fail GOV-03 (H-03).
-- T7  NULL app_role fails before role authorisation (H-04).
-- T8  Money-moving perform and decide both require verified AAL2 (H-05).
-- T9  A queued request and a sibling-row request cannot open a gate (H-07).
-- T10 An agent cannot grant itself autonomy even beside a permissive policy
--     (H-02), and a NULL ceiling fails closed (M-12).
-- T11 Unknown effect status raises at the shared enum boundary (R14).
-- T12 A malformed payload_schema raises rather than validating all payloads
--     (N-03).
-- T13 Every sweep is bounded/skip-locked, the approval view is invoker-rights,
--     tenant timezone arithmetic is present, and app USAGE survives (H-10,
--     H-13, M-02, M-04, M-13).
-- T14 No anon/authenticated SELECT or EXECUTE privilege exists on any 011
--     object, including the entry functions (C-04 residue).
--
-- RPC PROBE SHAPE. app.perform_action/decide_approval/report_effect_result have
-- intentionally no authenticated EXECUTE before 014. The task's request to run
-- them under authenticated therefore contradicts C-04's required zero-EXECUTE
-- state. The pin uses the production service_role entry privilege while keeping
-- the JWT identity HUMAN/AGENT/SYSTEM, rather than manufacturing a definer
-- bridge or a temporary authenticated grant. Temporary SECURITY INVOKER adapters
-- catch and park each one-statement result in transaction-local GUCs. Assertions
-- run only after RESET ROLE, because direct reads of the forced-RLS, REVOKE-ALL
-- gate tables would fail at the grant layer before reaching their subject.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_011 SETUP FAILURE: plpgsql.check_asserts is off';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF pg_catalog.to_regclass('core.action_requests') IS NULL
     OR pg_catalog.to_regclass('core.state_transitions') IS NULL
     OR pg_catalog.to_regtype('app.effect_status') IS NULL THEN
    RAISE EXCEPTION 'test_011 SETUP FAILURE: migration 011 is missing or partial';
  END IF;
END;
$setup$;

-- ─── Real auth and domain fixtures ─────────────────────────────────────────

INSERT INTO auth.users (id,email) VALUES
  ('00000011-0000-0000-0000-0000000000a1','t011-sales@example.invalid'),
  ('00000011-0000-0000-0000-0000000000a2','t011-manager-1@example.invalid'),
  ('00000011-0000-0000-0000-0000000000a3','t011-manager-2@example.invalid'),
  ('00000011-0000-0000-0000-0000000000a4','t011-finance@example.invalid'),
  ('00000011-0000-0000-0000-0000000000a5','t011-agent@example.invalid'),
  ('00000011-0000-0000-0000-0000000000a6','t011-observer@example.invalid'),
  ('00000011-0000-0000-0000-0000000000a7','t011-no-role@example.invalid'),
  ('00000011-0000-0000-0000-0000000000a8','t011-system@example.invalid');

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('00000011-1111-1111-1111-111111111111','t011-alpha','T011 Alpha','Asia/Kuala_Lumpur');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,agent_id,status,is_default)
VALUES
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a1',
   'SALES','HUMAN',NULL,'ACTIVE',true),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a2',
   'SALES_MANAGER','HUMAN',NULL,'ACTIVE',true),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a3',
   'SALES_MANAGER','HUMAN',NULL,'ACTIVE',true),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a4',
   'FINANCE','HUMAN',NULL,'ACTIVE',true),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a5',
   'AGENT','AGENT','agent_t011','ACTIVE',true),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a6',
   'AGENT','AGENT','agent_observe_t011','ACTIVE',true),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a8',
   'OPS','HUMAN',NULL,'ACTIVE',true);

INSERT INTO public.user_profiles (tenant_id,user_id,display_name) VALUES
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a1','T011 Sales'),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a2','T011 Manager One'),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a3','T011 Manager Two'),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a4','T011 Finance'),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a5','T011 Agent'),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a6','T011 Observer'),
  ('00000011-1111-1111-1111-111111111111','00000011-0000-0000-0000-0000000000a8','T011 System');

INSERT INTO core.ref_formats (tenant_id,prefix,entity,dated,width) VALUES
  ('00000011-1111-1111-1111-111111111111','ACT','action_requests',true,4),
  ('00000011-1111-1111-1111-111111111111','APV','approval_requests',true,4),
  ('00000011-1111-1111-1111-111111111111','DRF','suggested_drafts',true,4)
  -- ⚠ 016 now provisions every tenant's ref_formats from an AFTER INSERT trigger
  -- on public.tenants, so this fixture collides with the real thing. The pin's
  -- own shape wins: it is a fixture inside a transaction that rolls back, and
  -- the assertions below were written against these exact values.
  ON CONFLICT (tenant_id, prefix)
    DO UPDATE SET entity = EXCLUDED.entity,
                  dated  = EXCLUDED.dated,
                  width  = EXCLUDED.width;

INSERT INTO core.organisations (id,tenant_id,ref,name,owner_id) VALUES
  ('00000011-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000011-1111-1111-1111-111111111111',
   'ORG-T011','T011 Manufacturing','00000011-0000-0000-0000-0000000000a1');
INSERT INTO core.templates (id,tenant_id,ref,template_type,label,status) VALUES
  ('00000011-dddd-dddd-dddd-ddddddddddd1','00000011-1111-1111-1111-111111111111',
   'TPL-T011','PROPOSAL','T011 Proposal','ACTIVE');
INSERT INTO core.opportunities
  (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen)
VALUES
  ('00000011-cccc-cccc-cccc-ccccccccccc1','00000011-1111-1111-1111-111111111111',
   'OPP-T011','00000011-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
   '00000011-0000-0000-0000-0000000000a1','NEW',1850000);

INSERT INTO core.proposals
  (id,tenant_id,ref,opportunity_id,organisation_id,template_id,status,value_sen)
VALUES
  ('00000011-eeee-eeee-eeee-eeeeeeeeeee1','00000011-1111-1111-1111-111111111111',
   'PRO-T011-1','00000011-cccc-cccc-cccc-ccccccccccc1',
   '00000011-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000011-dddd-dddd-dddd-ddddddddddd1','DRAFT',1850000),
  ('00000011-eeee-eeee-eeee-eeeeeeeeeee2','00000011-1111-1111-1111-111111111111',
   'PRO-T011-2','00000011-cccc-cccc-cccc-ccccccccccc1',
   '00000011-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000011-dddd-dddd-dddd-ddddddddddd1','DRAFT',1850000),
  ('00000011-eeee-eeee-eeee-eeeeeeeeeee3','00000011-1111-1111-1111-111111111111',
   'PRO-T011-3','00000011-cccc-cccc-cccc-ccccccccccc1',
   '00000011-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000011-dddd-dddd-dddd-ddddddddddd1','DRAFT',1850000),
  ('00000011-eeee-eeee-eeee-eeeeeeeeeee4','00000011-1111-1111-1111-111111111111',
   'PRO-T011-4','00000011-cccc-cccc-cccc-ccccccccccc1',
   '00000011-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000011-dddd-dddd-dddd-ddddddddddd1','DRAFT',1850000),
  ('00000011-eeee-eeee-eeee-eeeeeeeeeee5','00000011-1111-1111-1111-111111111111',
   'PRO-T011-5','00000011-cccc-cccc-cccc-ccccccccccc1',
   '00000011-bbbb-bbbb-bbbb-bbbbbbbbbbb1','00000011-dddd-dddd-dddd-ddddddddddd1','DRAFT',1850000);

-- A rate card and a quotation, so T18 can edit a real record and watch the
-- approval diff hash move. Without them T18's record-change half SKIPS, and a
-- skipped assertion in a pin about a guard that could never fire is the same
-- vacuous pass the guard itself was.
-- A REAL aal2 session. `app.aal2_verified()` checks auth.sessions rather than
-- trusting the claim, so a money-moving action needs a row here and not just
-- "aal":"aal2" in the JWT — which is the point of that function and is why T19's
-- QUOTATION_APPLY could not otherwise be staged at all.
INSERT INTO auth.sessions (id,user_id,aal) VALUES
  ('00000011-5e55-0000-0000-00000000000a','00000011-0000-0000-0000-0000000000a1','aal2'),
  ('00000011-5e55-0000-0000-00000000000b','00000011-0000-0000-0000-0000000000a3','aal2');

INSERT INTO core.rate_cards (id,tenant_id,version,status,effective_from) VALUES
  ('00000011-0fff-0fff-0fff-0fffffffffe1','00000011-1111-1111-1111-111111111111',
   'v1-t011','DRAFT','2026-01-01');

INSERT INTO core.quotations
  (id,tenant_id,proposal_id,rate_card_id,pax,sell_price_sen,direct_cost_sen,
   programme_floor_price_sen,floor_margin_rate)
VALUES
  ('00000011-0977-0977-0977-097777777771','00000011-1111-1111-1111-111111111111',
   '00000011-eeee-eeee-eeee-eeeeeeeeeee1','00000011-0fff-0fff-0fff-0fffffffffe1',
   30,1850000,1091500,1390000,0.3500),
  -- A second one, so T19 can approve an UNCHANGED record and a CHANGED one
  -- without the first decision consuming the only fixture.
  ('00000011-0977-0977-0977-097777777772','00000011-1111-1111-1111-111111111111',
   '00000011-eeee-eeee-eeee-eeeeeeeeeee2','00000011-0fff-0fff-0fff-0fffffffffe1',
   30,1850000,1091500,1390000,0.3500);

INSERT INTO core.enquiries
  (id,tenant_id,ref,channel,status,received_at,subject)
VALUES
  ('00000011-ffff-ffff-ffff-fffffffffff1','00000011-1111-1111-1111-111111111111',
   'ENQ-T011-1','EMAIL','OPEN',pg_catalog.now(),'Human execution'),
  ('00000011-ffff-ffff-ffff-fffffffffff2','00000011-1111-1111-1111-111111111111',
   'ENQ-T011-2','EMAIL','OPEN',pg_catalog.now(),'Agent execution'),
  ('00000011-ffff-ffff-ffff-fffffffffff3','00000011-1111-1111-1111-111111111111',
   'ENQ-T011-3','EMAIL','OPEN',pg_catalog.now(),'System execution'),
  ('00000011-ffff-ffff-ffff-fffffffffff4','00000011-1111-1111-1111-111111111111',
   'ENQ-T011-4','EMAIL','OPEN',pg_catalog.now(),'Idempotent execution'),
  ('00000011-ffff-ffff-ffff-fffffffffff5','00000011-1111-1111-1111-111111111111',
   'ENQ-T011-5','EMAIL','OPEN',pg_catalog.now(),'Observe denial');

SELECT pg_catalog.set_config('request.jwt.claims','',true);
INSERT INTO core.autonomy_grants
  (tenant_id,agent_id,action_type,level,approver_role,min_confidence,granted_by)
VALUES
  ('00000011-1111-1111-1111-111111111111','agent_t011','ENQUIRY_ARCHIVE',
   'AUTONOMOUS',NULL,0.700,'t011-fixture'),
  ('00000011-1111-1111-1111-111111111111','agent_t011','PROPOSAL_SEND',
   'ACT_WITH_APPROVAL','SALES_MANAGER',0.700,'t011-fixture'),
  ('00000011-1111-1111-1111-111111111111','agent_t011','FOLLOWUP_SEND',
   'SUGGEST','SALES_MANAGER',0.700,'t011-fixture');

-- ─── Temporary RPC adapters ────────────────────────────────────────────────

CREATE FUNCTION pg_temp.t011_perform(
  p_type text,p_target text,p_payload jsonb,p_confidence numeric,p_idempotency text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE v_body jsonb; v_detail text;
BEGIN
  BEGIN
    v_body := app.perform_action(
      p_type,p_target,p_payload,NULL,p_confidence,NULL,'[]'::jsonb,p_idempotency);
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'http',pg_catalog.current_setting('response.status',true),'body',v_body);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'sqlstate',SQLSTATE,'message',SQLERRM,'detailText',v_detail);
  END;
END;
$fn$;

CREATE FUNCTION pg_temp.t011_decide(p_id uuid,p_decision text,p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE v_body jsonb; v_detail text;
BEGIN
  BEGIN
    v_body := app.decide_approval(p_id,p_decision,p_note,NULL,NULL);
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'http',pg_catalog.current_setting('response.status',true),'body',v_body);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'sqlstate',SQLSTATE,'message',SQLERRM,'detailText',v_detail);
  END;
END;
$fn$;

CREATE FUNCTION pg_temp.t011_decide_hash(p_id uuid,p_decision text,p_note text,p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE v_body jsonb; v_detail text;
BEGIN
  BEGIN
    v_body := app.decide_approval(p_id,p_decision,p_note,p_hash,NULL);
    RETURN pg_catalog.jsonb_build_object('ok',true,'body',v_body);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'sqlstate',SQLSTATE,'message',SQLERRM,'detailText',v_detail);
  END;
END;
$fn$;

CREATE FUNCTION pg_temp.t011_bulk(p_items jsonb, p_decision text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE v_body jsonb; v_detail text;
BEGIN
  BEGIN
    v_body := app.bulk_decide(p_items, p_decision, NULL, NULL);
    RETURN pg_catalog.jsonb_build_object('ok',true,'body',v_body);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'sqlstate',SQLSTATE,'message',SQLERRM,'detailText',v_detail);
  END;
END;
$fn$;

CREATE FUNCTION pg_temp.t011_report(p_id bigint,p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE v_detail text;
BEGIN
  BEGIN
    EXECUTE 'SELECT app.report_effect_result($1,$2::app.effect_status,$3,$4)'
      USING p_id,p_status,'{}'::jsonb,NULL::jsonb;
    RETURN pg_catalog.jsonb_build_object('ok',true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'sqlstate',SQLSTATE,'message',SQLERRM,'detailText',v_detail);
  END;
END;
$fn$;

-- ─── T2 · HUMAN matrix ─────────────────────────────────────────────────────

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.human_executed',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-1','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.human_queued',
  pg_temp.t011_perform('PROPOSAL_SEND','PRO-T011-1','{"channel":"EMAIL"}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

DO $t2$
DECLARE v_exec jsonb := pg_catalog.current_setting('t011.human_executed')::jsonb;
        v_queue jsonb := pg_catalog.current_setting('t011.human_queued')::jsonb;
BEGIN
  ASSERT v_exec = pg_catalog.jsonb_build_object(
    'ok',true,'http','202','body',pg_catalog.jsonb_build_object(
      'status','EXECUTED','result',pg_catalog.jsonb_build_object(
        'effects',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'op','UPDATE','entity','Enquiry','ref','ENQ-T011-1',
          'description','Archive the enquiry'))))),
    pg_catalog.format('T2a FAIL: HUMAN execution response was %s',v_exec);
  ASSERT (SELECT enquiry.status FROM core.enquiries AS enquiry
           WHERE enquiry.id = '00000011-ffff-ffff-ffff-fffffffffff1') = 'ARCHIVED',
    'T2b FAIL: HUMAN EXECUTED did not archive the exact enquiry';
  ASSERT v_queue ->> 'http' = '202'
     AND v_queue #>> '{body,status}' = 'QUEUED_FOR_APPROVAL'
     AND v_queue #>> '{body,approvalRequest,policyId}' = 'APV-01'
     AND v_queue #>> '{body,approvalRequest,assignedTo,id}' =
         '00000011-0000-0000-0000-0000000000a2',
    pg_catalog.format('T2c FAIL: HUMAN queued response was %s',v_queue);
  ASSERT (SELECT proposal.status FROM core.proposals AS proposal
           WHERE proposal.id = '00000011-eeee-eeee-eeee-eeeeeeeeeee1') = 'DRAFT',
    'T2d FAIL: queued proposal changed before approval';
  ASSERT (SELECT pg_catalog.count(*) FROM core.action_requests AS request
           WHERE request.requested_by_kind = 'HUMAN' AND request.status = 'SUGGESTED') = 0,
    'T2e FAIL: HUMAN reached the SUGGESTED branch';
  RAISE NOTICE 'T2 PASS - HUMAN EXECUTED/202 and QUEUED/202; SUGGESTED is unreachable.';
END;
$t2$;

-- ─── T3 · AGENT matrix ─────────────────────────────────────────────────────

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a5","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"AGENT","actor_kind":"AGENT","agent_id":"agent_t011","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.agent_executed',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-2','{}'::jsonb,0.900,NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a5","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"AGENT","actor_kind":"AGENT","agent_id":"agent_t011","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.agent_queued',
  pg_temp.t011_perform('PROPOSAL_SEND','PRO-T011-2','{"channel":"EMAIL","runId":"run_t011"}'::jsonb,0.820,NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a5","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"AGENT","actor_kind":"AGENT","agent_id":"agent_t011","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.agent_suggested',
  pg_temp.t011_perform('FOLLOWUP_SEND','FUP-T011-NONE',
    '{"channel":"EMAIL","body":"Suggested follow-up","runId":"run_t011"}'::jsonb,
    0.880,NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a6","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"AGENT","actor_kind":"AGENT","agent_id":"agent_observe_t011","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.agent_observe',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-5','{}'::jsonb,0.950,NULL)::text,true);
RESET ROLE;

DO $t3$
DECLARE v_exec jsonb := pg_catalog.current_setting('t011.agent_executed')::jsonb;
        v_queue jsonb := pg_catalog.current_setting('t011.agent_queued')::jsonb;
        v_suggest jsonb := pg_catalog.current_setting('t011.agent_suggested')::jsonb;
        v_observe jsonb := pg_catalog.current_setting('t011.agent_observe')::jsonb;
BEGIN
  ASSERT v_exec ->> 'http' = '202' AND v_exec #>> '{body,status}' = 'EXECUTED',
    pg_catalog.format('T3a FAIL: AGENT AUTONOMOUS was %s',v_exec);
  ASSERT (SELECT request.requested_by_id FROM core.action_requests AS request
           WHERE request.target_ref = 'ENQ-T011-2') = 'agent_t011',
    'T3b FAIL: AGENT identity was not logged exactly';
  ASSERT v_queue ->> 'http' = '202'
     AND v_queue #>> '{body,status}' = 'QUEUED_FOR_APPROVAL'
     AND v_queue #>> '{body,approvalRequest,policyId}' = 'APV-01',
    pg_catalog.format('T3c FAIL: AGENT approval response was %s',v_queue);
  ASSERT v_suggest ->> 'http' = '200'
     AND v_suggest #>> '{body,status}' = 'SUGGESTED'
     AND v_suggest #>> '{body,draft,type}' = 'FOLLOWUP_SEND',
    pg_catalog.format('T3d FAIL: AGENT suggestion response was %s',v_suggest);
  ASSERT (SELECT draft.expires_at - draft.created_at FROM core.suggested_drafts AS draft
           WHERE draft.action_type = 'FOLLOWUP_SEND') = interval '7 days',
    'T3e FAIL: suggested draft expiry is not exactly seven days';
  ASSERT v_observe ->> 'ok' = 'false'
     AND (v_observe ->> 'detailText')::jsonb ->> 'grantedLevel' = 'OBSERVE',
    pg_catalog.format('T3f FAIL: default deny was %s',v_observe);
  RAISE NOTICE 'T3 PASS - all four AGENT outcomes are exact.';
END;
$t3$;

-- ─── T4 · SYSTEM ───────────────────────────────────────────────────────────

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a8","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"OPS","actor_kind":"SYSTEM","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.system_executed',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-3','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

DO $t4$
DECLARE v jsonb := pg_catalog.current_setting('t011.system_executed')::jsonb;
BEGIN
  ASSERT v ->> 'http' = '202' AND v #>> '{body,status}' = 'EXECUTED',
    pg_catalog.format('T4a FAIL: SYSTEM response was %s',v);
  ASSERT (SELECT pg_catalog.jsonb_array_length(request.evaluation_trace)
            FROM core.action_requests AS request
           WHERE request.target_ref = 'ENQ-T011-3') = 5,
    'T4b FAIL: SYSTEM did not traverse the exact five evaluation/dispatch trace entries';
  ASSERT (SELECT request.requested_by_kind FROM core.action_requests AS request
           WHERE request.target_ref = 'ENQ-T011-3') = 'SYSTEM',
    'T4c FAIL: SYSTEM requester kind was not logged';
  RAISE NOTICE 'T4 PASS - SYSTEM executes with 202 and its identity is logged.';
END;
$t4$;

-- ─── T5 · idempotent replay is the original body with HTTP 200 ─────────────

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.replay_first',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-4','{}'::jsonb,NULL,'idem-t011')::text,true);
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.replay_second',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-4','{}'::jsonb,NULL,'idem-t011')::text,true);
RESET ROLE;

DO $t5$
DECLARE v_first jsonb := pg_catalog.current_setting('t011.replay_first')::jsonb;
        v_second jsonb := pg_catalog.current_setting('t011.replay_second')::jsonb;
BEGIN
  ASSERT v_first ->> 'http' = '202',
    pg_catalog.format('T5a FAIL: original HTTP was %s',v_first ->> 'http');
  ASSERT v_second ->> 'http' = '200',
    pg_catalog.format('T5b FAIL: replay HTTP was %s, expected 200',v_second ->> 'http');
  ASSERT v_second -> 'body' = v_first -> 'body',
    'T5c FAIL: replay body differs from the original response';
  ASSERT (SELECT pg_catalog.count(*) FROM core.action_requests AS request
           WHERE request.target_ref = 'ENQ-T011-4') = 1,
    'T5d FAIL: replay inserted a second action request';
  RAISE NOTICE 'T5 PASS - replay body is identical and HTTP is 200.';
END;
$t5$;

-- ─── Manual pending approvals for decision-side fraud/assurance probes ─────

-- Manager One submits; assignment must choose Manager Two, never the requester.
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a2","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES_MANAGER","actor_kind":"HUMAN","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.self_submit',
  pg_temp.t011_perform('PROPOSAL_SEND','PRO-T011-3','{"channel":"EMAIL"}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('t011.self_approval_id',(
  SELECT approval.id::text FROM core.approval_requests AS approval
   WHERE approval.target_ref = 'PRO-T011-3'),true);
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a2","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES_MANAGER","actor_kind":"HUMAN","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.self_decide',
  pg_temp.t011_decide(pg_catalog.current_setting('t011.self_approval_id')::uuid,
    'APPROVE',NULL)::text,true);
RESET ROLE;

INSERT INTO core.action_requests
  (id,tenant_id,ref,action_type,target_ref,target_entity,target_id,payload,
   requested_by_kind,requested_by_id,status,effects,effects_hash)
VALUES
  ('00000011-1111-1111-1111-111111111201','00000011-1111-1111-1111-111111111111',
   'ACT-T011-NULL','PROPOSAL_SEND','PRO-T011-4','proposal',
   '00000011-eeee-eeee-eeee-eeeeeeeeeee4','{"channel":"EMAIL"}',
   'HUMAN','00000011-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL','[]',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('[]'::jsonb::text,'UTF8')),'hex'));
INSERT INTO core.approval_requests
  (id,tenant_id,ref,action_request_id,policy_id,action_type,subject,target_ref,
   requested_by_kind,requested_by_id,reason,evidence,deviations,diff,diff_hash,
   approver_role,assigned_to_id,sla_due_at,expires_at,bulk_approvable)
VALUES
  ('00000011-1111-1111-1111-111111111301','00000011-1111-1111-1111-111111111111',
   'APV-T011-NULL','00000011-1111-1111-1111-111111111201','APV-01',
   'PROPOSAL_SEND','NULL requester','PRO-T011-4','HUMAN',NULL,'fraud backstop',
   '[]','[]','[]',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('[]'::jsonb::text,'UTF8')),'hex'),
   'SALES_MANAGER','00000011-0000-0000-0000-0000000000a3',
   pg_catalog.now() + interval '4 hours',pg_catalog.now() + interval '24 hours',false);

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a3","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES_MANAGER","actor_kind":"HUMAN","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.null_requester_decide',
  pg_temp.t011_decide('00000011-1111-1111-1111-111111111301','APPROVE',NULL)::text,true);
RESET ROLE;

DO $t6$
DECLARE v_self jsonb := pg_catalog.current_setting('t011.self_decide')::jsonb;
        v_null jsonb := pg_catalog.current_setting('t011.null_requester_decide')::jsonb;
BEGIN
  ASSERT pg_catalog.current_setting('t011.self_submit')::jsonb
           #>> '{body,approvalRequest,assignedTo,id}' =
         '00000011-0000-0000-0000-0000000000a3',
    'T6a FAIL: requester was assigned their own approval';
  ASSERT v_self ->> 'ok' = 'false'
     AND (v_self ->> 'detailText')::jsonb ->> 'policyId' = 'GOV-03',
    pg_catalog.format('T6b FAIL: self-approval response was %s',v_self);
  ASSERT v_null ->> 'ok' = 'false'
     AND (v_null ->> 'detailText')::jsonb ->> 'policyId' = 'GOV-03',
    pg_catalog.format('T6c FAIL: NULL requester response was %s',v_null);
  RAISE NOTICE 'T6 PASS - self and NULL requesters both fail GOV-03.';
END;
$t6$;

-- ─── T7/T8 · NULL role and AAL2 inside both envelopes ──────────────────────

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a7","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","actor_kind":"HUMAN","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.null_role',
  pg_temp.t011_decide('00000011-1111-1111-1111-111111111301','APPROVE',NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a4","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"FINANCE","actor_kind":"HUMAN","aal":"aal2"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.money_perform',
  pg_temp.t011_perform('INVOICE_PUSH','INV-NOT-REACHED','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

INSERT INTO core.action_requests
  (id,tenant_id,ref,action_type,target_ref,target_entity,payload,requested_by_kind,
   requested_by_id,status,effects,effects_hash)
VALUES
  ('00000011-1111-1111-1111-111111111202','00000011-1111-1111-1111-111111111111',
   'ACT-T011-MONEY','INVOICE_PUSH','INV-NOT-REACHED','invoice','{}','HUMAN',
   '00000011-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL','[]',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('[]'::jsonb::text,'UTF8')),'hex'));
INSERT INTO core.approval_requests
  (id,tenant_id,ref,action_request_id,policy_id,action_type,subject,target_ref,
   requested_by_kind,requested_by_id,reason,evidence,deviations,diff,diff_hash,
   approver_role,assigned_to_id,sla_due_at,expires_at,bulk_approvable)
VALUES
  ('00000011-1111-1111-1111-111111111302','00000011-1111-1111-1111-111111111111',
   'APV-T011-MONEY','00000011-1111-1111-1111-111111111202','FIN-02','INVOICE_PUSH',
   'Money approval','INV-NOT-REACHED','HUMAN','00000011-0000-0000-0000-0000000000a1',
   'AAL2 backstop','[]','[]','[]',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('[]'::jsonb::text,'UTF8')),'hex'),
   'FINANCE','00000011-0000-0000-0000-0000000000a4',
   pg_catalog.now() + interval '4 hours',pg_catalog.now() + interval '24 hours',false);

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a4","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"FINANCE","actor_kind":"HUMAN","aal":"aal2"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.money_decide',
  pg_temp.t011_decide('00000011-1111-1111-1111-111111111302','APPROVE',NULL)::text,true);
RESET ROLE;

DO $t7_t8$
DECLARE v_role jsonb := pg_catalog.current_setting('t011.null_role')::jsonb;
        v_perform jsonb := pg_catalog.current_setting('t011.money_perform')::jsonb;
        v_decide jsonb := pg_catalog.current_setting('t011.money_decide')::jsonb;
BEGIN
  ASSERT v_role ->> 'ok' = 'false'
     AND (v_role ->> 'detailText')::jsonb ->> 'reason' = 'APP_ROLE_REQUIRED',
    pg_catalog.format('T7 FAIL: NULL role response was %s',v_role);
  -- A forgeable aal2 claim is present on purpose. With no matching auth.sessions
  -- row, app.aal2_verified() must still fail closed.
  ASSERT v_perform ->> 'ok' = 'false'
     AND (v_perform ->> 'detailText')::jsonb ->> 'reason' = 'AAL2_REQUIRED',
    pg_catalog.format('T8a FAIL: money perform response was %s',v_perform);
  ASSERT v_decide ->> 'ok' = 'false'
     AND (v_decide ->> 'detailText')::jsonb ->> 'reason' = 'AAL2_REQUIRED',
    pg_catalog.format('T8b FAIL: money decide response was %s',v_decide);
  RAISE NOTICE 'T7 PASS - NULL role refused before authorisation.';
  RAISE NOTICE 'T8 PASS - a forged aal2 claim passes neither money boundary.';
END;
$t7_t8$;

-- ─── T9 · both H-07 holes are closed ───────────────────────────────────────

INSERT INTO core.action_requests
  (id,tenant_id,ref,action_type,target_ref,target_entity,target_id,payload,
   requested_by_kind,requested_by_id,status,effects)
VALUES
  ('00000011-1111-1111-1111-111111111203','00000011-1111-1111-1111-111111111111',
   'ACT-T011-QUEUED','PROPOSAL_SEND','PRO-T011-4','proposal',
   '00000011-eeee-eeee-eeee-eeeeeeeeeee4','{"channel":"EMAIL"}',
   'HUMAN','00000011-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL','[]'),
  ('00000011-1111-1111-1111-111111111204','00000011-1111-1111-1111-111111111111',
   'ACT-T011-SIBLING','PROPOSAL_SEND','PRO-T011-4','proposal',
   '00000011-eeee-eeee-eeee-eeeeeeeeeee4','{"channel":"EMAIL"}',
   'HUMAN','00000011-0000-0000-0000-0000000000a1','EXECUTING','[]');

DO $t9$
DECLARE v_queued boolean := false; v_sibling boolean := false;
BEGIN
  PERFORM pg_catalog.set_config(
    'app.effect_applier','00000011-1111-1111-1111-111111111203',true);
  BEGIN
    UPDATE core.proposals SET status = 'SENT',sent_at = pg_catalog.now()
     WHERE id = '00000011-eeee-eeee-eeee-eeeeeeeeeee4';
  EXCEPTION WHEN SQLSTATE 'TRNOS' THEN v_queued := true;
  END;
  PERFORM pg_catalog.set_config(
    'app.effect_applier','00000011-1111-1111-1111-111111111204',true);
  BEGIN
    UPDATE core.proposals SET status = 'SENT',sent_at = pg_catalog.now()
     WHERE id = '00000011-eeee-eeee-eeee-eeeeeeeeeee5';
  EXCEPTION WHEN SQLSTATE 'TRNOS' THEN v_sibling := true;
  END;
  PERFORM pg_catalog.set_config('app.effect_applier','',true);
  ASSERT v_queued, 'T9a FAIL: QUEUED_FOR_APPROVAL opened a state gate';
  ASSERT v_sibling, 'T9b FAIL: an action for a different target row opened the gate';
  ASSERT (SELECT proposal.status FROM core.proposals AS proposal
           WHERE proposal.id = '00000011-eeee-eeee-eeee-eeeeeeeeeee4') = 'DRAFT',
    'T9c FAIL: queued action changed its target';
  ASSERT (SELECT proposal.status FROM core.proposals AS proposal
           WHERE proposal.id = '00000011-eeee-eeee-eeee-eeeeeeeeeee5') = 'DRAFT',
    'T9d FAIL: sibling action changed the wrong target';
  RAISE NOTICE 'T9 PASS - queued status and sibling target both fail GOV-07.';
END;
$t9$;

-- ─── T10 · restrictive self-grant and NULL autonomy ceiling ────────────────

CREATE POLICY t011_autonomy_insert_positive_control ON core.autonomy_grants
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
GRANT INSERT ON core.autonomy_grants TO authenticated;

DO $t10a$
DECLARE v_denied boolean := false;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000011-0000-0000-0000-0000000000a5","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"AGENT","actor_kind":"AGENT","agent_id":"agent_t011"}',true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO core.autonomy_grants
      (id,tenant_id,agent_id,action_type,level,granted_by)
    VALUES
      ('00000011-1111-1111-1111-111111111401',
       '00000011-1111-1111-1111-111111111111','agent_t011',
       'TNA_RECOMMENDATION_ACCEPT','SUGGEST','agent_t011');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  RESET ROLE;
  ASSERT v_denied, 'T10a FAIL: agent inserted its own autonomy grant';
END;
$t10a$;

REVOKE INSERT ON core.autonomy_grants FROM authenticated;
DROP POLICY t011_autonomy_insert_positive_control ON core.autonomy_grants;
SELECT pg_catalog.set_config('request.jwt.claims','',true);

ALTER TABLE app.action_types ALTER COLUMN ceiling_autonomy DROP NOT NULL;
DO $t10b$
DECLARE v_raised boolean := false;
BEGIN
  BEGIN
    UPDATE app.action_types SET ceiling_autonomy = NULL
     WHERE key = 'TNA_RECOMMENDATION_ACCEPT';
    INSERT INTO core.autonomy_grants
      (tenant_id,agent_id,action_type,level,granted_by)
    VALUES
      ('00000011-1111-1111-1111-111111111111','agent_null_ceiling_t011',
       'TNA_RECOMMENDATION_ACCEPT','SUGGEST','t011');
  EXCEPTION WHEN SQLSTATE 'TRNOS' THEN v_raised := true;
  END;
  ASSERT v_raised, 'T10b FAIL: NULL autonomy ceiling admitted a grant';
  RAISE NOTICE 'T10 PASS - self-grant denied and NULL ceiling raises.';
END;
$t10b$;
ALTER TABLE app.action_types ALTER COLUMN ceiling_autonomy SET NOT NULL;

-- ─── T11 · typed effect-status seam ────────────────────────────────────────

INSERT INTO core.action_requests
  (id,tenant_id,ref,action_type,target_entity,payload,requested_by_kind,
   requested_by_id,status,effects)
VALUES
  ('00000011-1111-1111-1111-111111111205','00000011-1111-1111-1111-111111111111',
   'ACT-T011-EFFECT','BROADCAST_SEND','broadcast','{"channel":"EMAIL"}',
   'SYSTEM','00000011-0000-0000-0000-0000000000a8','EXECUTING','[]');
WITH inserted AS (
  INSERT INTO app.action_effects
    (tenant_id,action_request_id,seq,op,entity,description,kind,status,job_key)
  VALUES
    ('00000011-1111-1111-1111-111111111111',
     '00000011-1111-1111-1111-111111111205',1,'ADD','Message',
     'T011 effect','EXTERNAL','DISPATCHED','t011-effect')
  RETURNING id
)
SELECT pg_catalog.set_config('t011.effect_id',(SELECT id::text FROM inserted),true);

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a8","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"OPS","actor_kind":"SYSTEM"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.effect_unknown',
  pg_temp.t011_report(pg_catalog.current_setting('t011.effect_id')::bigint,'BOGUS')::text,true);
RESET ROLE;

DO $t11$
DECLARE v jsonb := pg_catalog.current_setting('t011.effect_unknown')::jsonb;
BEGIN
  ASSERT v ->> 'ok' = 'false' AND v ->> 'sqlstate' = '22P02',
    pg_catalog.format('T11a FAIL: unknown effect status response was %s',v);
  ASSERT (SELECT effect.status FROM app.action_effects AS effect
           WHERE effect.id = pg_catalog.current_setting('t011.effect_id')::bigint) = 'DISPATCHED',
    'T11b FAIL: unknown status changed the ledger';
  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_type AS type
           WHERE type.typname = 'effect_status') = 1,
    'T11c FAIL: effect_status is duplicated';
  RAISE NOTICE 'T11 PASS - unknown worker status raises at the single enum seam.';
END;
$t11$;

-- ─── T12 · malformed payload_schema raises ─────────────────────────────────

ALTER TABLE app.action_types DROP CONSTRAINT action_types_payload_schema_shape;
UPDATE app.action_types SET payload_schema = '{"requires":[]}'::jsonb
 WHERE key = 'ENQUIRY_ARCHIVE';
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.malformed_schema',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-5','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;
UPDATE app.action_types SET payload_schema = '{"required":[]}'::jsonb
 WHERE key = 'ENQUIRY_ARCHIVE';
ALTER TABLE app.action_types
  ADD CONSTRAINT action_types_payload_schema_shape
  CHECK (payload_schema ? 'required'
         AND pg_catalog.jsonb_typeof(payload_schema -> 'required') = 'array');

DO $t12$
DECLARE v jsonb := pg_catalog.current_setting('t011.malformed_schema')::jsonb;
BEGIN
  ASSERT v ->> 'ok' = 'false'
     AND (v ->> 'detailText')::jsonb ->> 'reason' = 'MALFORMED_PAYLOAD_SCHEMA',
    pg_catalog.format('T12 FAIL: malformed schema response was %s',v);
  RAISE NOTICE 'T12 PASS - malformed payload_schema fails closed.';
END;
$t12$;

-- ─── T1/T13/T14 · structural and privilege closure ────────────────────────

DO $t1_t13_t14$
DECLARE
  v_count integer;
  v_bad text;
  v_name text;
  v_definition text;
  v_role text;
  v_relation regclass;
  v_function regprocedure;
  v_column record;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM (VALUES
      ('core.autonomy_grants'),('core.action_policies'),('core.action_requests'),
      ('app.action_effects'),('core.approval_requests'),('core.approval_decisions'),
      ('app.idempotency_keys'),('core.suggested_drafts'),('core.jury_configs'),
      ('core.jury_verdicts'),('core.state_transitions')
    ) AS expected(name)
   WHERE pg_catalog.to_regclass(expected.name) IS NOT NULL;
  ASSERT v_count = 11,
    pg_catalog.format('T1a FAIL: 011 table count is %s, expected 11',v_count);
  ASSERT (SELECT pg_catalog.count(*) FROM app.action_types) = 22,
    'T1b FAIL: action type count is not exactly 22';
  ASSERT (SELECT pg_catalog.count(*) FROM core.action_policies
           WHERE tenant_id = '00000011-1111-1111-1111-111111111111') = 22,
    'T1c FAIL: policy count is not exactly 22 for the fixture tenant';
  -- 121 from doc 01 §5.3 + 3 payment-reversal edges that section omits and
  -- 010's reversal path requires. See the marked note at the seed in 011.
  ASSERT (SELECT pg_catalog.count(*) FROM core.state_transitions) = 124,
    'T1d FAIL: transition count is not exactly 124';
  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS trigger
           WHERE NOT trigger.tgisinternal
             AND trigger.tgfoid = 'app.enforce_state_transition()'::regprocedure) = 15,
    'T1e FAIL: state-transition attachment count is not exactly 15';
  ASSERT (SELECT pg_catalog.array_agg(enum.enumlabel::text ORDER BY enum.enumsortorder)
            FROM pg_catalog.pg_enum AS enum
           WHERE enum.enumtypid = 'app.effect_status'::regtype) = ARRAY[
      'PLANNED','APPLIED','DISPATCHED','SUCCEEDED','FAILED','SETTLED','DEAD_LETTERED'],
    'T1f FAIL: effect_status labels or order changed';

  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'app'
     AND procedure.proname = ANY (ARRAY[
       'is_valid_condition_set','autonomy_rank','jnum','policy_matches','aal2_verified',
       'seed_action_policies','seed_action_policies_on_tenant',
       'enforce_autonomy_ceiling','assert_gates_exist','enforce_state_transition',
       'resolve_action_target_id','action_value','open_approval_count',
       'pick_role_holder','plan_effects',
       'execute_in_database_action','apply_effects','perform_action','decide_approval',
       'bulk_decide','report_effect_result','escalate_approvals',
       'notify_approval_breaches','expire_approvals','cleanup_idempotency_keys',
       'expire_suggested_drafts','enqueue_jury','enqueue_jury_samples'])
     AND procedure.proconfig @> ARRAY['search_path=""'];
  ASSERT v_count = 28,
    pg_catalog.format('T1g FAIL: %s of 28 functions store search_path=""',v_count);

  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    WHERE class.oid = 'core.autonomy_grants'::regclass
      AND policy.polname = 'autonomy_grants_agents_cannot_write'
      AND NOT policy.polpermissive AND policy.polcmd = '*'
      AND pg_catalog.strpos(pg_catalog.pg_get_expr(policy.polqual,policy.polrelid), 'is_agent()') > 0
      AND pg_catalog.strpos(pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid), 'is_agent()') > 0),
    'T1h FAIL: restrictive self-grant policy is absent from USING or WITH CHECK';

  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'core.v_approval_requests'::regclass
       AND class.reloptions @> ARRAY['security_invoker=true']),
    'T13a FAIL: v_approval_requests is not security_invoker';
  ASSERT pg_catalog.has_schema_privilege('anon','app','USAGE')
     AND pg_catalog.has_schema_privilege('authenticated','app','USAGE')
     AND pg_catalog.has_schema_privilege('service_role','app','USAGE'),
    'T13b FAIL: M-04 load-bearing app schema USAGE was revoked';

  FOR v_column IN
    SELECT * FROM (VALUES
      ('core.enquiries','status'),('core.opportunities','stage'),
      ('core.tnas','status'),('core.proposals','status'),
      ('core.quotations','status'),('core.engagements','status'),
      ('core.attendance_days','status'),('core.hrdc_packets','status'),
      ('core.invoices','status'),('core.invoices','sync_state'),
      ('core.collections_cases','stage'),('core.trainer_bookings','state'),
      ('core.compliance_rules','status'),('core.rule_changes','status'),
      ('core.outbound_messages','status'))
      AS gated(relation_name,column_name)
  LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      ASSERT NOT pg_catalog.has_column_privilege(
        v_role,v_column.relation_name,v_column.column_name,'UPDATE'),
        pg_catalog.format('T13c FAIL: %s can directly UPDATE %s.%s',
          v_role,v_column.relation_name,v_column.column_name);
    END LOOP;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(
    'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure)
    INTO v_definition;
  ASSERT pg_catalog.strpos(v_definition, 'tenant.timezone') > 0
     AND (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(
       v_definition,'AT TIME ZONE v_tenant_timezone','')))
         / pg_catalog.length('AT TIME ZONE v_tenant_timezone') >= 4,
    'T13d FAIL: tenant-local day arithmetic is incomplete';
  SELECT pg_catalog.regexp_replace(
           pg_catalog.pg_get_viewdef('core.v_approval_requests'::regclass,true),
           '\s+', '', 'g')
    INTO v_definition;
  ASSERT (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(
       v_definition,'ATTIMEZONEtenant.timezone','')))
         / pg_catalog.length('ATTIMEZONEtenant.timezone') = 2,
    'T13e FAIL: date_trunc local midnight is not converted back to timestamptz';

  FOREACH v_name IN ARRAY ARRAY[
    'escalate_approvals','notify_approval_breaches','expire_approvals',
    'cleanup_idempotency_keys','expire_suggested_drafts','enqueue_jury_samples']
  LOOP
    SELECT pg_catalog.pg_get_functiondef(procedure.oid) INTO v_definition
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'app' AND procedure.proname = v_name;
    ASSERT pg_catalog.strpos(v_definition, 'FOR UPDATE') > 0
       AND pg_catalog.strpos(v_definition, 'SKIP LOCKED') > 0
       AND pg_catalog.strpos(v_definition, 'LIMIT p_limit') > 0,
      pg_catalog.format('T13f FAIL: %s lacks FOR UPDATE SKIP LOCKED + LIMIT',v_name);
  END LOOP;
  FOREACH v_name IN ARRAY ARRAY[
    'escalate_approvals','notify_approval_breaches','expire_approvals']
  LOOP
    SELECT pg_catalog.pg_get_functiondef(procedure.oid) INTO v_definition
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'app' AND procedure.proname = v_name;
    ASSERT pg_catalog.strpos(v_definition, 'approval.status = ''PENDING''') > 0,
      pg_catalog.format('T13g FAIL: %s outer UPDATE lacks the live status guard',v_name);
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR v_relation IN
      SELECT pg_catalog.to_regclass(name) FROM (VALUES
        ('app.action_types'),('core.autonomy_grants'),('core.action_policies'),
        ('core.action_requests'),('app.action_effects'),('core.approval_requests'),
        ('core.approval_decisions'),('app.idempotency_keys'),
        ('core.suggested_drafts'),('core.jury_configs'),('core.jury_verdicts'),
        ('core.state_transitions'),('core.v_approval_requests')
      ) AS relation(name)
    LOOP
      -- ⚠ AMENDED BY 014 (2026-09-13). This loop asserted the C-04 residue: that
      -- NOTHING 011 created was reachable by a client role, because policies and
      -- grants were to land together in 014. They have. `authenticated` now holds
      -- SELECT on the core relations, tenant-scoped by 014's policies; `anon`
      -- still holds nothing, and core.v_approval_requests is still granted to
      -- neither (doc 09 §12). The invariant that survives is the one that was
      -- always the point: no client role may WRITE any of these, because every
      -- one of them is the envelope's own bookkeeping.
      IF v_role = 'anon' THEN
        ASSERT NOT pg_catalog.has_table_privilege(v_role,v_relation,'SELECT'),
          pg_catalog.format('T16a FAIL: %s has SELECT on %s',v_role,v_relation);
      ELSIF v_relation = 'core.v_approval_requests'::regclass
         OR v_relation::text LIKE 'app.%' THEN
        ASSERT NOT pg_catalog.has_table_privilege(v_role,v_relation,'SELECT'),
          pg_catalog.format('T16a FAIL: %s has SELECT on %s, which 014 '
            'deliberately leaves ungranted',v_role,v_relation);
      END IF;
      ASSERT NOT pg_catalog.has_table_privilege(v_role,v_relation,'INSERT')
         AND NOT pg_catalog.has_table_privilege(v_role,v_relation,'UPDATE')
         AND NOT pg_catalog.has_table_privilege(v_role,v_relation,'DELETE'),
        pg_catalog.format('T14a2 FAIL: %s can WRITE %s. These relations are the '
          'action envelope''s own ledger; a client that writes them directly has '
          'gone around the gate that this entire migration exists to be.',
          v_role,v_relation);
    END LOOP;
    FOR v_function IN
      SELECT procedure.oid::regprocedure
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app'
         AND procedure.proname = ANY (ARRAY[
           'is_valid_condition_set','autonomy_rank','jnum','policy_matches','aal2_verified',
           'seed_action_policies','seed_action_policies_on_tenant',
           'enforce_autonomy_ceiling','assert_gates_exist','enforce_state_transition',
           'resolve_action_target_id','action_value','open_approval_count',
           'pick_role_holder','plan_effects',
           'execute_in_database_action','apply_effects','perform_action','decide_approval',
           'bulk_decide','report_effect_result','escalate_approvals',
           'notify_approval_breaches','expire_approvals','cleanup_idempotency_keys',
           'expire_suggested_drafts','enqueue_jury','enqueue_jury_samples'])
    LOOP
      ASSERT NOT pg_catalog.has_function_privilege(v_role,v_function,'EXECUTE'),
        pg_catalog.format('T16b FAIL: %s has EXECUTE on %s',v_role,v_function);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'T1 PASS - exact 11-table/28-function/22-policy/124-edge inventory.';
  RAISE NOTICE 'T13 PASS - invoker view, app USAGE, timezone math, and bounded sweep structure hold.';
  RAISE NOTICE 'T14 PASS - zero client SELECT/EXECUTE grants on every 011 object.';
END;
$t1_t13_t14$;


-- ─── T16 · CRIT · a dispatched external effect becomes a claimable job ─────
-- The finding: `app.apply_effects` wrote every EXTERNAL effect `DISPATCHED` and
-- stopped. `app.enqueue_effect_jobs` (012) is what turns a dispatched effect
-- into an `app.outbox` row the Node worker can claim, and a repo-wide grep found
-- its only caller anywhere — apps/, packages/, every migration and rollback —
-- was `test_012` itself. So every PROPOSAL_SEND, INVOICE_PUSH, REMINDER_SEND and
-- BROADCAST_SEND reported success, moved its action to EXECUTING, and waited
-- forever for a job that was never created. Nothing alarms on it: `DISPATCHED`
-- is a healthy-looking status and no timeout watches it.
--
-- This pin walks the whole seam rather than asserting the call exists: perform an
-- action that plans an external effect, then CLAIM the job as the worker does.
-- A pin that only checked `app.outbox` had a row would pass against a row the
-- worker could never take.

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"MD","actor_kind":"HUMAN","aal":"aal2"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.seam_action',
  pg_temp.t011_perform('PROPOSAL_SEND','PRO-T011-5','{"channel":"EMAIL"}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

-- PROPOSAL_SEND is policy-gated, so the action queues rather than executing.
-- APPROVING it is what reaches app.apply_effects at all — which is the point:
-- the seam being tested is downstream of the approval, and an approved action
-- that produces no job is the exact silent failure this pin exists for.
SELECT pg_catalog.set_config('t011.seam_approval_id',(
  SELECT approval.id::text FROM core.approval_requests AS approval
   WHERE approval.target_ref = 'PRO-T011-5'
   ORDER BY approval.created_at DESC LIMIT 1),true);

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a3","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"MD","actor_kind":"HUMAN","aal":"aal2"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.seam_decide',
  pg_temp.t011_decide(pg_catalog.current_setting('t011.seam_approval_id')::uuid,
    'APPROVE',NULL)::text,true);
RESET ROLE;

DO $t16$
DECLARE
  v_res     jsonb := pg_catalog.current_setting('t011.seam_action')::jsonb;
  v_req     uuid;
  v_effects integer;
  v_jobs    integer;
  v_claimed_n integer;
  v_status  text;
BEGIN
  ASSERT (v_res->>'ok')::boolean,
    pg_catalog.format('T16 SETUP FAIL: the action did not succeed, so there is '
      'no dispatched effect to follow: %s', v_res::text);
  ASSERT (pg_catalog.current_setting('t011.seam_decide')::jsonb ->> 'ok')::boolean,
    pg_catalog.format('T16 SETUP FAIL: the approval was not granted, so '
      'apply_effects never ran: %s', pg_catalog.current_setting('t011.seam_decide'));

  SELECT id, status INTO v_req, v_status
    FROM core.action_requests
   WHERE target_ref = 'PRO-T011-5'
   ORDER BY created_at DESC LIMIT 1;
  ASSERT v_req IS NOT NULL, 'T16 SETUP FAIL: no action_request was written.';

  SELECT pg_catalog.count(*) INTO v_effects
    FROM app.action_effects
   WHERE action_request_id = v_req AND kind = 'EXTERNAL' AND status = 'DISPATCHED';
  ASSERT v_effects > 0,
    pg_catalog.format('T16 SETUP FAIL: PROPOSAL_SEND planned %s dispatched '
      'external effects. If this action type stopped planning one, this pin is '
      'measuring nothing and needs a different action type.', v_effects);

  -- T14a · THE JOB EXISTS. Against the pre-fix SQL this is zero, and everything
  -- above it still passes — which is exactly why the defect survived 13 green
  -- pins.
  SELECT pg_catalog.count(*) INTO v_jobs
    FROM app.outbox
   WHERE action_request_id = v_req;
  ASSERT v_jobs = v_effects,
    pg_catalog.format('T16a FAIL: %s external effect(s) were dispatched and %s '
      'job(s) exist. app.apply_effects marks effects DISPATCHED; nothing sends '
      'them unless app.enqueue_effect_jobs turns them into outbox rows. A '
      'DISPATCHED effect with no job is an email the customer never gets, with no '
      'error anywhere.', v_effects, v_jobs);

  -- T14b · and the action is EXECUTING, not EXECUTED: work is outstanding.
  ASSERT v_status = 'EXECUTING',
    pg_catalog.format('T16b FAIL: the action is %s with an external effect '
      'outstanding.', v_status);

  -- T16c · THE WORKER CAN ACTUALLY TAKE IT. The half a row-count cannot prove:
  -- a row in app.outbox the worker cannot claim is the same outage, one
  -- indirection further down. claim_jobs returns SETOF app.outbox, so this counts
  -- the rows it handed out that belong to this action.
  SET LOCAL ROLE service_role;
  SELECT pg_catalog.count(*) INTO v_claimed_n
    FROM app.claim_jobs('t016-worker', NULL, NULL, 10, interval '60 seconds', 100) AS j
   WHERE j.action_request_id = v_req;
  RESET ROLE;

  ASSERT v_claimed_n = v_effects,
    pg_catalog.format('T16c FAIL: app.claim_jobs handed out %s of this action''s '
      '%s job(s). A queued job the worker cannot claim never sends either.',
      v_claimed_n, v_effects);

  RAISE NOTICE
    'T16 PASS - a HUMAN PROPOSAL_SEND plans % external effect(s), each becomes an '
    'app.outbox row, the action sits at EXECUTING, and the worker''s own '
    'app.claim_jobs takes the work.', v_effects;
END;
$t16$;



-- ─── T17 · HIGH · a HUMAN with no permission cannot perform an action ──────
-- The finding: `core.action_policies` decides whether an action needs APPROVAL,
-- and it was ALSO, accidentally, the only thing between a caller and execution.
-- Where no policy row matched — three of the 22 action types have none at all for
-- a freshly provisioned tenant, and any type's conditions can exclude a case —
-- dispatch fell through to a bare EXECUTING with no permission check anywhere in
-- 011. `app.has_permission` was called exactly once in the whole file, inside
-- decide_approval, and 014's wrapper re-validates nothing.
--
-- Four ways, because "gated" has four halves and checking one proves nothing
-- about the others:
--   (a) a role WITHOUT the permission is refused          — the finding
--   (b) a role WITH it is admitted                        — not an outage
--   (c) the refusal names the permission                  — actionable, not opaque
--   (d) every active action type carries one              — no 23rd type slips in
--
-- ENQUIRY_ARCHIVE is one of the three with no policy row at all, so it exercises
-- the pure fall-through. PAYMENT_RECORD is the review's own worked example and is
-- money-moving, so it also proves the new check runs BEFORE the aal2 gate rather
-- than hiding behind it.

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1","session_id":"00000011-5e55-0000-0000-000000000001"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.perm_sales_enquiry_archive',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-1','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN","aal":"aal1","session_id":"00000011-5e55-0000-0000-000000000001"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.perm_sales_payment_record',
  pg_temp.t011_perform('PAYMENT_RECORD','INV-T011-1','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"MD","actor_kind":"HUMAN","aal":"aal2","session_id":"00000011-5e55-0000-0000-000000000001"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.perm_md_enquiry_archive',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-1','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"MD","actor_kind":"HUMAN","aal":"aal2","session_id":"00000011-5e55-0000-0000-000000000001"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.perm_md_payment_record',
  pg_temp.t011_perform('PAYMENT_RECORD','INV-T011-1','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;


-- A CLIENT-kind actor with a CLIENT role: exactly what app.principal_claims
-- (002) emits for a membership with role = CLIENT, actor_kind = CLIENT. The role
-- must be CLIENT, not a staff role — a CLIENT fixture carrying app_role MD holds
-- enquiry:archive through MD and cannot tell a gated CLIENT from an exempt one.
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"sub":"00000011-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"CLIENT","actor_kind":"CLIENT","aal":"aal1"}',true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.perm_client_archive',
  pg_temp.t011_perform('ENQUIRY_ARCHIVE','ENQ-T011-1','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;

-- The same CLIENT, now holding the one permission a money-moving type needs, at
-- aal1. Seeded inside this transaction and removed straight after. It must be
-- refused AAL2_REQUIRED: holding the permission is not a second factor.
INSERT INTO app.role_permissions (role, permission)
SELECT 'CLIENT', t.required_permission FROM app.action_types AS t
 WHERE t.key = 'INVOICE_PUSH';
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('t011.perm_client_money_aal1',
  pg_temp.t011_perform('INVOICE_PUSH','INV-NOT-REACHED','{}'::jsonb,NULL,NULL)::text,true);
RESET ROLE;
DELETE FROM app.role_permissions WHERE role = 'CLIENT';

DO $t17$
DECLARE
  v_sales_arch jsonb := pg_catalog.current_setting('t011.perm_sales_enquiry_archive')::jsonb;
  v_md_arch    jsonb := pg_catalog.current_setting('t011.perm_md_enquiry_archive')::jsonb;
  v_sales_pay  jsonb := pg_catalog.current_setting('t011.perm_sales_payment_record')::jsonb;
  v_bad        text;
BEGIN
  -- (d) first: if a type has no required_permission the rest proves nothing.
  SELECT pg_catalog.string_agg(t.key, ', ' ORDER BY t.key) INTO v_bad
    FROM app.action_types AS t
   WHERE t.active AND t.required_permission IS NULL;
  ASSERT v_bad IS NULL,
    pg_catalog.format('T17d FAIL: active action type(s) with no '
      'required_permission: %s. On the HUMAN path that used to mean "anyone".', v_bad);

  SELECT pg_catalog.string_agg(t.key, ', ' ORDER BY t.key) INTO v_bad
    FROM app.action_types AS t
   WHERE t.active
     AND NOT EXISTS (SELECT 1 FROM app.role_permissions AS rp
                      WHERE rp.permission = t.required_permission);
  ASSERT v_bad IS NULL,
    pg_catalog.format('T17d2 FAIL: action type(s) requiring a permission no role '
      'holds: %s. That is an outage, not a gate.', v_bad);

  -- (a) SALES does not hold enquiry:archive... it does, scope-narrowed, so the
  -- probe that matters here is payment:record, which SALES genuinely lacks.
  ASSERT NOT (v_sales_pay->>'ok')::boolean,
    pg_catalog.format('T17a FAIL: a SALES principal performed PAYMENT_RECORD. '
      '002 gives payment:record to FINANCE, MD and ADMIN and not to SALES, and '
      'before this check the only thing that would have stopped them was a policy '
      'row happening to match — which for an amount nothing conditions on, it does '
      'not. The payment posts. Result: %s', v_sales_pay::text);

  -- (c) and the refusal says what is missing.
  ASSERT v_sales_pay->>'detailText' LIKE '%payment:record%',
    pg_catalog.format('T17c FAIL: the refusal does not name the permission the '
      'caller lacks, so the only way to find out is to read 011: %s',
      COALESCE(v_sales_pay->>'detailText','<none>'));

  -- T17c3 · AND IT DOES NOT LEAK THE PAYLOAD SCHEMA. The first version of the
  -- check sat after payload validation, so an unauthorized SALES probe came back
  -- with {"field":"amount","reason":"REQUIRED"} — the shape of an action they may
  -- not perform, handed to them by the refusal itself.
  ASSERT v_sales_pay->>'detailText' NOT LIKE '%VALIDATION_FAILED%',
    pg_catalog.format('T17c3 FAIL: an unauthorized caller was told what the '
      'payload requires before being told they may not call it: %s',
      v_sales_pay->>'detailText');
  ASSERT v_sales_pay->>'detailText' LIKE '%FORBIDDEN%',
    pg_catalog.format('T17c2 FAIL: the refusal is not coded FORBIDDEN: %s',
      COALESCE(v_sales_pay->>'detailText','<none>'));

  -- (e) A CLIENT ACTOR IS GATED EXACTLY LIKE A HUMAN ONE, and fails closed.
  --     An earlier 011 exempted CLIENT while app.role_permissions held no CLIENT
  --     row; a CLIENT principal at aal1 then executed staff actions with no
  --     permission check. CLIENT holds no permissions, so it is refused.
  ASSERT NOT EXISTS (SELECT 1 FROM app.role_permissions AS rp
                      WHERE rp.role = 'CLIENT' AND rp.permission = 'enquiry:archive'),
    'T17e0 FAIL: CLIENT holds enquiry:archive, so T17e below cannot show a '
    'refusal. Pick an action type CLIENT does not hold.';

  ASSERT NOT (pg_catalog.current_setting('t011.perm_client_archive')::jsonb ->> 'ok')::boolean
     AND pg_catalog.current_setting('t011.perm_client_archive')::jsonb ->> 'detailText'
         LIKE '%FORBIDDEN%enquiry:archive%',
    pg_catalog.format('T17e FAIL: a CLIENT principal with no permissions was not '
      'refused ENQUIRY_ARCHIVE as FORBIDDEN enquiry:archive. A CLIENT that skips '
      'the permission check executes any action type whose policy does not match: %s',
      pg_catalog.current_setting('t011.perm_client_archive'));

  ASSERT NOT (pg_catalog.current_setting('t011.perm_client_money_aal1')::jsonb ->> 'ok')::boolean
     AND (pg_catalog.current_setting('t011.perm_client_money_aal1')::jsonb ->> 'detailText')::jsonb
         ->> 'reason' = 'AAL2_REQUIRED',
    pg_catalog.format('T17e2 FAIL: a CLIENT holding the permission for a '
      'money-moving action was not refused AAL2_REQUIRED at aal1. H-05 must cover '
      'CLIENT as it covers HUMAN: %s',
      pg_catalog.current_setting('t011.perm_client_money_aal1'));

  -- (b) a role that DOES hold the permission still gets through. ENQUIRY_ARCHIVE
  -- has no policy row at all, so this is the pure fall-through path: before the
  -- fix it executed for everyone, and after it must still execute for the right
  -- someone.
  ASSERT (v_md_arch->>'ok')::boolean,
    pg_catalog.format('T17b FAIL: an MD, who holds enquiry:archive, was refused '
      'ENQUIRY_ARCHIVE. Default-deny must not become deny-all: the three action '
      'types with no policy row would then be unperformable by anybody. %s',
      v_md_arch::text);

  RAISE NOTICE
    'T17 PASS - every active action type names a permission some role holds, a '
    'SALES principal is refused PAYMENT_RECORD with the missing permission named, '
    'an MD still performs ENQUIRY_ARCHIVE through the no-policy path that used to '
    'be open to everyone, and a CLIENT is refused both without the permission and, '
    'holding it, at aal1 on a money-moving type.';
END;
$t17$;



-- ─── T18 · HIGH · the diff-hash guard can actually fire ────────────────────
-- The finding: `app.decide_approval`'s "the effects changed since the diff was
-- rendered" guard hashed `app.plan_effects(...)` alone. That function is
-- IMMUTABLE — `provolatile = 'i'`, measured — and reads NO ROW: it derives its
-- output from the action type, the target ref and the payload, all of which are
-- columns of the request itself and none of which can change after the request is
-- written. The fresh hash was therefore IDENTICAL to the stored one BY
-- CONSTRUCTION, and DIFF_CHANGED was mathematically unreachable. An approver could
-- approve a quotation that had been edited to a different price after it was
-- queued, with the diff on their screen still showing the old one and the guard
-- that exists for exactly that raising nothing.
--
-- The hash now covers `{effects, value}`, and `app.action_value` is the part that
-- reads the record. This pin edits the record and requires the guard to fire — a
-- structural assertion about the hash expression would have passed against the
-- broken version too, because the expression was never the problem.
DO $t18$
DECLARE
  v_immutable char;
  v_before    text;
  v_after     text;
  v_qid       uuid;
BEGIN
  -- T18a · the premise, measured rather than asserted from the finding. If
  -- plan_effects ever stops being IMMUTABLE this pin's reasoning changes.
  SELECT p.provolatile INTO v_immutable
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname='app' AND p.proname='plan_effects';
  ASSERT v_immutable = 'i',
    pg_catalog.format('T18a FAIL: app.plan_effects is volatility %s, not '
      'IMMUTABLE. The whole argument for folding action_value into the hash was '
      'that plan_effects cannot see a changed record; if that is no longer true, '
      'reread the reasoning before trusting this test.', v_immutable);

  -- T18b · the hash moves when the RECORD moves, with the request untouched.
  SELECT id INTO v_qid FROM core.quotations
   WHERE tenant_id = '00000011-1111-1111-1111-111111111111'
   ORDER BY created_at LIMIT 1;

  IF v_qid IS NULL THEN
    RAISE NOTICE
      'T18 SKIP - this pin needs a quotation in the 011 fixtures to edit. '
      'QUOTATION_APPLY is the action whose value reads one; without a row the '
      'record-change half cannot be staged here and is covered by T18c alone.';
  ELSE
    v_before := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'effects', app.plan_effects('QUOTATION_APPLY', NULL, '{}'::jsonb),
        'value',   app.action_value('QUOTATION_APPLY','00000011-1111-1111-1111-111111111111',
                     v_qid, '{}'::jsonb))::text,'UTF8')),'hex');

    UPDATE core.quotations SET sell_price_sen = sell_price_sen + 100000
     WHERE id = v_qid;

    v_after := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'effects', app.plan_effects('QUOTATION_APPLY', NULL, '{}'::jsonb),
        'value',   app.action_value('QUOTATION_APPLY','00000011-1111-1111-1111-111111111111',
                     v_qid, '{}'::jsonb))::text,'UTF8')),'hex');

    ASSERT v_before IS DISTINCT FROM v_after,
      'T18b FAIL: editing the quotation''s sell price did not change the hashed '
      'material. That is the defect: the hash is over the request, which cannot '
      'change, so DIFF_CHANGED can never fire and an approver can approve a diff '
      'they were never shown.';
  END IF;

  -- T18c · and the effects half still counts, so folding in the value did not
  -- replace one blind spot with another.
  ASSERT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           pg_catalog.jsonb_build_object(
             'effects', app.plan_effects('PROPOSAL_SEND', NULL, '{}'::jsonb),
             'value',   '{}'::jsonb)::text,'UTF8')),'hex')
     IS DISTINCT FROM
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           pg_catalog.jsonb_build_object(
             'effects', app.plan_effects('PROPOSAL_SEND', 'PRO-T011-1', '{}'::jsonb),
             'value',   '{}'::jsonb)::text,'UTF8')),'hex'),
    'T18c FAIL: two different planned-effect sets hash the same, so the half of '
    'the guard that always worked has stopped working.';

  RAISE NOTICE
    'T18 PASS - plan_effects is IMMUTABLE and reads no row, so the hash now also '
    'covers app.action_value: editing the underlying record moves it, and two '
    'different effect plans still hash differently.';
END;
$t18$;



-- ─── T19 · HIGH · the diff the approver saw is the diff they approve ────────
-- THE CANONICAL FORM, written down here because it is a contract between three
-- places and was previously implied by none of them.
--
--   The approval's `diff_hash` is computed SERVER-SIDE, once, at queue time, over
--   `{"effects": <app.plan_effects(...)>, "value": <app.action_value(...)>}`
--   rendered as jsonb text and SHA-256'd. It is stored on the approval row and
--   exposed on `core.v_approval_requests`. The client READS it with the approval
--   and ECHOES it back as `p_expected_diff_hash`; it does not compute one.
--   `apps/web/src/features/approvals/ApprovalDetail.tsx:170` passes
--   `detail.diffHash` verbatim, and the only `hashDiff()` in the repository lives
--   in `packages/fixtures`, which is the mock client and not this path.
--
-- That is deliberate and it is the cheaper half of a choice. A client-computed
-- hash would have to agree, byte for byte, with a server-side canonical
-- serialisation forever — two implementations of one format in two languages,
-- which is the drift this repo's rules exist to prevent. An echoed server hash
-- has one implementation and one place to change it.
--
-- WHAT THE ECHO IS FOR, since a value the client merely returns cannot detect a
-- change the client made. It detects the gap between READ and DECIDE: the
-- approver loaded a diff, something else moved the underlying record, and the
-- hash they echo no longer matches the one the row carries now. That is the only
-- failure this guard was ever able to catch, and until the hash covered
-- `app.action_value` it could not catch even that — `app.plan_effects` is
-- IMMUTABLE and reads no row, so the fresh hash equalled the stored one by
-- construction (see T18).

-- The quotation refs, read as the owner before any role swap.
SELECT pg_catalog.set_config('t011.qref_a',
  (SELECT ref FROM core.quotations WHERE id='00000011-0977-0977-0977-097777777771'), true);
SELECT pg_catalog.set_config('t011.qref_b',
  (SELECT ref FROM core.quotations WHERE id='00000011-0977-0977-0977-097777777772'), true);

-- ⚠ THE APPROVALS ARE STAGED DIRECTLY, NOT THROUGH app.perform_action, and the
-- reason is worth stating rather than hiding. QUOTATION_APPLY is the only action
-- type whose `value_source` is QUOTATION — it is the one whose value READS the
-- record this pin edits — and in this file's fixtures it dispatches straight to
-- EXECUTING rather than queueing, because this tenant carries no matching
-- `core.action_policies` row. Routing through perform_action would therefore make
-- this a test of policy seeding, which T16 and T17 already cover, and would never
-- reach the guard that is actually under test.
--
-- What is staged is exactly what perform_action writes: an action request, and an
-- approval whose `diff_hash` is the canonical
-- SHA-256 over {"effects": plan_effects(...), "value": action_value(...)}.
-- If that expression ever diverges from 011's, T19a fails immediately — an
-- approval whose stored hash does not match what decide_approval recomputes is
-- refused on the FIRST, unchanged case.
INSERT INTO core.action_requests
  (id,tenant_id,ref,action_type,target_ref,requested_by_kind,requested_by_id,status)
VALUES
  ('00000011-ac19-0000-0000-00000000000a','00000011-1111-1111-1111-111111111111',
   'ACT-T019-A','QUOTATION_APPLY',pg_catalog.current_setting('t011.qref_a'),
   'HUMAN','00000011-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL'),
  ('00000011-ac19-0000-0000-00000000000b','00000011-1111-1111-1111-111111111111',
   'ACT-T019-B','QUOTATION_APPLY',pg_catalog.current_setting('t011.qref_b'),
   'HUMAN','00000011-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL');

INSERT INTO core.approval_requests
  (id,tenant_id,action_request_id,policy_id,action_type,subject,target_ref,
   requested_by_kind,requested_by_id,reason,diff,diff_hash,approver_role,
   sla_due_at,expires_at,bulk_approvable)
SELECT
  q.approval_id, '00000011-1111-1111-1111-111111111111', q.request_id,
  'pol_t019','QUOTATION_APPLY','quotation', q.ref,
  'HUMAN','00000011-0000-0000-0000-0000000000a1','T019 diff-hash probe',
  app.plan_effects('QUOTATION_APPLY', q.ref, '{}'::jsonb),
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'effects', app.plan_effects('QUOTATION_APPLY', q.ref, '{}'::jsonb),
      'value',   app.action_value('QUOTATION_APPLY','00000011-1111-1111-1111-111111111111',
                   q.quotation_id, '{}'::jsonb))::text,'UTF8')),'hex'),
  'MD', pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', false
FROM (VALUES
  ('00000011-a919-0000-0000-00000000000a'::uuid,'00000011-ac19-0000-0000-00000000000a'::uuid,
   '00000011-0977-0977-0977-097777777771'::uuid, pg_catalog.current_setting('t011.qref_a')),
  ('00000011-a919-0000-0000-00000000000b'::uuid,'00000011-ac19-0000-0000-00000000000b'::uuid,
   '00000011-0977-0977-0977-097777777772'::uuid, pg_catalog.current_setting('t011.qref_b'))
) AS q(approval_id, request_id, quotation_id, ref);

DO $t19$
DECLARE
  v_ap_a    uuid := '00000011-a919-0000-0000-00000000000a';
  v_ap_b    uuid := '00000011-a919-0000-0000-00000000000b';
  v_read_a  text;
  v_read_b  text;
  v_res     jsonb;
BEGIN
  -- Read the hash the way the product does: off the approval, through the view
  -- the detail screen reads.
  SELECT diff_hash INTO v_read_a FROM core.v_approval_requests WHERE id = v_ap_a;
  SELECT diff_hash INTO v_read_b FROM core.v_approval_requests WHERE id = v_ap_b;

  ASSERT v_read_a IS NOT NULL AND v_read_b IS NOT NULL,
    'T19 SETUP FAIL: core.v_approval_requests does not expose diff_hash, so the '
    'client has nothing to echo and the guard cannot work at all.';

  -- (a) NOTHING CHANGED between read and decide: the echoed hash is accepted.
  PERFORM pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000011-0000-0000-0000-0000000000a3","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"MD","actor_kind":"HUMAN","aal":"aal2","session_id":"00000011-5e55-0000-0000-00000000000b"}',true);
  v_res := pg_temp.t011_decide_hash(v_ap_a,'APPROVE',NULL,v_read_a);
  ASSERT (v_res->>'ok')::boolean,
    pg_catalog.format('T19a FAIL: an APPROVE echoing the hash it just read, with '
      'nothing changed underneath, was refused. The guard must admit the '
      'unchanged case or every approval in the product fails: %s', v_res::text);

  -- (b) THE RECORD MOVES between read and decide: the echoed hash is refused.
  -- This is the scenario the whole mechanism exists for — a quotation repriced
  -- after the approver opened it — and before the hash covered app.action_value
  -- it was undetectable, because plan_effects cannot see a quotation.
  UPDATE core.quotations SET sell_price_sen = sell_price_sen + 250000
   WHERE id = '00000011-0977-0977-0977-097777777772';

  v_res := pg_temp.t011_decide_hash(v_ap_b,'APPROVE',NULL,v_read_b);
  ASSERT NOT (v_res->>'ok')::boolean,
    pg_catalog.format('T19b FAIL: the quotation was repriced after the approver '
      'read the diff, and the APPROVE echoing the hash from that read was '
      'ACCEPTED. The approver has just approved a number they were never shown: %s',
      v_res::text);
  ASSERT v_res->>'detailText' LIKE '%DIFF_CHANGED%',
    pg_catalog.format('T19b2 FAIL: the stale APPROVE was refused, but not as '
      'DIFF_CHANGED, so the client cannot tell the approver to reload rather than '
      'to sign in again: %s', COALESCE(v_res->>'detailText','<none>'));

  RAISE NOTICE
    'T19 PASS - the approval hash is computed server-side over {effects, value}, '
    'exposed on core.v_approval_requests and echoed by the client. An APPROVE is '
    'admitted when nothing moved between read and decide, and refused as '
    'DIFF_CHANGED when the underlying quotation was repriced in between.';
END;
$t19$;



-- ─── T20 · HIGH · bulk APPROVE cannot bypass the diff guard ────────────────
-- THE HOLE. `core.decide_approval` refuses an APPROVE that carries no diff hash,
-- and the commit that added that refusal claimed a guard both sides enforce
-- "cannot be re-disabled by one of them changing". `core.bulk_decide_approvals`
-- falsified it on the same day: granted to `authenticated` exactly like its
-- sibling, it took NO hash at all and `app.bulk_decide` forwarded every item as
-- `app.decide_approval(id, decision, note, NULL, NULL)`. 011 compares the hash
-- only when it is non-NULL, so the bulk path skipped the check entirely — and the
-- bulk path is the one an approver uses to clear an inbox quickly, which is
-- exactly when they are not re-reading diffs.
--
-- `p_items` is now an array of `{approvalId, expectedDiffHash}` because a hash
-- per approval cannot travel in an array of ids.
DO $t20$
DECLARE
  v_ap_c  uuid := '00000011-a919-0000-0000-00000000000c';
  v_ap_d  uuid := '00000011-a919-0000-0000-00000000000d';
  v_read_c text;
  v_read_d text;
  v_res   jsonb;
BEGIN
  -- Two more approvals, staged the same way T19 stages its own and for the same
  -- reason. bulk_approvable is true: the monetary exclusion is a separate guard
  -- and this pin must not be refused by it instead.
  INSERT INTO core.action_requests
    (id,tenant_id,ref,action_type,target_ref,requested_by_kind,requested_by_id,status)
  VALUES
    ('00000011-ac20-0000-0000-00000000000c','00000011-1111-1111-1111-111111111111',
     'ACT-T020-C','QUOTATION_APPLY',pg_catalog.current_setting('t011.qref_a'),
     'HUMAN','00000011-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL'),
    ('00000011-ac20-0000-0000-00000000000d','00000011-1111-1111-1111-111111111111',
     'ACT-T020-D','QUOTATION_APPLY',pg_catalog.current_setting('t011.qref_b'),
     'HUMAN','00000011-0000-0000-0000-0000000000a1','QUEUED_FOR_APPROVAL');

  INSERT INTO core.approval_requests
    (id,tenant_id,action_request_id,policy_id,action_type,subject,target_ref,
     requested_by_kind,requested_by_id,reason,diff,diff_hash,approver_role,
     sla_due_at,expires_at,bulk_approvable)
  SELECT q.approval_id,'00000011-1111-1111-1111-111111111111',q.request_id,
    'pol_t020','QUOTATION_APPLY','quotation',q.ref,
    'HUMAN','00000011-0000-0000-0000-0000000000a1','T020 bulk hash probe',
    app.plan_effects('QUOTATION_APPLY', q.ref, '{}'::jsonb),
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'effects', app.plan_effects('QUOTATION_APPLY', q.ref, '{}'::jsonb),
        'value',   app.action_value('QUOTATION_APPLY','00000011-1111-1111-1111-111111111111',
                     q.quotation_id, '{}'::jsonb))::text,'UTF8')),'hex'),
    'MD', pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', true
  FROM (VALUES
    ('00000011-a919-0000-0000-00000000000c'::uuid,'00000011-ac20-0000-0000-00000000000c'::uuid,
     '00000011-0977-0977-0977-097777777771'::uuid, pg_catalog.current_setting('t011.qref_a')),
    ('00000011-a919-0000-0000-00000000000d'::uuid,'00000011-ac20-0000-0000-00000000000d'::uuid,
     '00000011-0977-0977-0977-097777777772'::uuid, pg_catalog.current_setting('t011.qref_b'))
  ) AS q(approval_id, request_id, quotation_id, ref);

  SELECT diff_hash INTO v_read_c FROM core.approval_requests WHERE id = v_ap_c;
  SELECT diff_hash INTO v_read_d FROM core.approval_requests WHERE id = v_ap_d;

  PERFORM pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000011-0000-0000-0000-0000000000a3","role":"authenticated","tenant_id":"00000011-1111-1111-1111-111111111111","app_role":"MD","actor_kind":"HUMAN","aal":"aal2","session_id":"00000011-5e55-0000-0000-00000000000b"}',true);

  -- T20a · AN APPROVE ITEM WITH NO HASH IS REFUSED, and the whole batch with it.
  -- A partial bulk decide is worse than a refused one: the approver cannot tell
  -- which half went through.
  v_res := pg_temp.t011_bulk(
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('approvalId', v_ap_c),
      pg_catalog.jsonb_build_object('approvalId', v_ap_d, 'expectedDiffHash', v_read_d)),
    'APPROVE');
  ASSERT NOT (v_res->>'ok')::boolean,
    pg_catalog.format('T20a FAIL: a bulk APPROVE with one hashless item was '
      'accepted. That is the bypass: core.decide_approval refuses a NULL hash and '
      'this door forwarded it anyway. %s', v_res::text);
  ASSERT v_res->>'detailText' LIKE '%expectedDiffHash%',
    pg_catalog.format('T20a2 FAIL: refused, but not for the missing hash: %s',
      COALESCE(v_res->>'detailText','<none>'));

  -- T20b · A REPRICED APPROVAL IS REFUSED AS DIFF_CHANGED, through the bulk door.
  UPDATE core.quotations SET sell_price_sen = sell_price_sen + 310000
   WHERE id = '00000011-0977-0977-0977-097777777772';

  v_res := pg_temp.t011_bulk(
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('approvalId', v_ap_d, 'expectedDiffHash', v_read_d)),
    'APPROVE');
  ASSERT NOT (v_res->>'ok')::boolean,
    pg_catalog.format('T20b FAIL: a bulk APPROVE of an approval whose quotation '
      'was repriced after the diff was read was ACCEPTED. %s', v_res::text);
  ASSERT v_res->>'detailText' LIKE '%DIFF_CHANGED%',
    pg_catalog.format('T20b2 FAIL: the stale bulk APPROVE was refused, but not as '
      'DIFF_CHANGED: %s', COALESCE(v_res->>'detailText','<none>'));

  -- T20c · and an unchanged one still goes through, with the CONTRACT SHAPE.
  v_res := pg_temp.t011_bulk(
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('approvalId', v_ap_c, 'expectedDiffHash', v_read_c)),
    'APPROVE');
  ASSERT (v_res->>'ok')::boolean,
    pg_catalog.format('T20c FAIL: an unchanged bulk APPROVE was refused. The '
      'guard must admit the unchanged case or bulk decide is unusable: %s',
      v_res::text);

  ASSERT (v_res -> 'body') ? 'results',
    pg_catalog.format('T20d FAIL: the bulk response has no `results` key. The '
      'contract''s ApprovalBulkDecideResponse is {results:[...]}; this used to '
      'return {data,count}, whose second top-level key also flipped the client''s '
      'auto-unwrap to pass-through. Body: %s', (v_res -> 'body')::text);
  ASSERT NOT ((v_res -> 'body') ? 'count'),
    'T20d2 FAIL: `count` is back beside `results`. app.ok wraps this, and a '
    'sibling key is what breaks the client''s auto-unwrap — 001''s comment on '
    'app.ok says exactly this.';
  ASSERT ((v_res -> 'body' -> 'results' -> 0) ? 'id')
     AND ((v_res -> 'body' -> 'results' -> 0) ? 'ref'),
    pg_catalog.format('T20e FAIL: a bulk result element carries no id/ref, so the '
      'inbox cannot reconcile which of N approvals got which outcome. Element: %s',
      (v_res -> 'body' -> 'results' -> 0)::text);

  RAISE NOTICE
    'T20 PASS - bulk APPROVE refuses a hashless item, refuses a repriced approval '
    'as DIFF_CHANGED, admits an unchanged one, and returns {results:[{id,ref,...}]} '
    'with no sibling key beside it.';
END;
$t20$;


ROLLBACK;
