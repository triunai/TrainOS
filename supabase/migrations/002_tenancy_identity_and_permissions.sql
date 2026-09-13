-- ============================================================================
-- Migration 002: tenancy — the identity tables, the claim readers, the
-- permission catalogue, and the access-token hook that makes RLS possible.
-- ============================================================================
--
-- FEATURE. TrainOS is multi-tenant from row zero and the contract's §1 says
-- "Tenant is implicit from auth and never appears in a path or body". That
-- sentence only holds if the database can answer "which tenant is asking"
-- without being told. 002 is that answer: five identity tables, a permission
-- catalogue that is data rather than code, and the small set of STABLE claim
-- readers every policy in 014 is built from.
--
-- Source: docs/architecture/02, §1.2 (core tables), §1.3 (the hook), §2.2/§2.3
-- (94 permissions, 7 role columns), §2.4 (data scopes), §3.1 (agent claims),
-- §4.1 (claim readers), §4.3 (identity-table policies).
--
-- WHY CLAIMS FOR IDENTITY AND A LOOKUP FOR PERMISSIONS (doc 02 §1.4)
--
-- `tenant_id`, `actor_kind`, `agent_id` and `trainer_id` are identity: they do
-- not change during a session, and if one ever does the correct response is to
-- kill the session, not to hope the next query notices. They ride in the JWT.
--
-- `permission` is authorisation: an admin who removes `invoice:push` from OPS
-- expects that to bite now, not at the next token refresh, and the ADMIN row
-- alone is roughly ninety strings riding on every request. It is a lookup —
-- `app.role_permissions`, a few hundred rows, fully cached, hit once per
-- statement because `app.has_permission()` is STABLE and every call site wraps
-- it in `(select ...)`.
--
-- THE THREE THINGS THAT MAKE THIS MIGRATION DANGEROUS, AND WHAT STOPS THEM
--
--   1. Privilege escalation through a self-edit. An ADMIN who can UPDATE their
--      own `memberships` row can write themselves any role, any scope, any
--      tenant. A RESTRICTIVE policy (`memberships_no_self_edit`) makes that
--      unrepresentable, and RESTRICTIVE is the right tool because it ANDs with
--      every other policy instead of being one more OR branch to forget.
--      Bootstrapping a tenant's first ADMIN is therefore a `service_role`
--      provisioning act, which is what it should have been anyway.
--
--   2. The hook failing open. `app.custom_access_token_hook` runs as
--      `supabase_auth_admin`, which is NOT `BYPASSRLS`. Without a SELECT grant
--      AND a policy on `memberships` and `tenants` it returns no row — and a
--      hook that returns no row issues a token with `tenant_id: null`, which
--      satisfies no policy anywhere. That is the correct failure direction, and
--      it is still a total outage, so the grants and the two
--      `supabase_auth_admin` policies are created here and pinned by T7.
--
--   3. Claim drift between the hook and the agent token minter. §3.1 notes the
--      hook does not run for a self-minted agent token, so claims would be
--      built in two places. `app.principal_claims(uuid)` is the single body;
--      the hook is one caller and the minter (an Edge Function, not in this
--      set) is the other. One body, two callers, one test.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   No client-callable RPC. Everything here is a policy input.
--   `app.has_permission`, `app.my_team_user_ids`, `app.can_see_owner`:
--     EXECUTE to `authenticated` only — an RLS predicate is evaluated in the
--     caller's context, so the caller must be able to run it. Each reads the
--     caller's OWN identity from the JWT or `auth.uid()` and takes no identity
--     argument, so there is nothing to escalate: you cannot ask them about
--     somebody else.
--   Everything else in `app`: EXECUTE revoked from every client role.
--   `app.custom_access_token_hook`: EXECUTE to `supabase_auth_admin` ONLY.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: no RPC added; nothing returns an envelope.
--   2. Unwrap: not applicable — no jsonb envelope crosses the API boundary.
--      `app.principal_claims` returns jsonb but it is a GoTrue-internal shape,
--      not an RPC envelope, and `app` is not an exposed schema.
--   3. RpcMap: no entries. `packages/contract/src` describes HTTP endpoints;
--      none of these functions is one.
--   4. Call sites: `app.current_tenant_id`, `app.has_permission`,
--      `app.can_see_owner`, `app.aal`, `app.role` are consumed by every policy
--      in 014 and by the gate in 011. Zero consumers today is expected, not a
--      dead-RPC finding — the consumers are later migrations in this same set.
--   5. Casts: none.
--   6. Reload/restore: a role or scope change does NOT take effect until the
--      access token refreshes, because those are claims. Doc 02 §7.4 requires
--      forcing `refreshSession()` after any privilege change. That is a client
--      obligation this migration cannot enforce, and it is called out here so
--      it is not discovered as a bug.
--   7. Public routes: none. `anon` holds EXECUTE on nothing created here.
--
-- SPINE: 002 does not touch the action envelope — it does not exist yet (011).
-- 002 IS the foundation the spine's authorization rests on.
--
-- Rollback: rollbacks/002_tenancy_identity_and_permissions_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── 1 · Enum types ─────────────────────────────────────────────────────────
--
-- These three live in `app`, not `core`, because doc 02 §1.2 writes them that
-- way and doc 02 owns identity. The ~45 DOMAIN enums doc 01 names live in
-- `core` alongside the tables they type (003). Recorded as conflict C2.

DO $$ BEGIN
  CREATE TYPE app.app_role AS ENUM (
    'SALES','SALES_MANAGER','OPS','FINANCE','MD','ADMIN','TRAINER','CLIENT','AGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.actor_kind AS ENUM ('HUMAN','AGENT','SYSTEM','CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.data_scope AS ENUM ('MY_ACCOUNTS','MY_TEAM','ALL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2 · Identity tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenants (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name       text        NOT NULL,
  status     text        NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  timezone   text        NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  locale     text        NOT NULL DEFAULT 'en-MY',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenants IS
  'One row per training provider. `slug` is the only externally meaningful name; '
  'the contract forbids a tenant appearing in a path or body, so the slug is for '
  'operators, not for routing.';

CREATE TABLE IF NOT EXISTS public.teams (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  manager_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS public.team_members (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  team_id   uuid NOT NULL REFERENCES public.teams(id)   ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.memberships (
  tenant_id       uuid           NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         uuid           NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  role            app.app_role   NOT NULL,
  actor_kind      app.actor_kind NOT NULL DEFAULT 'HUMAN',
  agent_id        text,
  primary_team_id uuid           REFERENCES public.teams(id) ON DELETE SET NULL,
  trainer_id      uuid,          -- FK added in 006, when core.trainers exists
  client_scope    app.data_scope NOT NULL DEFAULT 'MY_ACCOUNTS',
  team_scope      app.data_scope NOT NULL DEFAULT 'MY_TEAM',
  mfa_required    boolean        NOT NULL DEFAULT false,
  status          text           NOT NULL DEFAULT 'ACTIVE'
                                 CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
  is_default      boolean        NOT NULL DEFAULT true,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT memberships_agent_id_matches_kind
    CHECK ((actor_kind = 'AGENT') = (agent_id IS NOT NULL)),
  CONSTRAINT memberships_agent_role
    CHECK (actor_kind <> 'AGENT' OR role = 'AGENT'),
  CONSTRAINT memberships_trainer_id_present
    CHECK (role <> 'TRAINER' OR trainer_id IS NOT NULL)
);

COMMENT ON TABLE public.memberships IS
  'Keyed (tenant_id, user_id), so a human CAN hold memberships in more than one '
  'tenant. Nothing at launch needs that - there is no tenant switcher and the '
  'contract forbids a tenant in the path - so the access-token hook pins the '
  'single is_default row. The extension point exists; the feature does not.';

-- `user_profiles` is the rest of GET /v1/me. Doc 02 §1.2 assigns it to sb-erd
-- and states the two columns it requires; doc 01 never defines it. It is
-- created here rather than left to fall between the two lanes, because the hook
-- and every policy that resolves a display name need it to exist.
-- ⚠ AUTHOR ADDITION — flagged in the report and in the catalog.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  tenant_id     uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  display_name  text        NOT NULL,
  email         extensions.citext,
  locale        text        NOT NULL DEFAULT 'en-MY',
  timezone      text        NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  theme         text        NOT NULL DEFAULT 'LIGHT' CHECK (theme IN ('LIGHT','DARK')),
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

COMMENT ON TABLE public.user_profiles IS
  'AUTHOR ADDITION. Doc 02 s1.2 assigns this to sb-erd and names the two columns '
  'it requires; doc 01 does not define it. Created here so the identity layer is '
  'complete rather than split across a lane boundary. Columns beyond tenant_id '
  'and user_id are taken from the GET /v1/me response shape in contract s2.';

-- ─── 3 · Indexes ────────────────────────────────────────────────────────────
--
-- Every column a policy reads. `memberships` is keyed (tenant_id, user_id) so
-- the PK already serves tenant-prefixed lookups; the standalone user_id index
-- is for the hook, which searches by user across tenants.

CREATE INDEX IF NOT EXISTS teams_tenant_id_idx          ON public.teams (tenant_id);
CREATE INDEX IF NOT EXISTS teams_manager_user_id_idx     ON public.teams (manager_user_id);
CREATE INDEX IF NOT EXISTS team_members_tenant_user_idx  ON public.team_members (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS team_members_user_idx         ON public.team_members (user_id);
CREATE INDEX IF NOT EXISTS memberships_user_id_idx       ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS user_profiles_user_id_idx     ON public.user_profiles (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_default_per_user
  ON public.memberships (user_id) WHERE is_default AND status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS memberships_agent_unique
  ON public.memberships (tenant_id, agent_id) WHERE agent_id IS NOT NULL;

-- ─── 4 · updated_at triggers ────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_tenants_updated_at       ON public.tenants;
CREATE TRIGGER trg_tenants_updated_at       BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS trg_teams_updated_at         ON public.teams;
CREATE TRIGGER trg_teams_updated_at         BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS trg_memberships_updated_at   ON public.memberships;
CREATE TRIGGER trg_memberships_updated_at   BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A membership's tenant and user are its identity. Allowing either to move
-- would silently transplant a role into another tenant.
DROP TRIGGER IF EXISTS trg_memberships_immutable ON public.memberships;
CREATE TRIGGER trg_memberships_immutable BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION app.enforce_immutable_columns('tenant_id', 'user_id');

-- ─── 5 · The permission catalogue ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app.role_permissions (
  role       app.app_role NOT NULL,
  permission text         NOT NULL
             CHECK (permission ~ '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)+$'),
  PRIMARY KEY (role, permission)
);

COMMENT ON TABLE app.role_permissions IS
  'The role-to-permission matrix, as DATA so an MD can move discount:approve '
  'between roles without a migration. Global, not tenant-scoped. No grants: `app` '
  'is not exposed to PostgREST and no client role holds SELECT. Reached only '
  'through app.has_permission(), which is SECURITY DEFINER. RLS is enabled AND '
  'FORCED with one permissive SELECT policy - see the DDL for why the policy is '
  'required rather than sloppy.';

REVOKE ALL ON TABLE app.role_permissions FROM PUBLIC, anon, authenticated;

-- RLS enabled AND FORCED, per CLAUDE.md rule 2: "every table in `public` and
-- `app`. No exceptions, including config and reference tables." This table was
-- one of three in the pack that had neither.
--
-- The permissive SELECT policy is NOT a shortcut around the rule, it is the
-- measured cost of obeying it. app.has_permission() is SECURITY DEFINER and
-- reads this table; FORCE removes the owner's exemption, and with no policy the
-- function returns FALSE for every permission on a platform whose owner lacks
-- BYPASSRLS. Probe C above measured exactly that: the entire authorisation
-- system fails closed and every MD silently loses every right.
--
-- USING (true) leaks nothing, and that is checkable rather than asserted. The
-- guard on this table is the GRANT layer, not RLS: anon and authenticated hold
-- no SELECT (measured alongside the probe - both false), and `app` is absent
-- from config.toml's exposed schemas, so no client can reach the table to have
-- a policy evaluated for them at all. The policy is reachable only by a role
-- that already owns the table. There is also nothing tenant-scoped here to
-- leak: the table is (role, permission) pairs, identical for every customer.
ALTER TABLE app.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.role_permissions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_permissions_definer_read ON app.role_permissions;
CREATE POLICY role_permissions_definer_read ON app.role_permissions
  FOR SELECT USING (true);

-- ─── 6 · Claim readers ──────────────────────────────────────────────────────
--
-- All STABLE. All read nothing but the request GUC. None is SECURITY DEFINER,
-- because there is nothing to define away — they tell the caller about the
-- caller.
--
-- ✅ DEVIATION D1 IS CLOSED, 2026-09-13, before any apply. It used to read:
-- "this set uses the four-element form … the two forms are equivalent in effect
-- here". They are equivalent in EFFECT and were never equivalent in EVIDENCE,
-- which is the whole of the problem. The four-element form stores proconfig as
--   search_path=pg_catalog, public, extensions, pg_temp
-- and doc 02 §8.7's sweep asserts the exact string `search_path=""`. All forty
-- functions in 001–009 failed it (critic N-05). A test that fails on every
-- object it governs is not a guard, it is noise that gets switched off.
--
-- Resolved in the direction the critic recommended: ONE spelling, `''`, on every
-- function in every migration, because that is what three of the five design
-- docs already write and what the sweep already asserts. The alternative —
-- teaching the sweep to accept both spellings — weakens the sweep, and the
-- sweep's exactness is the only reason it catches the single-quoted-comma trap
-- (`SET search_path = 'a, b'`, one string, silently NOT a two-schema path).
--
-- This was safe to change because every body below was ALREADY fully
-- schema-qualified. That was verified, not assumed: all forty bodies were read
-- out of pg_proc and swept for bare references to any object in app, core,
-- public or extensions. Two hits, both the column `trainer_id` colliding with
-- the function name `app.trainer_id()`, both false. plpgsql does not resolve a
-- relation name until the statement first executes, so a clean apply proves
-- nothing here and the static sweep is the load-bearing check.

CREATE OR REPLACE FUNCTION app.jwt() RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$fn$;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT NULLIF(app.jwt() ->> 'tenant_id', '')::uuid;
$fn$;

COMMENT ON FUNCTION app.current_tenant_id() IS
  'The spelling three lanes converged on independently. app.tenant_id() does not '
  'exist and must not be created - two names for the caller''s tenant is exactly '
  'the divergence that ends with one policy using the wrong one.';

CREATE OR REPLACE FUNCTION app.role() RETURNS app.app_role
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT NULLIF(app.jwt() ->> 'app_role', '')::app.app_role;
$fn$;

CREATE OR REPLACE FUNCTION app.actor_kind() RETURNS app.actor_kind
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT COALESCE(NULLIF(app.jwt() ->> 'actor_kind', ''), 'HUMAN')::app.actor_kind;
$fn$;

CREATE OR REPLACE FUNCTION app.client_scope() RETURNS app.data_scope
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT COALESCE(NULLIF(app.jwt() ->> 'client_scope', ''), 'MY_ACCOUNTS')::app.data_scope;
$fn$;

CREATE OR REPLACE FUNCTION app.team_scope() RETURNS app.data_scope
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT COALESCE(NULLIF(app.jwt() ->> 'team_scope', ''), 'MY_TEAM')::app.data_scope;
$fn$;

-- Authenticator Assurance Level. `aal2` means the caller completed MFA.
CREATE OR REPLACE FUNCTION app.aal() RETURNS text
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT COALESCE(app.jwt() ->> 'aal', 'aal1');
$fn$;

CREATE OR REPLACE FUNCTION app.is_agent() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT COALESCE(app.jwt() ->> 'actor_kind', 'HUMAN') = 'AGENT';
$fn$;

CREATE OR REPLACE FUNCTION app.agent_id() RETURNS text
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT NULLIF(app.jwt() ->> 'agent_id', '');
$fn$;

CREATE OR REPLACE FUNCTION app.trainer_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT NULLIF(app.jwt() ->> 'trainer_id', '')::uuid;
$fn$;

-- For GATE functions, where an absent tenant should be an exception rather than
-- a denial. ⚠ A POLICY MUST NOT CALL THIS: a predicate that raises turns an
-- empty result set into a 500, which is both a worse experience and an
-- existence oracle.
CREATE OR REPLACE FUNCTION app.require_tenant_id() RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $fn$
DECLARE v_tenant uuid := app.current_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'NO_TENANT' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_tenant;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.has_role(p_role text) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT app.role() = p_role::app.app_role;
$fn$;

COMMENT ON FUNCTION app.has_role(text) IS
  'Exists because sb-actions asked for it. PREFER app.has_permission() wherever a '
  'permission string fits: the matrix is data, so an MD can move a permission '
  'between roles without a migration, while a role check hard-codes today''s '
  'matrix into the caller.';

-- SECURITY DEFINER purely so no login role needs SELECT on app.role_permissions.
-- It takes no identity argument and reads only the caller's own claim, so there
-- is no privilege to escalate — the self-check is structural rather than written.
CREATE OR REPLACE FUNCTION app.has_permission(p_permission text) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM app.role_permissions rp
    WHERE rp.role = app.role() AND rp.permission = p_permission
  );
$fn$;

-- SECURITY DEFINER so it can read team_members without that table's own policy
-- recursing into it. It reads the caller's identity internally from auth.uid(),
-- so it cannot be pointed at anyone else's team.
CREATE OR REPLACE FUNCTION app.my_team_user_ids() RETURNS uuid[]
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT peer.user_id), ARRAY[]::uuid[])
  FROM public.team_members peer
  WHERE peer.tenant_id = app.current_tenant_id()
    AND peer.team_id IN (
      SELECT mine.team_id
      FROM public.team_members mine
      WHERE mine.user_id = (SELECT auth.uid())
        AND mine.tenant_id = app.current_tenant_id()
    );
$fn$;

CREATE OR REPLACE FUNCTION app.can_see_owner(p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  -- ⚠ CORRECTION to doc 02 §4.1, found by executing it. The doc writes
  --     p_owner = any ((select app.my_team_user_ids()))
  -- which does not compile: `ANY ((SELECT ...))` is parsed as the SUBQUERY form
  -- of ANY, which wants a set, and the function returns a single uuid[] value,
  -- so Postgres reports `operator does not exist: uuid = uuid[]`. The explicit
  -- `::uuid[]` cast selects the ARRAY form instead.
  --
  -- The cast is also what preserves the property the doc wanted: EXPLAIN shows
  -- the whole expression hoisted to `(InitPlan 1).col1`, so the team lookup runs
  -- once per statement rather than once per row. Calling the function bare —
  -- `= ANY (app.my_team_user_ids())` — also compiles but gives up that guarantee.
  SELECT CASE app.client_scope()
           WHEN 'ALL'     THEN true
           WHEN 'MY_TEAM' THEN p_owner = ANY ((SELECT app.my_team_user_ids())::uuid[])
           ELSE                p_owner = (SELECT auth.uid())
         END;
$fn$;

-- sb-actions' actor record. actor_kind has FOUR values: portal RPCs write CLIENT.
CREATE OR REPLACE FUNCTION app.current_actor()
RETURNS TABLE (actor_id text, actor_kind text, role text)
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT
    CASE WHEN app.is_agent() THEN app.agent_id() ELSE (SELECT auth.uid())::text END,
    app.actor_kind()::text,
    app.role()::text;
$fn$;

-- ─── 7 · Claim construction — ONE body, two callers ─────────────────────────
--
-- Doc 02 §3.1: the access-token hook does not run for a self-minted agent
-- token, so claims would otherwise be built in two places and drift. This is
-- the single body. The hook below is one caller; the agent-token minter (an
-- Edge Function, outside this migration set) is the other.

-- ⚠ SECURITY INVOKER, NOT DEFINER, AND THAT IS THE POINT. Changed 2026-09-13
-- under the lead's ruling, together with its only caller below.
--
-- Doc 02 §4.1 left this open and said so: the hook was SECURITY DEFINER *and*
-- 002 granted supabase_auth_admin SELECT on the two tables *and* created
-- supabase_auth_admin policies for them — "which means one of the two is dead
-- code and nobody knows which". Under DEFINER the body runs as the function's
-- OWNER, so the grants and the policies are inert; under INVOKER it runs as
-- supabase_auth_admin, which is GoTrue's own role, and they are load-bearing.
--
-- The failure mode INVOKER removes is not hypothetical. public.memberships is
-- FORCE ROW LEVEL SECURITY (§9 below). FORCE strips the owner's exemption, so a
-- DEFINER body owned by a role without BYPASSRLS matches no policy on that table
-- — every policy there is written TO authenticated or TO supabase_auth_admin —
-- reads zero rows, and returns the tenant_id-NULL claim set below. That is not a
-- visible error. It is every user signing in successfully and then seeing an
-- empty product.
--
-- MEASURED, on PostgreSQL 17.11, because this cluster's `postgres` is a
-- superuser with BYPASSRLS and therefore cannot answer the hosted question by
-- being asked. The probe reassigns a table and its DEFINER reader to a role
-- created NOSUPERUSER NOBYPASSRLS — the hosted worst case — and measures the
-- mechanism:
--     A  RLS off                       -> true
--     B  RLS enabled, not forced       -> true   (owner keeps its exemption)
--     C  RLS FORCED, no policy         -> FALSE  (the silent failure)
--     D  RLS FORCED, one SELECT policy -> true
-- Supabase's own RLS guide states that a function created by `postgres` "will
-- have bypassrls privileges", which implies C never fires on the platform. That
-- is an inference from prose about a role attribute nobody here can read, and
-- §4.1 already says doc-reading cannot settle it. So the pack is built to be
-- correct EITHER WAY: INVOKER here, and an explicit owner-admitting policy on
-- every table a DEFINER function must read. Then the attribute does not matter.
CREATE OR REPLACE FUNCTION app.principal_claims(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE m record;
BEGIN
  SELECT mb.tenant_id, mb.role, mb.actor_kind, mb.agent_id,
         mb.primary_team_id, mb.trainer_id, mb.client_scope, mb.team_scope,
         mb.mfa_required
    INTO m
  FROM public.memberships mb
  JOIN public.tenants t ON t.id = mb.tenant_id
  WHERE mb.user_id = p_user_id
    AND mb.status  = 'ACTIVE'
    AND t.status   = 'ACTIVE'
  ORDER BY mb.is_default DESC, mb.created_at ASC
  LIMIT 1;

  -- No active membership: return claims that satisfy no policy anywhere. Failing
  -- closed here is deliberate — the alternative is a token with no tenant claim
  -- at all, which several policies would read as NULL = NULL and skip.
  IF m.tenant_id IS NULL THEN
    RETURN jsonb_build_object('tenant_id', NULL, 'app_role', NULL, 'actor_kind', 'HUMAN');
  END IF;

  RETURN jsonb_build_object(
    'tenant_id',    m.tenant_id,
    'app_role',     m.role,
    'actor_kind',   m.actor_kind,
    'agent_id',     m.agent_id,
    'team_id',      m.primary_team_id,
    'trainer_id',   m.trainer_id,
    'client_scope', m.client_scope,
    'team_scope',   m.team_scope,
    'mfa_required', m.mfa_required
  );
END;
$fn$;

-- SECURITY INVOKER for the reason given on app.principal_claims above. The two
-- must change together: the hook is a two-line wrapper, so leaving
-- principal_claims as DEFINER would move the body back to the owner's context
-- and restore the exact failure INVOKER was chosen to remove.
CREATE OR REPLACE FUNCTION app.custom_access_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_claims jsonb := COALESCE(event -> 'claims', '{}'::jsonb);
BEGIN
  v_claims := v_claims || app.principal_claims((event ->> 'user_id')::uuid);
  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$fn$;

COMMENT ON FUNCTION app.custom_access_token_hook(jsonb) IS
  'GoTrue custom access token hook. Enable with '
  'auth.hook.custom_access_token.enabled = true and '
  'uri = "pg-functions://postgres/app/custom_access_token_hook". SECURITY INVOKER, '
  'so it genuinely runs as supabase_auth_admin, which is NOT BYPASSRLS: the SELECT '
  'grants and the two supabase_auth_admin policies below are what make it work, '
  'not decoration beside a DEFINER that ignored them. Remove either and every '
  'token issues with tenant_id null and nobody can see anything.';

-- ─── 8 · Function grants ────────────────────────────────────────────────────
--
-- Default-deny, then grant back the three an RLS predicate must evaluate in the
-- caller's own context. Doc 02 §4.1's ALTER DEFAULT PRIVILEGES does not close
-- this (see 001's header); these explicit REVOKEs do.

REVOKE ALL ON FUNCTION app.jwt()                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.current_tenant_id()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.role()                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.actor_kind()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.client_scope()                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.team_scope()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.aal()                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.is_agent()                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.agent_id()                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.trainer_id()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.require_tenant_id()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.has_role(text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.has_permission(text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.my_team_user_ids()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.can_see_owner(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.current_actor()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.principal_claims(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.custom_access_token_hook(jsonb)    FROM PUBLIC, anon, authenticated;

-- The claim readers a policy predicate evaluates in the CALLER's context. A
-- policy that calls a function the caller may not execute fails the whole
-- statement, so these three grants are load-bearing, not incidental.
GRANT EXECUTE ON FUNCTION app.jwt()                TO authenticated;
GRANT EXECUTE ON FUNCTION app.current_tenant_id()  TO authenticated;
GRANT EXECUTE ON FUNCTION app.role()               TO authenticated;
GRANT EXECUTE ON FUNCTION app.actor_kind()         TO authenticated;
GRANT EXECUTE ON FUNCTION app.client_scope()       TO authenticated;
GRANT EXECUTE ON FUNCTION app.team_scope()         TO authenticated;
GRANT EXECUTE ON FUNCTION app.aal()                TO authenticated;
GRANT EXECUTE ON FUNCTION app.is_agent()           TO authenticated;
GRANT EXECUTE ON FUNCTION app.agent_id()           TO authenticated;
GRANT EXECUTE ON FUNCTION app.trainer_id()         TO authenticated;
GRANT EXECUTE ON FUNCTION app.has_role(text)       TO authenticated;
GRANT EXECUTE ON FUNCTION app.has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.my_team_user_ids()   TO authenticated;
GRANT EXECUTE ON FUNCTION app.can_see_owner(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION app.current_actor()      TO authenticated;

-- ─── 9 · Grants GoTrue needs, and the reason they are easy to forget ────────
--
-- `supabase_auth_admin` exists only on a real Supabase project. Guarded so this
-- migration runs on a bare Postgres too, and NOTICEs loudly rather than
-- silently skipping — a silently skipped hook grant is a total outage whose
-- only symptom is that nobody can see anything.

DO $gotrue$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT USAGE ON SCHEMA app TO supabase_auth_admin;
    -- ⚠ LOAD-BEARING SINCE THE HOOK BECAME SECURITY INVOKER, and it was NOT
    -- needed before, which is why it was missing. 001 revokes the Postgres
    -- default `GRANT USAGE ON SCHEMA public TO PUBLIC` and grants USAGE back to
    -- exactly anon, authenticated and service_role. supabase_auth_admin was not
    -- on that list. Under SECURITY DEFINER the hook ran as its owner and never
    -- noticed; under INVOKER it runs as supabase_auth_admin and dies on
    -- "permission denied for schema public" before it reads a single row.
    -- Found by test_002 T9, which had been passing vacuously until the mode
    -- changed and only then tested what its name claims.
    GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION app.custom_access_token_hook(jsonb) TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION app.principal_claims(uuid)          TO supabase_auth_admin;
    GRANT SELECT ON public.memberships, public.tenants            TO supabase_auth_admin;
    RAISE NOTICE '002: supabase_auth_admin granted the hook and its two reads.';
  ELSE
    RAISE NOTICE
      '002: role supabase_auth_admin not present - hook grants SKIPPED. This is '
      'expected on a bare Postgres and is a BLOCKER on a real project: without '
      'them every access token issues with tenant_id null.';
  END IF;
END;
$gotrue$;

-- ─── 10 · RLS on the identity tables (doc 02 §4.3) ──────────────────────────
--
-- FORCE as well as ENABLE. FORCE removes the table OWNER's exemption, so a
-- function running as `postgres` no longer silently sees every tenant. It does
-- not affect `service_role`, which holds BYPASSRLS and bypasses regardless —
-- that is intended and is why service_role must never reach a browser.

ALTER TABLE public.tenants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.teams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams          FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.team_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members   FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships    FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles  FORCE  ROW LEVEL SECURITY;

-- PostgREST reaches these as `authenticated`; the table grants below are the
-- floor under RLS, not a substitute for it.
GRANT SELECT                         ON public.tenants       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members  TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.memberships   TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.user_profiles TO authenticated;
GRANT UPDATE                         ON public.tenants       TO authenticated;

-- tenants ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenants_select ON public.tenants;
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (id = (SELECT app.current_tenant_id()));

DROP POLICY IF EXISTS tenants_update_admin ON public.tenants;
CREATE POLICY tenants_update_admin ON public.tenants
  FOR UPDATE TO authenticated
  USING (id = (SELECT app.current_tenant_id()) AND (SELECT app.role()) = 'ADMIN')
  WITH CHECK (id = (SELECT app.current_tenant_id()));
-- No INSERT and no DELETE policy: creating and closing a tenant is provisioning,
-- done by service_role, not a button in the product.

-- teams / team_members ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT app.current_tenant_id()));

DROP POLICY IF EXISTS teams_write_admin ON public.teams;
CREATE POLICY teams_write_admin ON public.teams
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT app.current_tenant_id()) AND (SELECT app.role()) = 'ADMIN')
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()) AND (SELECT app.role()) = 'ADMIN');

DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT app.current_tenant_id()));

DROP POLICY IF EXISTS team_members_write_admin ON public.team_members;
CREATE POLICY team_members_write_admin ON public.team_members
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT app.current_tenant_id()) AND (SELECT app.role()) = 'ADMIN')
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()) AND (SELECT app.role()) = 'ADMIN');

-- memberships ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS memberships_select_self ON public.memberships;
CREATE POLICY memberships_select_self ON public.memberships
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    AND (user_id = (SELECT auth.uid()) OR (SELECT app.role()) IN ('ADMIN','MD'))
  );

DROP POLICY IF EXISTS memberships_write_admin ON public.memberships;
CREATE POLICY memberships_write_admin ON public.memberships
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT app.current_tenant_id()) AND (SELECT app.role()) = 'ADMIN')
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    AND (SELECT app.role()) = 'ADMIN'
    AND (SELECT app.aal()) = 'aal2'
  );

-- THE escalation stop. RESTRICTIVE, so it ANDs with everything above instead of
-- being one more OR branch someone forgets. Without it an ADMIN can UPDATE their
-- own row to any role, any scope, any tenant — and `memberships_write_admin`
-- would permit it, because they are an ADMIN of that tenant while they do it.
DROP POLICY IF EXISTS memberships_no_self_edit ON public.memberships;
CREATE POLICY memberships_no_self_edit ON public.memberships
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (user_id <> (SELECT auth.uid()));

-- No DELETE policy anywhere on memberships: removal is `status = 'REMOVED'`, so
-- the audit trail of who had access when survives.

-- user_profiles ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
CREATE POLICY user_profiles_select ON public.user_profiles
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT app.current_tenant_id()));

DROP POLICY IF EXISTS user_profiles_insert_admin ON public.user_profiles;
CREATE POLICY user_profiles_insert_admin ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()) AND (SELECT app.role()) = 'ADMIN');

DROP POLICY IF EXISTS user_profiles_update_self_or_admin ON public.user_profiles;
CREATE POLICY user_profiles_update_self_or_admin ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (
    tenant_id = (SELECT app.current_tenant_id())
    AND (user_id = (SELECT auth.uid()) OR (SELECT app.role()) = 'ADMIN')
  )
  WITH CHECK (
    tenant_id = (SELECT app.current_tenant_id())
    AND (user_id = (SELECT auth.uid()) OR (SELECT app.role()) = 'ADMIN')
  );

-- supabase_auth_admin reads, without which the hook returns nothing ─────────
DO $gotrue_policies$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    DROP POLICY IF EXISTS memberships_auth_admin_read ON public.memberships;
    CREATE POLICY memberships_auth_admin_read ON public.memberships
      FOR SELECT TO supabase_auth_admin USING (true);
    DROP POLICY IF EXISTS tenants_auth_admin_read ON public.tenants;
    CREATE POLICY tenants_auth_admin_read ON public.tenants
      FOR SELECT TO supabase_auth_admin USING (true);
  END IF;
END;
$gotrue_policies$;


-- ─── 11 · The role → permission matrix, as data ─────────────────────────────
--
-- Transcribed from doc 02 §2.3 by PARSING the markdown table, not by reading it:
-- 74 rows, 109 distinct permissions, 399 (role, permission) pairs. A hand
-- transcription of a 74x7 grid is a typo generator, and a missing tick here is
-- a silent authorisation hole that no test for a DIFFERENT permission would
-- catch.
--
-- ⚠ FINDING. Doc 02 §2.2 closes with "Ninety-four strings." Its own catalogue
-- holds 109 (111 minus `me:read`, which the same sentence excludes, and
-- `object:verb`, which is the sample shape). Its §2.3 matrix independently holds
-- the same 109. The prose count is stale, the data is consistent, and this seed
-- follows the data. Reported rather than silently corrected in the doc.
--
-- ● and ○ are BOTH grants. ○ means "granted, then narrowed by data scope" — the
-- narrowing is `app.can_see_owner()` inside the policy, not the absence of a
-- permission row. Storing ○ as a denial would lock SALES out of their own
-- accounts entirely. 78 of the 399 pairs are ○.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running adds nothing. Rows are NOT
-- deleted on re-run - an operator who has edited the matrix in production keeps
-- their edit, which is the point of making it data.

INSERT INTO app.role_permissions (role, permission) VALUES
  -- SALES (50)
  ('SALES', 'approval:read'),  -- scope-narrowed
  ('SALES', 'audit:read'),
  ('SALES', 'collection:read'),  -- scope-narrowed
  ('SALES', 'contact:consent:read'),  -- scope-narrowed
  ('SALES', 'contact:read'),  -- scope-narrowed
  ('SALES', 'contact:write'),  -- scope-narrowed
  ('SALES', 'dashboard:read'),
  ('SALES', 'engagement:read'),  -- scope-narrowed
  ('SALES', 'enquiry:archive'),  -- scope-narrowed
  ('SALES', 'enquiry:convert'),  -- scope-narrowed
  ('SALES', 'enquiry:edit_extraction'),  -- scope-narrowed
  ('SALES', 'enquiry:read'),  -- scope-narrowed
  ('SALES', 'followup:draft'),  -- scope-narrowed
  ('SALES', 'followup:read'),  -- scope-narrowed
  ('SALES', 'followup:send'),  -- scope-narrowed
  ('SALES', 'invoice:read'),  -- scope-narrowed
  ('SALES', 'metric:read'),
  ('SALES', 'navigation:read'),
  ('SALES', 'opportunity:read'),  -- scope-narrowed
  ('SALES', 'opportunity:stage'),  -- scope-narrowed
  ('SALES', 'opportunity:write'),  -- scope-narrowed
  ('SALES', 'organisation:metrics:read'),  -- scope-narrowed
  ('SALES', 'organisation:read'),  -- scope-narrowed
  ('SALES', 'organisation:suggestions:read'),  -- scope-narrowed
  ('SALES', 'organisation:write'),  -- scope-narrowed
  ('SALES', 'pipeline:read'),
  ('SALES', 'policy:read'),
  ('SALES', 'portal:token:issue'),  -- scope-narrowed
  ('SALES', 'portal:token:revoke'),  -- scope-narrowed
  ('SALES', 'programme:read'),
  ('SALES', 'proposal:preview'),  -- scope-narrowed
  ('SALES', 'proposal:read'),  -- scope-narrowed
  ('SALES', 'proposal:regenerate'),  -- scope-narrowed
  ('SALES', 'proposal:send'),  -- scope-narrowed
  ('SALES', 'proposal:share'),  -- scope-narrowed
  ('SALES', 'proposal:write'),  -- scope-narrowed
  ('SALES', 'quotation:apply'),  -- scope-narrowed
  ('SALES', 'quotation:read'),  -- scope-narrowed
  ('SALES', 'quotation:write'),  -- scope-narrowed
  ('SALES', 'receivable:read'),  -- scope-narrowed
  ('SALES', 'report:read'),
  ('SALES', 'search:read'),
  ('SALES', 'template:read'),
  ('SALES', 'tna:read'),  -- scope-narrowed
  ('SALES', 'tna:recommendation:accept'),  -- scope-narrowed
  ('SALES', 'tna:reopen'),  -- scope-narrowed
  ('SALES', 'tna:write'),  -- scope-narrowed
  ('SALES', 'trainer:read'),
  ('SALES', 'view:read'),
  ('SALES', 'view:write'),
  -- SALES_MANAGER (58)
  ('SALES_MANAGER', 'approval:bulk_decide'),
  ('SALES_MANAGER', 'approval:decide'),
  ('SALES_MANAGER', 'approval:read'),
  ('SALES_MANAGER', 'approval:reassign'),
  ('SALES_MANAGER', 'audit:read'),
  ('SALES_MANAGER', 'broadcast:send'),
  ('SALES_MANAGER', 'collection:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'contact:consent:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'contact:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'contact:write'),  -- scope-narrowed
  ('SALES_MANAGER', 'dashboard:executive:read'),
  ('SALES_MANAGER', 'dashboard:read'),
  ('SALES_MANAGER', 'discount:approve'),
  ('SALES_MANAGER', 'engagement:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'enquiry:archive'),  -- scope-narrowed
  ('SALES_MANAGER', 'enquiry:assign'),
  ('SALES_MANAGER', 'enquiry:convert'),  -- scope-narrowed
  ('SALES_MANAGER', 'enquiry:edit_extraction'),  -- scope-narrowed
  ('SALES_MANAGER', 'enquiry:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'followup:draft'),  -- scope-narrowed
  ('SALES_MANAGER', 'followup:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'followup:send'),  -- scope-narrowed
  ('SALES_MANAGER', 'invoice:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'metric:read'),
  ('SALES_MANAGER', 'navigation:read'),
  ('SALES_MANAGER', 'opportunity:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'opportunity:stage'),  -- scope-narrowed
  ('SALES_MANAGER', 'opportunity:write'),  -- scope-narrowed
  ('SALES_MANAGER', 'organisation:metrics:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'organisation:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'organisation:suggestions:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'organisation:write'),  -- scope-narrowed
  ('SALES_MANAGER', 'pipeline:read'),
  ('SALES_MANAGER', 'policy:read'),
  ('SALES_MANAGER', 'portal:token:issue'),  -- scope-narrowed
  ('SALES_MANAGER', 'portal:token:revoke'),
  ('SALES_MANAGER', 'programme:read'),
  ('SALES_MANAGER', 'proposal:preview'),  -- scope-narrowed
  ('SALES_MANAGER', 'proposal:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'proposal:regenerate'),  -- scope-narrowed
  ('SALES_MANAGER', 'proposal:send'),  -- scope-narrowed
  ('SALES_MANAGER', 'proposal:share'),  -- scope-narrowed
  ('SALES_MANAGER', 'proposal:write'),  -- scope-narrowed
  ('SALES_MANAGER', 'quotation:apply'),  -- scope-narrowed
  ('SALES_MANAGER', 'quotation:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'quotation:write'),  -- scope-narrowed
  ('SALES_MANAGER', 'receivable:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'report:read'),
  ('SALES_MANAGER', 'search:read'),
  ('SALES_MANAGER', 'template:read'),
  ('SALES_MANAGER', 'tna:read'),  -- scope-narrowed
  ('SALES_MANAGER', 'tna:recommendation:accept'),  -- scope-narrowed
  ('SALES_MANAGER', 'tna:reopen'),  -- scope-narrowed
  ('SALES_MANAGER', 'tna:write'),  -- scope-narrowed
  ('SALES_MANAGER', 'trainer:read'),
  ('SALES_MANAGER', 'view:read'),
  ('SALES_MANAGER', 'view:share'),
  ('SALES_MANAGER', 'view:write'),
  -- OPS (40)
  ('OPS', 'approval:read'),  -- scope-narrowed
  ('OPS', 'attendance:approve'),
  ('OPS', 'attendance:capture'),
  ('OPS', 'attendance:export'),
  ('OPS', 'attendance:read'),
  ('OPS', 'audit:read'),
  ('OPS', 'compliance:check:read'),
  ('OPS', 'compliance:rule:read'),
  ('OPS', 'contact:consent:read'),
  ('OPS', 'contact:read'),
  ('OPS', 'contact:write'),
  ('OPS', 'dashboard:read'),
  ('OPS', 'engagement:close_out'),
  ('OPS', 'engagement:read'),
  ('OPS', 'engagement:write'),
  ('OPS', 'hrdc:document:write'),
  ('OPS', 'hrdc:export'),
  ('OPS', 'hrdc:read'),
  ('OPS', 'metric:read'),
  ('OPS', 'navigation:read'),
  ('OPS', 'opportunity:read'),
  ('OPS', 'organisation:metrics:read'),
  ('OPS', 'organisation:read'),
  ('OPS', 'participant:read'),
  ('OPS', 'participant:write'),
  ('OPS', 'pipeline:read'),
  ('OPS', 'policy:read'),
  ('OPS', 'programme:read'),
  ('OPS', 'proposal:preview'),
  ('OPS', 'proposal:read'),
  ('OPS', 'report:read'),
  ('OPS', 'search:read'),
  ('OPS', 'template:read'),
  ('OPS', 'tna:read'),
  ('OPS', 'trainer:book'),
  ('OPS', 'trainer:read'),
  ('OPS', 'trainer:write'),
  ('OPS', 'view:read'),
  ('OPS', 'view:share'),
  ('OPS', 'view:write'),
  -- FINANCE (52)
  ('FINANCE', 'ai:budget:read'),
  ('FINANCE', 'ai:usage:read'),
  ('FINANCE', 'approval:bulk_decide'),
  ('FINANCE', 'approval:decide'),
  ('FINANCE', 'approval:read'),
  ('FINANCE', 'attendance:export'),
  ('FINANCE', 'attendance:read'),
  ('FINANCE', 'attendance:unlock'),
  ('FINANCE', 'audit:read'),
  ('FINANCE', 'collection:read'),
  ('FINANCE', 'collection:remind'),
  ('FINANCE', 'compliance:check:read'),
  ('FINANCE', 'compliance:rule:approve'),
  ('FINANCE', 'compliance:rule:read'),
  ('FINANCE', 'compliance:rule:write'),
  ('FINANCE', 'contact:consent:read'),
  ('FINANCE', 'contact:read'),
  ('FINANCE', 'dashboard:executive:read'),
  ('FINANCE', 'dashboard:read'),
  ('FINANCE', 'discount:approve'),
  ('FINANCE', 'engagement:read'),
  ('FINANCE', 'hrdc:document:write'),
  ('FINANCE', 'hrdc:export'),
  ('FINANCE', 'hrdc:mark_submitted'),
  ('FINANCE', 'hrdc:read'),
  ('FINANCE', 'invoice:create'),
  ('FINANCE', 'invoice:push'),
  ('FINANCE', 'invoice:read'),
  ('FINANCE', 'knowledge:source:read'),
  ('FINANCE', 'metric:read'),
  ('FINANCE', 'navigation:read'),
  ('FINANCE', 'opportunity:read'),
  ('FINANCE', 'organisation:metrics:read'),
  ('FINANCE', 'organisation:read'),
  ('FINANCE', 'participant:read'),
  ('FINANCE', 'payment:record'),
  ('FINANCE', 'pipeline:read'),
  ('FINANCE', 'policy:read'),
  ('FINANCE', 'programme:read'),
  ('FINANCE', 'proposal:preview'),
  ('FINANCE', 'proposal:read'),
  ('FINANCE', 'quotation:apply'),
  ('FINANCE', 'quotation:read'),
  ('FINANCE', 'quotation:write'),
  ('FINANCE', 'receivable:read'),
  ('FINANCE', 'report:read'),
  ('FINANCE', 'search:read'),
  ('FINANCE', 'template:read'),
  ('FINANCE', 'trainer:read'),
  ('FINANCE', 'view:read'),
  ('FINANCE', 'view:share'),
  ('FINANCE', 'view:write'),
  -- MD (91)
  ('MD', 'agent:autonomy'),
  ('MD', 'agent:pause'),
  ('MD', 'agent:read'),
  ('MD', 'ai:budget:raise'),
  ('MD', 'ai:budget:read'),
  ('MD', 'ai:routing:read'),
  ('MD', 'ai:tier:read'),
  ('MD', 'ai:usage:read'),
  ('MD', 'approval:bulk_decide'),
  ('MD', 'approval:decide'),
  ('MD', 'approval:read'),
  ('MD', 'approval:reassign'),
  ('MD', 'attendance:approve'),
  ('MD', 'attendance:capture'),
  ('MD', 'attendance:export'),
  ('MD', 'attendance:read'),
  ('MD', 'attendance:unlock'),
  ('MD', 'audit:read'),
  ('MD', 'broadcast:send'),
  ('MD', 'collection:read'),
  ('MD', 'collection:remind'),
  ('MD', 'compliance:check:read'),
  ('MD', 'compliance:rule:approve'),
  ('MD', 'compliance:rule:read'),
  ('MD', 'contact:consent:read'),
  ('MD', 'contact:read'),
  ('MD', 'contact:write'),
  ('MD', 'dashboard:executive:read'),
  ('MD', 'dashboard:read'),
  ('MD', 'discount:approve'),
  ('MD', 'engagement:close_out'),
  ('MD', 'engagement:read'),
  ('MD', 'engagement:write'),
  ('MD', 'enquiry:archive'),
  ('MD', 'enquiry:assign'),
  ('MD', 'enquiry:convert'),
  ('MD', 'enquiry:edit_extraction'),
  ('MD', 'enquiry:read'),
  ('MD', 'eval:read'),
  ('MD', 'followup:draft'),
  ('MD', 'followup:read'),
  ('MD', 'followup:send'),
  ('MD', 'hrdc:document:write'),
  ('MD', 'hrdc:export'),
  ('MD', 'hrdc:mark_submitted'),
  ('MD', 'hrdc:read'),
  ('MD', 'invoice:create'),
  ('MD', 'invoice:push'),
  ('MD', 'invoice:read'),
  ('MD', 'knowledge:source:read'),
  ('MD', 'metric:read'),
  ('MD', 'navigation:read'),
  ('MD', 'opportunity:read'),
  ('MD', 'opportunity:stage'),
  ('MD', 'opportunity:write'),
  ('MD', 'organisation:metrics:read'),
  ('MD', 'organisation:read'),
  ('MD', 'organisation:suggestions:read'),
  ('MD', 'organisation:write'),
  ('MD', 'participant:read'),
  ('MD', 'participant:write'),
  ('MD', 'payment:record'),
  ('MD', 'pipeline:read'),
  ('MD', 'policy:read'),
  ('MD', 'portal:token:issue'),
  ('MD', 'portal:token:revoke'),
  ('MD', 'programme:read'),
  ('MD', 'proposal:preview'),
  ('MD', 'proposal:read'),
  ('MD', 'proposal:regenerate'),
  ('MD', 'proposal:send'),
  ('MD', 'proposal:share'),
  ('MD', 'proposal:write'),
  ('MD', 'quotation:apply'),
  ('MD', 'quotation:read'),
  ('MD', 'quotation:write'),
  ('MD', 'receivable:read'),
  ('MD', 'report:read'),
  ('MD', 'run:read'),
  ('MD', 'search:read'),
  ('MD', 'template:read'),
  ('MD', 'tna:read'),
  ('MD', 'tna:recommendation:accept'),
  ('MD', 'tna:reopen'),
  ('MD', 'tna:write'),
  ('MD', 'trainer:book'),
  ('MD', 'trainer:read'),
  ('MD', 'trainer:write'),
  ('MD', 'view:read'),
  ('MD', 'view:share'),
  ('MD', 'view:write'),
  -- ADMIN (98)
  ('ADMIN', 'agent:pause'),
  ('ADMIN', 'agent:read'),
  ('ADMIN', 'ai:budget:read'),
  ('ADMIN', 'ai:budget:write'),
  ('ADMIN', 'ai:provider:delete'),
  ('ADMIN', 'ai:provider:read'),
  ('ADMIN', 'ai:provider:reveal'),
  ('ADMIN', 'ai:provider:rotate'),
  ('ADMIN', 'ai:provider:test'),
  ('ADMIN', 'ai:provider:write'),
  ('ADMIN', 'ai:routing:read'),
  ('ADMIN', 'ai:routing:write'),
  ('ADMIN', 'ai:tier:read'),
  ('ADMIN', 'ai:tier:write'),
  ('ADMIN', 'ai:usage:read'),
  ('ADMIN', 'approval:read'),
  ('ADMIN', 'approval:reassign'),
  ('ADMIN', 'attendance:approve'),
  ('ADMIN', 'attendance:capture'),
  ('ADMIN', 'attendance:export'),
  ('ADMIN', 'attendance:read'),
  ('ADMIN', 'attendance:unlock'),
  ('ADMIN', 'audit:read'),
  ('ADMIN', 'broadcast:send'),
  ('ADMIN', 'collection:read'),
  ('ADMIN', 'compliance:check:read'),
  ('ADMIN', 'compliance:rule:read'),
  ('ADMIN', 'compliance:rule:write'),
  ('ADMIN', 'contact:consent:read'),
  ('ADMIN', 'contact:read'),
  ('ADMIN', 'contact:write'),
  ('ADMIN', 'dashboard:executive:read'),
  ('ADMIN', 'dashboard:read'),
  ('ADMIN', 'engagement:close_out'),
  ('ADMIN', 'engagement:read'),
  ('ADMIN', 'engagement:write'),
  ('ADMIN', 'enquiry:archive'),
  ('ADMIN', 'enquiry:assign'),
  ('ADMIN', 'enquiry:convert'),
  ('ADMIN', 'enquiry:edit_extraction'),
  ('ADMIN', 'enquiry:read'),
  ('ADMIN', 'eval:read'),
  ('ADMIN', 'followup:draft'),
  ('ADMIN', 'followup:read'),
  ('ADMIN', 'followup:send'),
  ('ADMIN', 'hrdc:document:write'),
  ('ADMIN', 'hrdc:export'),
  ('ADMIN', 'hrdc:read'),
  ('ADMIN', 'invoice:read'),
  ('ADMIN', 'knowledge:source:read'),
  ('ADMIN', 'knowledge:source:reingest'),
  ('ADMIN', 'knowledge:source:write'),
  ('ADMIN', 'metric:read'),
  ('ADMIN', 'navigation:read'),
  ('ADMIN', 'opportunity:read'),
  ('ADMIN', 'opportunity:stage'),
  ('ADMIN', 'opportunity:write'),
  ('ADMIN', 'organisation:metrics:read'),
  ('ADMIN', 'organisation:read'),
  ('ADMIN', 'organisation:suggestions:read'),
  ('ADMIN', 'organisation:write'),
  ('ADMIN', 'participant:read'),
  ('ADMIN', 'participant:write'),
  ('ADMIN', 'pipeline:read'),
  ('ADMIN', 'policy:read'),
  ('ADMIN', 'policy:write'),
  ('ADMIN', 'portal:token:issue'),
  ('ADMIN', 'portal:token:revoke'),
  ('ADMIN', 'programme:read'),
  ('ADMIN', 'programme:write'),
  ('ADMIN', 'proposal:preview'),
  ('ADMIN', 'proposal:read'),
  ('ADMIN', 'proposal:regenerate'),
  ('ADMIN', 'proposal:send'),
  ('ADMIN', 'proposal:share'),
  ('ADMIN', 'proposal:write'),
  ('ADMIN', 'quotation:apply'),
  ('ADMIN', 'quotation:read'),
  ('ADMIN', 'quotation:write'),
  ('ADMIN', 'receivable:read'),
  ('ADMIN', 'report:read'),
  ('ADMIN', 'run:dead_letter'),
  ('ADMIN', 'run:read'),
  ('ADMIN', 'run:replay'),
  ('ADMIN', 'run:retry'),
  ('ADMIN', 'search:read'),
  ('ADMIN', 'template:read'),
  ('ADMIN', 'template:write'),
  ('ADMIN', 'tna:read'),
  ('ADMIN', 'tna:recommendation:accept'),
  ('ADMIN', 'tna:reopen'),
  ('ADMIN', 'tna:write'),
  ('ADMIN', 'trainer:book'),
  ('ADMIN', 'trainer:read'),
  ('ADMIN', 'trainer:write'),
  ('ADMIN', 'view:read'),
  ('ADMIN', 'view:share'),
  ('ADMIN', 'view:write'),
  -- TRAINER (10)
  ('TRAINER', 'attendance:approve'),  -- scope-narrowed
  ('TRAINER', 'attendance:capture'),  -- scope-narrowed
  ('TRAINER', 'attendance:read'),  -- scope-narrowed
  ('TRAINER', 'audit:read'),
  ('TRAINER', 'engagement:read'),  -- scope-narrowed
  ('TRAINER', 'navigation:read'),
  ('TRAINER', 'participant:read'),  -- scope-narrowed
  ('TRAINER', 'pipeline:read'),
  ('TRAINER', 'programme:read'),
  ('TRAINER', 'search:read')
ON CONFLICT (role, permission) DO NOTHING;

-- ─── 12 · Verify ────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_cnt  int;
  v_bad  text;
BEGIN
  SELECT count(*) INTO v_cnt FROM app.role_permissions;
  IF v_cnt <> 399 THEN
    RAISE EXCEPTION '002 verify: expected 399 role_permissions rows, found %', v_cnt;
  END IF;

  SELECT count(DISTINCT permission) INTO v_cnt FROM app.role_permissions;
  IF v_cnt <> 109 THEN
    RAISE EXCEPTION '002 verify: expected 109 distinct permissions, found %', v_cnt;
  END IF;

  -- The three asymmetries doc 02 calls out as the ones a reviewer will query.
  -- They are deliberate, so they are asserted rather than left to be "fixed".
  IF EXISTS (SELECT 1 FROM app.role_permissions
             WHERE role = 'ADMIN'
               AND permission IN ('discount:approve','approval:decide',
                                  'hrdc:mark_submitted','invoice:create',
                                  'ai:budget:raise')) THEN
    RAISE EXCEPTION
      '002 verify: ADMIN holds a business-commitment permission. The system '
      'administrator runs the system; they do not commit the business.';
  END IF;
  IF EXISTS (SELECT 1 FROM app.role_permissions
             WHERE permission = 'agent:autonomy' AND role <> 'MD') THEN
    RAISE EXCEPTION '002 verify: agent:autonomy is MD-only (DECISIONS 1)';
  END IF;
  IF EXISTS (SELECT 1 FROM app.role_permissions
             WHERE permission IN ('run:retry','run:replay') AND role <> 'ADMIN') THEN
    RAISE EXCEPTION '002 verify: run:retry / run:replay are ADMIN-only - a retry has side effects';
  END IF;

  -- Every identity table is RLS-enabled AND forced.
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('tenants','teams','team_members','memberships','user_profiles')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '002 verify: RLS not enabled+forced on: %', v_bad;
  END IF;

  -- The escalation stop must exist AND be restrictive. A permissive policy of
  -- the same name would read identically in a diff and do the opposite.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'memberships'
      AND policyname = 'memberships_no_self_edit' AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION
      '002 verify: memberships_no_self_edit is missing or is PERMISSIVE. '
      'Permissive, it is an OR branch that grants; restrictive, it is the AND '
      'that stops an ADMIN rewriting their own role.';
  END IF;

  -- No policy may be left at the implicit PUBLIC, which also matches anon.
  SELECT string_agg(policyname, ', ') INTO v_bad
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('tenants','teams','team_members','memberships','user_profiles')
    AND roles = '{public}';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '002 verify: policy/policies not qualified TO a role: %', v_bad;
  END IF;

  RAISE NOTICE
    '002 verify: OK - 399 grants over 109 permissions, 5 identity tables RLS-forced.';
END;
$verify$;

COMMIT;
