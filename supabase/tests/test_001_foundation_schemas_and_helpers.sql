-- ============================================================================
-- PIN 001 · foundation_schemas_and_helpers
-- ============================================================================
--
-- Run only AFTER 001 has been applied to the target database.
-- Every fixture write is rolled back; this file writes nothing durable.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f supabase/tests/test_001_foundation_schemas_and_helpers.sql
-- A run that reaches the final NOTICE is a PASS. Any failed ASSERT or RAISE
-- aborts the transaction, so nothing survives either way.
--
-- WHAT THIS PIN IS FOR. 001 adds no business table and no client-callable RPC,
-- so a purely structural pin would prove almost nothing worth proving. The four
-- assertions that matter are BEHAVIOURAL, and three of them are the kind that
-- pass by inspection and fail in production:
--
--   T6  round_half_up_minor is HALF-UP, not banker's rounding. Postgres' float
--       and numeric round() disagree on 2.5 — numeric gives 3, double precision
--       gives 2 — and an implicit cast anywhere in a later money expression
--       silently switches which one you get. The pin fixes the answer.
--   T8  enforce_immutable_columns refuses value -> NULL. An "immutable" column
--       that can be erased is not immutable, and erasure is the shape the
--       attack takes, not mutation.
--   T9  A trigger attached with a column name that does not exist RAISES rather
--       than silently protecting nothing. This is the failure mode that would
--       leave `ref` freely writable across the whole model with every migration
--       looking correct.
--   T10 anon genuinely cannot execute an `app` function. Asserted by actually
--       becoming anon, not only by reading has_function_privilege.
--
-- RLS FOUR-WAY: not applicable to 001 — it creates no table and therefore no
-- policy. The four-way owner/peer/other-tenant/anon matrix begins in
-- test_014_rls_policies, against tables that exist.
--
-- RUNNABILITY NOTES
-- 1. No auth.users rows are needed: 001 has no RPC that reads auth.uid().
-- 2. T10 swaps to ROLE anon for exactly one probe and RESETs immediately. The
--    probe is a single statement inside its own exception block, so the planner
--    cannot fold it and a caught 42501 does not poison the outer transaction.
-- 3. Fixture objects are namespaced `t001_` so a partial run collides with
--    nothing.
-- 4. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ── canary · prove ASSERT actually raises in this session (the test_084 idiom)
DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION
      'test_001 SETUP FAILURE: ASSERT did not raise - plpgsql.check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN
    NULL;
  END;
END;
$canary$;

-- ── setup guard · 001 is actually applied ───────────────────────────────────
DO $setup$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app'
    AND p.proname IN ('set_updated_at','enforce_immutable_columns',
                      'round_half_up_minor','ok','err');
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION
      'test_001 SETUP FAILURE: expected 5 app helpers, found % - 001 is missing or partial.',
      v_cnt;
  END IF;
END;
$setup$;

-- === T1 · the `app` schema exists and no client role may create in it =======
DO $t1$
DECLARE v_bad text;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'app'),
    'T1 FAIL: schema app does not exist';

  SELECT string_agg(r.role_name, ', ') INTO v_bad
  FROM unnest(ARRAY['anon','authenticated']) AS r(role_name)
  WHERE has_schema_privilege(r.role_name, 'app', 'CREATE');
  ASSERT v_bad IS NULL,
    format('T1 FAIL: client role(s) hold CREATE on schema app: %s', v_bad);

  -- USAGE is intended and load-bearing: an RLS predicate is evaluated in the
  -- caller's context and must be able to resolve app.<fn>.
  ASSERT has_schema_privilege('authenticated', 'app', 'USAGE'),
    'T1 FAIL: authenticated lost USAGE on app - RLS predicates in 002+ cannot resolve';
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'core'),
    'T1 FAIL: schema core does not exist - the whole domain has nowhere to live';
  RAISE NOTICE 'T1 PASS - app and core exist, USAGE yes, CREATE no on app.';
END;
$t1$;

-- === T2 · the four extensions are installed, and in `extensions` ============
DO $t2$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(want, ', ') INTO v_missing
  FROM unnest(ARRAY['pgcrypto','citext','btree_gist','pg_trgm']) AS want
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = want AND n.nspname = 'extensions'
  );
  ASSERT v_missing IS NULL,
    format('T2 FAIL: extension(s) absent from schema extensions: %s', v_missing);
  RAISE NOTICE 'T2 PASS - pgcrypto, citext, btree_gist, pg_trgm in schema extensions.';
END;
$t2$;

-- === T3 · every helper pins its search_path, pg_catalog first, pg_temp last ==
DO $t3$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app'
    AND NOT ('search_path=pg_catalog, public, extensions, pg_temp'
             = ANY (COALESCE(p.proconfig, ARRAY[]::text[])));
  ASSERT v_bad IS NULL,
    format('T3 FAIL: app function(s) without the pinned search_path: %s', v_bad);
  RAISE NOTICE 'T3 PASS - all app helpers pin search_path.';
END;
$t3$;

-- === T4 · no client role holds EXECUTE on anything in `app` =================
DO $t4$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s->%s', r.role_name, p.proname), ', ') INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN unnest(ARRAY['anon','authenticated']) AS r(role_name)
  WHERE n.nspname = 'app'
    AND has_function_privilege(r.role_name, p.oid, 'EXECUTE');
  ASSERT v_bad IS NULL,
    format('T4 FAIL: client EXECUTE grant(s) in schema app: %s', v_bad);
  RAISE NOTICE 'T4 PASS - zero client EXECUTE grants in app.';
END;
$t4$;

-- === T4b · the pseudo-role PUBLIC holds nothing on the exposed schemas ======
--     Postgres grants PUBLIC rights on `public` by default. If 001's revoke is
--     ever dropped, every table added afterwards inherits a grant nobody wrote.
DO $t4b$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(s.nspname, ', ') INTO v_bad
  FROM unnest(ARRAY['public','core']) AS s(nspname)
  WHERE has_schema_privilege('public', s.nspname, 'CREATE');
  ASSERT v_bad IS NULL,
    format('T4b FAIL: PUBLIC still holds CREATE on schema(s): %s', v_bad);

  -- USAGE too: without CREATE but with USAGE, PUBLIC can still resolve and call
  -- anything in the schema that was not explicitly revoked.
  SELECT string_agg(s.nspname, ', ') INTO v_bad
  FROM unnest(ARRAY['public','core','app']) AS s(nspname)
  WHERE has_schema_privilege('public', s.nspname, 'USAGE');
  ASSERT v_bad IS NULL,
    format('T4b FAIL: PUBLIC still holds USAGE on schema(s): %s', v_bad);

  -- This pin deliberately does NOT assert anything about pg_default_acl. The
  -- ALTER DEFAULT PRIVILEGES revoke in 001 was measured against PostgreSQL
  -- 17.11 and records nothing: a function created afterwards is still
  -- PUBLIC-executable. Asserting it would pin a fiction. The real invariant is
  -- per-object and lives in T4 above and in test_014's schema-wide sweep.
  RAISE NOTICE 'T4b PASS - PUBLIC holds neither CREATE nor USAGE on app/core/public.';
END;
$t4b$;

-- === T5 · the envelopes have EXACTLY the keys the client unwrap depends on ==
DO $t5$
DECLARE
  v_ok      jsonb := app.ok(jsonb_build_object('x', 1));
  v_ok_def  jsonb := app.ok();
  v_err     jsonb := app.err('NOPE');
  v_err_d   jsonb := app.err('NOPE', jsonb_build_object('field', 'ref'));
  v_keys    text[];
BEGIN
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_ok) AS k;
  ASSERT v_keys = ARRAY['data','success'],
    format('T5a FAIL: success envelope keys are %s, expected {data,success}', v_keys);

  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_err) AS k;
  ASSERT v_keys = ARRAY['error','success'],
    format('T5b FAIL: failure envelope keys are %s, expected {error,success}', v_keys);

  ASSERT v_ok -> 'success' = 'true'::jsonb AND v_ok -> 'data' = '{"x":1}'::jsonb,
    format('T5c FAIL: success envelope payload wrong: %s', v_ok);
  ASSERT v_ok_def -> 'data' = '{}'::jsonb,
    format('T5d FAIL: app.ok() default data should be {}, got %s', v_ok_def);
  ASSERT v_err #>> '{error,code}' = 'NOPE',
    format('T5e FAIL: error code not at error.code: %s', v_err);

  -- Details live INSIDE error. A top-level sibling is the 037 mechanism.
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_err_d) AS k;
  ASSERT v_keys = ARRAY['error','success'],
    format('T5f FAIL: app.err(code, details) added a top-level sibling: %s', v_err_d);
  ASSERT v_err_d #>> '{error,details,field}' = 'ref',
    format('T5g FAIL: details not nested under error: %s', v_err_d);
  RAISE NOTICE 'T5 PASS - both envelopes carry exactly two keys, details nested.';
END;
$t5$;

-- === T6 · rounding is HALF-UP, away from zero, and not banker's =============
DO $t6$
BEGIN
  ASSERT app.round_half_up_minor(0.5)   = 1,  'T6a FAIL: 0.5 did not round to 1';
  ASSERT app.round_half_up_minor(1.5)   = 2,  'T6b FAIL: 1.5 did not round to 2';
  -- The one that separates half-up from banker's rounding. Banker's gives 2.
  ASSERT app.round_half_up_minor(2.5)   = 3,
    format('T6c FAIL: 2.5 rounded to %s - that is banker''s rounding, not half-up',
           app.round_half_up_minor(2.5));
  ASSERT app.round_half_up_minor(-0.5)  = -1, 'T6d FAIL: -0.5 did not round away from zero';
  ASSERT app.round_half_up_minor(0.4)   = 0,  'T6e FAIL: 0.4 did not round down';
  ASSERT app.round_half_up_minor(616.67) = 617, 'T6f FAIL: 616.67 did not round to 617';
  -- STRICT: a null amount yields null, never 0. A silent 0 is a free line item.
  ASSERT app.round_half_up_minor(NULL) IS NULL, 'T6g FAIL: NULL input did not return NULL';
  RAISE NOTICE 'T6 PASS - half-up, away from zero, strict on NULL.';
END;
$t6$;

-- ── fixture table for the trigger tests ─────────────────────────────────────
CREATE TABLE public.t001_probe (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref        text,
  payload    text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_t001_probe_updated_at
  BEFORE UPDATE ON public.t001_probe
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER trg_t001_probe_immutable
  BEFORE UPDATE ON public.t001_probe
  FOR EACH ROW EXECUTE FUNCTION app.enforce_immutable_columns('ref');

-- === T7 · set_updated_at actually stamps ====================================
DO $t7$
DECLARE
  v_id    uuid;
  v_before timestamptz;
  v_after  timestamptz;
BEGIN
  INSERT INTO public.t001_probe (ref, payload, updated_at)
  VALUES (NULL, 'one', now() - interval '1 day')
  RETURNING id, updated_at INTO v_id, v_before;

  UPDATE public.t001_probe SET payload = 'two' WHERE id = v_id;
  SELECT updated_at INTO v_after FROM public.t001_probe WHERE id = v_id;

  ASSERT v_after > v_before,
    format('T7 FAIL: updated_at did not advance (% -> %)', v_before, v_after);
  RAISE NOTICE 'T7 PASS - set_updated_at stamps on UPDATE.';
END;
$t7$;

-- === T8 · immutability: NULL->value OK, value->other refused, value->NULL refused
DO $t8$
DECLARE
  v_id     uuid;
  v_caught text;
BEGIN
  SELECT id INTO v_id FROM public.t001_probe LIMIT 1;

  -- (a) NULL -> value is allowed. Several columns in this model are stamped
  --     after insert; freezing from INSERT would make them unwritable.
  UPDATE public.t001_probe SET ref = 'ENQ-2026-0912' WHERE id = v_id;
  ASSERT (SELECT ref FROM public.t001_probe WHERE id = v_id) = 'ENQ-2026-0912',
    'T8a FAIL: NULL -> value was blocked; allocation after insert is impossible';

  -- (b) value -> different value is refused.
  BEGIN
    UPDATE public.t001_probe SET ref = 'ENQ-2026-9999' WHERE id = v_id;
    RAISE EXCEPTION 'T8b FAIL: a frozen ref was overwritten';
  EXCEPTION WHEN integrity_constraint_violation THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    ASSERT v_caught LIKE 'IMMUTABLE_COLUMN:%',
      format('T8b FAIL: wrong error raised: %s', v_caught);
  END;

  -- (c) value -> NULL is refused. Erasure is the attack, not mutation.
  BEGIN
    UPDATE public.t001_probe SET ref = NULL WHERE id = v_id;
    RAISE EXCEPTION 'T8c FAIL: a frozen ref was erased to NULL';
  EXCEPTION WHEN integrity_constraint_violation THEN
    NULL;
  END;

  -- (d) a no-op re-save of the same value is not a violation.
  UPDATE public.t001_probe SET ref = 'ENQ-2026-0912', payload = 'three' WHERE id = v_id;
  ASSERT (SELECT payload FROM public.t001_probe WHERE id = v_id) = 'three',
    'T8d FAIL: an idempotent re-save of the frozen value was refused';

  ASSERT (SELECT ref FROM public.t001_probe WHERE id = v_id) = 'ENQ-2026-0912',
    'T8 FAIL: ref is not what it was frozen as';
  RAISE NOTICE 'T8 PASS - freeze on first value, refuse change and erasure, allow no-op.';
END;
$t8$;

-- === T9 · a trigger naming a column that does not exist RAISES ==============
--     Without this the trigger would quietly protect nothing and every
--     migration attaching it would still look correct.
CREATE TRIGGER trg_t001_probe_misspelled
  BEFORE UPDATE ON public.t001_probe
  FOR EACH ROW EXECUTE FUNCTION app.enforce_immutable_columns('reff');

DO $t9$
DECLARE
  v_id     uuid;
  v_caught text;
BEGIN
  SELECT id INTO v_id FROM public.t001_probe LIMIT 1;
  BEGIN
    UPDATE public.t001_probe SET payload = 'four' WHERE id = v_id;
    RAISE EXCEPTION
      'T9 FAIL: a trigger naming a non-existent column silently protected nothing';
  EXCEPTION WHEN undefined_column THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    ASSERT v_caught LIKE '%does not exist%',
      format('T9 FAIL: wrong message: %s', v_caught);
  END;
  RAISE NOTICE 'T9 PASS - a misspelled column name is a loud failure, not a silent one.';
END;
$t9$;

DROP TRIGGER trg_t001_probe_misspelled ON public.t001_probe;

-- === T10 · anon genuinely cannot execute an app function ====================
--     Structural privilege reads (T4) and actual behaviour can disagree. This
--     becomes anon and tries it. ONE statement inside its own exception block.
DO $t10$
DECLARE v_caught text;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM app.ok('{}'::jsonb);
    RESET ROLE;
    RAISE EXCEPTION 'T10 FAIL: anon executed app.ok';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
  END;
  RESET ROLE;
  ASSERT v_caught IS NOT NULL, 'T10 FAIL: no privilege error was raised for anon';
  RAISE NOTICE 'T10 PASS - anon is refused app.ok (%).', v_caught;
END;
$t10$;

RESET ROLE;

DO $done$
BEGIN
  RAISE NOTICE 'test_001 ALL PASS (T1-T10 incl. T4b, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
