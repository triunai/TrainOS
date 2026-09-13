-- ============================================================================
-- ROLLBACK 014 · rls_policies_and_client_grants
-- ============================================================================
--
-- Restores the state 013 left: every table in `core`, `app` and `public` RLS
-- enabled AND FORCED with no client grant, the three `core` wrappers absent, and
-- the only policies standing being the ones 002 and 011 authored.
--
-- DROP ORDER, which is the reverse of the forward order and is stated because the
-- catalog requires it stated rather than inferred:
--
--   1. the three `core` wrappers        (created last, dropped first — while they
--                                        exist they are a live grant to
--                                        authenticated)
--   2. the client grants                (revoked before the policies come down, so
--                                        the database never passes through a
--                                        moment of "granted, unpoliced"), and
--                                        then 002's five `public.*` grant sets
--                                        RE-ISSUED, because the blanket revoke
--                                        that step needs takes those too and 014
--                                        never created them
--   3. the policies 014 created         (by name, never by wildcard)
--   4. the index and the policy function
--
-- Step 2 before step 3 is the half that matters. The other order — policies down
-- first, grants still standing — leaves a window in which `authenticated` holds
-- SELECT on 114 tables with no predicate. It would be a window inside one
-- transaction and therefore invisible, and it would still be wrong, because a
-- rollback that is only safe because it commits atomically stops being safe the
-- first time somebody runs half of it by hand at 2am.
--
-- ⚠ WHAT THIS ROLLBACK MUST NOT TOUCH, and the guard for each:
--
--   * `core.autonomy_grants_agents_cannot_write` — 011's `H-02` restrictive
--     policy, the one RLS policy that deliberately landed before 014. Dropping it
--     would let an agent grant itself autonomy, which is the kill switch. 014 did
--     not create it; a wildcard `DROP POLICY` over `core` would take it anyway,
--     and that is exactly why nothing here uses a wildcard. Asserted present at
--     the end.
--   * 002's fourteen `public.*` policies and the three `app.*` definer-read
--     policies. Same reasoning, same assertion. 014's own fifteenth policy on
--     `public.memberships` IS dropped here, by name, which is what returns that
--     count to fourteen.
--   * 002's five `public.*` grant sets (002:696-701) and 002:665's SELECT for
--     `supabase_auth_admin`. Not a policy and not dropped by a DROP — destroyed
--     by the blanket REVOKE in step 2, which is why step 2 re-issues them and the
--     post-condition asserts them PRESENT rather than absent.
--   * `core.v_approval_requests`'s revoked state — 011 set it, 014 re-stated it,
--     and it must stay revoked either way.
--
-- Re-runnable: every statement is guarded, existence is tested with `to_regclass`
-- / `to_regprocedure` rather than a bare `::regclass` cast, because a cast RAISES
-- on a missing relation and 002's rollback crashed exactly that way on its second
-- run.
-- ============================================================================

BEGIN;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('core.enquiries') IS NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 014 refused: core.enquiries is absent, so 005-013 are already gone. '
      'Rolling 014 back against a partially dismantled database would revoke '
      'privileges on tables that no longer exist and report success.';
  END IF;
  IF pg_catalog.to_regclass('core.autonomy_grants') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK 014 refused: core.autonomy_grants is absent; 011 is not intact.';
  END IF;
END;
$preflight$;

-- ── 1 · The three wrappers ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text);
DROP FUNCTION IF EXISTS core.decide_approval(uuid,text,text,text,text);
DROP FUNCTION IF EXISTS core.bulk_decide_approvals(uuid[],text,text,text);

-- ── 2 · The client grants ───────────────────────────────────────────────────
-- Schema-wide and then explicitly per relation, because ALL TABLES IN SCHEMA is
-- evaluated at execution time over the tables that exist NOW; a table added
-- between the forward and the rollback would be missed by one and not the other.
REVOKE ALL ON ALL TABLES    IN SCHEMA core   FROM authenticated, anon, PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA core   FROM authenticated, anon, PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated, anon, PUBLIC;
REVOKE USAGE ON SCHEMA core FROM authenticated;

-- ⚠ AND NOW PUT BACK EVERY GRANT 002 LEFT, BECAUSE THE LINE ABOVE TOOK THEM TOO.
--
-- `REVOKE ALL ON ALL TABLES IN SCHEMA public` does not know which grants 014
-- made. It removes 002:696-701 as well — five relations `authenticated` has held
-- privileges on since migration 002, which 014 never created and which nothing
-- else re-grants. An earlier version of this file stopped at the revoke and then
-- asserted, in its own post-condition, that ZERO client privilege on `public` was
-- the correct restored state. So it could not fail: it destroyed login, profile
-- and team reads for every tenant and reported success against a header claiming
-- the database was back to "the state 013 left".
--
-- The six statements below are 002:696-701 REPRODUCED IN FULL, in 002's own
-- order, not referenced. That is the rollback rule: a rollback that says "see
-- migration 002" depends on another file being readable at the moment you need
-- it, which is not a rollback. If 002's grant set ever changes, this block and
-- the post-condition that checks it both have to change with it, and the
-- post-condition is written so that they cannot silently disagree.
--
-- 014's own widening of that set — DELETE on public.memberships — is deliberately
-- NOT reproduced here. It was the defect (CRIT-1); restoring "what 014 left" would
-- be restoring it.
GRANT SELECT                         ON public.tenants       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members  TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.memberships   TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.user_profiles TO authenticated;
GRANT UPDATE                         ON public.tenants       TO authenticated;

-- 002:665 grants SELECT on two of those tables to `supabase_auth_admin`, inside a
-- guarded DO block, so that the access-token hook can read a membership at mint
-- time. The blanket revoke above names `authenticated, anon, PUBLIC` and does not
-- touch it — stated here because "the revoke did not reach it" is the kind of
-- fact that stops being true when somebody adds a role to that list.
DO $auth_admin$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    IF NOT has_table_privilege('supabase_auth_admin','public.memberships','SELECT')
       OR NOT has_table_privilege('supabase_auth_admin','public.tenants','SELECT') THEN
      RAISE EXCEPTION
        'ROLLBACK 014: supabase_auth_admin lost its SELECT on public.memberships '
        'or public.tenants. 002:665 grants it so the access-token hook can mint '
        'claims; without it every login fails. Something widened the blanket '
        'REVOKE above to include it.';
    END IF;
  END IF;
END;
$auth_admin$;

-- 001 grants USAGE on `app` to authenticated and 011's M-04 records that it is
-- load-bearing for the caller-context RLS helpers. 014 never touched it and this
-- rollback must not either.

-- 014 granted EXECUTE on app.require_tenant_id to authenticated so that its
-- policy predicates could run as the querying role. With those policies gone the
-- grant has no consumer, and 013 did not have it.
REVOKE EXECUTE ON FUNCTION app.require_tenant_id() FROM authenticated;

-- ── 3 · The policies 014 created, by name ───────────────────────────────────
DO $drop_policies$
DECLARE
  r       pg_catalog.record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, p.polname
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core'
       AND (p.polname = c.relname || '_tenant_select'
         OR p.polname = c.relname || '_tenant_isolation')
  LOOP
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON %I.%I', r.polname, r.nspname, r.relname);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'ROLLBACK 014: dropped % tenant policies', v_count;
END;
$drop_policies$;

DROP POLICY IF EXISTS provenance_subjects_read ON core.provenance_subjects;

-- 014's own policy on a `public` table. It is 014's to drop and nobody else's:
-- 002 authored fourteen policies on `public.*` and this is the fifteenth, so the
-- post-condition's count of 14 is what proves this line ran and took only this.
DROP POLICY IF EXISTS memberships_no_client_delete ON public.memberships;

-- ── 4 · The index and the policy function ───────────────────────────────────
-- The index is 014's to drop: 009 never created it, so leaving it behind would
-- mean the round trip does not return to 013's state. It is dropped even though
-- it is harmless, because "harmless leftovers" is how a round-trip assertion
-- stops meaning anything.
DROP INDEX IF EXISTS core.rule_set_versions_tenant_idx;

DROP FUNCTION IF EXISTS app.apply_tenant_policies(text, text);

-- ── POST-CONDITIONS ─────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_left text;
  v_n    integer;
BEGIN
  -- Nothing 014 created is left standing.
  SELECT pg_catalog.string_agg(pg_catalog.format('%s.%s', c.relname, p.polname), ', ')
    INTO v_left
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core'
     AND (p.polname LIKE '%\_tenant\_select' OR p.polname LIKE '%\_tenant\_isolation'
          OR p.polname = 'provenance_subjects_read');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 014 incomplete: policies survive: %', v_left;
  END IF;

  IF pg_catalog.to_regprocedure('core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('core.decide_approval(uuid,text,text,text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('core.bulk_decide_approvals(uuid[],text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 014 incomplete: a core wrapper survives';
  END IF;

  IF pg_catalog.to_regproc('app.apply_tenant_policies') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 014 incomplete: app.apply_tenant_policies survives';
  END IF;

  -- No client grant survives in `core` or `app` — which is 013's state, because
  -- 014 is the migration that first granted anything there.
  --
  -- `public` is NOT in that list and must not be: 002 granted there and 014 did
  -- not, so zero privilege on `public` is not "restored", it is destroyed. The
  -- post-condition that follows asserts 002's set is PRESENT. These two checks
  -- are deliberately opposite in shape for the two schemas, because the two
  -- schemas had opposite starting states.
  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s.%s', table_schema, table_name), ', ')
    INTO v_left
    FROM information_schema.table_privileges
   WHERE table_schema IN ('core','app') AND grantee IN ('authenticated','anon');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 014 incomplete: client grants survive on: %', v_left;
  END IF;

  -- THE PRE-014 `public.*` GRANT SET, ASSERTED PRIVILEGE BY PRIVILEGE.
  -- has_table_privilege rather than information_schema.table_privileges: that
  -- view reports privileges by named grantee and does not resolve one held
  -- through membership of PUBLIC, so a stray `GRANT ... TO PUBLIC` would leave it
  -- reporting a clean restore while `authenticated` held more than 002 gave it.
  -- Both directions are checked — a missing privilege is the destroyed-grants
  -- defect, an extra one is 014's DELETE coming back through the rollback.
  FOR v_left IN
    SELECT x FROM pg_catalog.unnest(ARRAY[
      'tenants:SELECT,UPDATE',
      'teams:SELECT,INSERT,UPDATE,DELETE',
      'team_members:SELECT,INSERT,UPDATE,DELETE',
      'memberships:SELECT,INSERT,UPDATE',
      'user_profiles:SELECT,INSERT,UPDATE']) AS t(x)
  LOOP
    DECLARE
      v_rel  text   := pg_catalog.split_part(v_left, ':', 1);
      v_want text[] := pg_catalog.string_to_array(pg_catalog.split_part(v_left, ':', 2), ',');
      v_priv text;
    BEGIN
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege('authenticated', 'public.' || v_rel, v_priv) <> (v_priv = ANY (v_want)) THEN
          RAISE EXCEPTION
            'ROLLBACK 014 left public.% in the wrong state: authenticated %s %s, '
            'and 002:696-701 says the opposite. A rollback of 014 must leave '
            '002''s grants exactly as 002 wrote them — the blanket REVOKE above '
            'takes them and the GRANT block above is what puts them back.',
            v_rel,
            CASE WHEN v_priv = ANY (v_want) THEN 'LACKS' ELSE 'HOLDS' END, v_priv;
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- And the policies 014 never owned are all still here. 011's kill switch first.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'autonomy_grants'
       AND p.polname = 'autonomy_grants_agents_cannot_write')
  THEN
    RAISE EXCEPTION
      'ROLLBACK 014 DESTROYED 011''s H-02 policy. An agent can now grant itself '
      'autonomy. This rollback drops policies by name for exactly this reason and '
      'something has started using a wildcard.';
  END IF;

  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public';
  IF v_n <> 14 THEN
    RAISE EXCEPTION
      'ROLLBACK 014: public.* should carry 002''s fourteen policies and carries %', v_n;
  END IF;

  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app';
  IF v_n <> 3 THEN
    RAISE EXCEPTION
      'ROLLBACK 014: app.* should carry the three definer-read policies and carries %', v_n;
  END IF;

  -- Back to deny-all: exactly one policy left in core, and it is 011's.
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'ROLLBACK 014: core should be back to 011''s single policy and carries %', v_n;
  END IF;

  RAISE NOTICE 'ROLLBACK 014: OK — core and app are deny-all again, 002''s five \npublic.* grant sets are back privilege-for-privilege, and 011''s and 002''s \npolicies are intact';
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
