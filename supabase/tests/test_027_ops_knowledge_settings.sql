-- ═══════════════════════════════════════════════════════════════════════════
-- test_027 · Automation, knowledge and AI-settings read/write surface
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001-021+027. Ends in ROLLBACK, writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_027_ops_knowledge_settings.sql
--
-- EXECUTED before commit on a PostgreSQL 17 shim, migrations and this pin run
-- as a NOSUPERUSER BYPASSRLS role (hosted `postgres` stand-in, hc_mig). Seed:
-- 3 tier_keys, 2 core.agents (each with one autonomy_grant), 2 core.runs (one
-- SUCCEEDED, one FAILED), one core.ai_budgets (scope TIER/STANDARD, cap
-- 50,000.00 MYR), one core.ai_provider_keys row (masked only), one
-- core.routing_matrix_versions + core.routing_entries row, one
-- app.usage_rollup row. Principals: two same-tenant MDs (requester and
-- independent approver), a second-tenant MD, one ADMIN, one SALES, one CLIENT (no
-- library:read/tenant:read/agent:read), and a second tenant's MD for cross-
-- tenant isolation.
--
-- IMPERSONATION IS REAL: every probe runs as `authenticated` with the JWT
-- claims `app.custom_access_token_hook` produces for a real `auth.users` row.
--
-- T1  MD: list_agents/list_runs/get_run/get_ai_routing/get_usage/get_tenant/
--     list_library_assets succeed with the contract's top-level keys present;
--     pause_agent (whole-agent) flips status/pausedAt/autonomy[].paused; an
--     AAL1 cap raise is refused, an AAL2 raise queues FIN-07, and a different
--     AAL2 MD executes it. An ai:budget:write lower stays direct, and a currency
--     mismatch is VALIDATION_FAILED.
-- T2  ADMIN-only: create_knowledge_source/check_knowledge_source/
--     reingest_knowledge_source/list_providers/put_ai_routing/retry_run/
--     dead_letter_run succeed for ADMIN and are FORBIDDEN with
--     requiredPermission for MD.
-- T3  SALES: FORBIDDEN on agent:read/run:read/knowledge:source:*/
--     ai:provider:read/ai:routing:*, but succeeds on library:read/tenant:read
--     (the two permissions this migration adds, granted to all six staff
--     roles).
-- T4  CLIENT (no staff permissions at all): FORBIDDEN on every one, byte-
--     identical for a real and an invented id.
-- T5  anon: 42501 on every RPC (schema-level, before the function runs).
-- T6  Cross-tenant: a second tenant's MD sees zero rows from list_agents/
--     list_runs/list_library_assets/list_providers and NOT_FOUND on get_run
--     for tenant A's run id.
-- T7  listProviders never returns key material: no row has a `key` field, and
--     `maskedKey` always contains the mask character.
-- T8  Teeth-check, in pg_temp only (check:grants T1/T2 forbid a test from
--     defining a real SECURITY DEFINER function or granting authenticated):
--     a pg_temp copy of get_tenant with the gate deleted lets CLIENT through,
--     proving the assertion is live; the real, untouched core.get_tenant is
--     then called as the same CLIENT and still refuses.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages = warning;

-- ── fixture data ────────────────────────────────────────────────────────

-- Self-contained: this pin provisions its own tenant and users rather than
-- depending on the real akademi-perdana ids (those exist only on the
-- hosted-provisioned probe database, not on a clean 001-021+027 build). No
-- psql meta-commands (\set/\gset) - lint:sql only tolerates those in seeds;
-- every id here is a literal or a lookup against t027_ids.

CREATE TEMP TABLE t027_ids (k text PRIMARY KEY, id_val text);
GRANT SELECT ON t027_ids TO authenticated;

DO $seed$
DECLARE
  v_tenant uuid := 'a0270000-1000-4000-8000-000000000001';
  v_md1    uuid := 'a0270000-cd01-4000-8000-0000000000d1';
  v_md3    uuid := 'a0270000-cd03-4000-8000-0000000000d3';
  v_agent1 uuid := 'a0270000-a001-4000-8000-0000000000a1';
  v_agent2 uuid := 'a0270000-a002-4000-8000-0000000000a2';
  v_prin1  uuid := 'a0270000-9001-4000-8000-000000000901';
  v_prin2  uuid := 'a0270000-9002-4000-8000-000000000902';
  v_run_ok uuid := 'a0270000-6001-4000-8000-000000000601';
  v_run_bad uuid := 'a0270000-6002-4000-8000-000000000602';
  v_tenant2 uuid := 'a0270000-7002-4000-8000-000000000702';
  v_md2    uuid := 'a0270000-cd02-4000-8000-0000000000d2';
  v_sales  uuid := 'a0270000-5a1e-4000-8000-0000000005a1';
  v_client uuid := 'a0270000-c11e-4000-8000-000000000c11';
  v_admin  uuid := 'a0270000-ad01-4000-8000-000000000ad1';
BEGIN
  PERFORM app.provision_tenant('t027-tenant', 'T027 Test Co', 'Asia/Kuala_Lumpur', v_tenant);

  INSERT INTO auth.users (id, aud, role, email) VALUES
    (v_md1,   'authenticated','authenticated','t027-md1@internal.trainos'),
    (v_md3,   'authenticated','authenticated','t027-md3@internal.trainos');
  INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,client_scope,team_scope,status,is_default) VALUES
    (v_tenant, v_md1, 'MD', 'HUMAN', 'ALL','ALL','ACTIVE', true),
    (v_tenant, v_md3, 'MD', 'HUMAN', 'ALL','ALL','ACTIVE', true);

  -- Real AAL2 sessions: app.aal2_verified() ignores a forgeable JWT-only aal2.
  INSERT INTO auth.sessions (id,user_id,aal) VALUES
    ('a0270000-5e55-4000-8000-0000000000d1',v_md1,'aal2'),
    ('a0270000-5e55-4000-8000-0000000000d3',v_md3,'aal2');

  INSERT INTO core.tier_keys (tenant_id, tier_key, label, position) VALUES
    (v_tenant, 'FAST', 'Fast', 1), (v_tenant, 'STANDARD', 'Standard', 2);

  INSERT INTO auth.users (id, aud, role, email) VALUES
    (v_prin1, 'authenticated','authenticated','t027-agent1@internal.trainos'),
    (v_prin2, 'authenticated','authenticated','t027-agent2@internal.trainos'),
    (v_md2,   'authenticated','authenticated','t027-md2@internal.trainos'),
    (v_sales, 'authenticated','authenticated','t027-sales@internal.trainos'),
    (v_client,'authenticated','authenticated','t027-client@internal.trainos'),
    (v_admin, 'authenticated','authenticated','t027-admin@internal.trainos');

  INSERT INTO core.agents (id, tenant_id, agent_id, name, status, principal_user_id, default_tier) VALUES
    (v_agent1, v_tenant, 'agent_t027_a', 'T027 Agent A', 'ACTIVE', v_prin1, 'STANDARD'),
    (v_agent2, v_tenant, 'agent_t027_b', 'T027 Agent B', 'ACTIVE', v_prin2, 'FAST');
  INSERT INTO core.autonomy_grants (tenant_id, agent_id, action_type, level, approver_role, granted_by) VALUES
    (v_tenant, 'agent_t027_a', 'PROPOSAL_SEND', 'ACT_WITH_APPROVAL', 'SALES_MANAGER', 'test');

  INSERT INTO core.runs (id, tenant_id, agent_id, trigger, status, model, cost_sen, started_at, finished_at, duration_ms) VALUES
    (v_run_ok,  v_tenant, 'agent_t027_a', '{"type":"SCHEDULE"}'::jsonb, 'SUCCEEDED', 'claude-sonnet', 1000, now()-interval '1 day', now()-interval '1 day'+interval '10s', 10000),
    (v_run_bad, v_tenant, 'agent_t027_b', '{"type":"EVENT"}'::jsonb,    'FAILED',    'claude-haiku', 200, now()-interval '2 days', now()-interval '2 days'+interval '5s', 5000);
  UPDATE core.runs SET failure = '{"code":"X","message":"y","attempts":1,"retryable":true,"deadLettered":false}'::jsonb WHERE id = v_run_bad;

  INSERT INTO core.ai_budgets (tenant_id, scope, key, cap_sen) VALUES (v_tenant, 'TIER', 'STANDARD', 5000000);
  INSERT INTO core.ai_provider_keys (tenant_id, provider_ref, provider, label, status, masked_key, key_fingerprint, key_ref, region, billing_owner, added_by) VALUES
    (v_tenant, 'prv_t027_test', 'ANTHROPIC', 'T027 key', 'VALID', 'sk-ant-••••••••••••t027', sha256('t027'), 'vault:t027',
     'US', 'CLIENT_ACCOUNT', '{"kind":"HUMAN","id":"test","name":"Test"}'::jsonb);
  INSERT INTO core.routing_matrix_versions (id, tenant_id, label, effective_from) VALUES
    ('a0270000-ee00-4000-8000-0000000000e0', v_tenant, 't027-v1', now()-interval '7 days');
  INSERT INTO core.routing_entries (tenant_id, version_id, action_type, tier_key, jury) VALUES
    (v_tenant, 'a0270000-ee00-4000-8000-0000000000e0', 'PROPOSAL_SEND', 'STANDARD', '{"mode":"GATE","quorum":1,"of":1,"tiers":["STANDARD"]}'::jsonb);
  INSERT INTO app.usage_rollup (tenant_id, period, scope, key, spend_sen) VALUES
    (v_tenant, to_char(now(),'YYYY-MM'), 'TIER', 'STANDARD', 100000);

  INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,client_scope,team_scope,status,is_default) VALUES
    (v_tenant, v_sales,  'SALES',  'HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true),
    (v_tenant, v_client, 'CLIENT', 'HUMAN','MY_ACCOUNTS','MY_TEAM','ACTIVE',true),
    (v_tenant, v_admin,  'ADMIN',  'HUMAN','ALL','ALL','ACTIVE',true);

  -- A second tenant, for T6.
  INSERT INTO public.tenants (id, slug, name) VALUES (v_tenant2, 't027-other', 'T027 Other Co');
  INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,client_scope,team_scope,status,is_default) VALUES
    (v_tenant2, v_md2, 'MD', 'HUMAN', 'ALL','ALL','ACTIVE', true);

  INSERT INTO t027_ids VALUES
    ('agent1', v_agent1::text), ('run_ok', v_run_ok::text), ('run_bad', v_run_bad::text),
    ('md1', v_md1::text), ('md3', v_md3::text), ('md2', v_md2::text), ('sales', v_sales::text),
    ('client', v_client::text), ('admin', v_admin::text);

  -- 002 gives ai:budget:write to ADMIN only. Add it transactionally so the
  -- direct-lower probe exercises an MD who explicitly holds that permission
  -- without changing the shipped role matrix.
  INSERT INTO app.role_permissions (role,permission) VALUES ('MD','ai:budget:write');
END
$seed$;

-- ── claims helper (mirrors seed-hosted/rpc_check.sql) ─────────────────────

CREATE FUNCTION pg_temp.claims(p_user uuid) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  SET LOCAL ROLE supabase_auth_admin;
  SELECT (app.custom_access_token_hook(pg_catalog.jsonb_build_object(
    'user_id', p_user, 'claims', pg_catalog.jsonb_build_object('sub', p_user, 'role','authenticated')))
    -> 'claims')::text INTO v;
  RESET ROLE;
  RETURN v;
END;
$fn$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_claims text := pg_temp.claims(p_user);
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims, true);
END;
$fn$;

CREATE FUNCTION pg_temp.as_user_aal2(p_user uuid, p_session uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_claims jsonb := pg_temp.claims(p_user)::jsonb
                    || pg_catalog.jsonb_build_object(
                         'aal','aal2','session_id',p_session::text);
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
END;
$fn$;

-- ═══ T1 · MD ═══════════════════════════════════════════════════════════

SELECT pg_temp.as_user('a0270000-cd01-4000-8000-0000000000d1'::uuid);

DO $t1$
DECLARE
  v              jsonb;
  v_detail       text;
  v_approval_id  uuid;
  v_diff_hash    text;
  v_before_count bigint;
BEGIN
  v := core.list_agents();
  IF (v->>'success') <> 'true' OR jsonb_typeof(v->'data'->'data') <> 'array'
     OR jsonb_typeof(v->'data'->'summary') <> 'object' THEN
    RAISE EXCEPTION 'T1a: list_agents shape wrong: %', v;
  END IF;

  v := core.pause_agent((SELECT id_val FROM t027_ids WHERE k='agent1'), '{"actionType":null}'::jsonb);
  IF (v->>'success') <> 'true' OR (v->'data'->>'status') <> 'PAUSED'
     OR (v->'data'->>'pausedAt') IS NULL
     OR (v->'data'->'autonomy'->0->>'paused') <> 'true' THEN
    RAISE EXCEPTION 'T1b: pause_agent did not pause the whole agent: %', v;
  END IF;

  v := core.list_runs();
  IF (v->>'success') <> 'true' OR jsonb_array_length(v->'data'->'data') <> 2 THEN
    RAISE EXCEPTION 'T1c: list_runs expected 2 rows, got %', v;
  END IF;

  v := core.get_run((SELECT id_val FROM t027_ids WHERE k='run_ok'));
  IF (v->>'success') <> 'true' OR (v->'data'->>'status') <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'T1d: get_run wrong: %', v;
  END IF;

  v := core.get_ai_routing();
  IF (v->>'success') <> 'true' OR (v->'data'->>'unsavedChanges') <> '0' THEN
    RAISE EXCEPTION 'T1e: get_ai_routing wrong: %', v;
  END IF;

  v := core.get_usage(NULL, 'TIER');
  IF (v->>'success') <> 'true' OR (v->'data'->>'period') IS NULL THEN
    RAISE EXCEPTION 'T1f: get_usage wrong: %', v;
  END IF;

  -- An MD permission is not a second factor. 011's money-moving gate must
  -- refuse the AAL1 request before FIN-07 can queue it.
  BEGIN
    PERFORM core.put_budget(
      'TIER','STANDARD','{"cap":{"amount":6000000,"currency":"MYR"}}'::jsonb);
    RAISE EXCEPTION 'T1g0: an AAL1-only MD queued or executed a budget cap raise';
  EXCEPTION WHEN SQLSTATE 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb ->> 'code') <> 'FORBIDDEN'
       OR (v_detail::jsonb ->> 'reason') <> 'AAL2_REQUIRED' THEN
      RAISE EXCEPTION 'T1g0: AAL1 cap raise refused for the wrong reason: %', v_detail;
    END IF;
  END;

  -- With a real AAL2 session, MD may request the raise but FIN-07 queues it;
  -- the cap remains unchanged until a different MD decides the approval.
  PERFORM pg_temp.as_user_aal2(
    (SELECT id_val::uuid FROM t027_ids WHERE k='md1'),
    'a0270000-5e55-4000-8000-0000000000d1'::uuid);
  v := core.put_budget('TIER','STANDARD', '{"cap":{"amount":6000000,"currency":"MYR"}}'::jsonb);
  IF (v->>'success') <> 'true'
     OR (v->'data'->>'status') <> 'QUEUED_FOR_APPROVAL'
     OR (v#>>'{data,approvalRequest,policyId}') <> 'FIN-07'
     OR (v#>>'{data,approvalRequest,approverRole}') <> 'MD' THEN
    RAISE EXCEPTION 'T1g: MD cap raise was not queued for FIN-07 approval: %', v;
  END IF;
  IF (SELECT cap_sen FROM core.ai_budgets WHERE key='STANDARD') <> 5000000 THEN
    RAISE EXCEPTION 'T1g1: queued cap raise applied before approval';
  END IF;

  v_approval_id := (v #>> '{data,approvalRequest,id}')::uuid;
  PERFORM pg_temp.as_user_aal2(
    (SELECT id_val::uuid FROM t027_ids WHERE k='md3'),
    'a0270000-5e55-4000-8000-0000000000d3'::uuid);
  v := core.get_approval(v_approval_id::text);
  v_diff_hash := v #>> '{data,diffHash}';
  v := core.decide_approval(v_approval_id,'APPROVE',NULL,v_diff_hash,NULL);
  IF (v->>'success') <> 'true'
     OR (v->'data'->>'status') <> 'APPROVED'
     OR (SELECT cap_sen FROM core.ai_budgets WHERE key='STANDARD') <> 6000000 THEN
    RAISE EXCEPTION 'T1g2: a different MD did not execute the approved cap raise: %', v;
  END IF;

  -- Lowering a cap is a direct ai:budget:write edit, with no AAL2 step-up and
  -- no second approval row.
  PERFORM pg_temp.as_user((SELECT id_val::uuid FROM t027_ids WHERE k='md1'));
  SELECT pg_catalog.count(*) INTO v_before_count
    FROM core.approval_requests WHERE action_type = 'BUDGET_CAP_RAISE';
  v := core.put_budget('TIER','STANDARD', '{"cap":{"amount":4000000,"currency":"MYR"}}'::jsonb);
  IF (v->>'success') <> 'true'
     OR (v#>>'{data,cap,amount}') <> '4000000'
     OR (SELECT pg_catalog.count(*) FROM core.approval_requests
          WHERE action_type = 'BUDGET_CAP_RAISE') <> v_before_count THEN
    RAISE EXCEPTION 'T1g3: ai:budget:write cap lower was not direct: %', v;
  END IF;

  -- Currency belongs to the budget row; a body may not silently change it.
  BEGIN
    PERFORM core.put_budget(
      'TIER','STANDARD','{"cap":{"amount":7000000,"currency":"USD"}}'::jsonb);
    RAISE EXCEPTION 'T1g4: mismatched budget currency was accepted';
  EXCEPTION WHEN SQLSTATE 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb ->> 'code') <> 'VALIDATION_FAILED'
       OR (v_detail::jsonb #>> '{fields,0,reason}') <> 'CURRENCY_MISMATCH' THEN
      RAISE EXCEPTION 'T1g4: currency mismatch returned the wrong detail: %', v_detail;
    END IF;
  END;

  v := core.get_tenant();
  IF (v->>'success') <> 'true' OR (v->'data'->>'name') IS NULL THEN
    RAISE EXCEPTION 'T1h: get_tenant wrong: %', v;
  END IF;

  v := core.list_library_assets();
  IF (v->>'success') <> 'true' THEN
    RAISE EXCEPTION 'T1i: list_library_assets refused MD: %', v;
  END IF;
END
$t1$;

-- ═══ T2 · ADMIN-only paths ══════════════════════════════════════════════

DO $t2_md$
DECLARE v_detail text; v_state text; v_md1 uuid;
BEGIN
  SELECT id_val::uuid INTO v_md1 FROM t027_ids WHERE k='md1';
  PERFORM pg_temp.as_user(v_md1);
  BEGIN
    PERFORM core.retry_run((SELECT id_val FROM t027_ids WHERE k='run_ok'), NULL);
    RAISE EXCEPTION 'T2a: MD retried a run (should be ADMIN-only)';
  EXCEPTION WHEN SQLSTATE 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb ->> 'code') <> 'FORBIDDEN'
       OR (v_detail::jsonb ->> 'requiredPermission') <> 'run:retry' THEN
      RAISE EXCEPTION 'T2a: MD refused for the wrong reason: %', v_detail;
    END IF;
  END;

  BEGIN
    PERFORM core.create_knowledge_source('{"name":"nope","type":"HRDC_CIRCULAR","retrievalScopes":[]}'::jsonb);
    RAISE EXCEPTION 'T2a2: MD created a knowledge source (should be ADMIN-only)';
  EXCEPTION WHEN SQLSTATE 'TRNOS' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF (v_detail::jsonb ->> 'code') <> 'FORBIDDEN'
       OR (v_detail::jsonb ->> 'requiredPermission') <> 'knowledge:source:write' THEN
      RAISE EXCEPTION 'T2a2: MD refused for the wrong reason: %', v_detail;
    END IF;
  END;
END
$t2_md$;

DO $t2$
DECLARE v jsonb; v_admin uuid; v_kid text;
BEGIN
  SELECT id_val::uuid INTO v_admin FROM t027_ids WHERE k='admin';
  PERFORM pg_temp.as_user(v_admin);

  v := core.retry_run((SELECT id_val FROM t027_ids WHERE k='run_ok'), NULL);
  IF (v->>'success') <> 'true' OR (v->'data'->>'status') <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'T2b: ADMIN retry_run failed: %', v;
  END IF;

  v := core.dead_letter_run((SELECT id_val FROM t027_ids WHERE k='run_bad'), '{"reason":"t027 dead letter"}'::jsonb);
  IF (v->>'success') <> 'true' OR (v->'data'->'failure'->>'deadLettered') <> 'true' THEN
    RAISE EXCEPTION 'T2c: ADMIN dead_letter_run failed: %', v;
  END IF;

  v := core.create_knowledge_source('{"name":"T027 source","type":"HRDC_CIRCULAR","retrievalScopes":["COMPLIANCE"]}'::jsonb);
  IF (v->>'success') <> 'true' THEN RAISE EXCEPTION 'T2d: ADMIN create_knowledge_source failed: %', v; END IF;
  v_kid := v->'data'->>'id';

  v := core.check_knowledge_source(v_kid);
  IF (v->>'success') <> 'true' THEN RAISE EXCEPTION 'T2e: ADMIN check_knowledge_source failed: %', v; END IF;

  v := core.reingest_knowledge_source(v_kid);
  IF (v->>'success') <> 'true' OR (v->'data'->>'embeddingStatus') <> 'PENDING' OR (v->'data' ? 'runId') THEN
    RAISE EXCEPTION 'T2f: reingest_knowledge_source did not return the honest queued state: %', v;
  END IF;

  v := core.list_providers();
  IF (v->>'success') <> 'true' OR jsonb_array_length(v->'data'->'data') <> 1 THEN
    RAISE EXCEPTION 'T2g: ADMIN list_providers wrong: %', v;
  END IF;

  v := core.put_ai_routing('[{"actionType":"PROPOSAL_SEND","tier":"STANDARD","escalationLadder":[],"jury":{"mode":"GATE","quorum":1,"of":1,"tiers":["STANDARD"]},"requiredForAutonomous":false}]'::jsonb);
  IF (v->>'success') <> 'true' THEN RAISE EXCEPTION 'T2h: ADMIN put_ai_routing failed: %', v; END IF;
END
$t2$;

-- ═══ T3 · SALES: forbidden on agent/run/knowledge/provider/routing, ok on library/tenant ═══

DO $t3$
DECLARE v jsonb; v_sales uuid;
BEGIN
  SELECT id_val::uuid INTO v_sales FROM t027_ids WHERE k='sales';
  PERFORM pg_temp.as_user(v_sales);

  v := core.list_agents();
  IF (v->'error'->>'code') <> 'FORBIDDEN' OR (v->'error'->'details'->>'requiredPermission') <> 'agent:read' THEN
    RAISE EXCEPTION 'T3a: SALES not refused agent:read: %', v;
  END IF;

  v := core.list_runs();
  IF (v->'error'->>'code') <> 'FORBIDDEN' THEN RAISE EXCEPTION 'T3b: SALES not refused run:read: %', v; END IF;

  v := core.list_providers();
  IF (v->'error'->>'code') <> 'FORBIDDEN' THEN RAISE EXCEPTION 'T3c: SALES not refused ai:provider:read: %', v; END IF;

  v := core.get_ai_routing();
  IF (v->'error'->>'code') <> 'FORBIDDEN' THEN RAISE EXCEPTION 'T3d: SALES not refused ai:routing:read: %', v; END IF;

  v := core.list_library_assets();
  IF (v->>'success') <> 'true' THEN RAISE EXCEPTION 'T3e: SALES refused library:read: %', v; END IF;

  v := core.get_tenant();
  IF (v->>'success') <> 'true' THEN RAISE EXCEPTION 'T3f: SALES refused tenant:read: %', v; END IF;
END
$t3$;

-- ═══ T4 · CLIENT: forbidden on everything, byte-identical real vs fake id ═

DO $t4$
DECLARE v1 jsonb; v2 jsonb; v_client uuid;
BEGIN
  SELECT id_val::uuid INTO v_client FROM t027_ids WHERE k='client';
  PERFORM pg_temp.as_user(v_client);

  v1 := core.get_run((SELECT id_val FROM t027_ids WHERE k='run_ok'));
  v2 := core.get_run('00000000-0000-0000-0000-000000000000');
  IF v1 <> v2 OR (v1->'error'->>'code') <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T4a: CLIENT get_run not byte-identical FORBIDDEN for real vs fake id: % / %', v1, v2;
  END IF;

  IF (core.list_library_assets()->'error'->>'code') <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T4b: CLIENT not refused library:read';
  END IF;
  IF (core.get_tenant()->'error'->>'code') <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T4c: CLIENT not refused tenant:read';
  END IF;
END
$t4$;

-- ═══ T5 · anon: 42501 ═════════════════════════════════════════════════════

DO $t5$
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM core.list_agents();
    RAISE EXCEPTION 'T5: anon reached core.list_agents()';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END
$t5$;

-- ═══ T6 · cross-tenant isolation ══════════════════════════════════════════

DO $t6$
DECLARE v jsonb; v_md2 uuid;
BEGIN
  SELECT id_val::uuid INTO v_md2 FROM t027_ids WHERE k='md2';
  PERFORM pg_temp.as_user(v_md2);

  v := core.list_agents();
  IF jsonb_array_length(v->'data'->'data') <> 0 THEN
    RAISE EXCEPTION 'T6a: tenant 2 MD saw another tenant''s agents: %', v;
  END IF;

  v := core.list_runs();
  IF jsonb_array_length(v->'data'->'data') <> 0 THEN
    RAISE EXCEPTION 'T6b: tenant 2 MD saw another tenant''s runs: %', v;
  END IF;

  v := core.get_run((SELECT id_val FROM t027_ids WHERE k='run_ok'));
  IF (v->'error'->>'code') <> 'NOT_FOUND' THEN
    RAISE EXCEPTION 'T6c: tenant 2 MD did not get NOT_FOUND on tenant 1''s run: %', v;
  END IF;

  v := core.list_providers();
  IF jsonb_array_length(v->'data'->'data') <> 0 THEN
    RAISE EXCEPTION 'T6d: tenant 2 MD saw another tenant''s provider keys: %', v;
  END IF;
END
$t6$;

-- ═══ T7 · listProviders never returns key material ═══════════════════════

DO $t7$
DECLARE v jsonb; v_admin uuid; v_row jsonb;
BEGIN
  SELECT id_val::uuid INTO v_admin FROM t027_ids WHERE k='admin';
  PERFORM pg_temp.as_user(v_admin);
  v := core.list_providers();
  FOR v_row IN SELECT * FROM jsonb_array_elements(v->'data'->'data') LOOP
    IF v_row ? 'key' THEN
      RAISE EXCEPTION 'T7: listProviders row carries a raw "key" field: %', v_row;
    END IF;
    IF pg_catalog.strpos(v_row ->> 'maskedKey', '•') = 0 THEN
      RAISE EXCEPTION 'T7: maskedKey does not look masked: %', v_row;
    END IF;
  END LOOP;
END
$t7$;

-- ═══ T8 · teeth-check ══════════════════════════════════════════════════════
--
-- check:grants T1/T2 refuse a test file that defines a SECURITY DEFINER
-- function outside pg_temp, or grants EXECUTE to authenticated - exactly the
-- privilege-escalation shape a teeth-check must not itself create. So this
-- does not touch the real core.get_tenant: pg_temp.get_tenant_ungated is a
-- byte-for-byte copy of its body with the `app.has_permission` gate deleted,
-- created in pg_temp (session-private, dropped at ROLLBACK, T1's own
-- exception). Calling it as CLIENT proves the assertion below is live - it
-- would pass even if get_tenant() always returned FORBIDDEN, unless removing
-- the gate demonstrably flips the result - then the untouched real
-- core.get_tenant is called as the same CLIENT and must still refuse.

RESET ROLE;

CREATE FUNCTION pg_temp.get_tenant_ungated()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'pg_temp, pg_catalog'
AS $body$
DECLARE v_tenant uuid := app.require_tenant_id(); v_row public.tenants%ROWTYPE;
BEGIN
  -- T8: core.get_tenant's body, with the `app.has_permission('tenant:read')`
  -- gate deleted.
  SELECT tenant.* INTO v_row FROM public.tenants AS tenant WHERE tenant.id = v_tenant;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', v_tenant::text));
  END IF;
  RETURN app.ok(pg_catalog.jsonb_build_object('id', v_row.id::text, 'name', v_row.name,
    'locale', v_row.locale, 'timezone', v_row.timezone, 'currency', 'MYR'));
END; $body$;

DO $t8$
DECLARE v jsonb; v_client uuid;
BEGIN
  SELECT id_val::uuid INTO v_client FROM t027_ids WHERE k='client';
  PERFORM pg_temp.as_user(v_client);

  v := pg_temp.get_tenant_ungated();
  IF (v->>'success') <> 'true' THEN
    RAISE EXCEPTION 'T8a: teeth-check is not live - the ungated copy refused CLIENT too: %', v;
  END IF;

  v := core.get_tenant();
  IF (v->'error'->>'code') <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'T8b: the real, untouched core.get_tenant let CLIENT through: %', v;
  END IF;
END
$t8$;

RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'test_027: all checks passed'; END $$;

ROLLBACK;
