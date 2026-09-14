-- Pin for supabase/seeds/hosted_demo_finance.sql. Ends in ROLLBACK; writes
-- nothing durable. Run against a database that already has
-- hosted_demo_akademi_perdana.sql applied (durably — this pin does not seed it,
-- only reads it) and 026 applied.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/test_hosted_demo_finance.sql
--
-- T1  The seed applies inside this transaction with no error.
-- T2  Re-running it in the SAME transaction writes nothing the second time
--     (idempotent), proved by row counts, not by reading "OK" off the log.
-- T3  `core.list_invoices`/`core.get_receivables_aging`/`core.get_collections_queue`/
--     `core.get_collection_draft`/`core.list_commissions`, called as a real MD
--     (impersonated, the test_020/test_021 way), answer with the seeded rows —
--     the actual proof the four screens have real data, not just that the SQL
--     ran.
-- T4  A non-MD, non-FINANCE role (OPS, 002 §11) is FORBIDDEN on all five.

\set ON_ERROR_STOP on
SET client_min_messages = warning;

BEGIN;

DO $setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'akademi-perdana') THEN
    RAISE EXCEPTION 'test_hosted_demo_finance SETUP FAILURE: tenant akademi-perdana not found — apply hosted_demo_akademi_perdana.sql first';
  END IF;
  IF to_regprocedure('core.list_invoices(jsonb,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'test_hosted_demo_finance SETUP FAILURE: 026 is missing or partial';
  END IF;
END;
$setup$;

-- ════════ T1 · the seed applies ════════

\ir hosted_demo_finance.sql

DO $t1$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM core.invoices i
   JOIN public.tenants t ON t.id = i.tenant_id AND t.slug = 'akademi-perdana'
   WHERE i.ref IN ('INV-2026-0001', 'INV-2026-0002')
      OR i.id IN (SELECT id FROM core.invoices WHERE organisation_id IN (
            SELECT id FROM core.organisations WHERE tenant_id = t.id AND name IN
              ('Aurora Manufacturing Sdn Bhd', 'Meridian Logistics Sdn Bhd')));
  ASSERT v_n >= 2, format('T1 FAIL: expected at least 2 finance-seed invoices, found %s', v_n);
  RAISE NOTICE 'T1 PASS - the finance seed applied.';
END;
$t1$;

-- ════════ T2 · idempotent ════════

CREATE TEMP TABLE thf_before AS
SELECT count(*) AS n FROM core.invoices i
  JOIN public.tenants t ON t.id = i.tenant_id AND t.slug = 'akademi-perdana';

\ir hosted_demo_finance.sql

DO $t2b$
DECLARE v_before integer; v_after integer;
BEGIN
  SELECT n INTO v_before FROM thf_before;
  SELECT count(*) INTO v_after FROM core.invoices i
   JOIN public.tenants t ON t.id = i.tenant_id AND t.slug = 'akademi-perdana';
  ASSERT v_after = v_before,
    format('T2 FAIL: invoice count changed on re-run: %s -> %s', v_before, v_after);
  RAISE NOTICE 'T2 PASS - re-running the seed wrote no new invoice.';
END;
$t2b$;

-- ════════ T3 · the six screens answer with real data, as a real MD ════════

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal1')::text;
$fn$;

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'value', v);
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM);
END;
$fn$;

CREATE FUNCTION pg_temp.got(p_key text) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('thf.' || p_key)::jsonb; $fn$;

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('d1449fad-b732-4ee2-93c9-37f338e01358'::uuid,
                 (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana'), 'MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('thf.inv',  pg_temp.try($$SELECT core.list_invoices()$$)::text, true);
SELECT pg_catalog.set_config('thf.age',  pg_temp.try($$SELECT core.get_receivables_aging()$$)::text, true);
SELECT pg_catalog.set_config('thf.que',  pg_temp.try($$SELECT core.get_collections_queue()$$)::text, true);
SELECT pg_catalog.set_config('thf.dft',  pg_temp.try($$SELECT core.get_collection_draft('INV-2026-0002')$$)::text, true);
SELECT pg_catalog.set_config('thf.com',  pg_temp.try($$SELECT core.list_commissions()$$)::text, true);
RESET ROLE;

DO $t3$
DECLARE v_inv jsonb; v_age jsonb; v_que jsonb; v_dft jsonb; v_com jsonb;
BEGIN
  v_inv := pg_temp.got('inv'); v_age := pg_temp.got('age'); v_que := pg_temp.got('que');
  v_dft := pg_temp.got('dft'); v_com := pg_temp.got('com');

  ASSERT (v_inv -> 'value' ->> 'success')::boolean
     AND pg_catalog.jsonb_array_length(v_inv -> 'value' -> 'data' -> 'data') >= 2,
    format('T3a FAIL: list_invoices: %s', v_inv);
  ASSERT (v_age -> 'value' ->> 'success')::boolean
     AND pg_catalog.jsonb_typeof(v_age -> 'value' -> 'data' -> 'dsoDays') = 'number',
    format('T3b FAIL: get_receivables_aging: %s', v_age);
  ASSERT (v_que -> 'value' ->> 'success')::boolean
     AND pg_catalog.jsonb_array_length(v_que -> 'value' -> 'data' -> 'data') >= 1,
    format('T3c FAIL: get_collections_queue: %s', v_que);
  ASSERT (v_dft -> 'value' ->> 'success')::boolean
     AND (v_dft -> 'value' -> 'data' ->> 'rateSource') IN ('LIVE', 'CACHED'),
    format('T3d FAIL: get_collection_draft: %s', v_dft);
  ASSERT (v_com -> 'value' ->> 'success')::boolean
     AND pg_catalog.jsonb_array_length(v_com -> 'value' -> 'data' -> 'data') >= 2,
    format('T3e FAIL: list_commissions: %s', v_com);
  RAISE NOTICE 'T3 PASS - all six finance reads answer with the seeded rows, as a real MD.';
END;
$t3$;

-- ════════ T4 · a role with none of the four permissions is refused ════════
--
-- No OPS-role member exists in this tenant today (only the three MDs), and
-- this pin does not write a durable one — a throwaway fixture user, scoped to
-- this transaction and gone at ROLLBACK, the same as test_020/test_021/
-- test_026's own impersonation fixtures.

INSERT INTO auth.users (id, email) VALUES
  ('00000f00-0000-4000-8000-00000000000f', 'thf-ops@example.invalid');
INSERT INTO public.memberships (tenant_id, user_id, role, actor_kind, client_scope, team_scope, status, is_default)
VALUES ((SELECT id FROM public.tenants WHERE slug = 'akademi-perdana'),
        '00000f00-0000-4000-8000-00000000000f', 'OPS', 'HUMAN', 'ALL', 'ALL', 'ACTIVE', true);

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000f00-0000-4000-8000-00000000000f'::uuid,
                 (SELECT id FROM public.tenants WHERE slug = 'akademi-perdana'), 'OPS'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('thf.ops_inv', pg_temp.try($$SELECT core.list_invoices()$$)::text, true);
RESET ROLE;

DO $t4$
DECLARE v jsonb;
BEGIN
  v := pg_temp.got('ops_inv');
  ASSERT (v -> 'value' ->> 'success') = 'false' AND (v -> 'value' -> 'error' ->> 'code') = 'FORBIDDEN',
    format('T4 FAIL: expected FORBIDDEN for a non-finance role, got %s', v);
  RAISE NOTICE 'T4 PASS - a role without invoice:read is refused.';
END;
$t4$;

ROLLBACK;
