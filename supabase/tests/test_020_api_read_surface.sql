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
-- T7  Seventeen views read as `authenticated` MD: every one returns rows, each
--     row's keys are exactly the contract's, and the repaired values hold
--     (inline money, allowedHours windows, activeFallback, effective consent,
--     saved-view count equal to the list total, PRIVATE views hidden).
-- T8  SALES is filtered out of the six views whose 002 permission it lacks and
--     reads the ones it holds.
-- T9  Another tenant's MD sees no tenant-A value through any view.
-- T10 anon is refused every view with 42501.
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

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t1_value',
  pg_temp.try($$SELECT core.list_approvals('[{"field":"value.amount","op":"gte","value":1500000}]'::jsonb,
                                           NULL, '{"size":50}'::jsonb, NULL)$$)::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a2','a0200000-1111-4000-8000-000000000001','SALES_MANAGER'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.t1_value_hi',
  pg_temp.try($$SELECT core.list_approvals('[{"field":"value.amount","op":"gte","value":1850001}]'::jsonb,
                                           NULL, '{"size":50}'::jsonb, NULL)$$)::text, true);
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
  -- The inbox's high-value toggle filters `value.amount` (sen).
  IF (pg_temp.got('t1_value') #>> '{value,data,page,total}')::integer IS DISTINCT FROM 2
     OR (pg_temp.got('t1_value_hi') #>> '{value,data,page,total}')::integer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'T1f: the value.amount filter did not filter: % / %',
      pg_temp.got('t1_value'), pg_temp.got('t1_value_hi');
  END IF;
  RAISE NOTICE 'T1 PASS: list rows and the detail carry diffHash equal to approval_requests.diff_hash; value.amount filters.';
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

-- ════════ P2 fixtures · one row behind every view, in tenant A ════════

INSERT INTO core.contacts (id,tenant_id,organisation_id,name,job_title,email,is_primary,created_by_kind,created_by_id,created_by_name)
VALUES ('a0200000-6666-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001',
        'a0200000-2222-4000-8000-000000000001','Siti A20','HR Director','siti@a20.test',true,
        'HUMAN','a0200000-0000-4000-8000-0000000000a1','Sales A20');

INSERT INTO core.contact_consents (tenant_id,contact_id,channel,granted,recorded_at,purpose,withdrawn_at,created_by_kind,created_by_id)
VALUES ('a0200000-1111-4000-8000-000000000001','a0200000-6666-4000-8000-000000000001','EMAIL',true,
        pg_catalog.now(),'ENQUIRY_RESPONSE',NULL,'HUMAN','a0200000-0000-4000-8000-0000000000a1'),
       ('a0200000-1111-4000-8000-000000000001','a0200000-6666-4000-8000-000000000001','WHATSAPP',true,
        pg_catalog.now(),'ENQUIRY_RESPONSE',pg_catalog.now(),'HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.template_sections (tenant_id,template_id,n,title,ai_enabled,default_body)
VALUES ('a0200000-1111-4000-8000-000000000001','a0200000-4444-4000-8000-000000000001',1,'Understanding',true,'x');

INSERT INTO core.saved_views (id,tenant_id,object,label,filters,columns,is_default,owner_id,visibility,created_by_kind,created_by_id)
VALUES ('a0200000-7777-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','APPROVAL','Pending only',
        '[{"field":"status","op":"eq","value":"PENDING"}]'::jsonb, ARRAY['ref'], true,
        'a0200000-0000-4000-8000-0000000000a1','TENANT','HUMAN','a0200000-0000-4000-8000-0000000000a1'),
       ('a0200000-7777-4000-8000-000000000002','a0200000-1111-4000-8000-000000000001','ENQUIRY','Sales private',
        '[]'::jsonb, ARRAY['ref'], false,
        'a0200000-0000-4000-8000-0000000000a1','PRIVATE','HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.programmes (id,tenant_id,name,category,days,version,status,hrdc_scheme,hrdc_claimable,
  list_price_sen,list_price_pax,floor_price_sen,floor_margin_rate,currency,outcomes,created_by_kind,created_by_id)
VALUES ('a0200000-8888-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','Leading Teams A20','LEADERSHIP',
        2,1,'ACTIVE','SBL_KHAS',true,4000000,25,2800000,0.3000,'MYR',ARRAY['Delegate'],'HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.trainers (id,tenant_id,name,email,band,ttt_certified,ttt_ref,hrd_tdf,hrd_tdf_valid_to,rating,status,created_by_kind,created_by_id)
VALUES ('a0200000-9999-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','Farah A20','farah@a20.test',
        'A',true,'TTT-A20',true,'2028-01-01',4.70,'ACTIVE','HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.programme_trainers (tenant_id,programme_id,trainer_id,created_by_kind,created_by_id)
VALUES ('a0200000-1111-4000-8000-000000000001','a0200000-8888-4000-8000-000000000001',
        'a0200000-9999-4000-8000-000000000001','HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.engagements (id,tenant_id,organisation_id,programme_id,owner_id,pipeline_id,title,value_sen,currency,starts_on,ends_on,created_by_kind,created_by_id)
SELECT 'a0200000-aaaa-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001',
       'a0200000-2222-4000-8000-000000000001','a0200000-8888-4000-8000-000000000001',
       'a0200000-0000-4000-8000-0000000000a1', pipeline.id, 'Leading Teams for Chrome', 1850000,'MYR',
       '2026-08-10','2026-08-11','HUMAN','a0200000-0000-4000-8000-0000000000a1'
  FROM core.pipelines AS pipeline
 WHERE pipeline.tenant_id = 'a0200000-1111-4000-8000-000000000001' AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default;

-- 011's transition gate: an engagement is born PROPOSED and walks to DELIVERED.
UPDATE core.engagements SET status = 'CONFIRMED'   WHERE id = 'a0200000-aaaa-4000-8000-000000000001';
UPDATE core.engagements SET status = 'SCHEDULED'   WHERE id = 'a0200000-aaaa-4000-8000-000000000001';
UPDATE core.engagements SET status = 'IN_DELIVERY' WHERE id = 'a0200000-aaaa-4000-8000-000000000001';
UPDATE core.engagements SET status = 'DELIVERED'   WHERE id = 'a0200000-aaaa-4000-8000-000000000001';

INSERT INTO core.participants (tenant_id,engagement_id,name,created_by_kind,created_by_id)
VALUES ('a0200000-1111-4000-8000-000000000001','a0200000-aaaa-4000-8000-000000000001','P One','HUMAN','a0200000-0000-4000-8000-0000000000a1'),
       ('a0200000-1111-4000-8000-000000000001','a0200000-aaaa-4000-8000-000000000001','P Two','HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.evaluation_responses (tenant_id,engagement_id,overall_score,created_by_kind,created_by_id)
VALUES ('a0200000-1111-4000-8000-000000000001','a0200000-aaaa-4000-8000-000000000001',0.900,'HUMAN','a0200000-0000-4000-8000-0000000000a1'),
       ('a0200000-1111-4000-8000-000000000001','a0200000-aaaa-4000-8000-000000000001',0.940,'HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.trainer_bookings (tenant_id,trainer_id,engagement_id,state,starts_on,ends_on,hold_expires_at,created_by_kind,created_by_id)
VALUES ('a0200000-1111-4000-8000-000000000001','a0200000-9999-4000-8000-000000000001',
        'a0200000-aaaa-4000-8000-000000000001','SOFT_HOLD','2026-08-10','2026-08-11',pg_catalog.now() + interval '2 days','HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.hrdc_packets (tenant_id,engagement_id,organisation_id,scheme,employer_code,claim_value_sen,completeness,deadline_at,deadline_severity)
VALUES ('a0200000-1111-4000-8000-000000000001','a0200000-aaaa-4000-8000-000000000001',
        'a0200000-2222-4000-8000-000000000001','SBL_KHAS','E-A20',1850000,0.500,
        pg_catalog.now() + interval '10 days','WARN');

INSERT INTO core.collection_rules (tenant_id,stage,trigger_days_overdue,channel,autonomy)
VALUES ('a0200000-1111-4000-8000-000000000001','REMINDER_1',7,'EMAIL','ACT_WITH_APPROVAL');

INSERT INTO core.compliance_rules (id,tenant_id,rule_code,family_key,check_key,side,subject,subject_field,op,reference_kind,reference,effective_from,status)
VALUES ('a0200000-bbbb-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','A20-LEAD','LEAD_TIME_PUBLIC',
        'CHK_LEAD_TIME','GRANT','Public lead time A20','training_start','GTE','FIELD','grant_approval','2026-06-15','PROPOSED');

INSERT INTO core.rule_change_sets (id,tenant_id,document_id,title,published_at,ingested_at,effective_from,extracted_by_model,extraction_confidence,created_by_kind,created_by_id)
VALUES ('a0200000-cccc-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','DOC-A20','Circular A20',
        '2026-09-01',pg_catalog.now(),'2026-10-01','model-x',0.910,'AGENT','agent_compliance');

INSERT INTO core.rule_changes (id,tenant_id,rule_change_set_id,change_key,op,target_rule_id,after_text,confidence)
VALUES ('a0200000-cccc-4000-8000-000000000002','a0200000-1111-4000-8000-000000000001',
        'a0200000-cccc-4000-8000-000000000001','C1','MODIFY','a0200000-bbbb-4000-8000-000000000001','14 days',0.930);

INSERT INTO core.rule_change_affected_engagements (tenant_id,rule_change_id,engagement_id)
VALUES ('a0200000-1111-4000-8000-000000000001','a0200000-cccc-4000-8000-000000000002','a0200000-aaaa-4000-8000-000000000001');

INSERT INTO core.agents (tenant_id, agent_id, name, status, principal_user_id, scopes, kill_switch, escalation_ladder)
VALUES ('a0200000-1111-4000-8000-000000000001','agent_proposal','Proposal Agent','ACTIVE',
        'a0200000-0000-4000-8000-0000000000a1', ARRAY['proposal:write'], false, ARRAY[]::text[]);

INSERT INTO core.evals (tenant_id,agent_id,kind,score,evaluated_at)
VALUES ('a0200000-1111-4000-8000-000000000001','agent_proposal','LIVE_SAMPLE',0.800,pg_catalog.now()),
       ('a0200000-1111-4000-8000-000000000001','agent_proposal','LIVE_SAMPLE',0.900,pg_catalog.now());

INSERT INTO core.knowledge_sources (id,tenant_id,name,version,content_hash,created_by_kind,created_by_id)
VALUES ('a0200000-dddd-4000-8000-000000000001','a0200000-1111-4000-8000-000000000001','HRD Corp circular A20','1',
        'sha256:a20','HUMAN','a0200000-0000-4000-8000-0000000000a1');

INSERT INTO core.tier_keys (tenant_id,tier_key,label,position)
VALUES ('a0200000-1111-4000-8000-000000000001','A20FAST','Fast',1)
ON CONFLICT DO NOTHING;
INSERT INTO core.model_tiers (tenant_id,tier_key,model,provider,allowed_hours,monthly_cap_sen,health,degraded_since,degraded_reason)
VALUES ('a0200000-1111-4000-8000-000000000001','A20FAST','model-fast','ANTHROPIC',
        B'000000001111111111000011',50000,'DEGRADED',pg_catalog.now(),'PROVIDER_5XX');
INSERT INTO core.ai_budgets (tenant_id,scope,key,cap_sen)
VALUES ('a0200000-1111-4000-8000-000000000001','TIER','A20FAST',50000);

-- ════════ T7–T10 · The views, read the way a browser reads them ════════
--
-- One probe per principal: `pg_temp.snapshot()` reads every client view in its
-- own subtransaction (`pg_temp.try`), so one view's 42501 cannot hide another's
-- rows. There is no role or claim change inside the statement.

CREATE FUNCTION pg_temp.snapshot() RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_name text; v_out jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
      'v_organisation_relations','v_budgets','v_model_tiers','v_templates','v_policies',
      'v_saved_views','v_trainers','v_contacts','v_contact_channel_consents','v_programmes',
      'v_programme_deliveries','v_hrdc_deadlines','v_collection_rules','v_compliance_rules',
      'v_rule_change_sets','v_agent_evals','v_knowledge_sources']
  LOOP
    v_out := v_out || pg_catalog.jsonb_build_object(v_name, pg_temp.try(pg_catalog.format(
      'SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v)), ''[]''::jsonb) FROM core.%I AS v', v_name)));
  END LOOP;
  RETURN v_out;
END;
$fn$;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a3','a0200000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.v_md', pg_temp.snapshot()::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000a1','a0200000-1111-4000-8000-000000000001','SALES'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.v_sales', pg_temp.snapshot()::text, true);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0200000-0000-4000-8000-0000000000b1','a0200000-1111-4000-8000-000000000002','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a20.v_other', pg_temp.snapshot()::text, true);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('a20.v_anon', pg_temp.snapshot()::text, true);
RESET ROLE;

-- T7 · every view reads as `authenticated`, and each row is the contract shape.
DO $t7$
DECLARE
  v      jsonb := pg_temp.got('v_md');
  v_name text;
  v_keys text[];
  v_want text[];
  v_row  jsonb;
BEGIN
  FOR v_name IN SELECT pg_catalog.jsonb_object_keys(v) LOOP
    IF v -> v_name -> 'ok' <> 'true'::jsonb THEN
      RAISE EXCEPTION 'T7a: % is not readable by authenticated MD: %', v_name, v -> v_name;
    END IF;
    IF pg_catalog.jsonb_array_length(v -> v_name -> 'value') = 0 THEN
      RAISE EXCEPTION 'T7b: % returned no rows to the tenant''s MD', v_name;
    END IF;
  END LOOP;

  -- The column set IS the wire shape under select("*"): exact, per view.
  FOR v_name, v_want IN
    SELECT w.name, w.keys FROM (VALUES
      ('v_organisation_relations', ARRAY['tenant_id','organisation_id','engagements','contacts','invoices','hrdc','organisation_ref']),
      ('v_budgets',     ARRAY['scope','key','cap','spend','state']),
      ('v_model_tiers', ARRAY['key','model','provider','routing','fallbackChain','cacheStrategy','maxOutputTokens','allowedHours','monthlyCap','spend','status','degradation']),
      ('v_templates',   ARRAY['id','type','version','label','mergeFields','sections','category','ratePerMessage']),
      ('v_policies',    ARRAY['id','actionType','description','conditions','combinator','approverRole','slaMinutes','escalateToRole','escalateAfterMinutes']),
      ('v_saved_views', ARRAY['id','label','object','count','isDefault','filters','columns']),
      ('v_trainers',    ARRAY['id','ref','name','email','bands','tttCertified','tttRef','tttValidTo','hrdTdf','rating','programmeRefs','bookedDates','lastDeliveredAt']),
      ('v_contacts',    ARRAY['id','ref','createdAt','updatedAt','createdBy','organisationRef','name','role','email','phone','primary','consent','pdpaFlag']),
      ('v_contact_channel_consents', ARRAY['channel','granted','recordedAt','contact_id','contact_ref']),
      ('v_programmes',  ARRAY['id','ref','createdAt','updatedAt','createdBy','name','category','days','version','status','hrdcScheme','hrdcClaimable','listPrice','listPricePax','floorPrice','floorMarginRate','outcomes','modules','pricingTiers','trainerPool','materials','stats']),
      ('v_programme_deliveries', ARRAY['programme_id','programme_ref','engagementRef','organisationRef','organisationName','dates','pax','evaluation','value']),
      ('v_hrdc_deadlines', ARRAY['engagementRef','organisationRef','deadlineAt','daysRemaining','status','severity']),
      ('v_collection_rules', ARRAY['stage','afterDays','channel','autonomy','requiresApprovalFromRole']),
      ('v_compliance_rules', ARRAY['id','scheme','subject','expression','effectiveFrom','effectiveTo','status','source','supersedesId','supersededById','usedByChecks','affectedOpenEngagements','verifiedBy','verifiedAt','provenance']),
      ('v_rule_change_sets', ARRAY['documentId','title','publishedAt','ingestedAt','extractedBy','effectiveFrom','changes']),
      ('v_agent_evals', ARRAY['agentId','window','score','sampleSize','provenance']),
      ('v_knowledge_sources', ARRAY['id','name','type','version','ingestedAt','chunks','embeddingStatus','lastCheckedAt','monitorStatus','contentHash','retrievalScopes','ruleChangeSetId'])
    ) AS w(name, keys)
  LOOP
    SELECT pg_catalog.array_agg(k ORDER BY k) INTO v_keys
      FROM pg_catalog.jsonb_object_keys(v -> v_name -> 'value' -> 0) AS k;
    IF v_keys <> (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.unnest(v_want) AS k) THEN
      RAISE EXCEPTION 'T7c: % columns are % — the contract keys are %', v_name, v_keys, v_want;
    END IF;
  END LOOP;

  -- Values that carry the repairs.
  SELECT e.value INTO v_row FROM pg_catalog.jsonb_array_elements(v -> 'v_organisation_relations' -> 'value') AS e(value)
   WHERE e.value ->> 'organisation_id' = 'a0200000-2222-4000-8000-000000000001';
  IF v_row #>> '{engagements,0,value,amount}' <> '1850000' OR v_row ->> 'organisation_ref' IS NULL THEN
    RAISE EXCEPTION 'T7d: relations money or organisation_ref wrong: %', v_row;
  END IF;
  v_row := v -> 'v_model_tiers' -> 'value' -> 0;
  IF v_row -> 'allowedHours' <> '[[8,18],[22,24]]'::jsonb
     OR NOT (v_row -> 'degradation' ? 'activeFallback')
     OR v_row #>> '{monthlyCap,amount}' <> '50000'
     OR v_row ->> 'status' <> 'DEGRADED' THEN
    RAISE EXCEPTION 'T7e: v_model_tiers shape wrong: %', v_row;
  END IF;
  v_row := v -> 'v_budgets' -> 'value' -> 0;
  IF v_row #>> '{cap,amount}' <> '50000' OR v_row #>> '{spend,currency}' <> 'MYR' THEN
    RAISE EXCEPTION 'T7f: v_budgets money wrong: %', v_row;
  END IF;
  v_row := v -> 'v_contacts' -> 'value' -> 0;
  IF v_row -> 'consent' <> '{"email": true, "whatsapp": false}'::jsonb THEN
    RAISE EXCEPTION 'T7g: a withdrawn WhatsApp consent reads as granted: %', v_row;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v -> 'v_contact_channel_consents' -> 'value') AS e(value)
       WHERE e.value ->> 'channel' = 'WHATSAPP' AND e.value -> 'granted' = 'false'::jsonb
         AND e.value ->> 'recordedAt' IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'T7h: ChannelConsent granted is not the effective consent: %', v -> 'v_contact_channel_consents';
  END IF;
  v_row := v -> 'v_trainers' -> 'value' -> 0;
  IF v_row -> 'bookedDates' <> '["2026-08-10","2026-08-11"]'::jsonb
     OR pg_catalog.jsonb_array_length(v_row -> 'programmeRefs') <> 1 THEN
    RAISE EXCEPTION 'T7i: v_trainers derived arrays wrong: %', v_row;
  END IF;
  v_row := v -> 'v_programme_deliveries' -> 'value' -> 0;
  IF v_row -> 'pax' <> '2'::jsonb OR v_row -> 'evaluation' <> '4.6'::jsonb THEN
    RAISE EXCEPTION 'T7j: v_programme_deliveries pax/evaluation wrong: %', v_row;
  END IF;
  v_row := v -> 'v_hrdc_deadlines' -> 'value' -> 0;
  IF (v_row ->> 'daysRemaining')::integer NOT BETWEEN 9 AND 10 OR v_row ->> 'severity' <> 'WARN' THEN
    RAISE EXCEPTION 'T7k: v_hrdc_deadlines wrong: %', v_row;
  END IF;
  IF v #>> '{v_rule_change_sets,value,0,changes,0,affectedEngagements,0,ref}' IS NULL THEN
    RAISE EXCEPTION 'T7l: rule change set lost its affected engagement: %', v -> 'v_rule_change_sets';
  END IF;
  IF v #> '{v_agent_evals,value,0,score}' <> '0.850'::jsonb
     OR v #> '{v_agent_evals,value,0,sampleSize}' <> '2'::jsonb THEN
    RAISE EXCEPTION 'T7m: v_agent_evals rollup wrong: %', v -> 'v_agent_evals';
  END IF;
  -- The APPROVAL saved view's count is list_approvals' own total: one PENDING.
  IF (SELECT e.value -> 'count' FROM pg_catalog.jsonb_array_elements(v -> 'v_saved_views' -> 'value') AS e(value)
       WHERE e.value ->> 'label' = 'Pending only') <> '1'::jsonb THEN
    RAISE EXCEPTION 'T7n: saved view count is not the list total: %', v -> 'v_saved_views';
  END IF;
  -- A PRIVATE view owned by SALES is not the MD's.
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v -> 'v_saved_views' -> 'value') AS e(value)
              WHERE e.value ->> 'label' = 'Sales private') THEN
    RAISE EXCEPTION 'T7o: the MD can see another user''s PRIVATE saved view';
  END IF;
  RAISE NOTICE 'T7 PASS: 17 views read as authenticated MD with the contract''s exact columns and repaired values.';
END
$t7$;

-- T8 · a role without the 002 read permission gets rows it may read, and no others.
DO $t8$
DECLARE
  v      jsonb := pg_temp.got('v_sales');
  v_name text;
BEGIN
  FOR v_name IN SELECT pg_catalog.jsonb_object_keys(v) LOOP
    IF v -> v_name -> 'ok' <> 'true'::jsonb THEN
      RAISE EXCEPTION 'T8a: % errored for SALES instead of filtering: %', v_name, v -> v_name;
    END IF;
  END LOOP;
  -- SALES holds none of: hrdc:read, ai:budget:read, ai:tier:read,
  -- compliance:rule:read, eval:read, knowledge:source:read (002 §11).
  FOREACH v_name IN ARRAY ARRAY['v_hrdc_deadlines','v_budgets','v_model_tiers','v_compliance_rules',
                                'v_rule_change_sets','v_agent_evals','v_knowledge_sources']
  LOOP
    IF pg_catalog.jsonb_array_length(v -> v_name -> 'value') <> 0 THEN
      RAISE EXCEPTION 'T8b: SALES read % without the permission: %', v_name, v -> v_name;
    END IF;
  END LOOP;
  -- ...and does hold these.
  FOREACH v_name IN ARRAY ARRAY['v_organisation_relations','v_templates','v_trainers','v_contacts',
                                'v_contact_channel_consents','v_programmes','v_collection_rules']
  LOOP
    IF pg_catalog.jsonb_array_length(v -> v_name -> 'value') = 0 THEN
      RAISE EXCEPTION 'T8c: SALES holds the permission for % and got nothing', v_name;
    END IF;
  END LOOP;
  IF pg_catalog.jsonb_array_length(v -> 'v_saved_views' -> 'value') <> 2 THEN
    RAISE EXCEPTION 'T8d: SALES should see the TENANT view and its own PRIVATE one: %', v -> 'v_saved_views';
  END IF;
  RAISE NOTICE 'T8 PASS: SALES is filtered out of six permissioned views and reads the seven it holds.';
END
$t8$;

-- T9 · another tenant's MD sees none of tenant A through any view.
DO $t9$
DECLARE
  v      jsonb := pg_temp.got('v_other');
  v_name text;
  v_mark text;
BEGIN
  FOR v_name IN SELECT pg_catalog.jsonb_object_keys(v) LOOP
    IF v -> v_name -> 'ok' <> 'true'::jsonb THEN
      RAISE EXCEPTION 'T9a: % errored for the other tenant: %', v_name, v -> v_name;
    END IF;
  END LOOP;
  FOREACH v_mark IN ARRAY ARRAY['a0200000-1111-4000-8000-000000000001','Chrome A20','Siti A20','Farah A20',
                                'Leading Teams A20','A20-LEAD','DOC-A20','A20FAST','HRD Corp circular A20',
                                'Pending only','Standard A20','agent_proposal']
  LOOP
    IF pg_catalog.strpos(v::text, v_mark) > 0 THEN
      RAISE EXCEPTION 'T9b: tenant A''s "%" is visible to another tenant: %', v_mark, v;
    END IF;
  END LOOP;
  RAISE NOTICE 'T9 PASS: no tenant-A row reaches another tenant through any of the 17 views.';
END
$t9$;

-- T10 · anon is refused every view at the privilege layer.
DO $t10$
DECLARE
  v      jsonb := pg_temp.got('v_anon');
  v_name text;
BEGIN
  FOR v_name IN SELECT pg_catalog.jsonb_object_keys(v) LOOP
    IF v -> v_name ->> 'sqlstate' IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'T10: anon was not refused % with 42501: %', v_name, v -> v_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'T10 PASS: anon is refused all 17 views.';
END
$t10$;

ROLLBACK;
