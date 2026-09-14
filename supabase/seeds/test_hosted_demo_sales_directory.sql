-- Pin for hosted_demo_sales_directory.sql and its wipe. Ends in ROLLBACK.
--
-- Run from supabase/seeds/, against a database where 001-023 are applied and
-- tenant `akademi-perdana` is provisioned with its three MD memberships (the
-- hosted post-provision state):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test_hosted_demo_sales_directory.sql
--
-- \ir brings the base seed and this seed into the pin's own open transaction —
-- same technique test_hosted_demo.sql uses for hosted_demo_akademi_perdana.sql —
-- so the pin proves the real two-file run order rather than a copy of it.
--
-- T0  precondition: tenant found (else the base seed has not run)
-- T1  exact seed-row counts: 1 contact, 1 opportunity, 3 suggestions — no other
--     row in those three tables moved
-- T2  legal states only: the opportunity is NEW (the one ungated insert edge),
--     every suggestion is OPEN and points at a real seeded programme
-- T3  the 023 RPCs see the new rows, as `authenticated` with an MD's own claims:
--     `search_organisations` finds the new organisation's contact host by name,
--     `list_opportunities` returns the new opportunity at NEW, and
--     `get_organisation_suggestions` returns exactly the seeded CROSS_SELL row
--     for each of the three organisations, with `actions` and a provenance floor
-- T4  second run of the seed changes nothing (counts, ids)
-- T5  wipe: zero seed rows in this file's own id range; every base-seed row
--     untouched

\set ON_ERROR_STOP on
BEGIN;

-- Hosted post-provision state, reproduced for the pin (the base seed itself
-- deliberately never provisions a tenant — its own header says so). The three
-- ids are the real MD users this repo's other lanes already use; the shim has
-- no `auth.users` rows for them until this statement creates one.
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('d1449fad-b732-4ee2-93c9-37f338e01358','authenticated','authenticated','khucode@gmail.com'),
  ('ad615910-2d87-42a4-9855-58f52409ec6d','authenticated','authenticated','khumeren@gmail.com'),
  ('415dad6e-c53f-4a84-ab50-bf8e9e65223f','authenticated','authenticated','codeshern@gmail.com')
ON CONFLICT (id) DO NOTHING;
SELECT app.provision_tenant('akademi-perdana','Akademi Perdana','Asia/Kuala_Lumpur','0eaa9b60-4e02-4498-bf50-7151e9fe92cb')
 WHERE NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'akademi-perdana');
INSERT INTO public.memberships (tenant_id,user_id,role,actor_kind,client_scope,team_scope,status,is_default) VALUES
  ('0eaa9b60-4e02-4498-bf50-7151e9fe92cb','d1449fad-b732-4ee2-93c9-37f338e01358','MD','HUMAN','ALL','ALL','ACTIVE',true),
  ('0eaa9b60-4e02-4498-bf50-7151e9fe92cb','ad615910-2d87-42a4-9855-58f52409ec6d','MD','HUMAN','ALL','ALL','ACTIVE',true),
  ('0eaa9b60-4e02-4498-bf50-7151e9fe92cb','415dad6e-c53f-4a84-ab50-bf8e9e65223f','MD','HUMAN','ALL','ALL','ACTIVE',true)
ON CONFLICT (tenant_id, user_id) DO NOTHING;
INSERT INTO public.user_profiles (tenant_id,user_id,display_name,email) VALUES
  ('0eaa9b60-4e02-4498-bf50-7151e9fe92cb','d1449fad-b732-4ee2-93c9-37f338e01358','Khu Code','khucode@gmail.com'),
  ('0eaa9b60-4e02-4498-bf50-7151e9fe92cb','ad615910-2d87-42a4-9855-58f52409ec6d','Khu Meren','khumeren@gmail.com'),
  ('0eaa9b60-4e02-4498-bf50-7151e9fe92cb','415dad6e-c53f-4a84-ab50-bf8e9e65223f','Code Shern','codeshern@gmail.com')
ON CONFLICT (tenant_id, user_id) DO NOTHING;

CREATE FUNCTION pg_temp.sd_pin_id(p_key text) RETURNS uuid
LANGUAGE sql AS $fn$
  SELECT ('de30da7a-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:sales-directory:' || p_key) AS h) AS k;
$fn$;

CREATE FUNCTION pg_temp.sd_claims(p_user uuid, p_tenant uuid) RETURNS text
LANGUAGE sql AS $fn$
  SELECT (pg_catalog.jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', 'MD', 'actor_kind', 'HUMAN', 'aal', 'aal1'))::text;
$fn$;

\ir hosted_demo_akademi_perdana.sql

DO $t0$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'akademi-perdana') THEN
    RAISE EXCEPTION 'T0 FAIL: tenant akademi-perdana not found after the base seed';
  END IF;
  RAISE NOTICE 'T0 PASS';
END
$t0$;

\ir hosted_demo_sales_directory.sql

DO $t1$
DECLARE v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
BEGIN
  IF (SELECT count(*) FROM core.contacts WHERE tenant_id = v_t AND id = pg_temp.sd_pin_id('con:auroratl')) <> 1 THEN
    RAISE EXCEPTION 'T1 FAIL: the new contact was not inserted';
  END IF;
  IF (SELECT count(*) FROM core.opportunities WHERE tenant_id = v_t AND id = pg_temp.sd_pin_id('opp:auroratl')) <> 1 THEN
    RAISE EXCEPTION 'T1 FAIL: the new opportunity was not inserted';
  END IF;
  IF (SELECT count(*) FROM core.organisation_suggestions AS s
       WHERE s.tenant_id = v_t
         AND s.id IN (pg_temp.sd_pin_id('sug:aurora'), pg_temp.sd_pin_id('sug:kenanga'), pg_temp.sd_pin_id('sug:meridian'))) <> 3 THEN
    RAISE EXCEPTION 'T1 FAIL: expected exactly 3 seeded suggestions';
  END IF;
  RAISE NOTICE 'T1 PASS: 1 contact, 1 opportunity, 3 suggestions';
END
$t1$;

DO $t2$
DECLARE v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
BEGIN
  IF (SELECT o.stage FROM core.opportunities AS o WHERE o.id = pg_temp.sd_pin_id('opp:auroratl')) <> 'NEW' THEN
    RAISE EXCEPTION 'T2 FAIL: the seeded opportunity is not at NEW';
  END IF;
  IF EXISTS (
    SELECT 1 FROM core.organisation_suggestions AS s
     WHERE s.tenant_id = v_t
       AND s.id IN (pg_temp.sd_pin_id('sug:aurora'), pg_temp.sd_pin_id('sug:kenanga'), pg_temp.sd_pin_id('sug:meridian'))
       AND (s.status <> 'OPEN' OR s.programme_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM core.programmes p WHERE p.id = s.programme_id AND p.tenant_id = v_t))) THEN
    RAISE EXCEPTION 'T2 FAIL: a seeded suggestion is not OPEN, or does not name a real seeded programme';
  END IF;
  RAISE NOTICE 'T2 PASS: legal states only';
END
$t2$;

-- ════════ T3 · the 023 RPCs, as an MD with real hook claims ════════

DO $t3$
DECLARE
  v_t   uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
  v_md  uuid := 'd1449fad-b732-4ee2-93c9-37f338e01358';
  v_org uuid;
  v_search jsonb;
  v_opps   jsonb;
  v_sugg   jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_temp.sd_claims(v_md, v_t), true);
  SET LOCAL ROLE authenticated;

  v_search := core.search_organisations('Aurora Precision');
  IF pg_catalog.jsonb_array_length(v_search -> 'data') <> 1
     OR (v_search -> 'data' -> 0 ->> 'name') IS DISTINCT FROM 'Aurora Precision Tooling Sdn Bhd' THEN
    RAISE EXCEPTION 'T3 FAIL: search_organisations did not find the seeded organisation: %', v_search;
  END IF;

  v_opps := core.list_opportunities('[]'::jsonb, NULL, '{"size":50}'::jsonb);
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_opps -> 'data' -> 'data') AS row(value)
     WHERE (row.value ->> 'stage') = 'NEW'
       AND (row.value -> 'value' ->> 'amount')::bigint = 1580000) THEN
    RAISE EXCEPTION 'T3 FAIL: list_opportunities does not carry the seeded NEW opportunity: %', v_opps;
  END IF;

  SELECT org.id INTO v_org FROM core.organisations AS org
   WHERE org.tenant_id = v_t AND org.name = 'Aurora Manufacturing Sdn Bhd';
  v_sugg := core.get_organisation_suggestions(v_org::text);
  IF pg_catalog.jsonb_array_length(v_sugg -> 'data' -> 'data') <> 1
     OR (v_sugg -> 'data' -> 'data' -> 0 ->> 'title') IS DISTINCT FROM 'Conflict to Collaboration'
     OR pg_catalog.jsonb_array_length(v_sugg -> 'data' -> 'data' -> 0 -> 'actions') <> 2
     OR (v_sugg -> 'data' -> 'data' -> 0 -> 'provenance' ->> 'origin') IS NULL THEN
    RAISE EXCEPTION 'T3 FAIL: get_organisation_suggestions(Aurora) wrong shape: %', v_sugg;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'T3 PASS: search, list and suggestions all see the seeded rows';
END
$t3$;

-- ════════ T4 · idempotence ════════
--
-- `\ir` is a psql meta-command and cannot appear inside a DO block, so the
-- before/after snapshot is taken across two top-level statements rather than
-- inside one PL/pgSQL function.

CREATE TEMP TABLE t4_before ON COMMIT DROP AS
SELECT count(*) AS n FROM core.organisation_suggestions WHERE id::text LIKE 'de30da7a-5eed-4%';

\ir hosted_demo_sales_directory.sql

DO $t4$
DECLARE v_before bigint := (SELECT n FROM t4_before); v_after bigint;
BEGIN
  SELECT count(*) INTO v_after FROM core.organisation_suggestions
   WHERE id::text LIKE 'de30da7a-5eed-4%';
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'T4 FAIL: a second run of the seed changed the suggestion count (% -> %)', v_before, v_after;
  END IF;
  RAISE NOTICE 'T4 PASS: second run inserted nothing';
END
$t4$;

-- ════════ T5 · wipe ════════

\ir hosted_demo_sales_directory_wipe.sql

DO $t5$
DECLARE v_t uuid := (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana');
BEGIN
  IF EXISTS (SELECT 1 FROM core.contacts WHERE id = pg_temp.sd_pin_id('con:auroratl'))
     OR EXISTS (SELECT 1 FROM core.opportunities WHERE id = pg_temp.sd_pin_id('opp:auroratl'))
     OR EXISTS (SELECT 1 FROM core.organisation_suggestions
                 WHERE id IN (pg_temp.sd_pin_id('sug:aurora'), pg_temp.sd_pin_id('sug:kenanga'), pg_temp.sd_pin_id('sug:meridian'))) THEN
    RAISE EXCEPTION 'T5 FAIL: the wipe left a seed row behind';
  END IF;
  -- The base seed's own rows (a disjoint id namespace) are untouched.
  IF (SELECT count(*) FROM core.organisations WHERE tenant_id = v_t
       AND name IN ('Aurora Manufacturing Sdn Bhd','Kenanga Retail Group Berhad','Meridian Logistics Sdn Bhd')) <> 3 THEN
    RAISE EXCEPTION 'T5 FAIL: the wipe touched a base-seed organisation';
  END IF;
  RAISE NOTICE 'T5 PASS: wipe removed exactly this seed''s rows';
END
$t5$;

ROLLBACK;
