-- ============================================================================
-- Migration 001: foundation — the `app` schema, the extensions TrainOS depends
-- on, and the shared helper functions every later migration builds on.
-- ============================================================================
--
-- FEATURE. This is the floor of the database. Nothing here is a business table;
-- everything here is a primitive that 002–016 assume already exists. It lands
-- first so that no later migration has to invent one in passing and leave a
-- second, subtly different copy behind — the divergence the project rules
-- forbid at the component layer and which is worse in SQL, where two spellings
-- of "round half up" is a reconciliation bug nobody sees until an invoice is
-- a sen out.
--
-- WHAT IS HERE, AND WHY EACH ONE
--
--   THREE SCHEMAS, and which document decided each
--
--   `app`     Internal helpers and the action gate. NOT exposed to PostgREST.
--             Doc 02 §1.2 creates it for the tenant resolver and the permission
--             lookup; doc 03 §1 puts the whole action envelope in it. Keeping
--             the resolver out of an exposed schema means a client cannot call
--             it directly to probe what tenants exist.
--
--   `core`    The domain. ⚠ CITATION CORRECTED 2026-09-13, before any apply.
--             This header used to justify `core` by quoting doc 03 §1 — "Schema
--             `app` holds the gate. Schema `core` holds the domain (sb-erd)".
--             That sentence was in an EARLY DRAFT of 03. The committed 03 §1
--             said the opposite for a while (the critic's C-01), so citing it
--             made the floor of the database rest on a line that moved. The
--             real, checkable reason is two facts that do not move:
--
--               1. `supabase/config.toml` sets
--                    schemas = ["public", "core", "graphql_public"]
--                  PostgREST exposes exactly those. `core` is exposed; `app` is
--                  deliberately not. Verified by reading config.toml on
--                  2026-09-13 — the critic's Part 2 §2.8 recorded that nobody
--                  had, and now somebody has.
--               2. Three lanes then wrote ~250 `core.<table>` references against
--                  that file (03, 04 and 05 in their executable SQL, and 002's
--                  policies). The schema name is load-bearing in committed work,
--                  not a preference.
--
--             Doc 02 originally wrote the same tables as `public.*` and its
--             policies are re-targeted onto `core`. Recorded as conflict C1;
--             the catalog carries the full list.
--             ⚠ `core` MUST stay in PostgREST's exposed schemas or the whole
--             domain is invisible to the API, with no error to explain it.
--
--   `public`  Identity and tenancy only — doc 02's own four tables (`tenants`,
--             `teams`, `team_members`, `memberships`) plus `user_profiles`.
--             Doc 02 writes those as `public.*` and owns them, so they stay.
--
--   The schema-level baseline from doc 02 §4.1 — revoke the Postgres `public`
--   defaults rather than relying on per-table grants — is applied here to both
--   `public` and `core`, because it is a property of the schema and belongs with
--   the schema's creation, not repeated in fourteen table migrations.
--
--   extensions          pgcrypto  — digest() for share-token hashing. A portal
--                                   token is stored as a SHA-256 hash and never
--                                   in plaintext (doc 01 §3.1 share tokens).
--                                   Supabase installs this on every project, so
--                                   the CREATE here is a no-op on the real
--                                   target and 001 does not own it — which is
--                                   why the rollback leaves it standing.
--                       citext    — case-insensitive email columns. Contacts
--                                   are matched by email domain (`EXACT_DOMAIN`);
--                                   a case-sensitive match silently fails to
--                                   match `Nurul.Hassan@` against `nurul.hassan@`.
--                       btree_gist— required for the EXCLUDE constraint that
--                                   stops a trainer being double-booked across
--                                   overlapping date ranges (008).
--                       pg_trgm   — GIN trigram indexes for the ⌘K search over
--                                   organisation and contact names (contract §2).
--                       pg_cron   — the scheduler. Ruling R-EXT. Nine scheduled
--                                   behaviours in the design (retention reaper,
--                                   outbox drain, job reaper, levy staleness
--                                   sweep, embedding refresh and the rest) are
--                                   scheduled with cron.schedule in 015. Without
--                                   this extension every one of them is dead
--                                   code that no error reports — the critic's
--                                   N-01/C-06, the last CRITICAL in the pack.
--                       pg_net    — async HTTP from SQL. The outbox drain and
--                                   the webhook dispatcher in 012/015 call
--                                   net.http_post to reach an Edge Function;
--                                   docs 03 and 05 name it sixteen times.
--                                   Asynchronous matters: this is called from
--                                   inside a trigger, and the `http` extension
--                                   would block the writing transaction on a
--                                   third party's latency.
--                       vector    — pgvector, for core.knowledge_chunks.embedding
--                                   vector(1536) and its HNSW index (doc 01
--                                   §"Knowledge", Q23). 013 creates that column;
--                                   an unavailable `vector` type is a migration
--                                   that fails at apply time, which is why it is
--                                   enabled here at the floor and asserted below
--                                   rather than assumed in 013.
--
--   app.set_updated_at()            The shared BEFORE UPDATE trigger named in
--                                   doc 01's universal-columns table.
--   app.enforce_immutable_columns() One generic trigger for every "frozen after
--                                   write" rule in the model — `ref`, a SENT
--                                   proposal's body, an APPLIED quotation. The
--                                   columns are trigger arguments, so there is
--                                   one implementation and N attachments rather
--                                   than N hand-written triggers that drift.
--   app.round_half_up_sen()       The single definition of the rounding rule
--                                   DECISIONS §7 fixes: half-up, away from zero,
--                                   to the sen. Used by 007 and 010.
--                                   ⚠ RENAMED IN PLACE, 2026-09-12, before any
--                                   apply: it was `round_half_up_minor` until
--                                   doc 04 landed naming it `round_half_up_sen`
--                                   and using that name inside GENERATED ALWAYS
--                                   AS expressions. Two spellings of one
--                                   rounding rule is precisely the divergence
--                                   this function exists to prevent, so the
--                                   earlier name is gone rather than aliased.
--                                   Recorded in the catalog; nothing had been
--                                   applied, so this is a rename, not a
--                                   migration.
--   app.ok() / app.err()            The RPC envelope constructors.
--
-- WHY THE ENVELOPE IS A FUNCTION AND NOT A CONVENTION
--
-- Point 2 of the 7-point contract check is the "037 mechanism": a client
-- auto-unwraps `data` only while `data` is the SOLE non-`success` key, so one
-- well-meaning sibling key at the top level silently flips every consumer into
-- pass-through and breaks them. A convention cannot enforce that — a reviewer
-- has to notice. `app.ok(jsonb)` can: it BUILDS the object, so a sibling key is
-- not something a later author can add by accident, only by deleting the call.
-- Every RPC in 011 and 016 returns through these two functions.
--
-- SPINE: there is no spine yet. This migration creates the primitives the spine
-- (the action envelope, 011) will be built from.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   No RPCs. Nothing here is client-callable.
--   `app` schema: USAGE to anon + authenticated, because RLS policy predicates
--   are evaluated in the CALLER's context and so must be able to resolve and
--   execute the helper functions that 002 puts here. USAGE on the schema is not
--   access to anything in it: every function is REVOKEd and granted back one at
--   a time, and this migration grants EXECUTE on none of them.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: no RPC added. `app.ok`/`app.err` are the constructors that make
--      the envelope structurally correct for every RPC from 011 onward; their
--      own shape is asserted by test_001.
--   2. Unwrap: `app.ok(p_data)` emits exactly {success, data}; `app.err(...)`
--      exactly {success, error}. Both are pinned by an exact key-set assertion,
--      not a "contains" check, so a sibling key fails the pin.
--   3. RpcMap: no entries — `packages/contract/src` does not exist yet and this
--      migration adds no client-callable surface to describe.
--   4. Call sites: none. New objects, no consumers yet.
--   5. Casts: none.
--   6. Reload/restore: no client-visible behaviour.
--   7. Public routes: none. Nothing here can be reached from an unauthenticated
--      request; the portal's public surface arrives in 014.
--   Then: the RPC-contract check script does not exist in this repo yet (see
--   the catalog note); the equivalent invariants are asserted by test_001.
--
-- Rollback: rollbacks/001_foundation_schemas_and_helpers_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── 1 · Schemas ────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS core;

COMMENT ON SCHEMA core IS
  'The domain: the 86 tables of the ERD in docs/architecture/01. Exposed to '
  'PostgREST alongside public. Every table here is tenant-scoped, RLS-enabled and '
  'RLS-forced; every write arrives through app.perform_action, never directly.';

COMMENT ON SCHEMA app IS
  'Internal helpers: tenant resolution, RLS predicates, trigger functions, and the '
  'RPC envelope constructors. NOT exposed to PostgREST. Nothing in here is '
  'client-callable; EXECUTE is granted one function at a time and only where an '
  'RLS policy must evaluate it in the caller''s own context.';

-- Supabase provides `extensions`; a bare Postgres used for local execution may
-- not, so create it rather than assume it.
CREATE SCHEMA IF NOT EXISTS extensions;

-- USAGE only on `app`. This is the right to RESOLVE a name in the schema, not to
-- call anything in it — every function below is revoked from both roles.
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;

-- ─── 1b · The schema baseline (doc 02 §4.1) ─────────────────────────────────
--
-- Least privilege by revocation, not by remembering to grant narrowly. Postgres
-- gives the pseudo-role PUBLIC rights on `public` by default and on anything
-- created in it; taking those away once, here, means a table added in 005 is
-- closed the moment it exists rather than closed if its migration remembered.
--
-- ALTER DEFAULT PRIVILEGES binds to the CURRENT ROLE, so it only governs objects
-- created by whoever runs the migrations. That is the migration role in every
-- environment this set targets, but it is a real limitation worth stating.
--
-- ⚠ FINDING, MEASURED, NOT ASSUMED. Doc 02 §4.1 prescribes
--     alter default privileges in schema public revoke all on tables from public;
-- as line 3 of the baseline. Executed against PostgreSQL 17.11 it does nothing,
-- and neither does the equivalent for functions:
--
--   * For TABLES it is vacuous. Postgres grants the pseudo-role PUBLIC no
--     default table privileges in the first place, so there is nothing to
--     revoke. It is not wrong, it is simply not load-bearing.
--   * For FUNCTIONS it is NOT vacuous and still does not work. PUBLIC does hold
--     EXECUTE on a new function by default, and revoking it through ALTER
--     DEFAULT PRIVILEGES records NO row in pg_default_acl and changes nothing:
--     a function created afterwards is still executable by PUBLIC and by anon.
--     The same statement in GRANT form records correctly, so the mechanism is
--     live and it is the revoke-from-PUBLIC direction that does not take.
--
-- Both statements are kept because they are the documented baseline and are
-- harmless. They are NOT the guard. The guard is two things that were measured
-- to work:
--   1. Every migration REVOKEs EXECUTE per function, at creation. 001 does it
--      below; 002-016 do the same.
--   2. test_014 enumerates every function in app, core and public and fails if
--      PUBLIC or anon holds EXECUTE on one outside the portal allowlist. An
--      invariant asserted per object catches what a default privilege silently
--      did not apply.

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA core   FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA core   TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core   REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core   REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- ─── 1c · Hosted Supabase: the Data API auto-expose defaults ────────────────
--
-- Unlike the PUBLIC revokes above, THESE take, because on hosted Supabase there
-- is a real pg_default_acl row to revoke from. Hosted ships (read from the
-- project, 2026-09-14) default privileges for owner `postgres` IN SCHEMA public:
-- ALL on tables, EXECUTE on functions and USAGE/SELECT/UPDATE on sequences to
-- anon, authenticated and service_role. Left in place, 002's public tables are
-- created with anon holding ALL on them and 014's verify aborts on the grant it
-- was written to refuse. REVOKE ALL, not the four DML privileges: revoking only
-- SELECT/INSERT/UPDATE/DELETE leaves TRUNCATE, REFERENCES and TRIGGER behind,
-- and 014 aborts on TRUNCATE instead (measured, docs/reviews/2026-09-13-pr6-final.md §5).
--
-- service_role is revoked too. The design grants it one object at a time (012,
-- 013) and every pin was measured without these defaults; keeping them for
-- service_role would hand it table rights no migration intended.
--
-- No FOR ROLE: like every line above this binds to the migration role, which
-- is `postgres` on hosted. Guarded per role so a bare Postgres without the
-- Supabase roles is a no-op. The assertion after it fails 001 closed if any
-- default grant to the three roles survives for the migration role in a schema
-- 002-019 create objects in (public, core, app) or in a schema-less (global)
-- entry, before a single table exists. Hosted also ships postgres-owned
-- defaults IN SCHEMA storage; nothing here creates objects there, they are
-- Supabase's to keep, and an unscoped check refused to apply on them.
DO $hosted_default_acl$
DECLARE
  v_role     text;
  v_leftover text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', v_role);
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', v_role);
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', v_role);
    END IF;
  END LOOP;

  SELECT pg_catalog.string_agg(
           COALESCE(namespace.nspname, '(global)') || ':' || acl.defaclobjtype::text
             || ':' || pg_catalog.pg_get_userbyid(item.grantee), ', ')
    INTO v_leftover
    FROM pg_catalog.pg_default_acl AS acl
    LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = acl.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(acl.defaclacl) AS item
   WHERE acl.defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
     AND (acl.defaclnamespace = 0 OR namespace.nspname IN ('public','core','app'))
     AND item.grantee IN (SELECT oid FROM pg_catalog.pg_roles
                           WHERE rolname IN ('anon','authenticated','service_role'));
  IF v_leftover IS NOT NULL THEN
    RAISE EXCEPTION '001: default privileges still grant the API roles: %. '
      'Every table 002-017 creates would be born exposed.', v_leftover;
  END IF;
END;
$hosted_default_acl$;

-- ─── 2 · Extensions ─────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm    WITH SCHEMA extensions;

-- Ruling R-EXT. The target schema for each of these three is NOT a preference —
-- it is what Supabase's own install instructions specify, and getting it wrong
-- produces an extension that exists under a name nothing references.
--
--   pg_cron is NOT relocatable and its control file pins `schema = pg_catalog`.
--   `WITH SCHEMA pg_catalog` is therefore the only spelling that works, and it
--   is the one Supabase documents (supabase.com/docs/guides/cron/install). The
--   extension creates its own `cron` schema for cron.job / cron.schedule; the
--   two grants below are the other half of Supabase's documented install and
--   are what lets the migration role read and manage the job table afterwards.
--
--   pg_net creates its own `net` schema for net.http_post regardless of this
--   clause; `WITH SCHEMA extensions` is Supabase's documented form and is what
--   keeps the extension itself out of `public`.
--
--   vector IS relocatable, so `WITH SCHEMA extensions` genuinely places the
--   type there. 013's column is written `extensions.vector(1536)` to match; an
--   unqualified `vector(1536)` resolves only while `extensions` happens to be
--   on the search path, which is exactly the assumption that breaks inside a
--   function pinned to `search_path = ''`.
CREATE EXTENSION IF NOT EXISTS pg_cron    WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector     WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- No COMMENT ON SCHEMA cron: on hosted Supabase the `cron` schema is owned by
-- supabase_admin and the migration role `postgres` is not superuser, so the
-- statement fails with 42501 "must be owner of schema cron". The note it
-- carried, kept here instead:
--   pg_cron's own schema. Created by the extension, not by TrainOS. Every
--   TrainOS job is scheduled in 015 and named there; cron.job is the inventory.
--   cron.job_run_details is reaped by 015 - Postgres does not clean it up and
--   it grows without bound (critic C-07).

-- ─── 3 · Shared trigger functions ───────────────────────────────────────────

-- Every table in this model carries `updated_at timestamptz NOT NULL DEFAULT
-- now()`. One trigger function maintains all of them.
CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION app.set_updated_at() IS
  'BEFORE UPDATE FOR EACH ROW. Stamps updated_at. Attached by every table migration.';

-- The generic immutability trigger. Column names are passed as trigger
-- arguments:
--
--   CREATE TRIGGER trg_x_immutable
--     BEFORE UPDATE ON public.x FOR EACH ROW
--     EXECUTE FUNCTION app.enforce_immutable_columns('ref', 'tenant_id');
--
-- Semantics, chosen deliberately:
--   * A column is frozen only ONCE IT HAS A VALUE. NULL → non-NULL is allowed,
--     because several columns in this model are allocated after insert (`ref` is
--     stamped by a BEFORE INSERT trigger; `accepted_at` is set once and then
--     frozen). Freezing from the moment of INSERT would make those unwritable.
--   * non-NULL → NULL is a change, and is refused. "Immutable" that permits
--     erasure is not immutable, and erasure is the shape an attack takes.
--   * The comparison is IS DISTINCT FROM, so it is null-safe and does not treat
--     a no-op re-save as a violation.
CREATE OR REPLACE FUNCTION app.enforce_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_col   text;
  v_old   jsonb := to_jsonb(OLD);
  v_new   jsonb := to_jsonb(NEW);
BEGIN
  IF TG_NARGS = 0 THEN
    RAISE EXCEPTION
      'app.enforce_immutable_columns on %.% was attached with no column arguments',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOREACH v_col IN ARRAY TG_ARGV LOOP
    -- A column named in the trigger but absent from the row is a wiring error,
    -- and a silent one: the loop would compare NULL to NULL forever and the
    -- column it was meant to protect would be freely writable.
    IF NOT (v_old ? v_col) THEN
      RAISE EXCEPTION
        'app.enforce_immutable_columns on %.% names column %, which does not exist',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, v_col
        USING ERRCODE = 'undefined_column';
    END IF;

    IF (v_old -> v_col) IS NOT NULL
       AND (v_old -> v_col) <> 'null'::jsonb
       AND (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
      RAISE EXCEPTION
        'IMMUTABLE_COLUMN: %.%.% cannot be changed once set (was %, attempted %)',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, v_col,
        v_old ->> v_col, COALESCE(v_new ->> v_col, '<null>')
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION app.enforce_immutable_columns() IS
  'BEFORE UPDATE FOR EACH ROW, with the frozen column names as trigger arguments. '
  'A column freezes once it holds a value; NULL -> value is allowed, value -> NULL '
  'is not. Raises IMMUTABLE_COLUMN.';

-- ─── 4 · Money rounding ─────────────────────────────────────────────────────

-- DECISIONS §7: "each line = unit_price × qty, rounded half-up to the sen;
-- totals sum the ROUNDED lines."
--
-- Postgres `round(numeric)` already rounds half away from zero, which is what
-- half-up means for the non-negative amounts this model admits. The function
-- exists anyway, for three reasons: it is the one place the rule is written
-- down, it is what a reconciliation trigger and a test can both point at, and
-- it is STRICT + IMMUTABLE so it can be used inside a generated column or an
-- index if a later migration needs one. Do not inline `round()` instead.
CREATE OR REPLACE FUNCTION app.round_half_up_sen(p_amount numeric)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT round(p_amount)::bigint;
$fn$;

COMMENT ON FUNCTION app.round_half_up_sen(numeric) IS
  'The single definition of the rounding rule (DECISIONS 7): half-up, away from '
  'zero, to whole minor units. Every money line rounds through this and totals '
  'sum the rounded results.';

-- ─── 5 · RPC envelope constructors ──────────────────────────────────────────

-- Success: exactly {success, data}. `data` is the SOLE non-success key, which
-- is the precondition the client's auto-unwrap depends on.
CREATE OR REPLACE FUNCTION app.ok(p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object('success', true, 'data', COALESCE(p_data, '{}'::jsonb));
$fn$;

COMMENT ON FUNCTION app.ok(jsonb) IS
  'Success envelope: exactly {success:true, data}. Never add a third top-level key '
  '- a sibling flips the client from auto-unwrap to pass-through and breaks every '
  'consumer at once. New fields go INSIDE data.';

-- Failure: exactly {success, error}, with the code inside error.
CREATE OR REPLACE FUNCTION app.err(p_code text, p_details jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'success', false,
    'error', CASE
               WHEN p_details IS NULL THEN jsonb_build_object('code', p_code)
               ELSE jsonb_build_object('code', p_code, 'details', p_details)
             END
  );
$fn$;

COMMENT ON FUNCTION app.err(text, jsonb) IS
  'Failure envelope: exactly {success:false, error:{code[, details]}}. Codes are '
  'SCREAMING_SNAKE. Details go INSIDE error, never beside it.';

-- ─── 6 · Function posture ───────────────────────────────────────────────────
--
-- Nothing here is client-callable. USAGE on `app` was granted above so that 002's
-- RLS predicates can be RESOLVED by the caller; EXECUTE is granted per function,
-- and none of these five earns it.
--
-- Trigger functions are a special case worth stating rather than leaving to be
-- rediscovered: PostgreSQL does not check EXECUTE privilege when a trigger
-- fires, so revoking EXECUTE from set_updated_at and enforce_immutable_columns
-- costs nothing and closes the direct-call path.

REVOKE ALL ON FUNCTION app.set_updated_at()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.enforce_immutable_columns()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.round_half_up_sen(numeric)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.ok(jsonb)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.err(text, jsonb)               FROM PUBLIC, anon, authenticated;

-- ─── 7 · Verify ─────────────────────────────────────────────────────────────
--
-- Structural, off the catalogs — not a re-reading of the DDL above. If any of
-- this is false the transaction never commits.

DO $verify$
DECLARE
  v_missing text;
  v_cnt     int;
BEGIN
  -- Extensions actually installed, and each in the schema it was asked for.
  -- The schema is asserted, not just the presence: pg_cron under the wrong
  -- namespace still answers `extname = 'pg_cron'` while `cron.schedule` does not
  -- resolve, which is the failure this check exists to catch.
  SELECT string_agg(want || ' (expected in ' || where_ || ')', ', ')
    INTO v_missing
  FROM (VALUES ('pgcrypto','extensions'), ('citext','extensions'),
               ('btree_gist','extensions'), ('pg_trgm','extensions'),
               ('pg_net','extensions'), ('vector','extensions'),
               ('pg_cron','pg_catalog')) AS t(want, where_)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = t.want AND n.nspname = t.where_
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '001 verify: extension(s) missing or in the wrong schema: %', v_missing;
  END IF;

  -- pg_cron and pg_net are not types on a page; the objects the design calls
  -- must resolve. A present-but-broken extension is the thing that reaches
  -- production, so this asserts the callable surface rather than the catalog row.
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION '001 verify: pg_cron is installed but cron.job does not exist';
  END IF;
  IF to_regproc('net.http_post') IS NULL THEN
    RAISE EXCEPTION '001 verify: pg_net is installed but net.http_post does not exist';
  END IF;
  IF to_regtype('extensions.vector') IS NULL THEN
    RAISE EXCEPTION '001 verify: vector is installed but extensions.vector is not a type';
  END IF;

  -- All five helpers exist with search_path pinned to the EMPTY string.
  --
  -- ⚠ DEVIATION D1 IS RESOLVED HERE, 2026-09-13, and the resolution is the
  -- reason this assertion is spelled the way it is. 001-009 originally wrote
  -- `SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'`, which
  -- stores proconfig as `search_path=pg_catalog, public, extensions, pg_temp`.
  -- Doc 02 §8.7's sweep asserts the exact string `search_path=""` and every one
  -- of those forty functions failed it (critic N-05). One spelling, then one
  -- assertion: the empty path is now the only form in the pack, and every body
  -- is schema-qualified because with `''` nothing else resolves.
  --
  -- The assertion is `= ANY (proconfig)`, an EXACT string match against one
  -- element. `proconfig IS NOT NULL` would pass all three spellings including
  -- the broken single-quoted-comma form, which is the trap doc 02 §8.7 measured.
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app'
    AND p.proname IN ('set_updated_at','enforce_immutable_columns',
                      'round_half_up_sen','ok','err')
    AND 'search_path=""' = ANY (p.proconfig);
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION
      '001 verify: expected 5 app helpers with search_path pinned to the empty '
      'string, found %', v_cnt;
  END IF;

  -- No client role holds EXECUTE on anything in `app`.
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN unnest(ARRAY['anon','authenticated']) AS r(role_name)
  WHERE n.nspname = 'app'
    AND has_function_privilege(r.role_name, p.oid, 'EXECUTE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION
      '001 verify: % client EXECUTE grant(s) on schema app; expected none', v_cnt;
  END IF;

  -- The envelopes are the shape the whole contract rests on.
  IF app.ok('{"x":1}'::jsonb) <> '{"success": true, "data": {"x": 1}}'::jsonb THEN
    RAISE EXCEPTION '001 verify: app.ok did not build the success envelope';
  END IF;
  IF app.err('NOPE') <> '{"success": false, "error": {"code": "NOPE"}}'::jsonb THEN
    RAISE EXCEPTION '001 verify: app.err did not build the failure envelope';
  END IF;

  -- All three schemas exist, and PUBLIC holds nothing on the two exposed ones.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'core') THEN
    RAISE EXCEPTION '001 verify: schema core was not created';
  END IF;
  IF has_schema_privilege('public', 'public', 'CREATE')
     OR has_schema_privilege('public', 'core', 'CREATE') THEN
    RAISE EXCEPTION
      '001 verify: pseudo-role PUBLIC still holds CREATE on an exposed schema';
  END IF;

  RAISE NOTICE
    '001 verify: OK - 3 schemas, 7 extensions (cron/net/vector callable), '
    '5 helpers at search_path="", 0 client EXECUTE grants.';
END;
$verify$;

COMMIT;
