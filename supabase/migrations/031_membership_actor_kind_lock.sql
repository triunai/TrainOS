-- ═══════════════════════════════════════════════════════════════════════════
-- 031 · Membership actor_kind lock (Codex review C1, CRIT, live/insider-only)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE HOLE. 002's `memberships_write_admin` policy lets an ADMIN UPDATE any
-- column of any OTHER member's row, `actor_kind` included, so long as they are
-- ADMIN of that tenant at AAL2 (002:749-760). `app.principal_claims` (002:
-- 532-561) then copies whatever `actor_kind` the row holds straight into the
-- next JWT that principal's session mints. `app.actor_kind()` (002:345-350)
-- reads that claim, and 011's `perform_action` treats SYSTEM specially: it
-- skips `has_permission` (011:2295-2334), skips the AAL2 money-moving gate
-- (011:2359-2369), skips policy matching against `app.action_policies`
-- (011:2593-2603) and dispatches the action straight to `EXECUTING`
-- (011:2642-2655) — no approval, on any action type, including every
-- money-moving one. An ADMIN who flips a colleague's row to `actor_kind =
-- 'SYSTEM'` (or their own, since `memberships_no_self_edit` only stops
-- self-edits — a SECOND ADMIN's row is fair game) hands that principal's next
-- session unapproved execution of anything the envelope can do. Confirmed on
-- hosted before this migration was authored: `SELECT count(*) FROM
-- public.memberships WHERE actor_kind = 'SYSTEM'` is 0 today, so the hole is
-- open and unused, not yet exploited.
--
-- THE FIX, IN TWO PARTS.
--
--   1. A BEFORE INSERT OR UPDATE trigger on `public.memberships`,
--      `app.enforce_membership_actor_kind_lock`, refuses (a) an INSERT whose
--      `actor_kind` is SYSTEM or AGENT and (b) an UPDATE that changes
--      `actor_kind` AT ALL — to anything, not just to SYSTEM/AGENT — unless
--      `current_user` carries `rolsuper` or `rolbypassrls`. ATTRIBUTE-BASED,
--      not name-based: a role NAME (`postgres`) is not portable across
--      environments that model the same PRIVILEGE differently — this repo's
--      own build harness stands hosted `postgres` in with a role named
--      `hc_mig`, created NOSUPERUSER BYPASSRLS specifically to match hosted
--      `postgres`'s attribute profile, not its name (found by running
--      the existing pin suite against this migration: every fixture that
--      seeds `public.memberships` directly, as the migration-owning role,
--      failed under a hardcoded `IN ('postgres','service_role')` check the
--      first time this migration was authored). Checking `rolsuper OR
--      rolbypassrls` is the same reasoning 002's own `principal_claims`
--      comment already applies to this exact ambiguity (hosted `postgres` is
--      "at minimum bypassrls per Supabase's own RLS guide", possibly also
--      super — 002 is deliberately built to be correct either way): it
--      passes for hosted `postgres`, for `service_role` (bypassrls, per
--      002/014's own repeated documentation), and for `hc_mig`; it correctly
--      refuses `authenticated`, which holds neither, anywhere.
--      "Immutable outside a privileged role" rather than "SYSTEM/AGENT
--      forbidden on UPDATE" is the stronger and simpler rule: a client that
--      cannot move a row TO SYSTEM also cannot move one FROM SYSTEM, so a
--      provisioned AGENT or SYSTEM row cannot be laundered back to HUMAN by
--      the same ADMIN path and then forward again later. `INSERT` still
--      distinguishes SYSTEM/AGENT from HUMAN because an ADMIN creating a
--      brand-new HUMAN membership row (there is no client RPC that does this
--      today, but nothing stops a future one) must keep working.
--
--      DELIBERATELY NOT `SECURITY DEFINER`. A DEFINER trigger function runs
--      with `current_user` already switched to the function's OWNER — the
--      migration-owning role — by the time its body executes, which would
--      make the privileged-role check evaluate to `true` on EVERY call
--      regardless of who fired the trigger and turn this into a guard that
--      never guards. Plain (INVOKER) is what makes `current_user` the role
--      PostgREST actually switched to (`authenticated` for a browser
--      session, `service_role` for the worker, the migration-owning role for
--      a migration or a seed script) — the exact identity this check needs
--      to read. Postgres does not check EXECUTE privilege to fire a trigger
--      (unlike a direct call), so no grant is needed for `authenticated` to
--      be refused by it.
--
--   2. `app.principal_claims` (002) is redefined so a row that somehow still
--      carries `actor_kind = 'SYSTEM'` — pre-existing data, a future
--      provisioning bug, anything the trigger above does not anticipate —
--      NEVER reaches a session token as SYSTEM. GoTrue calls this hook to
--      mint the claims for a signed-in `auth.users` principal, i.e. for every
--      browser session that exists; there is no session-minting path in this
--      schema for a true SYSTEM actor (013/002's worker path authenticates as
--      `service_role` directly, never through GoTrue, and never reads this
--      hook). So the hook fails CLOSED: `actor_kind = 'SYSTEM'` in the row
--      becomes `actor_kind = 'HUMAN'` in the claims it issues, the least
--      privileged of the four kinds and the one every AAL2/permission/policy
--      check in 011 already treats a browser principal as by default. AGENT
--      is untouched — 013/002 explicitly want an AGENT membership's claims to
--      read AGENT for the worker path, and part 1 already stops a client
--      session from ever creating or reaching one.
--
-- WHAT THIS DOES NOT TOUCH. No RPC in 018/019/020/021/022 writes
-- `public.memberships` (grepped: the only writers are the two 002 RLS
-- policies), so AGENT provisioning — wherever it runs — must already execute
-- as `service_role` or `postgres`, never as an authenticated RPC caller, and
-- is unaffected. No permission, no role, no action type. Spine untouched.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.memberships') IS NULL THEN
    RAISE EXCEPTION '031 preflight: public.memberships is absent; 002 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('app.principal_claims(uuid)') IS NULL THEN
    RAISE EXCEPTION '031 preflight: app.principal_claims(uuid) is absent; 002 has not been applied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
     WHERE c.oid = 'public.memberships'::regclass
       AND c.relrowsecurity AND c.relforcerowsecurity)
  THEN
    RAISE EXCEPTION '031 preflight: public.memberships does not have RLS enabled AND forced';
  END IF;
END;
$preflight$;

-- ── The trigger ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.enforce_membership_actor_kind_lock()
RETURNS trigger
LANGUAGE plpgsql
-- Deliberately NOT SECURITY DEFINER. See the header.
SET search_path = ''
AS $fn$
DECLARE
  v_privileged boolean;
BEGIN
  -- Attribute-based, not name-based. `current_user` (no parens, no schema —
  -- `pg_catalog.current_user` is not valid syntax: it is a special SQL
  -- keyword, not a schema-qualifiable function) is refused ANYWAY by a name
  -- check for the same reason 002's own header spends a paragraph on:
  -- hosted's migration-owning role really is named `postgres`, but a role
  -- NAME is not portable across environments that model the same PRIVILEGE
  -- differently — this repo's own build harness stands hosted `postgres` in
  -- with a role named `hc_mig`, created NOSUPERUSER BYPASSRLS specifically
  -- to match hosted `postgres`'s attribute profile, not its name. Checking
  -- `rolsuper OR rolbypassrls` is the same mechanism 002's `principal_claims`
  -- comment already argues is the only thing that generalises: it passes for
  -- hosted `postgres` (super, or at minimum bypassrls per Supabase's own RLS
  -- guide — 002 already treats this as unsettled and builds for both), for
  -- `service_role` (bypassrls, per 002/014's own repeated documentation),
  -- and for this harness's `hc_mig`; it correctly refuses `authenticated`,
  -- which holds neither on hosted or here.
  SELECT (r.rolsuper OR r.rolbypassrls) INTO v_privileged
    FROM pg_catalog.pg_roles AS r
   WHERE r.rolname = current_user;

  IF COALESCE(v_privileged, false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_kind IN ('SYSTEM', 'AGENT') THEN
      RAISE EXCEPTION
        'a client-authenticated session may not create a membership with '
        'actor_kind %; SYSTEM and AGENT principals are provisioned by '
        'service_role/postgres only', NEW.actor_kind
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.actor_kind IS DISTINCT FROM OLD.actor_kind THEN
      RAISE EXCEPTION
        'actor_kind is immutable outside service_role/postgres (was %, '
        'attempted %)', OLD.actor_kind, NEW.actor_kind
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION app.enforce_membership_actor_kind_lock() IS
  '031 (C1). BEFORE INSERT OR UPDATE trigger on public.memberships. Refuses a '
  'client-authenticated INSERT with actor_kind SYSTEM/AGENT and refuses any '
  'client-authenticated UPDATE that changes actor_kind at all. NOT SECURITY '
  'DEFINER on purpose: current_user must stay the calling role, not this '
  'function''s owner, or the guard always passes.';

-- 017's own finding, applied on day one instead of found later: a new `app`
-- function is PUBLIC-executable by default (001:232's default-privilege
-- REVOKE does not take — measured, not assumed, and 017 fixed nine functions
-- 007/009 left exposed the same way). Harmless here — Postgres does not
-- check EXECUTE to fire a trigger — but test_002 T11a pins "anon holds
-- EXECUTE on no function in app", and a control this function does not
-- actually need is not a reason to leave a pin failing.
REVOKE ALL ON FUNCTION app.enforce_membership_actor_kind_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS memberships_actor_kind_lock ON public.memberships;
CREATE TRIGGER memberships_actor_kind_lock
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_membership_actor_kind_lock();

-- ── The hook: fail-closed on SYSTEM, belt under the trigger's braces ───────

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

  IF m.tenant_id IS NULL THEN
    RETURN jsonb_build_object('tenant_id', NULL, 'app_role', NULL, 'actor_kind', 'HUMAN');
  END IF;

  -- 031 (C1). GoTrue calls this hook to mint claims for an auth.users
  -- session, i.e. for a browser principal. There is no session-minting path
  -- in this schema for a genuine SYSTEM actor — 013/002's worker path
  -- authenticates as service_role directly and never reaches this function —
  -- so a row that still reads SYSTEM (legacy data, a provisioning bug, a gap
  -- 031's trigger did not anticipate) is reported as HUMAN, the least
  -- privileged of the four kinds, rather than handed through. AGENT is
  -- unaffected: 013/002 want an AGENT membership's claims to read AGENT.
  RETURN jsonb_build_object(
    'tenant_id',    m.tenant_id,
    'app_role',     m.role,
    'actor_kind',   CASE WHEN m.actor_kind = 'SYSTEM' THEN 'HUMAN' ELSE m.actor_kind END,
    'agent_id',     m.agent_id,
    'team_id',      m.primary_team_id,
    'trainer_id',   m.trainer_id,
    'client_scope', m.client_scope,
    'team_scope',   m.team_scope,
    'mfa_required', m.mfa_required
  );
END;
$fn$;

COMMENT ON FUNCTION app.principal_claims(uuid) IS
  '002, amended by 031 (C1). SECURITY INVOKER — see 002''s header, unchanged. '
  'actor_kind SYSTEM in the membership row is reported as HUMAN in the '
  'claims: this hook only ever runs for a GoTrue-issued (browser) session, '
  'and there is no such session for a genuine SYSTEM principal. Fail-closed '
  'backstop under 031''s trigger, which is the primary control.';

-- ── Verify ──────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_bad_rows  integer;
  v_trig_oid  pg_catalog.oid;
  v_body      text;
BEGIN
  -- V1 · no existing SYSTEM row survives into this migration unnoticed.
  -- Confirmed 0 on hosted before this migration was authored; asserted here
  -- so a future re-run against a database that somehow gained one fails
  -- loudly instead of silently blessing it.
  SELECT pg_catalog.count(*) INTO v_bad_rows
    FROM public.memberships WHERE actor_kind = 'SYSTEM';
  IF v_bad_rows <> 0 THEN
    RAISE EXCEPTION
      '031 verify V1: % public.memberships row(s) already carry actor_kind '
      'SYSTEM. 031''s trigger stops new ones; these existing rows need '
      'remediation (they now mint HUMAN claims via principal_claims, but the '
      'stored value is still wrong) before this migration should be '
      'considered closed.', v_bad_rows;
  END IF;

  -- V2 · the trigger exists, fires BEFORE, for INSERT and UPDATE, per ROW.
  SELECT t.oid INTO v_trig_oid
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.memberships'::regclass
     AND t.tgname = 'memberships_actor_kind_lock' AND NOT t.tgisinternal;
  IF v_trig_oid IS NULL THEN
    RAISE EXCEPTION '031 verify V2: memberships_actor_kind_lock trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
     WHERE t.oid = v_trig_oid
       AND (t.tgtype & 1) = 1          -- ROW
       AND (t.tgtype & 2) = 2          -- BEFORE
       AND (t.tgtype & 4) = 4          -- INSERT
       AND (t.tgtype & 16) = 16)       -- UPDATE
  THEN
    RAISE EXCEPTION
      '031 verify V2: memberships_actor_kind_lock is not BEFORE INSERT OR UPDATE FOR EACH ROW';
  END IF;

  -- V3 · the trigger function is not SECURITY DEFINER (see header — a
  -- DEFINER trigger here would always pass).
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'app.enforce_membership_actor_kind_lock()'::regprocedure
       AND p.prosecdef)
  THEN
    RAISE EXCEPTION
      '031 verify V3: enforce_membership_actor_kind_lock is SECURITY DEFINER; '
      'current_user would always read as the function owner and the guard '
      'would never refuse anything';
  END IF;

  -- V4 · principal_claims still carries the fail-closed CASE.
  v_body := app._body_sql('app.principal_claims(uuid)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'SYSTEM'' THEN ''HUMAN''') = 0 THEN
    RAISE EXCEPTION '031 verify V4: principal_claims has lost its SYSTEM-to-HUMAN fail-close';
  END IF;
END
$verify$;

COMMIT;
