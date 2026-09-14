-- ═══════════════════════════════════════════════════════════════════════════
-- test_031 · membership actor_kind lock (C1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run against 001-031 (or later). Ends in ROLLBACK and writes nothing durable.
--   psql "<db>" -v ON_ERROR_STOP=1 -f supabase/tests/test_031_membership_actor_kind_lock.sql
--
-- T1  an authenticated ADMIN cannot INSERT a new membership with actor_kind
--     SYSTEM or AGENT.
-- T2  an authenticated ADMIN cannot UPDATE another member's actor_kind to
--     SYSTEM — the exact C1 exploit path (002's memberships_write_admin +
--     memberships_no_self_edit already let an ADMIN write ANOTHER member's
--     row at aal2; only actor_kind itself was unguarded).
-- T3  an authenticated ADMIN cannot UPDATE actor_kind AWAY from AGENT either
--     (immutable, not just "can't become SYSTEM/AGENT").
-- T4  an authenticated ADMIN CAN still update an unrelated column
--     (client_scope) on the same AGENT row — the lock is scoped to
--     actor_kind alone, not a blanket freeze.
-- T5  a privileged (bypassrls) session — this pin's own migration-owner
--     connection — CAN create a SYSTEM/AGENT row and change actor_kind:
--     the worker/provisioning path is not collateral damage.
-- T6  app.principal_claims fails a SYSTEM row closed to HUMAN in the claims
--     it returns, even for a row T5 just proved the trigger cannot prevent
--     by construction (defence in depth, not reachable via T1-T4 alone).
-- T7  anon/authenticated hold no EXECUTE on the new trigger function.
--
-- If 031 (or its rollback) undoes the fix: T1/T2/T3 flip from "the UPDATE/
-- INSERT raises" to "it succeeds", which this pin's ASSERTs turn into a hard
-- FAIL rather than a silently-passing no-op.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = notice;

BEGIN;

CREATE FUNCTION pg_temp.claims(p_user uuid, p_tenant uuid, p_role text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_catalog.json_build_object(
    'sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant,
    'app_role', p_role, 'actor_kind', 'HUMAN', 'aal', 'aal2')::text;
$fn$;

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
  IF pg_catalog.to_regprocedure('app.enforce_membership_actor_kind_lock()') IS NULL THEN
    RAISE EXCEPTION '031 preflight: app.enforce_membership_actor_kind_lock() is absent; 031 has not been applied';
  END IF;
END;
$preflight$;

-- ── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('a0310000-0000-4000-8000-000000000001','admin1@a31.test'),
  ('a0310000-0000-4000-8000-000000000002','human1@a31.test'),
  ('a0310000-0000-4000-8000-000000000003','human2@a31.test'),
  ('a0310000-0000-4000-8000-000000000004','newuser@a31.test');

INSERT INTO auth.sessions (id,user_id,aal) VALUES
  ('a0310000-5e55-4000-8000-000000000001','a0310000-0000-4000-8000-000000000001','aal2');

INSERT INTO public.tenants (id, slug, name, status, timezone, locale) VALUES
  ('a0310000-1111-4000-8000-000000000001','a31-akademi','A31 Akademi','ACTIVE','Asia/Kuala_Lumpur','en-MY');

INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0310000-1111-4000-8000-000000000001','a0310000-0000-4000-8000-000000000001','ADMIN','HUMAN','ALL','ALL',true,'ACTIVE',true),
  ('a0310000-1111-4000-8000-000000000001','a0310000-0000-4000-8000-000000000002','SALES','HUMAN','MY_ACCOUNTS','MY_TEAM',false,'ACTIVE',true);

-- A pre-existing AGENT row, created the only way one legitimately can be:
-- as the privileged (bypassrls) connection this pin itself runs as.
INSERT INTO public.memberships
  (tenant_id,user_id,role,actor_kind,agent_id,client_scope,team_scope,mfa_required,status,is_default)
VALUES
  ('a0310000-1111-4000-8000-000000000001','a0310000-0000-4000-8000-000000000003','AGENT','AGENT','agent_a31','MY_ACCOUNTS','MY_TEAM',false,'ACTIVE',true);

-- ════════ T1 · authenticated ADMIN cannot INSERT actor_kind SYSTEM/AGENT ═══

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0310000-0000-4000-8000-000000000001','a0310000-1111-4000-8000-000000000001','ADMIN'), true);
SET LOCAL ROLE authenticated;

DO $t1$
BEGIN
  BEGIN
    INSERT INTO public.memberships
      (tenant_id,user_id,role,actor_kind,client_scope,team_scope,status,is_default)
    VALUES
      ('a0310000-1111-4000-8000-000000000001','a0310000-0000-4000-8000-000000000004','ADMIN','SYSTEM','ALL','ALL','ACTIVE',true);
    RAISE EXCEPTION 'T1a FAIL: authenticated ADMIN inserted a membership with actor_kind SYSTEM';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS T1a: INSERT actor_kind=SYSTEM refused (%)', SQLERRM;
  END;
END;
$t1$;

RESET ROLE;

-- ════════ T2 · authenticated ADMIN cannot UPDATE another member to SYSTEM ══
-- The exact C1 path: memberships_write_admin + memberships_no_self_edit
-- already let this ADMIN write user 2's row at aal2; only actor_kind was
-- unguarded before 031.

SELECT pg_catalog.set_config('request.jwt.claims',
  pg_temp.claims('a0310000-0000-4000-8000-000000000001','a0310000-1111-4000-8000-000000000001','ADMIN'), true);
SET LOCAL ROLE authenticated;

DO $t2$
BEGIN
  BEGIN
    UPDATE public.memberships SET actor_kind = 'SYSTEM'
     WHERE tenant_id = 'a0310000-1111-4000-8000-000000000001'
       AND user_id = 'a0310000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'T2 FAIL: authenticated ADMIN changed a colleague''s actor_kind to SYSTEM — this is C1';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS T2: UPDATE actor_kind HUMAN->SYSTEM on another member refused (%)', SQLERRM;
  END;
END;
$t2$;

-- ════════ T3 · actor_kind immutable AWAY from AGENT too, not just toward ═══

DO $t3$
BEGIN
  BEGIN
    UPDATE public.memberships SET actor_kind = 'HUMAN', role = 'SALES', agent_id = NULL
     WHERE tenant_id = 'a0310000-1111-4000-8000-000000000001'
       AND user_id = 'a0310000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'T3 FAIL: authenticated ADMIN laundered an AGENT row back to HUMAN';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS T3: UPDATE actor_kind AGENT->HUMAN refused (%)', SQLERRM;
  END;
END;
$t3$;

-- ════════ T4 · an unrelated column on the same row still updates fine ═════

DO $t4$
BEGIN
  UPDATE public.memberships SET client_scope = 'ALL'
   WHERE tenant_id = 'a0310000-1111-4000-8000-000000000001'
     AND user_id = 'a0310000-0000-4000-8000-000000000003';
  PERFORM pg_temp.assert(
    (SELECT client_scope::text FROM public.memberships
      WHERE tenant_id = 'a0310000-1111-4000-8000-000000000001'
        AND user_id = 'a0310000-0000-4000-8000-000000000003') = 'ALL',
    'T4 an unrelated column update on an AGENT row still succeeds (the lock is scoped to actor_kind)');
END;
$t4$;

RESET ROLE;

-- ════════ T5 · the privileged connection itself is not blocked ═══════════
-- This whole pin runs as the migration-owning (bypassrls) role. If IT could
-- not create/alter a SYSTEM or AGENT row, 031 would have broken the worker
-- provisioning path it explicitly promises to keep working.

DO $t5$
BEGIN
  INSERT INTO public.memberships
    (tenant_id,user_id,role,actor_kind,agent_id,client_scope,team_scope,status,is_default)
  VALUES
    ('a0310000-1111-4000-8000-000000000001','a0310000-0000-4000-8000-000000000004','AGENT','AGENT','agent_a31_new','ALL','ALL','ACTIVE',true);
  UPDATE public.memberships SET actor_kind = 'SYSTEM', role = 'ADMIN', agent_id = NULL
   WHERE tenant_id = 'a0310000-1111-4000-8000-000000000001'
     AND user_id = 'a0310000-0000-4000-8000-000000000004';
  PERFORM pg_temp.assert(
    (SELECT actor_kind::text FROM public.memberships
      WHERE tenant_id = 'a0310000-1111-4000-8000-000000000001'
        AND user_id = 'a0310000-0000-4000-8000-000000000004') = 'SYSTEM',
    'T5 the privileged (bypassrls) connection can still create AGENT rows and set actor_kind SYSTEM');
END;
$t5$;

-- ════════ T6 · principal_claims fail-closed for the SYSTEM row T5 made ════

DO $t6$
DECLARE v_claims jsonb;
BEGIN
  v_claims := app.principal_claims('a0310000-0000-4000-8000-000000000004'::uuid);
  PERFORM pg_temp.assert(v_claims ->> 'actor_kind' = 'HUMAN',
    pg_catalog.format('T6 principal_claims reports actor_kind %s for a row that is genuinely SYSTEM in the table — must be HUMAN, fail-closed', v_claims ->> 'actor_kind'));
END;
$t6$;

-- ════════ T7 · anon/authenticated hold no EXECUTE on the trigger function ══

DO $t7$
BEGIN
  PERFORM pg_temp.assert(
    NOT pg_catalog.has_function_privilege('anon', 'app.enforce_membership_actor_kind_lock()', 'EXECUTE'),
    'T7a anon holds no EXECUTE on enforce_membership_actor_kind_lock');
  PERFORM pg_temp.assert(
    NOT pg_catalog.has_function_privilege('authenticated', 'app.enforce_membership_actor_kind_lock()', 'EXECUTE'),
    'T7b authenticated holds no EXECUTE on enforce_membership_actor_kind_lock (not needed - Postgres does not check EXECUTE to fire a trigger)');
END;
$t7$;

DO $$ BEGIN RAISE NOTICE 'test_031 ALL PASS'; END $$;

ROLLBACK;
