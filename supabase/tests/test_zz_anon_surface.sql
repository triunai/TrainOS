-- ═══════════════════════════════════════════════════════════════════════════
-- test_zz_anon_surface · standing regression: what `anon` can actually reach
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run LAST, against the full applied migration set (001 through whatever the
-- highest numbered pack is — the "zz" prefix is deliberate, so this file
-- sorts after every `test_0NN_*.sql` in any directory listing or glob and is
-- naturally the last pin a build runs). Ends in ROLLBACK and writes nothing
-- durable, though it writes nothing at all — every assertion here is a
-- read against the catalog.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_zz_anon_surface.sql
--
-- WHY THIS EXISTS, BESIDE scripts/check-grants.mjs. That script is a static
-- reader: it looks for the LITERAL text `REVOKE ALL ON FUNCTION ... FROM
-- PUBLIC` in the same file a function is created in, and (necessarily) has
-- blind spots a determined author can hit by accident — a REVOKE issued
-- through a dynamic loop (011 §13's `EXECUTE pg_catalog.format('REVOKE ALL
-- ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function)`), a REVOKE
-- that lives in an earlier migration than the CREATE OR REPLACE that touches
-- the function again, or a REVOKE spelled in a form the script's regex does
-- not recognise. None of that matters to THIS test: it asks the database
-- directly, with `has_function_privilege` / `has_table_privilege`, which is
-- authoritative regardless of how the ACL got the shape it has. The two
-- checks are complementary — the script catches a NEW gap at review time
-- from the diff alone; this test catches ANY gap, old or new, expressed any
-- way, once the migrations actually apply.
--
-- T1  anon holds EXECUTE on ZERO functions in core, app or public, except an
--     explicit allowlist that starts EMPTY and is expected to gain exactly
--     the eventual client-portal endpoints (§16 in doc terms — the
--     unauthenticated proposal view and its siblings) the day they ship.
--     ⚠ WHEN 028 (client portal) LANDS: its (up to) three portal functions
--     become the first real entries. Add each one here, by its exact
--     `schema.function(args)` signature, with the SAME reason 028's own
--     migration gives for granting it — this file's allowlist is meant to
--     be read next to scripts/check-grants.mjs's `ANON_EXECUTE_ALLOWLIST`
--     (A1 there enforces textual parity between that list, the hardening
--     migration, and ITS own SQL test; this file is a SEPARATE, broader
--     sweep across every schema and is not itself party to A1 — keeping the
--     two lists in the same shape, updated in the same commit, is a human
--     discipline this header names rather than a mechanism that enforces it).
-- T2  anon holds no TABLE, VIEW or SEQUENCE privilege (SELECT, INSERT,
--     UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, USAGE) in core, app or
--     public — the same invariant 014's own header states in prose
--     ("`anon` holds SELECT on no table in `core`, EXECUTE on no function in
--     `core`"), asserted here as a standing, mechanical check rather than a
--     one-time claim in a migration's comment.
-- T3  `authenticated` and `service_role` are NOT swept by this file — they
--     are meant to reach a great deal, and a blanket zero-privilege
--     assertion for either would be false by design. This file is
--     deliberately `anon`-only.
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
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'zz preflight: role "anon" does not exist; this is not a Supabase database';
  END IF;
END;
$preflight$;

-- ── The allowlist. Empty today. See the header's note on what lands here
--    the day 028 (client portal) ships, and keep it in the same shape as
--    scripts/check-grants.mjs's ANON_EXECUTE_ALLOWLIST. ────────────────────
DO $t1$
DECLARE
  v_allowlist text[] := ARRAY[]::text[];
  v_bad       text[];
BEGIN
  SELECT pg_catalog.array_agg(
           pg_catalog.format('%I.%I(%s)', n.nspname, p.proname,
             pg_catalog.pg_get_function_identity_arguments(p.oid))
           ORDER BY n.nspname, p.proname)
    INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('core', 'app', 'public')
     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT (pg_catalog.format('%I.%I(%s)', n.nspname, p.proname,
                pg_catalog.pg_get_function_identity_arguments(p.oid)) = ANY (v_allowlist));

  PERFORM pg_temp.assert(v_bad IS NULL,
    pg_catalog.format('T1 anon holds EXECUTE on a function outside the allowlist: %s', v_bad));
END;
$t1$;

-- ── No table/view privilege at all. `USAGE` is not a `has_table_privilege`
--    type (it applies to sequences via `has_sequence_privilege`, checked
--    separately below), so this sweep excludes relkind 'S' and the other
--    seven privileges cover every relation kind PostgREST could reach.
DO $t2$
DECLARE
  v_bad text[];
BEGIN
  SELECT pg_catalog.array_agg(DISTINCT n.nspname || '.' || c.relname || ':' || priv.p
                               ORDER BY n.nspname || '.' || c.relname || ':' || priv.p)
    INTO v_bad
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN pg_catalog.unnest(
      ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
    ) AS priv(p)
   WHERE n.nspname IN ('core', 'app', 'public')
     AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
     AND pg_catalog.has_table_privilege('anon', c.oid, priv.p);

  PERFORM pg_temp.assert(v_bad IS NULL,
    pg_catalog.format('T2 anon holds a table/view privilege: %s', v_bad));
END;
$t2$;

-- ── No sequence privilege (USAGE/SELECT/UPDATE) either. ────────────────────
DO $t2b$
DECLARE
  v_bad text[];
BEGIN
  SELECT pg_catalog.array_agg(DISTINCT n.nspname || '.' || c.relname || ':' || priv.p
                               ORDER BY n.nspname || '.' || c.relname || ':' || priv.p)
    INTO v_bad
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN pg_catalog.unnest(ARRAY['USAGE','SELECT','UPDATE']) AS priv(p)
   WHERE n.nspname IN ('core', 'app', 'public')
     AND c.relkind = 'S'
     AND pg_catalog.has_sequence_privilege('anon', c.oid, priv.p);

  PERFORM pg_temp.assert(v_bad IS NULL,
    pg_catalog.format('T2b anon holds a sequence privilege: %s', v_bad));
END;
$t2b$;

-- ── Sanity: this file's sweep actually found rows to check, so a pass above
--    means "checked and clean," not "the queries matched nothing." ────────
DO $t3$
DECLARE v_functions integer; v_relations integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_functions
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('core', 'app', 'public');
  SELECT pg_catalog.count(*) INTO v_relations
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('core', 'app', 'public') AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S');

  PERFORM pg_temp.assert(v_functions > 100,
    pg_catalog.format('T3a sweep saw a plausible function count (%s) - not an empty/misconfigured database', v_functions));
  PERFORM pg_temp.assert(v_relations > 100,
    pg_catalog.format('T3b sweep saw a plausible relation count (%s) - not an empty/misconfigured database', v_relations));
END;
$t3$;

DO $$ BEGIN RAISE NOTICE 'test_zz_anon_surface ALL PASS'; END $$;

ROLLBACK;
