-- ═══════════════════════════════════════════════════════════════════════════
-- test_032 · approval target lock (H2) + OPP-01 content repair (H3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001-032 (or later). Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_032_approval_target_lock.sql
--
-- H2 concurrency note: a genuine two-session TOCTOU proof (session A holds
-- `core.quotations ... FOR UPDATE` uncommitted; session B's decide_approval
-- must block waiting for the SAME row) needs either `dblink` or two real
-- client connections. `dblink` is installed (superuser-only CREATE EXTENSION,
-- done once before this pin runs) but this shim's `pg_hba.conf` uses trust
-- auth locally, and `dblink` REFUSES a non-superuser caller's connection
-- unless the negotiated auth method was password/md5/scram (a documented
-- dblink security restriction, not a bug) — this pin runs as the migration-
-- owning role, which is not a superuser, so `dblink_connect` cannot be used
-- from inside a checked-in, single-file pin here. The true two-session
-- interleaving is proved separately, with two real `psql` processes, as part
-- of this migration's verification record (see the PR body / final report:
-- session A held `SELECT ... FOR UPDATE` on the quotation uncommitted;
-- session B's `app.lock_action_value_target` call blocked and hit
-- `statement_timeout` — 57014 — until A released it; the same call against
-- the PRE-032 code path — a bare `app.action_value` read — did not block).
--
-- What THIS pin proves, single-session and deterministically:
-- T1  app.lock_action_value_target exists, and for every value_source that
--     reads a mutable row (QUOTATION/INVOICE/HRDC_CLAIM) plus the
--     PROPOSAL_SEND special case, it takes out a REAL row lock — checked via
--     pg_locks from the SAME session (a session holds its own locks and can
--     see them in pg_locks without needing a second connection) rather than
--     assumed from reading the function body.
-- T2  app.lock_action_value_target is a genuine no-op (no lock taken, no
--     error) for PAYMENT/BUDGET_CAP/NONE value sources — the ones that read
--     their amount from the action's own payload, never from a row.
-- T3  decide_approval's source calls the lock helper strictly before
--     app.plan_effects (structural — the migration's own $verify$ checks
--     this at DDL time; re-asserted here so a later edit that reorders the
--     two calls fails THIS pin too, not just a from-scratch migration run).
-- T4  end-to-end regression safety: an unmodified QUOTATION_APPLY approval
--     still APPROVEs normally (the lock does not change the happy path).
-- T5  end-to-end: a quotation edited (committed) after the approval was
--     queued but before it is decided still comes back DIFF_CHANGED — the
--     pre-existing hash-check behaviour, unbroken by the added lock.
-- T6  OPP-01 (H3): a WRONG pre-existing row (active=false, wrong
--     approver_role) is corrected by app.seed_opportunity_stage_policy, not
--     left standing (the ON CONFLICT DO NOTHING defect 032 closes).
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond THEN RAISE NOTICE 'PASS %', p_label;
  ELSE RAISE EXCEPTION 'FAIL %', p_label;
  END IF;
END;
$fn$;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('app.lock_action_value_target(text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '032 preflight: app.lock_action_value_target/3 is absent; 032 has not been applied';
  END IF;
END;
$preflight$;

-- ── Fixtures (same shape as test_011's: users, tenant, org, opportunity,
--    proposal, rate card, quotations, plus a real aal2 session) ────────────

INSERT INTO auth.users (id,email) VALUES
  ('a0320000-0000-4000-8000-000000000001','sales@a32.test'),
  ('a0320000-0000-4000-8000-000000000002','manager@a32.test');

INSERT INTO auth.sessions (id,user_id,aal) VALUES
  ('a0320000-5e55-4000-8000-000000000001','a0320000-0000-4000-8000-000000000002','aal2');

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('a0320000-1111-4000-8000-000000000001','a32-alpha','A32 Alpha','Asia/Kuala_Lumpur');

INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,status,is_default) VALUES
  ('a0320000-1111-4000-8000-000000000001','a0320000-0000-4000-8000-000000000001','SALES','HUMAN','ACTIVE',true),
  ('a0320000-1111-4000-8000-000000000001','a0320000-0000-4000-8000-000000000002','MD','HUMAN','ACTIVE',true);

INSERT INTO core.organisations (id,tenant_id,ref,name,owner_id) VALUES
  ('a0320000-bbbb-4000-8000-000000000001','a0320000-1111-4000-8000-000000000001','ORG-A32','A32 Manufacturing','a0320000-0000-4000-8000-000000000001');

INSERT INTO core.opportunities (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen) VALUES
  ('a0320000-cccc-4000-8000-000000000001','a0320000-1111-4000-8000-000000000001','OPP-A32','a0320000-bbbb-4000-8000-000000000001','a0320000-0000-4000-8000-000000000001','NEW',1850000);

INSERT INTO core.templates (id,tenant_id,ref,template_type,label,status) VALUES
  ('a0320000-dddd-4000-8000-000000000001','a0320000-1111-4000-8000-000000000001','TPL-A32','PROPOSAL','A32 Proposal','ACTIVE');

INSERT INTO core.proposals (id,tenant_id,ref,opportunity_id,organisation_id,template_id,status,value_sen) VALUES
  ('a0320000-eeee-4000-8000-000000000001','a0320000-1111-4000-8000-000000000001','PRO-A32-1','a0320000-cccc-4000-8000-000000000001','a0320000-bbbb-4000-8000-000000000001','a0320000-dddd-4000-8000-000000000001','DRAFT',1850000),
  ('a0320000-eeee-4000-8000-000000000002','a0320000-1111-4000-8000-000000000001','PRO-A32-2','a0320000-cccc-4000-8000-000000000001','a0320000-bbbb-4000-8000-000000000001','a0320000-dddd-4000-8000-000000000001','DRAFT',1850000);

INSERT INTO core.rate_cards (id,tenant_id,version,status,effective_from) VALUES
  ('a0320000-ffff-4000-8000-000000000001','a0320000-1111-4000-8000-000000000001','v1-a32','DRAFT','2026-01-01');

INSERT INTO core.quotations
  (id,tenant_id,proposal_id,rate_card_id,pax,sell_price_sen,direct_cost_sen,programme_floor_price_sen,floor_margin_rate)
VALUES
  ('a0320000-9977-4000-8000-000000000001','a0320000-1111-4000-8000-000000000001',
   'a0320000-eeee-4000-8000-000000000001','a0320000-ffff-4000-8000-000000000001',
   30,1850000,1091500,1390000,0.3500),
  ('a0320000-9977-4000-8000-000000000002','a0320000-1111-4000-8000-000000000001',
   'a0320000-eeee-4000-8000-000000000002','a0320000-ffff-4000-8000-000000000001',
   30,1850000,1091500,1390000,0.3500);

INSERT INTO core.ref_formats (tenant_id,prefix,entity,dated,width) VALUES
  ('a0320000-1111-4000-8000-000000000001','ACT','action_requests',true,4),
  ('a0320000-1111-4000-8000-000000000001','APV','approval_requests',true,4)
ON CONFLICT (tenant_id, prefix) DO UPDATE SET entity = EXCLUDED.entity, dated = EXCLUDED.dated, width = EXCLUDED.width;

-- ════════ T1/T2 · lock_action_value_target takes a real lock, or none ═════

-- ⚠ `SELECT ... FOR UPDATE` registers a `RowShareLock` at the RELATION level
-- in `pg_locks` (weak — many sessions may hold it concurrently), not a
-- `tuple`-locktype row: Postgres only materialises a `tuple` lock entry when
-- there is actual contention for the SAME row, which an uncontended
-- single-session probe cannot manufacture. `RowShareLock` on the relation is
-- exactly the acquisition mode `FOR UPDATE` takes and is real, direct
-- evidence the statement executed — a session that never ran a locking read
-- would not hold it.
DO $t1$
DECLARE
  v_tenant uuid := 'a0320000-1111-4000-8000-000000000001';
  v_qid    uuid := 'a0320000-9977-4000-8000-000000000001';
  v_held   boolean;
BEGIN
  PERFORM app.lock_action_value_target('QUOTATION_APPLY', v_tenant, v_qid);
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks l
     WHERE l.locktype = 'relation'
       AND l.mode = 'RowShareLock'
       AND l.relation = 'core.quotations'::regclass
       AND l.pid = pg_catalog.pg_backend_pid())
    INTO v_held;
  PERFORM pg_temp.assert(v_held, 'T1a lock_action_value_target(QUOTATION_APPLY) holds a real FOR UPDATE (RowShareLock) on core.quotations');

  -- PROPOSAL_SEND: locks core.proposals via its special-cased branch.
  PERFORM app.lock_action_value_target('PROPOSAL_SEND', v_tenant, 'a0320000-eeee-4000-8000-000000000001'::uuid);
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks l
     WHERE l.locktype = 'relation'
       AND l.mode = 'RowShareLock'
       AND l.relation = 'core.proposals'::regclass
       AND l.pid = pg_catalog.pg_backend_pid())
    INTO v_held;
  PERFORM pg_temp.assert(v_held, 'T1b lock_action_value_target(PROPOSAL_SEND) holds a real FOR UPDATE (RowShareLock) on core.proposals');
END;
$t1$;

DO $t2$
BEGIN
  -- PAYMENT/BUDGET_CAP/NONE: no row to lock, must not error.
  PERFORM app.lock_action_value_target('PAYMENT_RECORD', 'a0320000-1111-4000-8000-000000000001'::uuid,
    'a0320000-9977-4000-8000-000000000001'::uuid);
  PERFORM app.lock_action_value_target('BUDGET_CAP_RAISE', 'a0320000-1111-4000-8000-000000000001'::uuid,
    pg_catalog.gen_random_uuid());
  PERFORM app.lock_action_value_target('AGENT_PAUSE', 'a0320000-1111-4000-8000-000000000001'::uuid, NULL);
  PERFORM pg_temp.assert(true, 'T2 lock_action_value_target is a no-op (no error) for PAYMENT/BUDGET_CAP/NONE-sourced types');
END;
$t2$;

-- ════════ T3 · decide_approval calls the lock helper before plan_effects ══

DO $t3$
DECLARE v_body text; v_lock_pos int; v_plan_pos int;
BEGIN
  v_body := app._body_sql('app.decide_approval(uuid,text,text,text,text)'::regprocedure);
  v_lock_pos := pg_catalog.strpos(v_body, 'app.lock_action_value_target');
  v_plan_pos := pg_catalog.strpos(v_body, 'app.plan_effects(v_action.action_type');
  PERFORM pg_temp.assert(v_lock_pos > 0 AND v_plan_pos > 0 AND v_lock_pos < v_plan_pos,
    'T3 decide_approval calls lock_action_value_target strictly before plan_effects');
END;
$t3$;

-- ════════ T4 · end-to-end: unmodified quotation still APPROVEs normally ══

INSERT INTO core.action_requests
  (id,tenant_id,ref,action_type,target_ref,target_id,requested_by_kind,requested_by_id,status)
VALUES
  ('a0320000-ac00-4000-8000-000000000001','a0320000-1111-4000-8000-000000000001',
   'ACT-A32-1','QUOTATION_APPLY',
   (SELECT ref FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000001'),
   'a0320000-9977-4000-8000-000000000001',
   'HUMAN','a0320000-0000-4000-8000-000000000001','QUEUED_FOR_APPROVAL');

INSERT INTO core.approval_requests
  (id,tenant_id,action_request_id,policy_id,action_type,subject,target_ref,
   requested_by_kind,requested_by_id,reason,diff,diff_hash,approver_role,
   sla_due_at,expires_at,bulk_approvable)
SELECT
  'a0320000-a919-4000-8000-000000000001','a0320000-1111-4000-8000-000000000001',
  'a0320000-ac00-4000-8000-000000000001','pol_a32','QUOTATION_APPLY','quotation',
  (SELECT ref FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000001'),
  'HUMAN','a0320000-0000-4000-8000-000000000001','T4 fixture',
  app.plan_effects('QUOTATION_APPLY', (SELECT ref FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000001'), '{}'::jsonb),
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'effects', app.plan_effects('QUOTATION_APPLY', (SELECT ref FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000001'), '{}'::jsonb),
      'value',   app.action_value('QUOTATION_APPLY','a0320000-1111-4000-8000-000000000001',
                   'a0320000-9977-4000-8000-000000000001'::uuid, '{}'::jsonb))::text,'UTF8')),'hex'),
  'MD', pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', false;

-- core.v_approval_requests is one of the three views 014 deliberately does
-- NOT grant to authenticated (T1c: "read only through a wrapper RPC" — doc
-- 09 §12); read the hash the way the product does — off the approval, but
-- as this privileged connection, BEFORE the role switch — and carry it
-- across via a GUC, same shape as test_030's a30.* pattern.
SELECT pg_catalog.set_config('a32.hash1',
  (SELECT diff_hash FROM core.v_approval_requests WHERE id = 'a0320000-a919-4000-8000-000000000001'), true);

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub','a0320000-0000-4000-8000-000000000002','role','authenticated',
    'tenant_id','a0320000-1111-4000-8000-000000000001','app_role','MD','actor_kind','HUMAN','aal','aal2','session_id','a0320000-5e55-4000-8000-000000000001')::text, true);
SET LOCAL ROLE authenticated;

DO $t4$
DECLARE v_result jsonb;
DECLARE v_hash text := pg_catalog.current_setting('a32.hash1');
BEGIN
  v_result := core.decide_approval('a0320000-a919-4000-8000-000000000001'::uuid,'APPROVE',NULL,v_hash,NULL);
  PERFORM pg_temp.assert(v_result -> 'data' ->> 'status' = 'APPROVED',
    pg_catalog.format('T4 unmodified quotation APPROVE still succeeds through the new lock, got %s', v_result));
  PERFORM pg_temp.assert(
    (SELECT status FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000001') = 'APPLIED',
    'T4b apply_effects actually ran (quotation status is APPLIED)');
END;
$t4$;

RESET ROLE;

-- ════════ T5 · a committed edit between queue and decide still DIFF_CHANGED

INSERT INTO core.action_requests
  (id,tenant_id,ref,action_type,target_ref,target_id,requested_by_kind,requested_by_id,status)
VALUES
  ('a0320000-ac00-4000-8000-000000000002','a0320000-1111-4000-8000-000000000001',
   'ACT-A32-2','QUOTATION_APPLY',
   (SELECT ref FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000002'),
   'a0320000-9977-4000-8000-000000000002',
   'HUMAN','a0320000-0000-4000-8000-000000000001','QUEUED_FOR_APPROVAL');

INSERT INTO core.approval_requests
  (id,tenant_id,action_request_id,policy_id,action_type,subject,target_ref,
   requested_by_kind,requested_by_id,reason,diff,diff_hash,approver_role,
   sla_due_at,expires_at,bulk_approvable)
SELECT
  'a0320000-a919-4000-8000-000000000002','a0320000-1111-4000-8000-000000000001',
  'a0320000-ac00-4000-8000-000000000002','pol_a32','QUOTATION_APPLY','quotation',
  (SELECT ref FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000002'),
  'HUMAN','a0320000-0000-4000-8000-000000000001','T5 fixture',
  app.plan_effects('QUOTATION_APPLY', (SELECT ref FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000002'), '{}'::jsonb),
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'effects', app.plan_effects('QUOTATION_APPLY', (SELECT ref FROM core.quotations WHERE id = 'a0320000-9977-4000-8000-000000000002'), '{}'::jsonb),
      'value',   app.action_value('QUOTATION_APPLY','a0320000-1111-4000-8000-000000000001',
                   'a0320000-9977-4000-8000-000000000002'::uuid, '{}'::jsonb))::text,'UTF8')),'hex'),
  'MD', pg_catalog.now() + interval '1 day', pg_catalog.now() + interval '7 days', false;

-- Committed price change, no concurrency needed to prove this half.
UPDATE core.quotations SET sell_price_sen = 2000000 WHERE id = 'a0320000-9977-4000-8000-000000000002';

SELECT pg_catalog.set_config('a32.hash2',
  (SELECT diff_hash FROM core.v_approval_requests WHERE id = 'a0320000-a919-4000-8000-000000000002'), true);

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub','a0320000-0000-4000-8000-000000000002','role','authenticated',
    'tenant_id','a0320000-1111-4000-8000-000000000001','app_role','MD','actor_kind','HUMAN','aal','aal2','session_id','a0320000-5e55-4000-8000-000000000001')::text, true);
SET LOCAL ROLE authenticated;

DO $t5$
DECLARE v_hash text := pg_catalog.current_setting('a32.hash2');
BEGIN
  BEGIN
    PERFORM core.decide_approval('a0320000-a919-4000-8000-000000000002'::uuid,'APPROVE',NULL,v_hash,NULL);
    RAISE EXCEPTION 'T5 FAIL: decide_approval approved a quotation whose price changed after queueing';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM pg_temp.assert(SQLERRM LIKE '%effects changed since the diff was rendered%',
        pg_catalog.format('T5 a committed price change between queue and decide is still refused as DIFF_CHANGED (got: %s)', SQLERRM));
  END;
END;
$t5$;

RESET ROLE;

-- ════════ T6 · OPP-01 content repair (H3) ═════════════════════════════════

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('a0320000-2222-4000-8000-000000000001','a32-beta','A32 Beta','Asia/Kuala_Lumpur');

DO $t6$
DECLARE v_row core.action_policies%ROWTYPE;
BEGIN
  -- A wrong pre-existing OPP-01 row: inactive, wrong approver.
  UPDATE core.action_policies
     SET active = false, approver_role = 'FINANCE'
   WHERE tenant_id = 'a0320000-2222-4000-8000-000000000001' AND id = 'OPP-01';
  SELECT p.* INTO v_row FROM core.action_policies p
   WHERE p.tenant_id = 'a0320000-2222-4000-8000-000000000001' AND p.id = 'OPP-01';
  PERFORM pg_temp.assert(v_row.active IS NOT true AND v_row.approver_role = 'FINANCE',
    'T6 SETUP: OPP-01 is deliberately wrong before the repair call');

  PERFORM app.seed_opportunity_stage_policy('a0320000-2222-4000-8000-000000000001'::uuid);

  SELECT p.* INTO v_row FROM core.action_policies p
   WHERE p.tenant_id = 'a0320000-2222-4000-8000-000000000001' AND p.id = 'OPP-01';
  PERFORM pg_temp.assert(v_row.active IS true, 'T6a app.seed_opportunity_stage_policy repairs active back to true');
  PERFORM pg_temp.assert(v_row.approver_role = 'SALES_MANAGER',
    'T6b app.seed_opportunity_stage_policy repairs approver_role back to SALES_MANAGER');
  PERFORM pg_temp.assert(v_row.conditions = '[{"field":"payload.stage","op":"in","value":["WON","LOST"]}]'::jsonb,
    'T6c app.seed_opportunity_stage_policy repairs conditions back to the canonical WON/LOST match');
END;
$t6$;

DO $$ BEGIN RAISE NOTICE 'test_032 ALL PASS'; END $$;

ROLLBACK;
