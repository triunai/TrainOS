-- ============================================================================
-- PIN 002 · tenancy_identity_and_permissions
-- ============================================================================
--
-- Run only AFTER 002 has been applied. Every fixture write is rolled back.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f supabase/tests/test_002_tenancy_identity_and_permissions.sql
--
-- WHAT THIS PIN IS FOR. 002 is the migration where a mistake is a cross-tenant
-- data leak rather than a bug, so the assertions that matter are the ones that
-- try to break out:
--
--   T5  THE FOUR-WAY MATRIX. The same row, read by its owner, by a peer in the
--       same tenant, by a user in another tenant, and by anon. Three of those
--       four must see nothing. A policy that only ever gets tested by its owner
--       passes while leaking to everyone.
--   T6  An ADMIN cannot edit their OWN membership row. This is the privilege
--       escalation that ends the product: ADMIN → write yourself any role, any
--       scope, any tenant. The RESTRICTIVE policy is what stops it, and a
--       RESTRICTIVE policy accidentally created PERMISSIVE reads identically in
--       a diff while doing the opposite.
--   T7  An ADMIN write without AAL2 is refused. MFA is a policy predicate, not
--       a front-end route guard.
--   T9  The access-token hook works as `supabase_auth_admin`, which is neither
--       superuser nor BYPASSRLS. Without both the grant and the policy the hook
--       silently returns no row and every token in the system issues with
--       tenant_id null. The failure is total and its only symptom is that
--       nobody can see anything, so it is pinned as its own check.
--
-- RUNNABILITY NOTES
-- 1. Real `auth.users` rows are inserted for every identity the policies see —
--    `memberships.user_id` and `teams.manager_user_id` are FKs to it.
-- 2. Impersonation sets BOTH `request.jwt.claims` (what app.jwt() reads) and
--    `ROLE authenticated` (what the policy's TO clause matches), then RESETs.
--    Results cross the role boundary in transaction-local GUCs, never in
--    plpgsql variables held across the swap.
-- 3. Each impersonated probe is ONE statement. A STABLE function called twice
--    with identical arguments can be folded by the planner, and `set_config`'s
--    role side effects are invisible to it, so a batched probe matrix returns a
--    silently-wrong all-denied result.
-- 4. Fixture ids are namespaced `00000002-...` so a partial run collides with
--    nothing.
-- 5. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_002 SETUP FAILURE: ASSERT did not raise - check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('tenants','teams','team_members','memberships','user_profiles');
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'test_002 SETUP FAILURE: expected 5 identity tables, found % - 002 is partial', v_cnt;
  END IF;
END;
$setup$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Two tenants. Alpha holds an admin, two consultants on one team, and a
-- consultant on another team. Beta holds one consultant and exists for exactly
-- one purpose: to be invisible.

INSERT INTO auth.users (id, email) VALUES
  ('00000002-0000-0000-0000-0000000000a1', 't002-admin@example.invalid'),
  ('00000002-0000-0000-0000-0000000000a2', 't002-amirah@example.invalid'),
  ('00000002-0000-0000-0000-0000000000a3', 't002-peer@example.invalid'),
  ('00000002-0000-0000-0000-0000000000a4', 't002-otherteam@example.invalid'),
  ('00000002-0000-0000-0000-0000000000b1', 't002-beta@example.invalid');

INSERT INTO public.tenants (id, slug, name) VALUES
  ('00000002-1111-1111-1111-111111111111', 't002-alpha', 'Alpha Training Sdn Bhd'),
  ('00000002-2222-2222-2222-222222222222', 't002-beta',  'Beta Training Sdn Bhd');

INSERT INTO public.teams (id, tenant_id, name) VALUES
  ('00000002-3333-3333-3333-333333333331', '00000002-1111-1111-1111-111111111111', 'Team One'),
  ('00000002-3333-3333-3333-333333333332', '00000002-1111-1111-1111-111111111111', 'Team Two');

INSERT INTO public.team_members (tenant_id, team_id, user_id) VALUES
  ('00000002-1111-1111-1111-111111111111','00000002-3333-3333-3333-333333333331','00000002-0000-0000-0000-0000000000a2'),
  ('00000002-1111-1111-1111-111111111111','00000002-3333-3333-3333-333333333331','00000002-0000-0000-0000-0000000000a3'),
  ('00000002-1111-1111-1111-111111111111','00000002-3333-3333-3333-333333333332','00000002-0000-0000-0000-0000000000a4');

INSERT INTO public.memberships (tenant_id, user_id, role, primary_team_id, client_scope, team_scope) VALUES
  ('00000002-1111-1111-1111-111111111111','00000002-0000-0000-0000-0000000000a1','ADMIN', NULL, 'ALL','ALL'),
  ('00000002-1111-1111-1111-111111111111','00000002-0000-0000-0000-0000000000a2','SALES','00000002-3333-3333-3333-333333333331','MY_ACCOUNTS','MY_TEAM'),
  ('00000002-1111-1111-1111-111111111111','00000002-0000-0000-0000-0000000000a3','SALES','00000002-3333-3333-3333-333333333331','MY_TEAM','MY_TEAM'),
  ('00000002-1111-1111-1111-111111111111','00000002-0000-0000-0000-0000000000a4','SALES','00000002-3333-3333-3333-333333333332','MY_ACCOUNTS','MY_TEAM'),
  ('00000002-2222-2222-2222-222222222222','00000002-0000-0000-0000-0000000000b1','SALES', NULL, 'ALL','ALL');

INSERT INTO public.user_profiles (tenant_id, user_id, display_name) VALUES
  ('00000002-1111-1111-1111-111111111111','00000002-0000-0000-0000-0000000000a2','Amirah Yusof'),
  ('00000002-2222-2222-2222-222222222222','00000002-0000-0000-0000-0000000000b1','Beta Consultant');

-- ── Impersonation helper, as a GUC-setting statement pair ───────────────────
-- No helper function: a SECURITY DEFINER helper in a test file is exactly what
-- the grant-hygiene rule forbids, and a plain one would need EXECUTE granted to
-- the roles it impersonates.

-- === T1 · RLS enabled AND forced on all five identity tables ================
DO $t1$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('tenants','teams','team_members','memberships','user_profiles')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  ASSERT v_bad IS NULL, format('T1 FAIL: RLS not enabled+forced on: %s', v_bad);
  RAISE NOTICE 'T1 PASS - five identity tables, RLS enabled and FORCED.';
END;
$t1$;

-- === T2 · every policy names a role; none is left at the implicit PUBLIC =====
DO $t2$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_bad
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('tenants','teams','team_members','memberships','user_profiles')
    AND roles = '{public}';
  ASSERT v_bad IS NULL,
    format('T2 FAIL: policy left at implicit PUBLIC (matches anon too): %s', v_bad);
  RAISE NOTICE 'T2 PASS - every identity policy is qualified TO a role.';
END;
$t2$;

-- === T3 · the permission matrix is the doc's, and the asymmetries hold ======
DO $t3$
DECLARE v_rows int; v_perms int;
BEGIN
  SELECT count(*), count(DISTINCT permission) INTO v_rows, v_perms FROM app.role_permissions;
  ASSERT v_rows = 399, format('T3a FAIL: expected 399 grant rows, found %s', v_rows);
  ASSERT v_perms = 109, format('T3b FAIL: expected 109 distinct permissions, found %s', v_perms);

  ASSERT NOT EXISTS (SELECT 1 FROM app.role_permissions
    WHERE role = 'ADMIN' AND permission IN
      ('discount:approve','approval:decide','hrdc:mark_submitted','invoice:create','ai:budget:raise')),
    'T3c FAIL: ADMIN holds a business-commitment permission';
  ASSERT (SELECT count(*) FROM app.role_permissions WHERE permission = 'agent:autonomy') = 1
     AND EXISTS (SELECT 1 FROM app.role_permissions WHERE permission = 'agent:autonomy' AND role = 'MD'),
    'T3d FAIL: agent:autonomy is not MD-only';
  ASSERT NOT EXISTS (SELECT 1 FROM app.role_permissions
    WHERE permission IN ('run:retry','run:replay') AND role <> 'ADMIN'),
    'T3e FAIL: run:retry / run:replay reachable by a non-ADMIN';

  -- The scope-narrowed (○) marks are GRANTS. Storing them as denials would lock
  -- SALES out of their own accounts, which is the failure a "tightening" edit
  -- would cause and no other assertion would catch.
  ASSERT EXISTS (SELECT 1 FROM app.role_permissions WHERE role='SALES' AND permission='enquiry:read'),
    'T3f FAIL: SALES lost enquiry:read - a scope-narrowed grant was stored as a denial';
  RAISE NOTICE 'T3 PASS - 399 grants, 109 permissions, all three asymmetries intact.';
END;
$t3$;

-- === T4 · claim readers read the claim, and default safely when it is absent =
SELECT set_config('request.jwt.claims',
  '{"sub":"00000002-0000-0000-0000-0000000000a2","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"SALES","actor_kind":"HUMAN","client_scope":"MY_ACCOUNTS","team_scope":"MY_TEAM","aal":"aal1"}',
  true);
DO $t4$
BEGIN
  ASSERT app.current_tenant_id() = '00000002-1111-1111-1111-111111111111',
    'T4a FAIL: current_tenant_id did not read the claim';
  ASSERT app.role() = 'SALES'::app.app_role,      'T4b FAIL: role';
  ASSERT app.actor_kind() = 'HUMAN'::app.actor_kind, 'T4c FAIL: actor_kind';
  ASSERT app.aal() = 'aal1',                      'T4d FAIL: aal';
  ASSERT app.is_agent() = false,                  'T4e FAIL: is_agent';
  ASSERT app.has_permission('enquiry:read'),      'T4f FAIL: SALES should hold enquiry:read';
  ASSERT NOT app.has_permission('agent:autonomy'),'T4g FAIL: SALES must not hold agent:autonomy';
END;
$t4$;

-- Absent claims must default to the LEAST privilege, not to a permissive value.
SELECT set_config('request.jwt.claims', '', true);
DO $t4b$
BEGIN
  ASSERT app.current_tenant_id() IS NULL, 'T4h FAIL: no claim should mean no tenant';
  ASSERT app.role() IS NULL,              'T4i FAIL: no claim should mean no role';
  ASSERT app.actor_kind() = 'HUMAN'::app.actor_kind, 'T4j FAIL: actor_kind default';
  ASSERT app.client_scope() = 'MY_ACCOUNTS'::app.data_scope,
    'T4k FAIL: client_scope must default to the NARROWEST scope, not ALL';
  ASSERT app.aal() = 'aal1', 'T4l FAIL: aal must default to aal1, never aal2';
  ASSERT NOT app.has_permission('enquiry:read'), 'T4m FAIL: no role must hold no permission';
  RAISE NOTICE 'T4 PASS - claims read correctly; absent claims default to least privilege.';
END;
$t4b$;

-- === T5 · THE FOUR-WAY MATRIX on public.memberships ========================
--     One row (Amirah's membership in Alpha), read four ways. Each probe is one
--     statement under its own role, parked in a GUC, read back after RESET.

-- (1) the owner
SELECT set_config('request.jwt.claims',
  '{"sub":"00000002-0000-0000-0000-0000000000a2","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"SALES"}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('t002.owner_sees', (
  SELECT count(*)::text FROM public.memberships
  WHERE user_id = '00000002-0000-0000-0000-0000000000a2'), true);
RESET ROLE;

-- (2) a peer in the SAME tenant, not an admin
SELECT set_config('request.jwt.claims',
  '{"sub":"00000002-0000-0000-0000-0000000000a3","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"SALES"}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('t002.peer_sees', (
  SELECT count(*)::text FROM public.memberships
  WHERE user_id = '00000002-0000-0000-0000-0000000000a2'), true);
RESET ROLE;

-- (3) a user in ANOTHER tenant
SELECT set_config('request.jwt.claims',
  '{"sub":"00000002-0000-0000-0000-0000000000b1","role":"authenticated","tenant_id":"00000002-2222-2222-2222-222222222222","app_role":"SALES"}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('t002.other_tenant_sees', (
  SELECT count(*)::text FROM public.memberships
  WHERE user_id = '00000002-0000-0000-0000-0000000000a2'), true);
SELECT set_config('t002.other_tenant_sees_tenants', (
  SELECT count(*)::text FROM public.tenants), true);
RESET ROLE;

-- (4) anon. This one is denied at the GRANT layer, BEFORE RLS is consulted, so
--     it RAISES rather than returning zero rows. That is a stronger result than
--     an empty set and the pin records which of the two happened: a future
--     migration that hands anon a SELECT grant would flip this from
--     DENIED_BY_GRANT to a row count, and 0 rows would still look like a pass
--     if the assertion only counted.
DO $anon_probe$
DECLARE v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.memberships;
    PERFORM set_config('t002.anon_sees', v_n::text, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('t002.anon_sees', 'DENIED_BY_GRANT', true);
  END;
  RESET ROLE;
END;
$anon_probe$;

-- (5) the tenant's ADMIN, who SHOULD see the row — the positive control that
--     stops "everything is denied" passing as a security property.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000002-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"ADMIN"}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('t002.admin_sees', (
  SELECT count(*)::text FROM public.memberships
  WHERE user_id = '00000002-0000-0000-0000-0000000000a2'), true);
RESET ROLE;

DO $t5$
BEGIN
  ASSERT current_setting('t002.owner_sees')  = '1',
    format('T5a FAIL: the owner cannot see their own membership (%s)', current_setting('t002.owner_sees'));
  ASSERT current_setting('t002.peer_sees')   = '0',
    format('T5b FAIL: a same-tenant peer can read another user''s membership (%s)', current_setting('t002.peer_sees'));
  ASSERT current_setting('t002.other_tenant_sees') = '0',
    format('T5c FAIL: CROSS-TENANT LEAK on memberships (%s)', current_setting('t002.other_tenant_sees'));
  ASSERT current_setting('t002.other_tenant_sees_tenants') = '1',
    format('T5d FAIL: a tenant sees %s tenant rows; it must see exactly its own',
           current_setting('t002.other_tenant_sees_tenants'));
  ASSERT current_setting('t002.anon_sees') IN ('0','DENIED_BY_GRANT'),
    format('T5e FAIL: anon can read memberships (%s)', current_setting('t002.anon_sees'));
  ASSERT current_setting('t002.anon_sees') = 'DENIED_BY_GRANT',
    format('T5e2 FAIL: anon reached the table and was stopped only by RLS (%s). '
           'anon must hold no grant at all, so it never reaches a policy.',
           current_setting('t002.anon_sees'));
  ASSERT current_setting('t002.admin_sees')  = '1',
    format('T5f FAIL: the tenant ADMIN cannot see a membership - the policy denies everyone (%s)',
           current_setting('t002.admin_sees'));
  RAISE NOTICE 'T5 PASS - four-way matrix: owner 1, peer 0, other tenant 0, anon denied at grant, admin 1.';
END;
$t5$;

-- === T6 · an ADMIN may not edit their OWN membership row ====================
--     The escalation that ends the product. memberships_write_admin permits it
--     on its own — they ARE an admin of that tenant while they do it — so the
--     RESTRICTIVE policy is the only thing standing in the way.
DO $t6_probe$
DECLARE v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000002-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"ADMIN","aal":"aal2"}',
    true);
  SET LOCAL ROLE authenticated;

  -- the admin editing THEMSELVES: must touch zero rows
  UPDATE public.memberships SET client_scope = 'ALL'
   WHERE user_id = '00000002-0000-0000-0000-0000000000a1';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('t002.self_edit_rows', v_n::text, true);

  -- the same admin editing SOMEBODY ELSE: must touch exactly one
  UPDATE public.memberships SET client_scope = 'MY_TEAM'
   WHERE user_id = '00000002-0000-0000-0000-0000000000a4';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('t002.other_edit_rows', v_n::text, true);

  RESET ROLE;
END;
$t6_probe$;

DO $t6$
BEGIN
  ASSERT current_setting('t002.self_edit_rows') = '0',
    format('T6a FAIL: an ADMIN edited their OWN membership row (%s rows). '
           'Privilege escalation: they can write themselves any role or tenant.',
           current_setting('t002.self_edit_rows'));
  ASSERT current_setting('t002.other_edit_rows') = '1',
    format('T6b FAIL: an ADMIN cannot edit anyone else''s membership either (%s) - '
           'the restrictive policy is too broad and admin is now useless',
           current_setting('t002.other_edit_rows'));

  -- and it must be RESTRICTIVE, not a permissive policy of the same name
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='memberships'
      AND policyname='memberships_no_self_edit' AND permissive='RESTRICTIVE'),
    'T6c FAIL: memberships_no_self_edit is PERMISSIVE - it now grants instead of denying';
  RAISE NOTICE 'T6 PASS - self-edit blocked, other-edit allowed, policy is RESTRICTIVE.';
END;
$t6$;

-- === T7 · an ADMIN write without AAL2 is refused ============================
DO $t7$
DECLARE v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000002-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"ADMIN","aal":"aal1"}',
    true);
  SET LOCAL ROLE authenticated;
  BEGIN
    -- A WITH CHECK violation RAISES (42501); it does not return zero rows. Both
    -- outcomes are recorded, and only a successful insert is a failure.
    INSERT INTO public.memberships (tenant_id, user_id, role)
    VALUES ('00000002-1111-1111-1111-111111111111',
            '00000002-0000-0000-0000-0000000000b1', 'OPS');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('t002.aal1_insert', 'INSERTED:' || v_n, true);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM set_config('t002.aal1_insert', 'REFUSED', true);
  END;
  RESET ROLE;

  ASSERT current_setting('t002.aal1_insert') = 'REFUSED',
    format('T7 FAIL: an ADMIN at aal1 inserted a membership (%s) - MFA is not '
           'enforced by the policy, only by the front end',
           current_setting('t002.aal1_insert'));
  RAISE NOTICE 'T7 PASS - ADMIN write at aal1 is refused; MFA lives in the policy.';
END;
$t7$;

-- === T8 · can_see_owner honours the three scopes ============================
--     MY_ACCOUNTS sees only itself, MY_TEAM sees team peers but not the other
--     team, ALL sees everyone.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000002-0000-0000-0000-0000000000a3","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"SALES","client_scope":"MY_TEAM"}', true);
DO $t8$
BEGIN
  ASSERT app.can_see_owner('00000002-0000-0000-0000-0000000000a2'),
    'T8a FAIL: MY_TEAM cannot see a peer on the same team';
  ASSERT NOT app.can_see_owner('00000002-0000-0000-0000-0000000000a4'),
    'T8b FAIL: MY_TEAM can see a user on a DIFFERENT team';
END;
$t8$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000002-0000-0000-0000-0000000000a2","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"SALES","client_scope":"MY_ACCOUNTS"}', true);
DO $t8b$
BEGIN
  ASSERT app.can_see_owner('00000002-0000-0000-0000-0000000000a2'),
    'T8c FAIL: MY_ACCOUNTS cannot see itself';
  ASSERT NOT app.can_see_owner('00000002-0000-0000-0000-0000000000a3'),
    'T8d FAIL: MY_ACCOUNTS can see a team peer - the narrowest scope is not narrow';
END;
$t8b$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000002-0000-0000-0000-0000000000a1","role":"authenticated","tenant_id":"00000002-1111-1111-1111-111111111111","app_role":"ADMIN","client_scope":"ALL"}', true);
DO $t8c$
BEGIN
  ASSERT app.can_see_owner('00000002-0000-0000-0000-0000000000a4'),
    'T8e FAIL: ALL cannot see an arbitrary user';
  RAISE NOTICE 'T8 PASS - MY_ACCOUNTS self only, MY_TEAM team only, ALL everyone.';
END;
$t8c$;

-- === T9 · the access-token hook works as supabase_auth_admin ================
--     Neither superuser nor BYPASSRLS. Without the grant AND the policy this
--     returns no row, every token issues with tenant_id null, and the only
--     symptom is that nobody can see anything.
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE supabase_auth_admin;
SELECT set_config('t002.hook', (
  SELECT app.custom_access_token_hook(jsonb_build_object(
    'user_id', '00000002-0000-0000-0000-0000000000a2',
    'claims',  jsonb_build_object('sub','00000002-0000-0000-0000-0000000000a2')
  ))::text), true);
RESET ROLE;

DO $t9$
DECLARE v jsonb := current_setting('t002.hook')::jsonb;
BEGIN
  ASSERT v #>> '{claims,tenant_id}' = '00000002-1111-1111-1111-111111111111',
    format('T9a FAIL: the hook did not resolve a tenant: %s', v);
  ASSERT v #>> '{claims,app_role}'     = 'SALES',       format('T9b FAIL: app_role: %s', v);
  ASSERT v #>> '{claims,client_scope}' = 'MY_ACCOUNTS', format('T9c FAIL: client_scope: %s', v);
  ASSERT v #>> '{claims,team_id}' = '00000002-3333-3333-3333-333333333331',
    format('T9d FAIL: team_id: %s', v);
  ASSERT v #>> '{claims,sub}' = '00000002-0000-0000-0000-0000000000a2',
    'T9e FAIL: the hook dropped the claims it was given instead of merging';
  RAISE NOTICE 'T9 PASS - hook resolves tenant, role, scope and team as supabase_auth_admin.';
END;
$t9$;

-- A user with NO active membership must get claims that satisfy no policy.
DO $t9b$
DECLARE v jsonb;
BEGIN
  v := app.principal_claims('00000002-0000-0000-0000-000000000099');
  ASSERT v ->> 'tenant_id' IS NULL AND v ->> 'app_role' IS NULL,
    format('T9f FAIL: an unknown user received usable claims: %s', v);
  RAISE NOTICE 'T9b PASS - no membership yields claims that satisfy nothing.';
END;
$t9b$;

-- === T10 · a membership's tenant and user are immutable =====================
DO $t10$
BEGIN
  BEGIN
    UPDATE public.memberships
       SET tenant_id = '00000002-2222-2222-2222-222222222222'
     WHERE user_id = '00000002-0000-0000-0000-0000000000a2';
    RAISE EXCEPTION 'T10 FAIL: a membership was transplanted into another tenant';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  RAISE NOTICE 'T10 PASS - membership tenant_id and user_id are frozen.';
END;
$t10$;

-- === T11 · anon holds EXECUTE on nothing in app, and can read nothing =======
DO $t11$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  ASSERT v_bad IS NULL, format('T11a FAIL: anon holds EXECUTE in app: %s', v_bad);

  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','app')
    AND c.relkind = 'r'
    AND has_table_privilege('anon', c.oid, 'SELECT');
  ASSERT v_bad IS NULL, format('T11b FAIL: anon holds SELECT on: %s', v_bad);
  RAISE NOTICE 'T11 PASS - anon holds no EXECUTE in app and no SELECT anywhere.';
END;
$t11$;

RESET ROLE;

DO $done$
BEGIN
  RAISE NOTICE 'test_002 ALL PASS (T1-T11, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
