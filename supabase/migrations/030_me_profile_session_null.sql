-- ═══════════════════════════════════════════════════════════════════════════
-- 030 · core.me_profile(): `session` answers `null` as a WHOLE whenever
--       `lastSignInAt` is unavailable, not only when the COLUMN is absent
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 001–022 (and 021, 023–029 — sibling lanes) ARE APPLIED TO HOSTED AND ARE
-- NOT EDITED. This is a `CREATE OR REPLACE` of 022's `core.me_profile()`.
-- Its body is 022's byte for byte except for the block marked `-- 030 ·`.
--
-- ── DEFECT, FOUND BY RUNNING 022's OWN PIN AGAINST HOSTED ──────────────────
--
-- 022's header states the intended contract in as many words: "`session`
-- (`ProfileSession`) ... answers `null` AS A WHOLE when it has nothing to
-- report, not an object with every field null" — and 022's own
-- `v_has_session` variable exists to enforce exactly that. But 022's guard
-- only flips `v_has_session` to `false` inside
-- `EXCEPTION WHEN undefined_column` — the COLUMN-ABSENT case. When
-- `auth.users.last_sign_in_at` EXISTS as a column (true on hosted) but the
-- row's VALUE is `NULL` (true for `test_022`'s fixture users, who are
-- INSERTed directly rather than signed in through GoTrue, and — this is the
-- part that makes it a real defect, not only a pin artifact — also true for
-- any hosted account GoTrue has not yet stamped a sign-in for), the read
-- SUCCEEDS with no exception, `v_has_session` stays at its default `true`,
-- and the function falls into the "build a full object" branch with
-- `v_last_sign_in` still `NULL`. The result is exactly the shape the
-- contract forbids: a POPULATED `session` object with `lastSignInAt: null`,
-- violating `ProfileSession.lastSignInAt`'s REQUIRED-field type on the wire.
--
-- Measured directly: `test_022`'s `T1j` (added in PR #48, commit
-- `05e7360`) asserts the branch `auth.users.last_sign_in_at`'s presence
-- implies, and FAILS on hosted — not because the assertion is wrong, but
-- because 022's function does not actually keep the promise its own header
-- makes. Reproduced locally against a copy of the shim's `auth` schema with
-- the column added and left at its column default (`NULL`, no row-level
-- value set): `core.me_profile()` returns
-- `"session": {"lastSignInAt": null, "browser": null, "place": null,
-- "activeSessions": 0, "twoFactorEnabled": false}` — not `"session": null`.
--
-- ── THE CHANGE ───────────────────────────────────────────────────────────
--
-- One `IF` added immediately after the existing `BEGIN … EXCEPTION` block:
-- `v_has_session` is now also set `false` when the read SUCCEEDED but
-- `v_last_sign_in IS NULL`. This subsumes the exception path (which already
-- leaves `v_last_sign_in` at its declared `NULL` default, so the new check
-- is a harmless no-op re-confirmation there) and closes the gap it did not
-- cover. Every other line of the function — permission gates, `moduleCount`,
-- `activeSessions`, `twoFactorEnabled`, the dashboard RPCs (untouched,
-- unchanged, not redefined here) — is identical to 022.
--
-- ── WHAT THIS DOES TO A CALLER WHO HAS ACTUALLY SIGNED IN ──────────────────
--
-- Nothing changes: GoTrue stamps `last_sign_in_at` on every real sign-in, so
-- every authenticated caller with a real session continues to get a
-- populated `session` with a real `lastSignInAt` — team-lead confirmed this
-- directly against hosted before this migration was authored ("on hosted,
-- me_profile returns a REAL session (lastSignInAt, activeSessions 1,
-- twoFactorEnabled false)"). This migration only changes the answer for a
-- principal GoTrue has not yet stamped a sign-in for, which used to leak a
-- null-valued required field and now correctly withholds the block.
--
-- ── POSTURE ────────────────────────────────────────────────────────────────
--
-- Unchanged from 022: SECURITY DEFINER, `SET search_path = ''`,
-- `SET statement_timeout = '10s'`, `REVOKE ALL FROM PUBLIC, anon`,
-- `GRANT EXECUTE TO authenticated`. Same signature (`core.me_profile()`, no
-- arguments) — `CREATE OR REPLACE` cannot create a second overload here, and
-- `$verify$` V1 asserts the count stays 1.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, WORKED ──────────────────────────────────
--
--  1 ENVELOPE. Unchanged: `app.ok`/`app.err`, `data` the sole non-`success`
--    key.
--  2 UNWRAP. Unchanged.
--  3 RpcMap. Signature unchanged (`me_profile(): MeProfile`); the RESPONSE
--    shape for `session` narrows in exactly one direction — a case that used
--    to emit an object with a null `lastSignInAt` now emits `session: null`.
--    `packages/contract/src/domain/shell.ts` (merged on `origin/main` ahead
--    of this migration, PRs #49/#50) already documents `core.me_profile()`'s
--    "FINAL shape" as `session: null` as a whole with a REQUIRED
--    `lastSignInAt` inside a present one — this migration is what makes the
--    already-merged contract and the already-merged web reader
--    (`SidebarProfile.tsx`) true of the actual database, not the other way
--    round.
--  4 CALL SITES. `apps/web/src/shared/components/layout/SidebarProfile.tsx`
--    is already gated on `details.session` before reading anything inside
--    it (PR #49) — it already tolerates `session: null` for a
--    never-signed-in principal; this migration removes the one shape it did
--    NOT anticipate (a present `session` with `lastSignInAt: null`), which
--    is strictly safer than what it could see before.
--  5 CASTS. No TypeScript in this migration.
--  6 RELOAD. A read with no idempotency surface.
--  7 PUBLIC ROUTES. Nothing granted to anon.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────────
--
-- Safe to apply any time: it only removes a shape (a populated `session`
-- with a null `lastSignInAt`) no consumer was ever built to expect on
-- purpose, and narrows toward what the merged contract already promises.
-- Needs no hosted privilege beyond 022's: `CREATE OR REPLACE FUNCTION` on an
-- object the migration role already owns.
--
-- Spine untouched: no action type, no handler, no branch in the envelope.
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

  -- 030 · 022's guard covered the COLUMN-ABSENT case (the exception above)
  -- but not the case where the column exists and the READ SUCCEEDS with a
  -- NULL value — which left `v_has_session` at its default `true` and built
  -- a populated `session` object carrying `lastSignInAt: null`, exactly the
  -- shape the header above says must never happen. `lastSignInAt` is
  -- REQUIRED within a present `session` per the contract, so a null value is
  -- equally "nothing to report" as a missing column, and gates the same way.
  IF v_last_sign_in IS NULL THEN
    v_has_session := false;
  END IF;

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
                     -- No short code is stored anywhere in 001-022.
                     'code', NULL::text),
    -- Not stored anywhere in 001-022. See 022's header ruling.
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
  '030. `GET /v1/me/profile`, ruled R14. The caller''s own MeProfile. Four '
  'fields (location, jobTitle, department, staffNumber) are `null` because no '
  'table in 001-022 carries them. `moduleCount` is real, derived from the '
  'same nav-permission match core.navigation() (018) uses. `session` answers '
  '`null` AS A WHOLE whenever `auth.users.last_sign_in_at` has no source - '
  'the column is absent, OR the column exists and the value is null (022''s '
  'defect, closed here: a populated object with a null required field is '
  'never emitted) - otherwise a full object: `browser`/`place` always null '
  '(no user-agent/geoip storage), `activeSessions` real from auth.sessions, '
  '`twoFactorEnabled` real from auth.mfa_factors where that relation exists, '
  'guarded on `to_regclass` since this migration has no hosted access to '
  'confirm it.';

-- ═══ Grants (restated; unchanged from 022 — same signature, same posture) ══

REVOKE ALL ON FUNCTION core.me_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.me_profile() TO authenticated;

-- ═══ $verify$ ════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_body text;
BEGIN
  -- V1 · IDENTITY AND OVERLOAD COUNT. Still exactly one `core.me_profile()`.
  IF pg_catalog.to_regprocedure('core.me_profile()') IS NULL THEN
    RAISE EXCEPTION '030 verify V1: core.me_profile() is missing';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core' AND p.proname = 'me_profile') <> 1 THEN
    RAISE EXCEPTION '030 verify V1: overload count is not exactly one';
  END IF;

  -- V2 · POSTURE unchanged from 022.
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = 'core.me_profile()'::regprocedure
          AND p.prosecdef
          AND p.proconfig @> ARRAY['search_path=""']
          AND p.proconfig @> ARRAY['statement_timeout=10s']
          AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,
                     pg_catalog.acldefault('f', p.proowner))) AS acl
             WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')) THEN
    RAISE EXCEPTION '030 verify V2: posture wrong on core.me_profile()';
  END IF;

  -- V3 · THE FIX IS IN THE BODY: the new null-value gate exists, and the
  -- existing membership gate (022's own posture) is still there.
  v_body := app._body_sql('core.me_profile()'::regprocedure);
  IF pg_catalog.strpos(v_body, 'v_last_sign_in IS NULL') = 0 THEN
    RAISE EXCEPTION '030 verify V3a: the null-value session gate is missing';
  END IF;
  IF pg_catalog.strpos(v_body, 'NO_MEMBERSHIP') = 0 THEN
    RAISE EXCEPTION '030 verify V3b: me_profile has lost its membership gate';
  END IF;

  -- V4 · THE DASHBOARD RPCS ARE UNTOUCHED — this migration redefines
  -- me_profile only.
  IF pg_catalog.to_regprocedure('core.get_executive_dashboard(text)') IS NULL
     OR pg_catalog.to_regprocedure('core.get_proposals_vs_won(integer)') IS NULL THEN
    RAISE EXCEPTION '030 verify V4: a 022 dashboard RPC is missing';
  END IF;
END
$verify$;

COMMIT;
