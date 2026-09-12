-- ============================================================================
-- ROLLBACK 002 · tenancy_identity_and_permissions
-- ============================================================================
--
-- Forward file: migrations/002_tenancy_identity_and_permissions.sql
--
-- PRIOR STATE THIS RESTORES. After 001 and before 002: schemas `app`, `core`
-- and `extensions` exist with 001's five helpers, and nothing else. No identity
-- tables, no enum types, no claim readers, no permission matrix. 002 created
-- every object named below from nothing, so there is no prior definition of any
-- of them to reproduce — stated plainly rather than left as an absence a reader
-- has to interpret. 001's five helpers are NOT touched.
--
-- ⚠ READ FIRST: THIS DESTROYS THE TENANT REGISTRY AND EVERY ROLE ASSIGNMENT.
--
-- `memberships` is the only record of who had access to which tenant, in which
-- role, with which data scope. It is deliberately append-and-amend — a removal
-- is `status = 'REMOVED'`, never a DELETE — precisely so that "who could see
-- this client's data in November" stays answerable. Dropping the table destroys
-- that history and it exists nowhere else.
--
-- BEFORE RUNNING THIS, EXPORT THE THREE TABLES THAT CANNOT BE RECONSTRUCTED:
--
--     COPY (SELECT * FROM public.tenants)      TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM public.memberships)  TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM public.team_members) TO STDOUT WITH CSV HEADER;
--
-- and keep the files. This rollback does NOT export for you, deliberately: an
-- automatic dump to an unspecified location is a false comfort, and the operator
-- should hold the artefact.
--
-- `app.role_permissions` is NOT in that list. It is seeded from doc 02 §2.3 and
-- re-running 002 reproduces it exactly — UNLESS an operator has edited the
-- matrix in production, which is the whole point of storing it as data. G4
-- below detects exactly that and refuses.
--
-- ⛔ PRE-FLIGHT GUARDS, none with an override:
--
--   G1  Any table in `core` means the domain exists and its `tenant_id` columns
--       point at `public.tenants`. Abort — roll the domain back first.
--   G2  Any function in `app` that neither 001 nor 002 created means a later
--       migration put it there. Abort.
--   G3  Any table anywhere outside `public`/`app` with a FK to `public.tenants`.
--       Belt and braces against G1: a later migration could put a tenant-scoped
--       table in a schema this file does not know about.
--   G4  `app.role_permissions` differs from the 399 rows 002 seeded. That means
--       an operator has edited the live matrix, and re-applying 002 would NOT
--       restore what they had — ON CONFLICT DO NOTHING re-adds the seed but
--       cannot bring back a row they deleted. Abort and tell them to export it.
--
-- An override belongs to a gate a file OWNS and removes on purpose, never to a
-- later migration's dependency it would strip as a side effect. None of these
-- four is 002's own gate, so none of them has one.
--
-- DROP ORDER: reverse of forward — policies and grants, then the permission
-- seed and its table, then the functions, then the triggers, then the tables in
-- FK-dependency order (user_profiles and team_members before teams; teams and
-- memberships before tenants), then the enum types last, because `memberships`
-- columns depend on them.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE
  v_core  text;
  v_extra text;
  v_fk    text;
  v_rows  int;
BEGIN
  -- ── G0 · already rolled back? ─────────────────────────────────────────────
  -- Re-running a rollback must be safe and must SAY so. Without this the G3
  -- guard below evaluates `'public.tenants'::regclass`, which RAISES when the
  -- table is gone, and the operator gets a bare "relation does not exist" cast
  -- error from inside a guard instead of "there is nothing to roll back". Found
  -- by re-running this file; the same trap is why G3 uses to_regclass().
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE NOTICE
      'rollback 002: nothing to do - public.tenants does not exist, so 002 is '
      'already rolled back (or was never applied).';
    RETURN;
  END IF;

  -- ── G1 · the domain does not exist yet ────────────────────────────────────
  SELECT string_agg(c.relname, ', ') INTO v_core
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind IN ('r','p','v','m');
  IF v_core IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 002 ABORTED: schema core still holds %. Every one of those is '
      'tenant-scoped; roll the domain back first.', v_core
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G2 · nothing later has added to `app` ─────────────────────────────────
  SELECT string_agg(p.proname, ', ') INTO v_extra
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app'
    AND p.proname NOT IN (
      -- 001
      'set_updated_at','enforce_immutable_columns','round_half_up_minor','ok','err',
      -- 002
      'jwt','current_tenant_id','role','actor_kind','client_scope','team_scope','aal',
      'is_agent','agent_id','trainer_id','require_tenant_id','has_role','has_permission',
      'my_team_user_ids','can_see_owner','current_actor','principal_claims',
      'custom_access_token_hook');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 002 ABORTED: schema app holds function(s) neither 001 nor 002 '
      'created: %. Roll that migration back first.', v_extra
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G3 · no stray foreign key into the tenant registry ────────────────────
  -- to_regclass, never a bare ::regclass cast: the cast RAISES on a missing
  -- relation, and a guard that crashes is worse than a guard that is absent.
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ') INTO v_fk
  FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c      ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n  ON n.oid = c.relnamespace
  WHERE k.contype = 'f'
    AND k.confrelid = to_regclass('public.tenants')
    AND NOT (n.nspname = 'public'
             AND c.relname IN ('teams','team_members','memberships','user_profiles'));
  IF v_fk IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 002 ABORTED: table(s) outside 002 still reference public.tenants: %',
      v_fk USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G4 · the permission matrix is still the one 002 seeded ────────────────
  -- Re-applying 002 uses ON CONFLICT DO NOTHING: it re-adds the seed but cannot
  -- resurrect a row an operator deleted. If the live matrix has drifted, this
  -- rollback is not reversible and says so instead of pretending.
  SELECT count(*) INTO v_rows FROM app.role_permissions;
  IF v_rows <> 399 THEN
    RAISE EXCEPTION
      'rollback 002 ABORTED: app.role_permissions holds % rows, not the 399 that '
      '002 seeded. The live matrix has been edited, and re-applying 002 would NOT '
      'restore it. Export it first: COPY (SELECT * FROM app.role_permissions) TO '
      'STDOUT WITH CSV HEADER;', v_rows
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 002 pre-flight: clear (no core tables, no later app functions, matrix unedited).';
END;
$preflight$;

-- ─── Reverse of forward step 10 · policies, then grants ─────────────────────
-- Dropping the tables would drop their policies anyway. They are dropped
-- explicitly so the reverse order is legible and so a partial run leaves no
-- policy attached to a table that survived.

DROP POLICY IF EXISTS user_profiles_update_self_or_admin ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_insert_admin         ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_select               ON public.user_profiles;

DROP POLICY IF EXISTS memberships_no_self_edit           ON public.memberships;
DROP POLICY IF EXISTS memberships_write_admin            ON public.memberships;
DROP POLICY IF EXISTS memberships_select_self            ON public.memberships;
DROP POLICY IF EXISTS memberships_auth_admin_read        ON public.memberships;

DROP POLICY IF EXISTS team_members_write_admin           ON public.team_members;
DROP POLICY IF EXISTS team_members_select                ON public.team_members;

DROP POLICY IF EXISTS teams_write_admin                  ON public.teams;
DROP POLICY IF EXISTS teams_select                       ON public.teams;

DROP POLICY IF EXISTS tenants_update_admin               ON public.tenants;
DROP POLICY IF EXISTS tenants_select                     ON public.tenants;
DROP POLICY IF EXISTS tenants_auth_admin_read            ON public.tenants;

-- Guarded on the TABLES as well as the role. A plpgsql RETURN exits the block
-- it is in, not the script, so the G0 short-circuit above does not stop this
-- file — and a bare REVOKE on a table that is already gone is a hard ERROR, not
-- a skip. Found by re-running this rollback after a successful one.
DO $ungrant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    IF to_regclass('public.memberships') IS NOT NULL THEN
      REVOKE SELECT ON public.memberships FROM supabase_auth_admin;
    END IF;
    IF to_regclass('public.tenants') IS NOT NULL THEN
      REVOKE SELECT ON public.tenants FROM supabase_auth_admin;
    END IF;
    REVOKE USAGE ON SCHEMA app FROM supabase_auth_admin;
  END IF;
END;
$ungrant$;

-- ─── Reverse of forward step 11 and 5 · the matrix, then its table ──────────
-- G4 has already proved the contents are exactly 002's seed, so this destroys
-- nothing an operator authored.
DO $matrix$
BEGIN
  IF to_regclass('app.role_permissions') IS NOT NULL THEN
    DELETE FROM app.role_permissions;
  END IF;
END;
$matrix$;
DROP TABLE IF EXISTS app.role_permissions;

-- ─── Reverse of forward steps 8, 7, 6 · functions ───────────────────────────
-- Every signature 002 created, dependants first: custom_access_token_hook calls
-- principal_claims; can_see_owner calls my_team_user_ids and client_scope;
-- everything reads jwt(). 001's five helpers are deliberately absent.
DROP FUNCTION IF EXISTS app.custom_access_token_hook(jsonb);
DROP FUNCTION IF EXISTS app.principal_claims(uuid);
DROP FUNCTION IF EXISTS app.current_actor();
DROP FUNCTION IF EXISTS app.can_see_owner(uuid);
DROP FUNCTION IF EXISTS app.my_team_user_ids();
DROP FUNCTION IF EXISTS app.has_permission(text);
DROP FUNCTION IF EXISTS app.has_role(text);
DROP FUNCTION IF EXISTS app.require_tenant_id();
DROP FUNCTION IF EXISTS app.trainer_id();
DROP FUNCTION IF EXISTS app.agent_id();
DROP FUNCTION IF EXISTS app.is_agent();
DROP FUNCTION IF EXISTS app.aal();
DROP FUNCTION IF EXISTS app.team_scope();
DROP FUNCTION IF EXISTS app.client_scope();
DROP FUNCTION IF EXISTS app.actor_kind();
DROP FUNCTION IF EXISTS app.role();
DROP FUNCTION IF EXISTS app.current_tenant_id();
DROP FUNCTION IF EXISTS app.jwt();

-- ─── Reverse of forward step 4 · triggers ───────────────────────────────────
-- Redundant before a DROP TABLE, kept so the reverse order is complete and so a
-- hand-edited partial run does not leave a trigger behind.
DROP TRIGGER IF EXISTS trg_memberships_immutable   ON public.memberships;
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
DROP TRIGGER IF EXISTS trg_memberships_updated_at   ON public.memberships;
DROP TRIGGER IF EXISTS trg_teams_updated_at         ON public.teams;
DROP TRIGGER IF EXISTS trg_tenants_updated_at       ON public.tenants;

-- ─── Reverse of forward step 2 · tables, in FK-dependency order ─────────────
-- RESTRICT, not CASCADE: G1 and G3 have already proved nothing else points
-- here, so a failure means a guard was wrong and the operator should see that
-- rather than have it tidied away underneath them.
DROP TABLE IF EXISTS public.user_profiles RESTRICT;
DROP TABLE IF EXISTS public.memberships   RESTRICT;
DROP TABLE IF EXISTS public.team_members  RESTRICT;
DROP TABLE IF EXISTS public.teams         RESTRICT;
DROP TABLE IF EXISTS public.tenants       RESTRICT;

-- ─── Reverse of forward step 1 · enum types, last ───────────────────────────
-- After the tables, because memberships.role, .actor_kind, .client_scope and
-- .team_scope depend on them. Dropping a type in use fails, which is why this
-- is the last step and not the first.
DROP TYPE IF EXISTS app.data_scope;
DROP TYPE IF EXISTS app.actor_kind;
DROP TYPE IF EXISTS app.app_role;

DO $verify$
DECLARE v_left text;
BEGIN
  -- Idempotent tail: if 002 was already rolled back, everything above was a
  -- no-op and the assertions below still hold, so this file ends the same way
  -- whether it did work or found none to do.
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('tenants','teams','team_members','memberships','user_profiles');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 002: identity table(s) survived the drop: %', v_left;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_type t
             JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'app'
               AND t.typname IN ('app_role','actor_kind','data_scope')) THEN
    RAISE EXCEPTION 'rollback 002: an enum type survived the drop';
  END IF;

  -- 001's floor must be intact. A rollback that quietly took the layer below
  -- with it would leave the database in a state neither migration describes.
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app'
        AND p.proname IN ('set_updated_at','enforce_immutable_columns',
                          'round_half_up_minor','ok','err')) <> 5 THEN
    RAISE EXCEPTION
      'rollback 002: schema app should hold exactly 001''s five helpers afterwards';
  END IF;

  RAISE NOTICE 'rollback 002: complete - identity, matrix and claim readers removed; 001 intact.';
END;
$verify$;

COMMIT;
