-- Pin for hosted_demo_ops.sql and hosted_demo_ops_wipe.sql. Ends in ROLLBACK.
--
-- Run from the repo root against a database where tenant `akademi-perdana` is
-- provisioned, all three MD users are members, and 001-021+027 are applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/test_hosted_demo_ops.sql
--
-- T1  seed: exact row counts per table in the de270272-5eed-4… range
-- T2  second seed run changes nothing (same counts, same ids)
-- T3  027's RPCs return the seeded rows for an MD, as `authenticated` with
--     real hook claims: list_agents (4), list_runs (6, 1 dead-lettered),
--     get_ai_routing (3 entries), list_providers (1, masked only), get_usage
-- T4  wipe: zero seed rows anywhere in the de270272-5eed-4… range

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE pin_ops_counts (phase text, tbl text, n bigint, PRIMARY KEY (phase, tbl)) ON COMMIT DROP;

CREATE FUNCTION pg_temp.snapshot(p_phase text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
BEGIN
  INSERT INTO pin_ops_counts VALUES
    (p_phase, 'core.agents',            (SELECT count(*) FROM core.agents WHERE tenant_id = v_t AND id::text LIKE 'de270272-5eed-4%')),
    (p_phase, 'core.autonomy_grants',   (SELECT count(*) FROM core.autonomy_grants ag JOIN core.agents a ON a.tenant_id = ag.tenant_id AND a.agent_id = ag.agent_id WHERE ag.tenant_id = v_t AND a.id::text LIKE 'de270272-5eed-4%')),
    (p_phase, 'core.runs',              (SELECT count(*) FROM core.runs WHERE tenant_id = v_t AND id::text LIKE 'de270272-5eed-4%')),
    (p_phase, 'core.routing_entries',   (SELECT count(*) FROM core.routing_entries WHERE tenant_id = v_t AND version_id::text LIKE 'de270272-5eed-4%')),
    (p_phase, 'core.ai_budgets',        (SELECT count(*) FROM core.ai_budgets WHERE tenant_id = v_t AND scope = 'TIER' AND key = 'STANDARD')),
    (p_phase, 'core.ai_provider_keys',  (SELECT count(*) FROM core.ai_provider_keys WHERE tenant_id = v_t AND id::text LIKE 'de270272-5eed-4%')),
    (p_phase, 'core.knowledge_sources', (SELECT count(*) FROM core.knowledge_sources WHERE tenant_id = v_t AND id::text LIKE 'de270272-5eed-4%')),
    (p_phase, 'core.library_assets',    (SELECT count(*) FROM core.library_assets WHERE tenant_id = v_t AND id::text LIKE 'de270272-5eed-4%')),
    (p_phase, 'auth.users',             (SELECT count(*) FROM auth.users WHERE id::text LIKE 'de270272-5eed-4%'));
END; $fn$;

\i supabase/seeds/hosted_demo_ops.sql
SELECT pg_temp.snapshot('T1');

DO $t1$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM pin_ops_counts WHERE phase = 'T1' LOOP
    IF (r.tbl = 'core.agents' AND r.n <> 4)
       OR (r.tbl = 'core.autonomy_grants' AND r.n <> 4)
       OR (r.tbl = 'core.runs' AND r.n <> 6)
       OR (r.tbl = 'core.routing_entries' AND r.n <> 3)
       OR (r.tbl = 'core.ai_budgets' AND r.n <> 1)
       OR (r.tbl = 'core.ai_provider_keys' AND r.n <> 1)
       OR (r.tbl = 'core.knowledge_sources' AND r.n <> 3)
       OR (r.tbl = 'core.library_assets' AND r.n <> 4)
       OR (r.tbl = 'auth.users' AND r.n <> 4) THEN
      RAISE EXCEPTION 'T1: unexpected row count for %: %', r.tbl, r.n;
    END IF;
  END LOOP;
END
$t1$;

-- T2: idempotent.
\i supabase/seeds/hosted_demo_ops.sql
SELECT pg_temp.snapshot('T2');

DO $t2$
DECLARE v_diff integer;
BEGIN
  SELECT count(*) INTO v_diff FROM pin_ops_counts a JOIN pin_ops_counts b USING (tbl)
   WHERE a.phase = 'T1' AND b.phase = 'T2' AND a.n <> b.n;
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'T2: a second seed run changed % table(s)'' counts', v_diff;
  END IF;
END
$t2$;

-- T3: 027's RPCs, as the first real MD.
DO $t3$
DECLARE v jsonb; v_claims text;
BEGIN
  SET LOCAL ROLE supabase_auth_admin;
  SELECT (app.custom_access_token_hook(jsonb_build_object('user_id', 'd1449fad-b732-4ee2-93c9-37f338e01358',
           'claims', jsonb_build_object('sub', 'd1449fad-b732-4ee2-93c9-37f338e01358', 'role','authenticated')))
           -> 'claims')::text INTO v_claims;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims, true);

  v := core.list_agents();
  IF (v->>'success') <> 'true' OR jsonb_array_length(v -> 'data' -> 'data') <> 4 THEN
    RAISE EXCEPTION 'T3a: list_agents did not return the 4 seeded agents: %', v;
  END IF;

  v := core.list_runs();
  IF (v->>'success') <> 'true' OR jsonb_array_length(v -> 'data' -> 'data') <> 6 THEN
    RAISE EXCEPTION 'T3b: list_runs did not return the 6 seeded runs: %', v;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v -> 'data' -> 'data') row
     WHERE row -> 'failure' ->> 'deadLettered' = 'true') THEN
    RAISE EXCEPTION 'T3c: no dead-lettered run among the seeded runs';
  END IF;

  v := core.get_ai_routing();
  IF (v->>'success') <> 'true' OR jsonb_array_length(v -> 'data' -> 'data') <> 3 THEN
    RAISE EXCEPTION 'T3d: get_ai_routing did not return the 3 seeded entries: %', v;
  END IF;

  RESET ROLE;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END
$t3$;

-- ADMIN-only read: list_providers, checked separately as an ADMIN.
DO $t3_admin$
DECLARE v jsonb; v_admin uuid; v_claims text;
BEGIN
  SELECT user_id INTO v_admin FROM public.memberships
   WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana') AND role = 'ADMIN'
   LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'T3e: no ADMIN member on akademi-perdana on this database; skipping listProviders check';
    RETURN;
  END IF;
  SET LOCAL ROLE supabase_auth_admin;
  SELECT (app.custom_access_token_hook(jsonb_build_object('user_id', v_admin::text,
           'claims', jsonb_build_object('sub', v_admin::text, 'role','authenticated')))
           -> 'claims')::text INTO v_claims;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims, true);

  v := core.list_providers();
  IF (v->>'success') <> 'true' OR jsonb_array_length(v -> 'data' -> 'data') <> 1 THEN
    RAISE EXCEPTION 'T3e: list_providers did not return the seeded placeholder: %', v;
  END IF;
  IF (v -> 'data' -> 'data' -> 0) ? 'key' THEN
    RAISE EXCEPTION 'T3f: list_providers returned raw key material';
  END IF;
  RESET ROLE;
END
$t3_admin$;

-- T4: wipe.
\i supabase/seeds/hosted_demo_ops_wipe.sql
SELECT pg_temp.snapshot('T4');

DO $t4$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM pin_ops_counts WHERE phase = 'T4' LOOP
    IF r.n <> 0 THEN
      RAISE EXCEPTION 'T4: % still has % seed row(s) after the wipe', r.tbl, r.n;
    END IF;
  END LOOP;
END
$t4$;

DO $$ BEGIN RAISE NOTICE 'test_hosted_demo_ops: all checks passed'; END $$;

ROLLBACK;
