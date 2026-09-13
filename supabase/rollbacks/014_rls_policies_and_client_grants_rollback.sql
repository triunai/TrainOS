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
--                                        moment of "granted, unpoliced")
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
--     policies. Same reasoning, same assertion.
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

  -- No client grant survives anywhere.
  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s.%s', table_schema, table_name), ', ')
    INTO v_left
    FROM information_schema.table_privileges
   WHERE table_schema IN ('core','app','public') AND grantee IN ('authenticated','anon');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 014 incomplete: client grants survive on: %', v_left;
  END IF;

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

  RAISE NOTICE 'ROLLBACK 014: OK — core is deny-all again, 011 and 002 intact';
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
