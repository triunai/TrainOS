-- ============================================================================
-- ROLLBACK 001 · foundation_schemas_and_helpers
-- ============================================================================
--
-- Forward file: migrations/001_foundation_schemas_and_helpers.sql
--
-- PRIOR STATE THIS RESTORES. 001 was the first migration, so the state before it
-- is an empty database: no `app` schema, none of the four extensions, and none
-- of the five helper functions. This file restores exactly that and nothing
-- else. There is no prior definition of any object to reproduce here — 001
-- created all five from nothing — so the "reproduce the prior body in full"
-- rule has no body to reproduce. Stated explicitly rather than left as an
-- absence a reader has to interpret.
--
-- ⛔ PRE-FLIGHT. 001 is the FLOOR. Every later migration stands on it, so
-- running this while 002+ are applied would take the ground out from under
-- them. Three guards, each refusing rather than cascading:
--
--   G1  Any function in `app` that 001 did not create means a later migration
--       put it there. Abort — roll those back first.
--   G2  Any trigger anywhere referencing app.set_updated_at or
--       app.enforce_immutable_columns means a table still depends on them.
--       Abort.
--   G3  Any relation in `public` or `core` at all means business tables exist.
--       001 created none, so anything found belongs to a later migration. Abort.
--
-- None of these guards has an override. An override belongs to a gate a file
-- OWNS and removes on purpose, never to a later migration's dependency it would
-- strip as a side effect.
--
-- PGCRYPTO IS NOT DROPPED, AND THAT IS THE FAITHFUL BEHAVIOUR. Supabase installs
-- pgcrypto on every project at creation, so 001's
-- `CREATE EXTENSION IF NOT EXISTS pgcrypto` is a no-op on the real target and
-- 001 does not own it. Dropping it would not restore the prior state, it would
-- destroy a piece of it — and break every other consumer of gen_random_uuid()
-- and digest() in the database. The first execution of this rollback proved the
-- point: it aborted on `cannot drop extension pgcrypto because other objects
-- depend on it`. The guard is the reasoning, not the error message.
--
-- The other six — citext, btree_gist, pg_trgm, pg_cron, pg_net and vector — are
-- NOT Supabase defaults; 001 genuinely created them, so this file drops them,
-- WITHOUT CASCADE. G3 has already proved `public` and `core` are empty, so
-- nothing should depend on them; if something does, Postgres refuses and names
-- it, which is a better outcome than a cascade that silently drops an email
-- column or an embedding.
--
-- ⚠ DROPPING pg_cron DESTROYS EVERY SCHEDULED JOB, and that is stated here
-- rather than discovered. `DROP EXTENSION pg_cron` deletes cron.job outright —
-- Supabase's own uninstall note says so. That is the correct behaviour for this
-- file (G1–G3 have already proved 015 is not applied, so there are no TrainOS
-- jobs to lose) and it would be catastrophic if those guards were removed. A
-- fourth guard, G4, refuses if cron.job holds anything at all, so the
-- destruction cannot happen silently.
--
-- `net` and `cron` SCHEMAS: created by their extensions, so they drop with them.
-- The guarded DROP SCHEMA lines afterwards exist because the REAL pg_net leaves
-- `net` standing on some versions (Supabase's uninstall instructions say
-- `drop extension if exists pg_net; drop schema net;`), and a rollback that
-- leaves a stray schema behind has not restored the prior state.
--
-- `extensions` SCHEMA IS NOT DROPPED, for the same reason as pgcrypto: on
-- Supabase it is platform-provided, and 001's `CREATE SCHEMA IF NOT EXISTS
-- extensions` is a courtesy for a bare Postgres, not an act of ownership.
--
-- DROP ORDER: reverse of forward — grants, then functions, then extensions,
-- then the schema.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  v_extra   text;
  v_trig    text;
  v_rel     text;
  v_jobs    bigint := 0;
BEGIN
  -- ── G1 · nothing else lives in `app` ──────────────────────────────────────
  SELECT string_agg(p.proname || '(' ||
                    pg_catalog.pg_get_function_identity_arguments(p.oid) || ')', ', ')
    INTO v_extra
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app'
    AND p.proname NOT IN ('set_updated_at','enforce_immutable_columns',
                          'round_half_up_sen','ok','err');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 001 ABORTED: schema app holds function(s) 001 did not create: %. '
      'A later migration put them there. Roll that migration back first.', v_extra
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G2 · no table still relies on the shared triggers ─────────────────────
  SELECT string_agg(format('%I.%I.%I', tn.nspname, c.relname, t.tgname), ', ')
    INTO v_trig
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c      ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace tn ON tn.oid = c.relnamespace
  JOIN pg_catalog.pg_proc p       ON p.oid = t.tgfoid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
  WHERE NOT t.tgisinternal
    AND pn.nspname = 'app'
    AND p.proname IN ('set_updated_at','enforce_immutable_columns');
  IF v_trig IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 001 ABORTED: trigger(s) still bound to app helpers: %. '
      'Roll back the migration that created those tables first.', v_trig
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G4 · no scheduled job would be destroyed ──────────────────────────────
  -- Dropping pg_cron deletes cron.job. If anything is scheduled, 015 is applied
  -- (or somebody scheduled by hand) and this file must not be the thing that
  -- finds out.
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job' INTO v_jobs;
    IF v_jobs > 0 THEN
      RAISE EXCEPTION
        'rollback 001 ABORTED: cron.job holds % scheduled job(s). Dropping pg_cron '
        'would delete every one of them. Roll back 015 first.', v_jobs
        USING ERRCODE = 'dependent_objects_still_exist';
    END IF;
  END IF;

  -- ── G3 · `public` is empty of business objects ────────────────────────────
  -- 001 created nothing in public. Anything here is a later migration's.
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    INTO v_rel
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','core')
    AND c.relkind IN ('r','p','v','m')
    AND c.relname <> 'schema_migrations';
  IF v_rel IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 001 ABORTED: relation(s) still exist in public/core: %. '
      '001 created none, so these belong to a later migration.', v_rel
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 001 pre-flight: clear (app holds only 001''s five helpers).';
END;
$preflight$;

-- ─── Reverse of forward step 6 · grants ─────────────────────────────────────
-- Revoking before the drop is redundant (a dropped function has no ACL) but it
-- keeps the reverse order honest and documents that the grants existed.
REVOKE USAGE ON SCHEMA app FROM anon, authenticated, service_role;

-- ─── Reverse of forward step 1b · the schema baseline ───────────────────────
-- `core` is 001's and is dropped below. `public` is NOT 001's — it ships with
-- every Postgres database — so its DEFAULT PRIVILEGES are put back the way
-- Postgres ships them rather than left in the hardened state. Leaving the
-- hardening behind would be convenient and would also mean this file does not
-- restore the prior state, which is the one thing a rollback is for.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO PUBLIC;
-- Forward step 1c (the hosted auto-expose revoke) is deliberately NOT reversed.
-- Its prior state is environment-specific — present on hosted Supabase, absent
-- on bare Postgres — and 001 kept no record of which, so a re-grant here would
-- invent default rights on databases that never had them. It is also the one
-- default this file would restore that makes every new public table readable
-- and writable by anon. To get it back on hosted, re-enable automatic exposure
-- of new tables and functions in the Data API settings.
GRANT ALL ON SCHEMA public TO PUBLIC;
REVOKE USAGE ON SCHEMA core FROM anon, authenticated, service_role;

-- ─── Reverse of forward steps 5, 4, 3 · functions ───────────────────────────
-- Every signature 001 created. If a later migration ever adds an overload, its
-- own rollback drops it; this file drops only what 001 owns.
DROP FUNCTION IF EXISTS app.err(text, jsonb);
DROP FUNCTION IF EXISTS app.ok(jsonb);
DROP FUNCTION IF EXISTS app.round_half_up_sen(numeric);
DROP FUNCTION IF EXISTS app.enforce_immutable_columns();
DROP FUNCTION IF EXISTS app.set_updated_at();

-- ─── Reverse of forward step 2 · extensions (no CASCADE, on purpose) ────────
-- pgcrypto is deliberately absent from this list; see the header.
DROP EXTENSION IF EXISTS vector;
DROP EXTENSION IF EXISTS pg_net;
DROP EXTENSION IF EXISTS pg_cron;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS btree_gist;
DROP EXTENSION IF EXISTS citext;

-- Reverse of the two grants Supabase's documented pg_cron install carries. The
-- extension is already gone, so these are guarded rather than unconditional.
DROP SCHEMA IF EXISTS cron RESTRICT;
DROP SCHEMA IF EXISTS net  RESTRICT;

-- ─── Reverse of forward step 1 · schema ─────────────────────────────────────
-- RESTRICT (the default) rather than CASCADE: G1 already proved the schema is
-- empty, so a failure here means the guard was wrong and the operator should
-- see that, not have it cleaned up underneath them.
DROP SCHEMA IF EXISTS app RESTRICT;
DROP SCHEMA IF EXISTS core RESTRICT;
-- `extensions` and `public` are deliberately left standing; see the header.

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname IN ('app','core')) THEN
    RAISE EXCEPTION 'rollback 001: schema app or core survived the drop';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension
             WHERE extname IN ('citext','btree_gist','pg_trgm',
                               'pg_cron','pg_net','vector')) THEN
    RAISE EXCEPTION 'rollback 001: one or more extensions survived the drop';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname IN ('cron','net')) THEN
    RAISE EXCEPTION
      'rollback 001: schema cron or net survived - the extension dropped but left '
      'its schema, so the prior state is not restored';
  END IF;
  RAISE NOTICE
    'rollback 001: complete - app and core schemas and 6 extensions removed '
    '(citext, btree_gist, pg_trgm, pg_cron, pg_net, vector), cron and net schemas '
    'gone, public default privileges restored; pgcrypto left standing '
    '(platform-provided, not 001''s to drop).';
END;
$verify$;

COMMIT;
