-- ═══════════════════════════════════════════════════════════════════════════
-- test_034 · executive dashboard contract fixes (M1, M2, M3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001-034 (or later). Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_034_dashboard_contract_fixes.sql
--
-- M1 DROPPED per ruling (2026-09-14): 002's role_permissions matrix is
-- authoritative for RPC gates, not endpoints.ts's narrower roles:['MD'] note
-- — hosted has two ADMIN founders who must keep executive dashboard access.
-- T1  regression guard for the dropped M1: SALES_MANAGER, FINANCE, MD and
--     ADMIN — all four hold dashboard:executive:read (002) — ALL succeed on
--     both get_executive_dashboard and get_proposals_vs_won (no role beyond
--     the permission itself is checked).
-- T2  M2: two open-pipeline opportunities, one MYR one USD. OPEN_PIPELINE's
--     value sums the MYR one only, and secondary notes the excluded row.
-- T3  M3: two evals for the same agent, one 10 days old (in the trailing-30
--     window) and one 40 days old (outside it). evalScore reflects ONLY the
--     recent one.
-- T4  default months=6: get_proposals_vs_won called with NO argument
--     produces a 6-element series.
-- T5  gate-before-read: a role with NEITHER the permission is given an
--     INVALID period, and is still refused FORBIDDEN — not VALIDATION_FAILED
--     — proving the permission gate runs before any input validation.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal1')::text;
$fn$;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond THEN RAISE NOTICE 'PASS %', p_label;
  ELSE RAISE EXCEPTION 'FAIL %', p_label;
  END IF;
END;
$fn$;

DO $preflight$
DECLARE v_body text;
BEGIN
  v_body := app._body_sql('core.get_executive_dashboard(text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'currency = ''MYR''') = 0 THEN
    RAISE EXCEPTION '034 preflight: get_executive_dashboard has no currency = ''MYR'' guard; 034 has not been applied';
  END IF;
  IF pg_catalog.strpos(v_body, 'app.role() IS DISTINCT FROM ''MD''') > 0 THEN
    RAISE EXCEPTION '034 preflight: get_executive_dashboard still carries the dropped M1 MD-only check';
  END IF;
END;
$preflight$;

-- ── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (id,email) VALUES
  ('a0340000-0000-4000-8000-000000000001','md@a34.test'),
  ('a0340000-0000-4000-8000-000000000002','sm@a34.test'),
  ('a0340000-0000-4000-8000-000000000003','finance@a34.test'),
  ('a0340000-0000-4000-8000-000000000004','admin@a34.test'),
  ('a0340000-0000-4000-8000-000000000005','sales@a34.test'),
  ('a0340000-0000-4000-8000-000000000006','agent-principal@a34.test');

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('a0340000-1111-4000-8000-000000000001','a34-alpha','A34 Alpha','Asia/Kuala_Lumpur');

INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,status,is_default) VALUES
  ('a0340000-1111-4000-8000-000000000001','a0340000-0000-4000-8000-000000000001','MD','HUMAN','ACTIVE',true),
  ('a0340000-1111-4000-8000-000000000001','a0340000-0000-4000-8000-000000000002','SALES_MANAGER','HUMAN','ACTIVE',true),
  ('a0340000-1111-4000-8000-000000000001','a0340000-0000-4000-8000-000000000003','FINANCE','HUMAN','ACTIVE',true),
  ('a0340000-1111-4000-8000-000000000001','a0340000-0000-4000-8000-000000000004','ADMIN','HUMAN','ACTIVE',true),
  ('a0340000-1111-4000-8000-000000000001','a0340000-0000-4000-8000-000000000005','SALES','HUMAN','ACTIVE',true);

INSERT INTO core.organisations (id,tenant_id,ref,name,owner_id) VALUES
  ('a0340000-bbbb-4000-8000-000000000001','a0340000-1111-4000-8000-000000000001','ORG-A34','A34 Org','a0340000-0000-4000-8000-000000000005');

-- Two open-pipeline opportunities: one MYR, one USD (M2). core.opportunities.
-- stage is a gated column (app.enforce_state_transition, GOV-07) even on the
-- very first INSERT if it is set away from the table's own NEW default — the
-- same pg_temp.gate/ungate fixture helper test_010/test_033 use.
CREATE FUNCTION pg_temp.gate(p_tenant uuid, p_type text, p_target uuid)
RETURNS void LANGUAGE plpgsql AS $gate$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.action_requests
    (tenant_id, action_type, target_id, status, requested_by_kind, requested_by_id)
  VALUES (p_tenant, p_type, p_target, 'EXECUTING', 'SYSTEM', 'pin-fixture')
  RETURNING id INTO v_id;
  PERFORM set_config('app.effect_applier', v_id::text, true);
END $gate$;
CREATE FUNCTION pg_temp.ungate() RETURNS void LANGUAGE plpgsql AS $ungate$
BEGIN
  PERFORM set_config('app.effect_applier', '', true);
END $ungate$;

SELECT pg_temp.gate('a0340000-1111-4000-8000-000000000001'::uuid,'OPPORTUNITY_CONVERT','a0340000-cccc-4000-8000-000000000001'::uuid);
INSERT INTO core.opportunities (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen,currency) VALUES
  ('a0340000-cccc-4000-8000-000000000001','a0340000-1111-4000-8000-000000000001','OPP-A34-1','a0340000-bbbb-4000-8000-000000000001','a0340000-0000-4000-8000-000000000005','QUALIFYING',1000000,'MYR');
SELECT pg_temp.ungate();

SELECT pg_temp.gate('a0340000-1111-4000-8000-000000000001'::uuid,'OPPORTUNITY_CONVERT','a0340000-cccc-4000-8000-000000000002'::uuid);
INSERT INTO core.opportunities (id,tenant_id,ref,organisation_id,owner_id,stage,value_sen,currency) VALUES
  ('a0340000-cccc-4000-8000-000000000002','a0340000-1111-4000-8000-000000000001','OPP-A34-2','a0340000-bbbb-4000-8000-000000000001','a0340000-0000-4000-8000-000000000005','QUALIFYING',500000,'USD');
SELECT pg_temp.ungate();

-- One active agent, two evals: recent (10d) and stale (40d) (M3).
INSERT INTO core.agents (id,tenant_id,agent_id,name,status,principal_user_id) VALUES
  ('a0340000-dddd-4000-8000-000000000001','a0340000-1111-4000-8000-000000000001','agent_a34','A34 Agent','ACTIVE','a0340000-0000-4000-8000-000000000006');

INSERT INTO core.evals (tenant_id,agent_id,kind,golden_set_version,score,evaluated_at) VALUES
  ('a0340000-1111-4000-8000-000000000001','agent_a34','GOLDEN_SET','v1',0.900,pg_catalog.now() - interval '10 days'),
  ('a0340000-1111-4000-8000-000000000001','agent_a34','GOLDEN_SET','v1',0.100,pg_catalog.now() - interval '40 days');

-- ════════ T1 · M1 dropped: all four dashboard:executive:read holders succeed

DO $t1$
DECLARE v_result jsonb; v_role text; v_user uuid;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['SALES_MANAGER','FINANCE','MD','ADMIN'] LOOP
    v_user := CASE v_role WHEN 'SALES_MANAGER' THEN 'a0340000-0000-4000-8000-000000000002'::uuid
                          WHEN 'FINANCE' THEN 'a0340000-0000-4000-8000-000000000003'::uuid
                          WHEN 'MD' THEN 'a0340000-0000-4000-8000-000000000001'::uuid
                          ELSE 'a0340000-0000-4000-8000-000000000004'::uuid END;
    PERFORM pg_catalog.set_config('request.jwt.claims',
      pg_temp.claims(v_user,'a0340000-1111-4000-8000-000000000001', v_role), true);
    SET LOCAL ROLE authenticated;
    v_result := core.get_executive_dashboard('2026-09');
    PERFORM pg_temp.assert((v_result ->> 'success')::boolean,
      pg_catalog.format('T1 %s (holds dashboard:executive:read) succeeds on get_executive_dashboard — M1 dropped, got %s', v_role, v_result));
    v_result := core.get_proposals_vs_won(6);
    PERFORM pg_temp.assert((v_result ->> 'success')::boolean,
      pg_catalog.format('T1 %s succeeds on get_proposals_vs_won — M1 dropped, got %s', v_role, v_result));
    RESET ROLE;
  END LOOP;
END;
$t1$;

-- ════════ T2 · M2: mixed-currency OPEN_PIPELINE ═══════════════════════════

DO $t2$
DECLARE v_result jsonb; v_metric jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0340000-0000-4000-8000-000000000001'::uuid,'a0340000-1111-4000-8000-000000000001','MD'), true);
  SET LOCAL ROLE authenticated;
  v_result := core.get_executive_dashboard('2026-09');
  SELECT item INTO v_metric FROM pg_catalog.jsonb_array_elements(v_result -> 'data' -> 'metrics') AS item
   WHERE item ->> 'key' = 'OPEN_PIPELINE';
  PERFORM pg_temp.assert((v_metric -> 'value' ->> 'amount')::bigint = 1000000,
    pg_catalog.format('T2a OPEN_PIPELINE.value sums the MYR opportunity only (1,000,000), got %s', v_metric -> 'value'));
  PERFORM pg_temp.assert(v_metric ->> 'secondary' LIKE '%non-MYR excluded%',
    pg_catalog.format('T2b OPEN_PIPELINE.secondary notes the excluded USD row, got %s', v_metric ->> 'secondary'));
  RESET ROLE;
END;
$t2$;

-- ════════ T3 · M3: evalScore is a trailing-30-day median ══════════════════

DO $t3$
DECLARE v_result jsonb; v_agent jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0340000-0000-4000-8000-000000000001'::uuid,'a0340000-1111-4000-8000-000000000001','MD'), true);
  SET LOCAL ROLE authenticated;
  v_result := core.get_executive_dashboard('2026-09');
  SELECT item INTO v_agent FROM pg_catalog.jsonb_array_elements(v_result -> 'data' -> 'agentActivity') AS item
   WHERE item ->> 'agentId' = 'agent_a34';
  PERFORM pg_temp.assert((v_agent ->> 'evalScore')::numeric = 0.900,
    pg_catalog.format('T3 evalScore reflects only the eval inside the trailing 30 days (0.900), not the 40-day-old 0.100, got %s', v_agent ->> 'evalScore'));
  RESET ROLE;
END;
$t3$;

-- ════════ T4 · default months=6 ════════════════════════════════════════

DO $t4$
DECLARE v_result jsonb; v_n integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0340000-0000-4000-8000-000000000001'::uuid,'a0340000-1111-4000-8000-000000000001','MD'), true);
  SET LOCAL ROLE authenticated;
  v_result := core.get_proposals_vs_won();
  SELECT pg_catalog.jsonb_array_length(v_result -> 'data' -> 'series') INTO v_n;
  PERFORM pg_temp.assert(v_n = 6, pg_catalog.format('T4 get_proposals_vs_won() with no argument defaults months to 6, got a %s-element series', v_n));
  RESET ROLE;
END;
$t4$;

-- ════════ T5 · gate before read: FORBIDDEN beats VALIDATION_FAILED ═══════

DO $t5$
DECLARE v_result jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_temp.claims('a0340000-0000-4000-8000-000000000005'::uuid,'a0340000-1111-4000-8000-000000000001','SALES'), true);
  SET LOCAL ROLE authenticated;
  v_result := core.get_executive_dashboard('not-a-period');
  PERFORM pg_temp.assert(v_result -> 'error' ->> 'code' = 'FORBIDDEN',
    pg_catalog.format('T5 SALES (holds neither the permission) with a malformed period is refused FORBIDDEN before validation runs, got %s', v_result));
  RESET ROLE;
END;
$t5$;

DO $$ BEGIN RAISE NOTICE 'test_034 ALL PASS'; END $$;

ROLLBACK;
