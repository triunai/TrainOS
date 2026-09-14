-- ═══════════════════════════════════════════════════════════════════════════
-- 030 ROLLBACK · core.me_profile() session-null-value fix
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores 022's `core.me_profile()` body EXACTLY (the null-value gate this
-- migration added is removed, restoring the defect 030's header documents —
-- a populated `session` with `lastSignInAt: null` when the column exists but
-- the value does not). Same signature, no data touched: `core.me_profile()`
-- is a read.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION core.me_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant       uuid := app.require_tenant_id();
  v_actor        record;
  v_member       public.memberships%ROWTYPE;
  v_profile      public.user_profiles%ROWTYPE;
  v_tenant_row   public.tenants%ROWTYPE;
  v_user_id      uuid;
  v_email        text;
  v_module_count integer;
  v_last_sign_in timestamptz;
  v_active_sess  integer;
  v_two_factor   boolean;
  v_has_session  boolean := true;
  v_session      jsonb;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;

  -- NEVER A PARTIAL PROFILE. Same posture as `core.me()` (018): a role-less
  -- or membership-less caller is FORBIDDEN, not a profile full of nulls.
  IF v_actor.role IS NULL OR v_actor.actor_id IS NULL THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'NO_APP_ROLE'));
  END IF;

  -- `MeProfile` is the SIGNED-IN PRINCIPAL'S OWN RECORD, and every field it
  -- carries (email, avatar, session) presumes a human account. An AGENT
  -- principal's `actor_id` is a text slug, never a uuid, and has no
  -- `auth.users` row of its own to read a profile from.
  IF v_actor.actor_kind = 'HUMAN' THEN
    BEGIN
      v_user_id := v_actor.actor_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_user_id := NULL;
    END;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'NOT_A_HUMAN_PRINCIPAL'));
  END IF;

  SELECT tenant.* INTO v_tenant_row FROM public.tenants AS tenant
   WHERE tenant.id = v_tenant;

  SELECT profile.* INTO v_profile FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_user_id;

  SELECT membership.* INTO v_member FROM public.memberships AS membership
   WHERE membership.tenant_id = v_tenant AND membership.user_id = v_user_id;

  IF v_member.tenant_id IS NULL THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'NO_MEMBERSHIP'));
  END IF;

  -- `auth.users.email` rather than `user_profiles.email`: the profile column
  -- is nullable and the modal's identity line cannot show a blank email for a
  -- real account. `SECURITY DEFINER` is what makes `auth.users` reachable.
  --
  -- `last_sign_in_at` is a standard GoTrue column on `auth.users` on every
  -- Supabase project; guarded anyway (an `undefined_column` here becomes
  -- `null` rather than a 500) because this migration cannot execute against
  -- hosted to confirm it, and a field this function cannot prove should fail
  -- soft, not hard. `lastSignInAt` is a REQUIRED `ProfileSession` field on the
  -- contract (`packages/contract/src/domain/shell.ts` — "auth.users.
  -- last_sign_in_at is a stored column, not a derivation"), so its absence
  -- means the whole `session` block has NOTHING TO REPORT, not a half-built
  -- object with a null required field: `v_has_session` gates the entire
  -- block below, matching the contract's own words for `core.me_profile()`
  -- ("answers session: null as a WHOLE") and the web reader built against it
  -- (`apps/web/src/shared/components/layout/SidebarProfile.tsx`, gated on
  -- `details.session` before reading anything inside it).
  BEGIN
    EXECUTE 'SELECT au.email, au.last_sign_in_at FROM auth.users AS au WHERE au.id = $1'
      INTO v_email, v_last_sign_in USING v_user_id;
  EXCEPTION WHEN undefined_column THEN
    SELECT au.email INTO v_email FROM auth.users AS au WHERE au.id = v_user_id;
    v_has_session := false;
  END;

  IF v_has_session THEN
    -- `activeSessions` — ruled derivable: `auth.sessions` is a standard
    -- GoTrue table and the SECURITY DEFINER owner can read it regardless of
    -- what is granted to `authenticated`. One row per live session for this
    -- user.
    SELECT pg_catalog.count(*) INTO v_active_sess
      FROM auth.sessions AS s WHERE s.user_id = v_user_id;

    -- `twoFactorEnabled` — `auth.mfa_factors` is a standard GoTrue table on
    -- hosted Supabase, but this migration has no hosted access to confirm
    -- it, so the read is GUARDED on `to_regclass` rather than assumed: this
    -- ONE optional field stays `null` (not the whole block) on any
    -- environment, this local shim included, where the relation is absent,
    -- and a real boolean once it exists. `status = 'verified'` is GoTrue's
    -- own vocabulary for a factor the user has actually completed
    -- enrollment for.
    IF pg_catalog.to_regclass('auth.mfa_factors') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.mfa_factors mf
                WHERE mf.user_id = $1 AND mf.status = ''verified'')'
        INTO v_two_factor USING v_user_id;
    ELSE
      v_two_factor := NULL;
    END IF;

    v_session := pg_catalog.jsonb_build_object(
      'lastSignInAt',     v_last_sign_in,
      -- No user-agent or geoip storage exists anywhere in this schema.
      'browser',          NULL::text,
      'place',            NULL::text,
      'activeSessions',   v_active_sess,
      'twoFactorEnabled', v_two_factor);
  ELSE
    v_session := NULL;
  END IF;

  -- `moduleCount` — see the header note. Deliberately the SAME 14 rows and
  -- the SAME permission match `core.navigation()` (018) uses for its `MAIN`
  -- group, counted rather than rendered.
  SELECT pg_catalog.count(*) INTO v_module_count
    FROM (VALUES
            ('dashboard:read'), ('approval:read'), ('enquiry:read'),
            ('organisation:read'), ('opportunity:read'), ('tna:read'),
            ('proposal:read'), ('programme:read'), ('engagement:read'),
            ('hrdc:read'), ('invoice:read'), ('collection:read'),
            ('agent:read'), ('compliance:read')
          ) AS nav(permission)
   WHERE EXISTS (
     SELECT 1 FROM app.role_permissions AS rp
      WHERE rp.role = v_member.role AND rp.permission = nav.permission);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',          v_actor.actor_id,
    'tenant',      pg_catalog.jsonb_build_object(
                     'name', v_tenant_row.name,
                     -- No short code is stored anywhere in 001-020.
                     'code', NULL::text),
    -- Not stored anywhere in 001-020. See 022's header ruling.
    'location',    NULL::text,
    'jobTitle',    NULL::text,
    'department',  NULL::text,
    'email',       COALESCE(v_email, v_profile.email::text),
    'staffNumber', NULL::text,
    'moduleCount', COALESCE(v_module_count, 0),
    -- `null` AS A WHOLE when `lastSignInAt` has no source (see the
    -- derivation above); otherwise a full object, never a half one.
    'session',     v_session)
    -- `mobile` was already OPTIONAL on the contract and no table carries a
    -- staff mobile number; the key is omitted entirely rather than nulled,
    -- matching how every other optional contract field is emitted in 018/020.
  );
END;
$fn$;

COMMENT ON FUNCTION core.me_profile() IS
  '022. `GET /v1/me/profile`, ruled R14. The caller''s own MeProfile. Four '
  'fields (location, jobTitle, department, staffNumber) are `null` because no '
  'table in 001-020 carries them - see this migration''s header. `moduleCount` '
  'is real, derived from the same nav-permission match core.navigation() '
  '(018) uses. `session` answers `null` AS A WHOLE when '
  '`auth.users.last_sign_in_at` has no source in this environment (a '
  'REQUIRED ProfileSession field per the contract); otherwise a full object '
  '- `browser`/`place` always null (no user-agent/geoip storage), '
  '`activeSessions` real from auth.sessions, `twoFactorEnabled` real from '
  'auth.mfa_factors where that relation exists, guarded on `to_regclass` '
  'since this migration has no hosted access to confirm it.';

REVOKE ALL ON FUNCTION core.me_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.me_profile() TO authenticated;

DO $verify$
DECLARE
  v_body text;
BEGIN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core' AND p.proname = 'me_profile') <> 1 THEN
    RAISE EXCEPTION '030 rollback verify: expected exactly one core.me_profile() definition';
  END IF;
  v_body := app._body_sql('core.me_profile()'::regprocedure);
  IF pg_catalog.strpos(v_body, 'v_last_sign_in IS NULL') > 0 THEN
    RAISE EXCEPTION '030 rollback verify: 030''s null-value gate is still in place';
  END IF;
END
$verify$;

COMMIT;
