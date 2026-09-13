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
--   3. the policies 014 created         (by the `migration:014` stamp each one
--                                        carries in its COMMENT, never by a name
--                                        pattern and never by a wildcard)
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
--     policies (002:286, 004:426, 012:896 — three policies, not three from 002). Same reasoning, same assertion. 014's own fifteenth policy on
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

  -- ⚠ REFUSE WHILE ANYTHING THAT DEPENDS ON 014 IS STILL APPLIED.
  --
  -- 017 is built on top of 014: its own preflight refuses unless
  -- `app.apply_tenant_policies` exists, it CALLS that function for three of its
  -- tables, and it grants SELECT on five `core` relations that did not exist when
  -- 014 ran. Rolling 014 back underneath it would do three separate kinds of
  -- damage, and an earlier version of this file did all three:
  --
  --   * `REVOKE ALL ON ALL TABLES IN SCHEMA core` would take 017:1187-1191's five
  --     grants — grants 014 never created and nothing re-grants — and the
  --     post-condition below would then certify zero client privilege in `core`
  --     as the correct restored state. That is CRIT-2 exactly, one schema over.
  --   * 017's six tenant policies carry no `migration:014` stamp, so the manifest
  --     loop leaves them standing on tables whose policy function has just been
  --     dropped, and the post-conditions fire on the leftovers.
  --   * the derived manifest count is computed from the tenant-scoped table count
  --     AS IT STANDS, which includes 017's three, and disagrees with the stamped
  --     set by exactly six.
  --
  -- The answer is not for 014's rollback to learn 017's grant list — a rollback
  -- that knows about later migrations is a rollback that needs editing every time
  -- one lands, and it would still leave 017's policies pointing at a function it
  -- had just dropped. The answer is the order this file's own header states: roll
  -- back 017, then 016, then 015, then this. So it refuses, loudly, with the
  -- order in the message, instead of succeeding and reporting a restored database.
  IF pg_catalog.to_regclass('core.tax_policies') IS NOT NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 014 refused: migration 017 is still applied (core.tax_policies '
      'exists). 017 is built on 014 — it calls app.apply_tenant_policies and '
      'grants SELECT on five core relations 014 never created. Rolling 014 back '
      'first would revoke those grants with nothing to restore them and leave '
      '017''s policies attached to a function this file is about to drop. Roll '
      'back in reverse order: 017, then 016, then 015, then 014.';
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
-- ⚠ NOT `REVOKE USAGE ON SCHEMA core FROM authenticated`. That is what this file
-- used to do, on the stated belief that 014 granted it. 001:232 grants USAGE on
-- `core` to anon, authenticated AND service_role in one statement — measured on a
-- 001-013 database, whose `core` nspacl reads
--   postgres=UC/postgres anon=U/postgres authenticated=U/postgres service_role=U/postgres
-- — so 014's GRANT was a restatement and revoking it here destroyed a 001 grant
-- exactly the way the blanket `public` revoke destroyed 002's. Same defect, one
-- schema over, found by executing the rollback rather than by reading it.
--
-- And the one privilege 014 really does take away is given back: 014 revokes
-- `anon`'s USAGE on `core` as hardening, which is a change to 001's state, so the
-- rollback restores it. A rollback returns the database to what the previous
-- migration left, including the parts this one narrowed.
GRANT USAGE ON SCHEMA core TO anon;

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

-- ── 3 · The policies 014 created, by stamped manifest ───────────────────────
-- ⚠ BY MANIFEST, NOT BY NAMING CONVENTION.
--
-- An earlier version of this block selected policies to drop by matching
-- `<table>_tenant_select` / `<table>_tenant_isolation`, while the forward
-- migration's comment claimed "nothing uses a wildcard DROP POLICY". Matching a
-- name pattern IS a wildcard with extra steps: `app.apply_tenant_policies` is a
-- shared function, 017 already calls it for three of its own tables, and anything
-- later that calls it — or hand-writes a policy with the same name shape — would
-- have its policies silently dropped by 014's rollback.
--
-- So 014 stamps every policy it creates with `migration:014` at the head of the
-- policy's COMMENT, from the CALLER rather than from inside the shared function,
-- and this loop drops exactly what carries that stamp. 017's three tables are
-- stamped by 017 or not at all; either way they are not 014's.
--
-- The stamp lives in pg_description, which is dropped with the policy, so there
-- is no separate manifest table to keep in step and nothing survives the drop.
DO $drop_policies$
DECLARE
  r          pg_catalog.record;
  v_count    integer := 0;
  v_expected integer;
BEGIN
  -- What the stamp SHOULD cover, DERIVED from the catalogue as it stands right
  -- now rather than hardcoded. Two policies for every tenant-scoped core table
  -- (the three role-gated tables carry their gate INSIDE their isolation policy,
  -- so they are two like everything else), plus provenance_subjects_read, plus
  -- 014's one policy on public.memberships.
  --
  -- Derived and not a literal because the number legitimately moves. 014's §2
  -- loop covers every tenant-scoped core table that exists WHEN IT RUNS: on a
  -- clean forward apply that is 113, but re-applying 014 on top of an already
  -- applied 017 re-creates 017's three tables' policies too, and they carry 014's
  -- stamp afterwards because 014 genuinely was the last thing to create them.
  -- A literal would have made a correct re-apply fail here, which is how magic
  -- numbers teach people to delete assertions.
  SELECT pg_catalog.count(*) * 2 + 2 INTO v_expected
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                    AND a.attnum > 0 AND NOT a.attisdropped);

  FOR r IN
    SELECT n.nspname, c.relname, p.polname
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_description d
        ON d.objoid = p.oid
       AND d.classoid = 'pg_catalog.pg_policy'::pg_catalog.regclass
     WHERE n.nspname IN ('core','public')
       AND d.description LIKE 'migration:014 %'
  LOOP
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON %I.%I', r.polname, r.nspname, r.relname);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'ROLLBACK 014: dropped % policies stamped migration:014', v_count;

  -- A count that does not match the derivation means the stamp has drifted from
  -- the DDL, and a drifted manifest is a drop that silently misses something.
  IF v_count <> v_expected THEN
    RAISE EXCEPTION
      'ROLLBACK 014: dropped % policies stamped migration:014, and the catalogue '
      'says there should have been % (two per tenant-scoped core table, plus '
      'provenance_subjects_read and memberships_no_client_delete). '
      'Either 014 created a policy it did not stamp, or something other than 014 '
      'is writing 014''s marker.', v_count, v_expected;
  END IF;
END;
$drop_policies$;

-- 014's own policy on a `public` table. The manifest loop above already took it
-- — `public` is in that loop's schema list for exactly this policy — and this
-- line is the belt to that braces: if the stamp is ever lost from this one
-- policy, the count assertion above fires AND this line still removes it, so the
-- post-condition's count of 14 cannot be reached by leaving it behind.
DROP POLICY IF EXISTS memberships_no_client_delete ON public.memberships;

-- ── 4 · The index and the policy function ───────────────────────────────────
-- The index is 014's to drop: 009 never created it, so leaving it behind would
-- mean the round trip does not return to 013's state. It is dropped even though
-- it is harmless, because "harmless leftovers" is how a round-trip assertion
-- stops meaning anything.
DROP INDEX IF EXISTS core.rule_set_versions_tenant_idx;

-- BOTH signatures. 014 changed this function from two arguments to three and
-- dropped the two-argument form as it went; a database rolled back from an
-- earlier 014 could still be carrying either.
DROP FUNCTION IF EXISTS app.apply_tenant_policies(text, text, text);
DROP FUNCTION IF EXISTS app.apply_tenant_policies(text, text);

-- ── POST-CONDITIONS ─────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_left text;
  v_n    integer;
BEGIN
  -- Nothing carrying 014's stamp is left standing, in either schema. Checked off
  -- the same manifest the drop loop used, so the two cannot disagree about what
  -- "014's policies" means.
  SELECT pg_catalog.string_agg(pg_catalog.format('%s.%s.%s', n.nspname, c.relname, p.polname), ', ')
    INTO v_left
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_description d
      ON d.objoid = p.oid
     AND d.classoid = 'pg_catalog.pg_policy'::pg_catalog.regclass
   WHERE d.description LIKE 'migration:014 %';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 014 incomplete: policies survive: %', v_left;
  END IF;

  -- And nothing shaped like one is left either, stamp or no stamp. A policy that
  -- 014 created but failed to stamp would pass the check above and still be a
  -- leftover; this is the check that does not trust the manifest.
  --
  -- It is safe to sweep by NAME here, where the drop loop above is not, precisely
  -- because of the preflight: the only other migration that creates policies in
  -- this shape is 017, and this file refuses to run while 017 is applied. If a
  -- later migration starts calling app.apply_tenant_policies, it joins that
  -- preflight — one more `to_regclass` guard — rather than joining this sweep.
  SELECT pg_catalog.string_agg(pg_catalog.format('%s.%s', c.relname, p.polname), ', ')
    INTO v_left
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core'
     AND (p.polname LIKE '%\_tenant\_select' OR p.polname LIKE '%\_tenant\_isolation'
          OR p.polname = 'provenance_subjects_read');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 014 incomplete: unstamped 014-shaped policies survive: %', v_left;
  END IF;

  IF pg_catalog.to_regprocedure('core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('core.decide_approval(uuid,text,text,text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('core.bulk_decide_approvals(uuid[],text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 014 incomplete: a core wrapper survives';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
               JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'app' AND p.proname = 'apply_tenant_policies') THEN
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
  -- has_table_privilege here too, for the same reason R1 below uses it: a
  -- privilege granted to PUBLIC is inherited by both client roles and appears in
  -- information_schema.table_privileges under NEITHER name, so the old spelling
  -- would report a clean `core` while `anon` could read every enquiry.
  SELECT pg_catalog.string_agg(
           pg_catalog.format('%s.%s', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO v_left
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('core','app') AND c.relkind IN ('r','v','m','p','f')
     AND (has_table_privilege('authenticated', c.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('anon', c.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
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
  -- Literals, not derivations, and deliberately so — unlike the manifest count
  -- above, which had to be derived because re-applying 014 legitimately moves it.
  -- These three numbers are fixed by migrations that have already run and cannot
  -- move while this file's preflight holds: 002 authors fourteen policies on
  -- `public`, 002/004/012 author three on `app`, and `core` is left with 011's
  -- H-02 alone. A change to any of them is a change to an earlier migration and
  -- SHOULD stop this rollback until somebody has looked at it.
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
      'ROLLBACK 014: app.* should carry its three definer-read policies '
      '(002:286, 004:426, 012:896) and carries %', v_n;
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

  RAISE NOTICE
    'ROLLBACK 014: OK — core and app are deny-all again, 002''s five public.* '
    'grant sets are back privilege-for-privilege, anon''s USAGE on core is '
    'restored, and 011''s and 002''s policies are intact';
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
