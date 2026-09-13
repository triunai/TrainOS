-- ============================================================================
-- PIN · rollback 014 · the pre-014 grant set survives the rollback
-- ============================================================================
--
-- WHAT THIS PINS, AND WHY IT IS A SEPARATE FILE.
--
-- `rollbacks/014_..._rollback.sql` revokes every client privilege on `public`
-- schema-wide, because it has to: `REVOKE ALL ON ALL TABLES IN SCHEMA public`
-- is the only form that reaches a table added between the forward migration and
-- the rollback. But that statement cannot tell 014's grants from 002's, and
-- migration 002 has granted on those five relations since long before 014
-- existed. The rollback therefore destroyed `002:696-701` — login, profile and
-- team reads for every tenant — and its own post-condition asserted that ZERO
-- client privilege on `public` was the correct restored state, so it reported
-- success. That is finding CRIT-2.
--
-- This pin cannot live inside `test_014`, because `test_014` asserts the state
-- 014 leaves and this asserts the state its ROLLBACK leaves. The two states are
-- mutually exclusive: one has `app.apply_tenant_policies` and 228 policies on
-- `core`, the other has neither. So this is its own file with its own
-- pre-flight, run at exactly one moment:
--
--   RUN IT AFTER `rollbacks/014_rls_policies_and_client_grants_rollback.sql`
--   AND BEFORE RE-APPLYING 014.
--
-- It refuses to run at any other point rather than passing vacuously. A pin that
-- silently no-ops when its subject is absent is the failure mode this repo's
-- `test_073` and `test_074` shipped with.
--
-- WHAT IT DOES NOT DO. It does not execute the rollback. Executing a file that
-- carries its own `BEGIN`/`COMMIT` from inside an open transaction would commit
-- the caller's transaction, and a pin that can leave durable state behind is not
-- a pin. The rollback is run by the harness; this file reads what it left.
--
-- SHAPE. One transaction, no fixtures, ends in ROLLBACK like every other pin in
-- this directory even though it writes nothing — so that the shape is uniform
-- and a future edit that does add a fixture cannot leak it.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ─── PRE-FLIGHT · refuse to pass vacuously ──────────────────────────────────
DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.memberships') IS NULL THEN
    RAISE EXCEPTION
      'test_014_rollback SETUP FAILURE: public.memberships is absent, so 002 is '
      'gone too and there is no pre-014 grant set to check.';
  END IF;

  IF pg_catalog.to_regproc('app.apply_tenant_policies') IS NOT NULL THEN
    RAISE EXCEPTION
      'test_014_rollback SETUP FAILURE: app.apply_tenant_policies still exists, '
      'so migration 014 is APPLIED and its rollback has not run. This pin asserts '
      'the post-rollback state; running it here would compare the wrong database '
      'and pass or fail for reasons unrelated to the rollback.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core'
       AND (p.polname = c.relname || '_tenant_select'
         OR p.polname = c.relname || '_tenant_isolation'))
  THEN
    RAISE EXCEPTION
      'test_014_rollback SETUP FAILURE: 014 tenant policies survive on core, so '
      'the rollback did not complete.';
  END IF;
END;
$preflight$;

-- ─── R1 · 002's five grant sets are back, privilege for privilege ───────────
-- has_table_privilege, not information_schema.table_privileges: that view lists a
-- privilege under the grantee it was granted to and does NOT report one held
-- through membership of PUBLIC. A restore that handed these to PUBLIC would look
-- identical to no restore at all in information_schema, and identical to a
-- correct restore in the product. has_table_privilege resolves inheritance and
-- PUBLIC, so it answers the question actually being asked.
--
-- Both directions, not just the missing half. An EXTRA privilege here is 014's
-- DELETE on memberships (CRIT-1) coming back through the rollback, which is the
-- other way this file could be wrong.
DO $r1$
DECLARE
  r      pg_catalog.record;
  v_priv text;
  v_bad  text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT relname, wanted FROM (VALUES
      ('tenants',       ARRAY['SELECT','UPDATE']),
      ('teams',         ARRAY['SELECT','INSERT','UPDATE','DELETE']),
      ('team_members',  ARRAY['SELECT','INSERT','UPDATE','DELETE']),
      ('memberships',   ARRAY['SELECT','INSERT','UPDATE']),
      ('user_profiles', ARRAY['SELECT','INSERT','UPDATE'])
    ) AS t(relname, wanted)
  LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('authenticated', 'public.' || r.relname, v_priv)
         <> (v_priv = ANY (r.wanted)) THEN
        v_bad := v_bad || pg_catalog.format('%s.%s(%s)',
          r.relname, v_priv,
          CASE WHEN v_priv = ANY (r.wanted) THEN 'missing' ELSE 'unexpected' END);
      END IF;
    END LOOP;
  END LOOP;

  ASSERT pg_catalog.cardinality(v_bad) = 0,
    pg_catalog.format(
      'R1 FAIL: rolling 014 back left public.* in a state 002 never wrote: %s. '
      '`REVOKE ALL ON ALL TABLES IN SCHEMA public` takes 002''s grants as well as '
      '014''s, and 014 never created 002''s — so the rollback has to re-issue '
      'them (they are reproduced in full in the rollback file, in 002''s order). '
      'A "missing" entry is that destruction. An "unexpected" entry is 014''s '
      'DELETE on memberships coming back through the rollback, which is CRIT-1.',
      pg_catalog.array_to_string(v_bad, ', '));

  RAISE NOTICE
    'R1 PASS - authenticated holds exactly 002:696-701 on the five identity '
    'tables after the rollback: tenants SELECT+UPDATE, teams and team_members '
    'SELECT+INSERT+UPDATE+DELETE, memberships and user_profiles '
    'SELECT+INSERT+UPDATE, and no DELETE on memberships.';
END;
$r1$;

-- ─── R2 · the policies those grants make live are still there ───────────────
-- A grant with no policy is zero rows under FORCE; a policy with no grant is dead
-- code. The rollback restores one of them, and this asserts it restored it into a
-- database where the other still stands, which is the only state that is actually
-- "what 013 left plus 002".
DO $r2$
DECLARE v_n integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public';
  ASSERT v_n = 14,
    pg_catalog.format('R2a FAIL: public.* carries %s policies, not 002''s '
      'fourteen. 014 adds a fifteenth (memberships_no_client_delete) and the '
      'rollback drops it by name; any other number means the rollback took one of '
      '002''s or left one of 014''s.', v_n);

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'memberships' AND p.polname = 'memberships_no_client_delete'),
    'R2b FAIL: 014''s memberships_no_client_delete survived its own rollback.';

  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'memberships' AND p.polname = 'memberships_no_self_edit'),
    'R2c FAIL: 002''s escalation stop is gone. The rollback drops policies by '
    'name for exactly this reason and something has started using a wildcard.';

  RAISE NOTICE 'R2 PASS - fourteen policies on public, 002''s escalation stop '
    'intact, 014''s own policy gone.';
END;
$r2$;

-- ─── R3 · and `core` really is deny-all again ───────────────────────────────
-- The opposite shape to R1, deliberately: 002 granted nothing in `core`, so zero
-- IS the restored state there, and asserting "present" would be as wrong in this
-- schema as asserting "absent" was in `public`.
DO $r3$
DECLARE v_left text;
BEGIN
  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s.%s', table_schema, table_name), ', ')
    INTO v_left
    FROM information_schema.table_privileges
   WHERE table_schema IN ('core','app') AND grantee IN ('authenticated','anon');
  ASSERT v_left IS NULL,
    pg_catalog.format('R3a FAIL: a client grant survives in core or app: %s', v_left);

  ASSERT NOT has_schema_privilege('authenticated','core','USAGE'),
    'R3b FAIL: authenticated keeps USAGE on core after the rollback; 013 did not '
    'have it and 014 granted it.';

  ASSERT has_schema_privilege('authenticated','app','USAGE'),
    'R3c FAIL: the rollback revoked USAGE on `app` from authenticated. 001 grants '
    'it and 011''s M-04 records it as load-bearing for the caller-context RLS '
    'helpers; 014 never touched it and the rollback must not either.';

  RAISE NOTICE 'R3 PASS - core is deny-all and unreachable, app USAGE untouched.';
END;
$r3$;

-- ─── R4 · the access-token hook can still mint a claim ──────────────────────
-- 002:665 grants supabase_auth_admin SELECT on two of the five tables so the hook
-- can read a membership at login. It is granted to a named role that is NOT in
-- the rollback's revoke list, which is a fact that stops being true the moment
-- somebody adds a role to that list — so it is asserted rather than assumed.
DO $r4$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    RAISE NOTICE 'R4 SKIP - no supabase_auth_admin role on this cluster.';
    RETURN;
  END IF;

  ASSERT has_table_privilege('supabase_auth_admin','public.memberships','SELECT')
     AND has_table_privilege('supabase_auth_admin','public.tenants','SELECT'),
    'R4 FAIL: supabase_auth_admin lost SELECT on public.memberships or '
    'public.tenants. Without it app.custom_access_token_hook cannot read a '
    'membership and every login mints a claimless token.';

  RAISE NOTICE 'R4 PASS - the access-token hook keeps its two reads.';
END;
$r4$;

ROLLBACK;
