-- ═══════════════════════════════════════════════════════════════════════════
-- test_020 · The API read surface
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001–020. Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_020_api_read_surface.sql
--
-- EXECUTED before commit on a PostgreSQL 17 shim built hosted-like: every
-- migration applied as a NOSUPERUSER BYPASSRLS role (hosted `postgres`), with
-- Supabase's 27 default-ACL rows. The pin itself runs as that same role.
--
-- IMPERSONATION IS REAL. Every RPC and view probe runs as `authenticated`
-- (`SET LOCAL ROLE`) with a JWT claim set for a real `auth.users` row, is ONE
-- STATEMENT, and parks its result in a transaction-local GUC. Assertions run
-- after `RESET ROLE`. `authenticated` is NOBYPASSRLS, so the view reads below
-- are filtered by 014's policies exactly as they are for a browser. The
-- migration role, by contrast, bypasses RLS on hosted, which is why a view read
-- as that role proves nothing.
--
-- T1  Approvals: a SALES `PROPOSAL_SEND` queues; the SALES_MANAGER's list row
--     and detail both carry `diffHash`, equal to the stored hash.
-- T2  The approve path end to end, as the web sends it: the approval UUID plus
--     the `diffHash` it just read. APPROVED, the proposal is SENT. A stale hash
--     is refused DIFF_CHANGED, and an APPROVE with no hash VALIDATION_FAILED.
-- T3  Authorization: a CLIENT principal is FORBIDDEN from list, detail and audit, with
--     the same answer for a real id and a made-up one.
-- T4  Another tenant's MD sees zero approvals, NOT_FOUND on the id, an empty
--     audit trail.
-- T5  The audit drawer answers `approvals::{ref}` with the events correlated
--     to the approval's action request, `proposals::{ref}` with the proposal's,
--     and the UPPER_SNAKE spelling still works.
-- T6  anon can call none of it.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers ────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal1')::text;
$fn$;

-- Runs one SQL statement and returns its jsonb value, or the error it raised.
-- SECURITY INVOKER, so it runs as whoever calls it: `authenticated` below.
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
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('a20.' || p_key)::jsonb; $fn$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Real auth.users rows: memberships and user_profiles FK to them, and every
-- probe's `sub` is one of them. The tenant INSERTs provision ref formats (016),
-- action policies (011/016) and pipelines (019) through their own triggers.

INSERT INTO auth.users (id, email) VALUES
  ('a0200000-0000-4000-8000-0000000000a1','sales@a20.test'),
  ('a0200000-0000-4000-8000-0000000000a2','sm@a20.test'),
  ('a0200000-0000-4000-8000-0000000000a3','md@a20.test'),
  ('a0200000-0000-4000-8000-0000000000a4','ops@a20.test'),
  ('a0200000-0000-4000-8000-0000000000a5','client@a20.test'),
  ('a0200000-0000-4000-8000-0000000000b1','md@b20.test');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('a0200000-1111-4000-8000-000000000001','a20-akademi','Akademi Perdana A20','ACTIVE','Asia/Kuala_Lumpur','en-MY'),
  ('a0200000-1111-4000-8000-000000000002','a20-other','Other Tenant A20','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0200000-1111-4000-8000-000000000001','a0200000-0000-4000-8000-0000000000a1','SALES','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0200000-1111-4000-8000-000000000001','a0200000-0000-4000-8000-0000000000a2','SALES_MANAGER','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0200000-1111-4000-8000-000000000001','a0200000-0000-4000-8000-0000000000a3','MD','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0200000-1111-4000-8000-000000000001','a0200000-0000-4000-8000-0000000000a4','OPS','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0200000-1111-4000-8000-000000000002','a0200000-0000-4000-8000-0000000000b1','MD','HUMAN','ALL','ALL',false,'ACTIVE',true);

INSERT INTO core.organisations
  (id,tenant_id,name,industry,location,owner_id,status,hrdc_registered,hrdc_employer_code,country_code)
VALUES
  ('a0200000-2222-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','Chrome A20',
   'MANUFACTURING','Shah Alam','a0200000-0000-4000-8000-0000000000a1','ACTIVE_CLIENT',true,'E-A20','MYS'),
  ('a0200000-2222-4000-8000-000000000002','a0200000-1111-4000-8000-000000000002','Other Co A20',
   'SERVICES','Penang','a0200000-0000-4000-8000-0000000000b1','PROSPECT',false,NULL,'MYS');

INSERT INTO core.opportunities
  (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen,currency,probability,created_by_kind,created_by_id)
VALUES
  ('a0200000-3333-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','OPP-A20-0001',
   'a0200000-2222-4000-8000-000000000001','a0200000-0000-4000-8000-0000000000a1','NEW',1850000,'MYR',0.400,
   'HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.templates
  (id,tenant_id,template_type,version,label,merge_fields,status,created_by_kind,created_by_id)
VALUES
  ('a0200000-4444-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','PROPOSAL',1,'Standard A20',
   ARRAY['organisation.name'],'ACTIVE','HUMAN','a0200000-0000-4000-8000-0000000000a1');

-- Two proposals: one is approved with the right hash (T2a), the other is the
-- stale-hash and missing-hash probe (T2c, T2d). Both are worth RM18,500, which
-- meets APV-01's `value.amount >= 1500000` condition as provisioned.
INSERT INTO core.proposals
  (id,tenant_id,ref,opportunity_id,organisation_id,template_id,status,value_sen)
VALUES
  ('a0200000-5555-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','PRO-A20-0001',
   'a0200000-3333-4000-8000-000000000001','a0200000-2222-4000-8000-000000000001',
   'a0200000-4444-4000-8000-000000000001','DRAFT',1850000),
  ('a0200000-5555-4000-8000-000000000002','a0200000-1111-4000-8000-000000000001','PRO-A20-0002',
   'a0200000-3333-4000-8000-000000000001','a0200000-2222-4000-8000-000000000001',
   'a0200000-4444-4000-8000-000000000001','DRAFT',1850000);

-- ════════ T1 · Approvals carry diffHash ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a1','a0200000-1111-4000-8000-000000000001','SALES'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t1_queue1',
  pg_temp.try($$SELECT core.perform_action('PROPOSAL_SEND','PRO-A20-0001','{"channel":"EMAIL"}'::jsonb,
                                           NULL,NULL,NULL,NULL,'a20-send-1')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a1','a0200000-1111-4000-8000-000000000001','SALES'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t1_queue2',
  pg_temp.try($$SELECT core.perform_action('PROPOSAL_SEND','PRO-A20-0002','{"channel":"EMAIL"}'::jsonb,
                                           NULL,NULL,NULL,NULL,'a20-send-2')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('a20.apv1_id',
  (SELECT approval.id::text FROM core.approval_requests AS approval WHERE approval.target_ref = 'PRO-A20-0001'), true);
SELECT pg_catalog.set_config('a20.apv2_id',
  (SELECT approval.id::text FROM core.approval_requests AS approval WHERE approval.target_ref = 'PRO-A20-0002'), true);
SELECT pg_catalog.set_config('a20.apv1_ref',
  (SELECT approval.ref FROM core.approval_requests AS approval WHERE approval.target_ref = 'PRO-A20-0001'), true);
SELECT pg_catalog.set_config('a20.apv2_ref',
  (SELECT approval.ref FROM core.approval_requests AS approval WHERE approval.target_ref = 'PRO-A20-0002'), true);

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t1_list',
  pg_temp.try($$SELECT core.list_approvals('[]'::jsonb, NULL, '{"size":50}'::jsonb, NULL)$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t1_detail',
  pg_temp.try(pg_catalog.format($$SELECT core.get_approval(%L)$$, pg_catalog.current_setting('a20.apv1_ref')))::text, true);
RESET ROLE;

DO $t1$
DECLARE
  v_list   jsonb := pg_temp.got('t1_list');
  v_detail jsonb := pg_temp.got('t1_detail');
  v_row    jsonb;
  v_stored text;
BEGIN
  IF pg_temp.got('t1_queue1') #>> '{value,data,status}' IS DISTINCT FROM 'QUEUED_FOR_APPROVAL'
     OR pg_temp.got('t1_queue2') #>> '{value,data,status}' IS DISTINCT FROM 'QUEUED_FOR_APPROVAL' THEN
    RAISE EXCEPTION 'T1 SETUP: PROPOSAL_SEND did not queue for approval: % / %',
      pg_temp.got('t1_queue1'), pg_temp.got('t1_queue2');
  END IF;
  IF v_list -> 'ok' <> 'true'::jsonb OR v_list #> '{value,success}' <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T1a: list_approvals refused the SALES_MANAGER: %', v_list;
  END IF;
  IF (v_list #>> '{value,data,page,total}')::integer <> 2 THEN
    RAISE EXCEPTION 'T1b: expected 2 approvals, got %', v_list #> '{value,data,page}';
  END IF;
  FOR v_row IN SELECT e.value FROM pg_catalog.jsonb_array_elements(v_list #> '{value,data,data}') AS e(value)
  LOOP
    SELECT approval.diff_hash INTO v_stored FROM core.approval_requests AS approval
     WHERE approval.id = (v_row ->> 'id')::uuid;
    IF pg_catalog.jsonb_typeof(v_row -> 'diffHash') IS DISTINCT FROM 'string'
       OR v_row ->> 'diffHash' IS DISTINCT FROM v_stored THEN
      RAISE EXCEPTION 'T1c: list row % has diffHash % but the stored hash is %',
        v_row ->> 'ref', v_row -> 'diffHash', v_stored;
    END IF;
  END LOOP;
  IF v_detail #> '{value,success}' <> 'true'::jsonb THEN
    RAISE EXCEPTION 'T1d: get_approval refused: %', v_detail;
  END IF;
  SELECT approval.diff_hash INTO v_stored FROM core.approval_requests AS approval
   WHERE approval.ref = pg_catalog.current_setting('a20.apv1_ref')
     AND approval.tenant_id = 'a0200000-1111-4000-8000-000000000001';
  IF v_detail #>> '{value,data,diffHash}' IS DISTINCT FROM v_stored THEN
    RAISE EXCEPTION 'T1e: detail diffHash % is not the stored %', v_detail #> '{value,data,diffHash}', v_stored;
  END IF;
  RAISE NOTICE 'T1 PASS: list rows and the detail carry diffHash equal to approval_requests.diff_hash.';
END
$t1$;

-- ════════ T2 · Approve end to end, the way the web sends it ════════


SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t2_approve',
  pg_temp.try(pg_catalog.format(
    $$SELECT core.decide_approval(%L::uuid, 'APPROVE', 'Looks right', %L, 'a20-decide-1')$$,
    pg_catalog.current_setting('a20.apv1_id'),
    (SELECT e.value ->> 'diffHash'
       FROM pg_catalog.jsonb_array_elements(pg_temp.got('t1_list') #> '{value,data,data}') AS e(value)
      WHERE e.value ->> 'id' = pg_catalog.current_setting('a20.apv1_id'))))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t2_stale',
  pg_temp.try(pg_catalog.format(
    $$SELECT core.decide_approval(%L::uuid, 'APPROVE', NULL, %L, 'a20-decide-2')$$,
    pg_catalog.current_setting('a20.apv2_id'), pg_catalog.repeat('0', 64)))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t2_nohash',
  pg_temp.try(pg_catalog.format(
    $$SELECT core.decide_approval(%L::uuid, 'APPROVE', NULL, NULL, 'a20-decide-3')$$,
    pg_catalog.current_setting('a20.apv2_id')))::text, true);
RESET ROLE;

DO $t2$
DECLARE
  v_ok    jsonb := pg_temp.got('t2_approve');
  v_stale jsonb := pg_temp.got('t2_stale');
  v_none  jsonb := pg_temp.got('t2_nohash');
BEGIN
  IF v_ok -> 'ok' <> 'true'::jsonb OR v_ok #>> '{value,data,status}' IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'T2a: APPROVE with the listed diffHash did not succeed: %', v_ok;
  END IF;
  IF (SELECT proposal.status::text FROM core.proposals AS proposal
       WHERE proposal.id = 'a0200000-5555-4000-8000-000000000001') <> 'SENT' THEN
    RAISE EXCEPTION 'T2b: the approved PROPOSAL_SEND did not mark the proposal SENT';
  END IF;
  IF v_stale -> 'ok' <> 'false'::jsonb OR v_stale ->> 'sqlstate' <> 'TRNOS'
     OR (v_stale ->> 'detail')::jsonb ->> 'code' <> 'DIFF_CHANGED'
     OR (v_stale ->> 'detail')::jsonb ->> 'diffHash' IS NULL THEN
    RAISE EXCEPTION 'T2c: a stale hash was not refused DIFF_CHANGED with the fresh hash: %', v_stale;
  END IF;
  IF v_none -> 'ok' <> 'false'::jsonb OR (v_none ->> 'detail')::jsonb ->> 'code' <> 'VALIDATION_FAILED' THEN
    RAISE EXCEPTION 'T2d: an APPROVE with no hash was not refused VALIDATION_FAILED: %', v_none;
  END IF;
  IF (SELECT approval.status::text FROM core.approval_requests AS approval
       WHERE approval.id = pg_catalog.current_setting('a20.apv2_id')::uuid) <> 'PENDING' THEN
    RAISE EXCEPTION 'T2e: a refused decision changed the approval';
  END IF;
  RAISE NOTICE 'T2 PASS: uuid + listed diffHash approves; stale hash DIFF_CHANGED; no hash VALIDATION_FAILED.';
END
$t2$;

-- ════════ T3 · A role without approval:read / audit:read (CLIENT) is FORBIDDEN ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a5','a0200000-1111-4000-8000-000000000001','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t3_list',
  pg_temp.try($$SELECT core.list_approvals('[]'::jsonb, NULL, '{"size":50}'::jsonb, NULL)$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a5','a0200000-1111-4000-8000-000000000001','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t3_real',
  pg_temp.try(pg_catalog.format($$SELECT core.get_approval(%L)$$, pg_catalog.current_setting('a20.apv1_ref')))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a5','a0200000-1111-4000-8000-000000000001','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t3_fake',
  pg_temp.try($$SELECT core.get_approval('APV-2099-9999')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a5','a0200000-1111-4000-8000-000000000001','CLIENT'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t3_audit',
  pg_temp.try(pg_catalog.format($$SELECT core.get_audit('approvals', %L)$$, pg_catalog.current_setting('a20.apv1_ref')))::text, true);
RESET ROLE;

DO $t3$
BEGIN
  IF pg_temp.got('t3_list') #>> '{value,error,code}' IS DISTINCT FROM 'FORBIDDEN'
     OR pg_temp.got('t3_list') #> '{value}' ? 'data' THEN
    RAISE EXCEPTION 'T3a: CLIENT list_approvals was not FORBIDDEN: %', pg_temp.got('t3_list');
  END IF;
  IF pg_temp.got('t3_real') #>> '{value,error,code}' IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T3b: CLIENT get_approval was not FORBIDDEN: %', pg_temp.got('t3_real');
  END IF;
  -- NON-ENUMERABLE: a real ref and an invented one get byte-identical answers.
  IF pg_temp.got('t3_real') <> pg_temp.got('t3_fake') THEN
    RAISE EXCEPTION 'T3c: the refusal differs for a real and a made-up ref: % vs %',
      pg_temp.got('t3_real'), pg_temp.got('t3_fake');
  END IF;
  IF pg_temp.got('t3_audit') #>> '{value,error,code}' IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T3d: CLIENT get_audit was not FORBIDDEN: %', pg_temp.got('t3_audit');
  END IF;
  RAISE NOTICE 'T3 PASS: CLIENT is FORBIDDEN on list, detail and audit, identically for real and fake ids.';
END
$t3$;

-- ════════ T4 · Another tenant sees nothing ════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000b1','a0200000-1111-4000-8000-000000000002','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t4_list',
  pg_temp.try($$SELECT core.list_approvals('[]'::jsonb, NULL, '{"size":50}'::jsonb, NULL)$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000b1','a0200000-1111-4000-8000-000000000002','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t4_detail',
  pg_temp.try(pg_catalog.format($$SELECT core.get_approval(%L)$$,
    pg_catalog.current_setting('a20.apv2_id')))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000b1','a0200000-1111-4000-8000-000000000002','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t4_audit',
  pg_temp.try($$SELECT core.get_audit('proposals','PRO-A20-0001')$$)::text, true);
RESET ROLE;

-- ════════ T5 · The audit drawer, addressed as the client addresses it ════════
--
-- 001–020 emit no event for a decision in-database. The fixture event stands in
-- for the worker's completion write: `app.emit_event`'s action-request overload
-- (012) sets the aggregate to the proposal and correlation_id to the request.

SELECT app.emit_event('a0200000-1111-4000-8000-000000000001'::uuid, 'ProposalSent',
  (SELECT approval.action_request_id FROM core.approval_requests AS approval
    WHERE approval.id = pg_catalog.current_setting('a20.apv1_id')::uuid)) IS NOT NULL AS emitted;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t5_apv',
  pg_temp.try(pg_catalog.format($$SELECT core.get_audit('approvals', %L)$$, pg_catalog.current_setting('a20.apv1_ref')))::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t5_pro',
  pg_temp.try($$SELECT core.get_audit('proposals','PRO-A20-0001')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t5_upper',
  pg_temp.try($$SELECT core.get_audit('PROPOSAL','PRO-A20-0001')$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t5_other_apv',
  pg_temp.try(pg_catalog.format($$SELECT core.get_audit('approvals', %L)$$, pg_catalog.current_setting('a20.apv2_ref')))::text, true);
RESET ROLE;

DO $t45$
BEGIN
  IF (pg_temp.got('t4_list') #>> '{value,data,page,total}')::integer <> 0 THEN
    RAISE EXCEPTION 'T4a: another tenant''s MD listed approvals: %', pg_temp.got('t4_list');
  END IF;
  IF pg_temp.got('t4_detail') #>> '{value,error,code}' IS DISTINCT FROM 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T4b: another tenant''s MD read an approval by id: %', pg_temp.got('t4_detail');
  END IF;
  IF (pg_temp.got('t4_audit') #>> '{value,data,page,total}')::integer <> 0 THEN
    RAISE EXCEPTION 'T4c: another tenant''s MD read an audit trail: %', pg_temp.got('t4_audit');
  END IF;
  RAISE NOTICE 'T4 PASS: another tenant sees zero approvals, NOT_FOUND on the id and an empty trail.';

  IF (pg_temp.got('t5_apv') #>> '{value,data,page,total}')::integer <> 1
     OR pg_temp.got('t5_apv') #>> '{value,data,data,0,event}' <> 'ProposalSent' THEN
    RAISE EXCEPTION 'T5a: approvals::{ref} did not return its correlated event: %', pg_temp.got('t5_apv');
  END IF;
  IF (pg_temp.got('t5_pro') #>> '{value,data,page,total}')::integer <> 1 THEN
    RAISE EXCEPTION 'T5b: proposals::PRO-A20-0001 did not map to PROPOSAL: %', pg_temp.got('t5_pro');
  END IF;
  IF pg_temp.got('t5_upper') #> '{value,data}' <> pg_temp.got('t5_pro') #> '{value,data}' THEN
    RAISE EXCEPTION 'T5c: the UPPER_SNAKE spelling no longer answers the same: %', pg_temp.got('t5_upper');
  END IF;
  IF (pg_temp.got('t5_other_apv') #>> '{value,data,page,total}')::integer <> 0 THEN
    RAISE EXCEPTION 'T5d: an approval with no events borrowed another''s trail: %', pg_temp.got('t5_other_apv');
  END IF;
  RAISE NOTICE 'T5 PASS: approvals:: returns the correlated trail, proposals:: maps to PROPOSAL, UPPER_SNAKE unchanged.';
END
$t45$;

-- ════════ T6 · anon reaches none of it ════════

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('a20.t6_list',
  pg_temp.try($$SELECT core.list_approvals('[]'::jsonb, NULL, NULL, NULL)$$)::text, true);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('a20.t6_audit',
  pg_temp.try(pg_catalog.format($$SELECT core.get_audit('approvals', %L)$$, pg_catalog.current_setting('a20.apv1_ref')))::text, true);
RESET ROLE;

DO $t6$
BEGIN
  IF pg_temp.got('t6_list') ->> 'sqlstate' IS DISTINCT FROM '42501'
     OR pg_temp.got('t6_audit') ->> 'sqlstate' IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'T6: anon was not refused 42501: % / %', pg_temp.got('t6_list'), pg_temp.got('t6_audit');
  END IF;
  RAISE NOTICE 'T6 PASS: anon is refused at the privilege layer.';
END
$t6$;

ROLLBACK;
