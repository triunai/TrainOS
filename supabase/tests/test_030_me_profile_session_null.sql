-- ═══════════════════════════════════════════════════════════════════════════
-- test_030 · core.me_profile(): session null-value fix
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001-030. Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_030_me_profile_session_null.sql
--
-- `auth.users.last_sign_in_at` is a standard GoTrue column present on
-- hosted Supabase but ABSENT from this repo's local PostgreSQL shim (which
-- stubs only `id`/`email`/`aud`/`role`/... on `auth.users`). This pin
-- branches STRUCTURALLY on whether the column exists, rather than assuming
-- one environment, so it is correct — and exercises every case the running
-- environment can actually support — on both:
--
-- COLUMN ABSENT (this local shim):
--   T1  a real MD principal: `session` is `null` as a whole (022's original,
--       correct behaviour for the column-absent case — untouched by 030).
--
-- COLUMN PRESENT (hosted, or a locally-extended shim):
--   T2  a principal whose `last_sign_in_at` is NULL (never signed in through
--       GoTrue, or a freshly-inserted fixture row - 022's own DEFECT this
--       migration closes): `session` is `null` as a whole, not a populated
--       object with a null `lastSignInAt`.
--   T3  a principal whose `last_sign_in_at` IS set: `session` is a full
--       object with exactly the 5 `ProfileSession` keys and a non-null
--       `lastSignInAt`.
--
-- T4  FORBIDDEN / anon paths are unchanged by 030 - reasserted briefly so
--     this pin does not depend on test_022 alone for that coverage.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

-- ── Helpers (same shape as test_022) ────────────────────────────────────────

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal1')::text;
$fn$;

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_detail text;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'value', v);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE,
    'message', SQLERRM, 'detail', v_detail);
END;
$fn$;

CREATE FUNCTION pg_temp.got(p_key text) RETURNS jsonb
LANGUAGE sql AS $fn$ SELECT pg_catalog.current_setting('a30.' || p_key)::jsonb; $fn$;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond THEN RAISE NOTICE 'PASS %', p_label;
  ELSE RAISE EXCEPTION 'FAIL %', p_label;
  END IF;
END;
$fn$;

CREATE FUNCTION pg_temp.has_last_sign_in_at() RETURNS boolean
LANGUAGE sql AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = 'auth.users'::regclass
       AND a.attname = 'last_sign_in_at'
       AND NOT a.attisdropped);
$fn$;

-- ── Fixtures ───────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('a0300000-0000-4000-8000-000000000001','md1@a30.test'),
  ('a0300000-0000-4000-8000-000000000002','md2@a30.test'),
  ('a0300000-0000-4000-8000-000000000003','md3@a30.test');

-- Only meaningful when the column exists; a harmless no-op statement when it
-- does not (`UPDATE ... SET last_sign_in_at = ...` against a nonexistent
-- column would itself fail to plan, so this is skipped entirely rather than
-- attempted, matching the structural branch below).
DO $fixture$
BEGIN
  IF pg_temp.has_last_sign_in_at() THEN
    -- md2: never signed in (NULL) - the defect case. md3: signed in - the
    -- real-data case. md1 is unused when the column is absent and reused as
    -- the T1 principal when it is present, so every principal below has a
    -- clear single purpose.
    EXECUTE 'UPDATE auth.users SET last_sign_in_at = NULL
              WHERE id = ''a0300000-0000-4000-8000-000000000002''';
    EXECUTE 'UPDATE auth.users SET last_sign_in_at = pg_catalog.now() - interval ''1 hour''
              WHERE id = ''a0300000-0000-4000-8000-000000000003''';
  END IF;
END
$fixture$;

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('a0300000-1111-4000-8000-000000000001','a30-akademi','Akademi Perdana A30','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0300000-1111-4000-8000-000000000001','a0300000-0000-4000-8000-000000000001','MD','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0300000-1111-4000-8000-000000000001','a0300000-0000-4000-8000-000000000002','MD','HUMAN','ALL','ALL',false,'ACTIVE',true),
  ('a0300000-1111-4000-8000-000000000001','a0300000-0000-4000-8000-000000000003','MD','HUMAN','ALL','ALL',false,'ACTIVE',true);

-- ════════ T1 · column ABSENT: session null as a whole (unchanged by 030) ═══

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0300000-0000-4000-8000-000000000001','a0300000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a30.t1', pg_temp.try($$SELECT core.me_profile()$$)::text, true);
RESET ROLE;

DO $t1$
BEGIN
  IF NOT pg_temp.has_last_sign_in_at() THEN
    PERFORM pg_temp.assert((pg_temp.got('t1')->'value'->>'success')::boolean, 'T1a me_profile ok=true');
    PERFORM pg_temp.assert((pg_temp.got('t1')->'value'->'data'->'session') = 'null'::jsonb,
      'T1b column absent: session null as a whole');
  ELSE
    RAISE NOTICE 'SKIP T1 (auth.users.last_sign_in_at exists in this environment - see T2/T3)';
  END IF;
END
$t1$;

-- ════════ T2 · column PRESENT, value NULL: 022's defect, closed by 030 ═════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0300000-0000-4000-8000-000000000002','a0300000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a30.t2', pg_temp.try($$SELECT core.me_profile()$$)::text, true);
RESET ROLE;

DO $t2$
BEGIN
  IF pg_temp.has_last_sign_in_at() THEN
    PERFORM pg_temp.assert((pg_temp.got('t2')->'value'->>'success')::boolean, 'T2a me_profile ok=true');
    PERFORM pg_temp.assert((pg_temp.got('t2')->'value'->'data'->'session') = 'null'::jsonb,
      'T2b column present, value null: session null as a whole (022 T1j''s failure on hosted, fixed here)');
  ELSE
    RAISE NOTICE 'SKIP T2 (auth.users.last_sign_in_at absent in this environment - see T1)';
  END IF;
END
$t2$;

-- ════════ T3 · column PRESENT, value SET: full object, exact keys ══════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0300000-0000-4000-8000-000000000003','a0300000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a30.t3', pg_temp.try($$SELECT core.me_profile()$$)::text, true);
RESET ROLE;

DO $t3$
BEGIN
  IF pg_temp.has_last_sign_in_at() THEN
    PERFORM pg_temp.assert((pg_temp.got('t3')->'value'->>'success')::boolean, 'T3a me_profile ok=true');
    PERFORM pg_temp.assert(
      (SELECT pg_catalog.array_agg(k ORDER BY k)
         FROM pg_catalog.jsonb_object_keys(pg_temp.got('t3')->'value'->'data'->'session') AS k)
        = ARRAY['activeSessions','browser','lastSignInAt','place','twoFactorEnabled'],
      'T3b column present, value set: exactly the 5 ProfileSession keys');
    PERFORM pg_temp.assert(
      (pg_temp.got('t3')->'value'->'data'->'session'->'lastSignInAt') <> 'null'::jsonb,
      'T3c lastSignInAt is the real, non-null value');
    PERFORM pg_temp.assert(
      (pg_temp.got('t3')->'value'->'data'->'session'->'browser') = 'null'::jsonb
      AND (pg_temp.got('t3')->'value'->'data'->'session'->'place') = 'null'::jsonb,
      'T3d browser/place still always null');
    PERFORM pg_temp.assert(
      (pg_temp.got('t3')->'value'->'data'->'session'->>'activeSessions') IS NOT NULL,
      'T3e activeSessions present (a real count, zero seeded auth.sessions rows here)');
  ELSE
    RAISE NOTICE 'SKIP T3 (auth.users.last_sign_in_at absent in this environment - see T1)';
  END IF;
END
$t3$;

-- ════════ T4 · FORBIDDEN / anon paths, unchanged by 030 ════════════════════

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('00000000-0000-4000-8000-000000000099','a0300000-1111-4000-8000-000000000001','MD'), true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('a30.t4', pg_temp.try($$SELECT core.me_profile()$$)::text, true);
RESET ROLE;
SELECT pg_temp.assert((pg_temp.got('t4')->'value'->>'success')::boolean = false, 'T4a no-membership principal refused');
SELECT pg_temp.assert(pg_temp.got('t4')->'value'->'error'->>'code' = 'FORBIDDEN', 'T4b no-membership principal FORBIDDEN');

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('a30.t4c', pg_temp.try($$SELECT core.me_profile()$$)::text, true);
RESET ROLE;
SELECT pg_temp.assert((pg_temp.got('t4c')->>'ok')::boolean = false, 'T4c anon me_profile raised');
SELECT pg_temp.assert(pg_temp.got('t4c')->>'sqlstate' = '42501', 'T4d anon me_profile 42501');

ROLLBACK;
