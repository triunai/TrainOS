-- ============================================================================
-- Migration 014: row-level security policies, the client grant layer, and the
-- three `core` wrappers that make the 011 action envelope reachable from a
-- browser.
-- ============================================================================
--
-- FEATURE. Until this migration every table in the database is deny-all. That is
-- not an oversight, it is the posture 004's `app.finalise_table()` establishes on
-- purpose: RLS ENABLED **and FORCED** with zero policies, so no table is ever
-- open, not even for the duration of one migration. 014 is the pack that opens
-- the read path, and it opens it exactly as wide as one tenant.
--
-- ⚠ THE PRE-014 BASELINE, MEASURED ON A 001-013 DATABASE RATHER THAN ASSUMED.
-- An earlier version of this header said "the whole of 001-013 granted no table,
-- view, sequence or function privilege to `anon` or `authenticated`", and that
-- `relacl` on 002's five identity tables was `{postgres=arwdDxtm/postgres}` and
-- nothing else. Both statements are false, and the second one names the table
-- that disproves it. Measured, on a database with exactly 001-013 applied:
--
--   public.memberships relacl:
--     postgres=arwdDxtm/postgres supabase_auth_admin=r/postgres authenticated=arw/postgres
--   authenticated table privileges in `public`: 16, over the five identity
--     tables — 002:696-701.
--   authenticated table privileges in `core` and `app`: NONE. (This half was true.)
--   authenticated EXECUTE on functions: 15, all in `app` — 002:626-640.
--   schema USAGE for authenticated: `app`, `public` AND `core`, all from
--     001:190/231/232, which grants `core` to anon and service_role too.
--   policies already standing: 14 on `public` (002), 3 on `app` (002:286, 004:426, 012:896),
--     1 on `core` (011's H-02 kill switch).
--
-- WHY THAT MATTERED RATHER THAN BEING A TIDINESS PROBLEM. The false premise is
-- what made `GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships` read as
-- "restating 002" to whoever wrote it. It was not restating 002; 002 grants three
-- privileges there and withholds DELETE on purpose, and the fourth one was a
-- role-escalation path (see §4). A header that describes the starting state
-- wrongly will licence a diff that nobody can see is a diff.
--
-- SO THE REAL DIFF 014 MAKES, stated as a diff:
--   + SELECT on 114 `core` tables and 2 `core` views to `authenticated`
--   + EXECUTE on app.require_tenant_id() to `authenticated`
--   + EXECUTE on three new `core` wrapper functions to `authenticated`
--   + 227 policies on `core` (226 tenant policies over 113 tenant-scoped tables,
--     three of whose restrictive halves also carry a permission term, plus
--     provenance_subjects_read)
--   + 1 policy on `public.memberships` (memberships_no_client_delete)
--   - USAGE on schema `core` from `anon` (001:232 granted it; see §4)
--   = 002's five `public.*` grant sets, restated unchanged
--
-- The reason policies and grants must land together is still mechanical rather
-- than tidy-minded, and it is still the reason this pack exists:
--
--   A POLICY WITHOUT A GRANT IS DEAD CODE — in `core`, where it is literally
--   true. 011 wrote the `autonomy_grants_agents_cannot_write` kill switch and no
--   client role has ever held a privilege on any `core` table, so that policy has
--   never once been consulted. 014 grants `core` into service and the pin proves
--   the policies now decide something. On `public` the same sentence would be
--   false: 002 landed its twelve `authenticated` policies AND the grants under
--   them in the same migration, which is the pattern 014 is copying.
--
--   A GRANT WITHOUT A POLICY IS A LEAK. Under FORCE-with-no-policy the answer is
--   zero rows, so the leak does not open the day the grant lands — it opens the
--   day somebody adds the first policy to "fix the empty screen". Landing both in
--   one migration is what stops that sequence from ever being available.
--
--   AND A REVOKE BEFORE ANY GRANT IS A NO-OP THAT LOOKS LIKE PROTECTION. 011:1357
--   -1371 revokes UPDATE on the fifteen GOV-07 gated columns from `anon`,
--   `authenticated` and `service_role`. Measured: `pg_attribute.attacl` is NULL
--   for all fifteen, because REVOKE removes a privilege from an ACL and there was
--   no ACL. The fifteen lines changed nothing. They were correct to write and they
--   are not the guard; §4's rule that no client role receives UPDATE on any core
--   table AT ALL is the guard, and the verify block re-derives it from
--   `information_schema.column_privileges` rather than trusting the revokes.
--
-- OBJECTS, COUNTED FROM THE APPLIED DATABASE RATHER THAN FROM THIS FILE'S
-- ARITHMETIC. An earlier version of this header said "235 policies over 115
-- relations… 4 core views granted", and the catalog repeated it. The real
-- figures, on a clean forward apply of 001-014:
--
--   228 policies created by 014, over 115 relations:
--     226  tenant policy pairs over 113 tenant-scoped `core` tables — three of
--          those pairs also carry a permission term (§4b), which is folded into
--          the pair's restrictive half rather than added as a third policy
--       1  provenance_subjects_read, on the one `core` table with no tenant_id
--       1  memberships_no_client_delete, on `public.memberships`
--   228 policies on `core` in total afterwards: 227 of 014's (everything above
--       except the one on `public.memberships`) plus 011's H-02 kill switch.
--   15 policies on `public`: 002's fourteen plus 014's one.
--
--   ⚠ EVERY FIGURE ABOVE DESCRIBES A CLEAN 001-014 DATABASE, read back off one
--   rather than counted by hand off this file. THE PIN'S T1 COUNTS A DIFFERENT
--   STATE — 001-017, because that is what the harness applies — so T1 asserts 116
--   policy pairs and 121 `core` SELECT grants where this header says 113 and 114.
--   Both are right about their own database and neither is a correction of the
--   other: 017 adds three tenant-scoped tables and five granted relations. §6
--   derives rather than asserting a literal, so it is correct in both states; T1's
--   literals are pinned to the post-017 state on purpose, and the catalog records
--   that as the 017 amendment pass.
--   114 `core` tables granted SELECT; 2 of the 5 `core` views granted, not 4 —
--       the other three are explicitly REVOKED here and each has its reason
--       written beside it.
--     5 `public` tables, whose grant set is 002's unchanged.
--
-- Plus one function, three `SECURITY DEFINER` wrappers in `core`, and one index.
-- No table, no type, no trigger.
--
-- Every one of those numbers is re-derived by §6 and by the pin's T1, so this
-- comment cannot drift from the database without something failing.
--
-- ── THE READ MODEL, AND WHY WRITES ARE NOT IN IT ─────────────────────────────
--
-- `authenticated` receives **SELECT and nothing else** on `core`. Not INSERT, not
-- UPDATE, not DELETE, on any of the 114 tables.
--
-- That is not caution, it is the spine rule enforced at the privilege layer.
-- `supabase/CLAUDE.md`: "Every primary button in the product and every agent
-- proposal passes through [the action envelope]." A browser holding UPDATE on
-- `core.proposals` can move a proposal without an `action_request` row, without a
-- policy evaluation, without an `action_effect`, and without an entry in the
-- audit index — which is to say it can do the one thing the envelope exists to
-- make impossible. Doc 09 §0 rule 1 puts the same fact the other way round: "A
-- function a client calls must live in `core`; a function only a worker calls must
-- not." The write path is `core.perform_action`, created below. There is no second
-- write path, and after this migration there is no privilege that could become one.
--
-- The consequence worth stating plainly: the fifteen gated-column revokes above
-- are still vacuous after 014, because a column-level UPDATE revoke is vacuous
-- when no role holds UPDATE on the table. 014 does not re-write them to look
-- thorough. It asserts the stronger property instead.
--
-- ── WHY THE POLICY PREDICATE RAISES WHERE 002's RETURNS EMPTY ────────────────
--
-- Every `core` policy below resolves the tenant through
-- `(SELECT app.require_tenant_id())`, which RAISES `NO_TENANT` when the claim is
-- absent. 002's `public.*` policies resolve it through
-- `(SELECT app.current_tenant_id())`, which returns NULL and therefore matches no
-- row. Two spellings, and this migration keeps both deliberately, so here is the
-- distinction that makes it a design rather than a drift:
--
--   `public.tenants`, `teams`, `team_members`, `memberships` and `user_profiles`
--   are read DURING principal assembly. `app.principal_claims()` and the GoTrue
--   hook run as `supabase_auth_admin` at a moment when, by construction, there is
--   no tenant claim yet — the claim is what that read is computing. A predicate
--   that raised there would break login itself. Empty is the correct answer to
--   "which tenant is this" asked before the answer exists.
--
--   Every `core` table is business data, reachable only by a principal that has
--   already been assembled. An authenticated session that reaches
--   `core.enquiries` with no tenant claim is not in a state the product has — it
--   is a broken or forged token, and answering it with an empty list dressed as
--   success is how a tenant-isolation defect hides for a month. It raises.
--
-- The rule for a later author, stated so it does not have to be re-derived:
-- **`current_tenant_id()` above the claim, `require_tenant_id()` below it.**
--
-- ── THE GLOBAL-ROW FALLBACK IS DERIVED, NOT LISTED ───────────────────────────
--
-- 009 makes compliance rules national by default (`tenant_id NULL`) with optional
-- tenant overrides. A policy that only matched `tenant_id = <mine>` would hide
-- every national HRD Corp rule from every tenant, which is the entire registry.
-- So the predicate admits `tenant_id IS NULL` — but only on the tables where that
-- is a representable state, and `apply_tenant_policies` DERIVES which those are
-- from `pg_attribute.attnotnull` rather than taking a list. Two tables qualify
-- today (`core.compliance_rules`, `core.rule_set_versions`). A fifteenth table
-- that later drops NOT NULL on `tenant_id` gets the fallback automatically, and a
-- table that should never have had it fails the verify sweep instead of quietly
-- widening. A hand-maintained list would have gone stale at 009 and nobody would
-- have noticed until a rule vanished.
--
-- ── `core.v_approval_requests` IS DELIBERATELY NOT GRANTED ───────────────────
--
-- ⚠ DEVIATION FROM THE TASK BRIEF, RECORDED LOUDLY. The brief for this pack asks
-- for a pin that "the approval view is readable". Doc 09 §12 says the opposite in
-- as many words about this exact relation: it "is currently `REVOKE ALL … FROM
-- PUBLIC, anon, authenticated` (011:1428)… **Do not grant the view to
-- `authenticated` to shortcut** [`core.list_approvals`]." Both cannot be honoured
-- literally, so 014 honours the mechanism and pins the property:
--
--   * The view stays revoked from `authenticated`. It is `security_invoker=true`,
--     so granting it would run its body AS the browser and expose the join path
--     011 built for a definer to walk.
--   * The pin (T7) asserts the view IS readable — through the definer path, for
--     the caller's own tenant, returning that tenant's rows and no other's — and
--     separately asserts that a direct `SELECT` by `authenticated` is REFUSED.
--
-- That is the readable the product needs. `core.list_approvals` and
-- `core.get_approval` are 018's to write over it; 014 leaves the relation in the
-- state their definer bodies require.
--
-- ⚠ THE OTHER FOUR VIEWS ARE NOT ALL GRANTED, WHICH IS WHAT AN EARLIER VERSION
-- OF THIS PARAGRAPH SAID. TWO ARE: `core.audit_entries` and
-- `core.v_contact_consent_current`. `core.budget_status` and
-- `core.model_tier_status` are explicitly REVOKED in §4 with their reason — they
-- are `security_invoker` over `app.usage_rollup`, which no client role can read,
-- so a grant on them delivers a permission error rather than a row. Measured:
-- `has_table_privilege('authenticated', …, 'SELECT')` is false for both.
--
-- The two that ARE granted are `security_invoker=true`, so each re-runs the
-- underlying tables' policies as the caller and inherits tenant isolation rather
-- than needing its own. §4 asserts that flag on every `core` view before granting
-- anything, because Postgres creates a view SECURITY DEFINER by default and one
-- that lost the flag in a later edit would bypass every policy above it and look
-- identical in `\dv`. T5 measures the isolation by reading as two tenants; T4 is
-- the `anon` test.
--
-- ── WHAT THE THREE WRAPPERS DO AND DO NOT DO ────────────────────────────────
--
-- `app.perform_action`, `app.decide_approval` and `app.bulk_decide` are granted to
-- `service_role` only (011:3408-3413) and `app` is not in PostgREST's exposed
-- schemas, so a browser cannot reach them at all. The wrappers are what make them
-- reachable, and they are one line each on purpose:
--
--   * They add `app.ok()`, because doc 09 §1 records that `app.perform_action`
--     returns a BARE `{status, result|approvalRequest|draft}` and 012's worker
--     path returns the same value and does not want an envelope. The envelope is
--     added at the edge that needs it, not pushed down into `app` where it would
--     break the worker.
--   * They add NO second tenant check and NO re-validation. `app.perform_action`
--     calls `app.require_tenant_id()` itself and resolves the actor from
--     `app.current_actor()`. A wrapper that re-derived either would be a second
--     place for the two to disagree.
--   * They do NOT widen identity. `SECURITY DEFINER` here buys exactly one thing:
--     EXECUTE on an `app` function the caller does not hold. The caller's JWT is
--     unchanged, so every role, permission, AAL and tenant check inside 011 is
--     evaluated against the real principal. T2 proves this by performing a real
--     action as a real `authenticated` principal and then proving a cross-tenant
--     one is refused BY 011, through the wrapper.
--   * `POLICY_APPROVAL_REQUIRED` is not reclassified. Doc 09 §1: 011 returns
--     `{"status":"QUEUED_FOR_APPROVAL", …}`, which is a 202 and a success. A
--     wrapper that turned it into `app.err()` would make every approval-gated
--     button in the product render an error. T3 walks that outcome through.
--
-- NAMING, SETTLED AGAINST THE CONSUMER. The task brief calls the third wrapper
-- `core.bulk_decide`. Doc 09 §1 and §12 call it `core.bulk_decide_approvals`, and
-- so does the only thing that will ever call it: `apps/web/src/shared/api/
-- rpcClient.ts:335` lists `wraps011: ["perform_action", "decide_approval",
-- "bulk_decide_approvals"]` and line 533 issues `this.call("bulk_decide_approvals",
-- …)`. A wrapper named something no client calls is dead code with a live-looking
-- grant. The spelling follows the consumer and the document; the `app` function it
-- wraps keeps its own name, `app.bulk_decide`, which is why the brief's shorthand
-- is understandable and is recorded here rather than silently overridden.
--
-- ── SPINE ───────────────────────────────────────────────────────────────────
--
-- Spine untouched, in the strongest sense available to this pack: 014 adds no
-- action type, no handler and no branch to the envelope, and it is the migration
-- that makes bypassing the envelope impossible rather than merely discouraged.
-- Pipeline configuration is untouched; no stage name appears in this file.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────
-- Each guard names the pack it depends on and the object it needs from it. A
-- guard that fires stops the migration before a single GRANT lands, because a
-- half-granted database is strictly worse than an ungranted one.

DO $preflight$
BEGIN
  IF pg_catalog.to_regproc('app.require_tenant_id') IS NULL THEN
    RAISE EXCEPTION '014 preflight: app.require_tenant_id() is absent; 002 has not been applied';
  END IF;
  IF pg_catalog.to_regproc('app.current_tenant_id') IS NULL THEN
    RAISE EXCEPTION '014 preflight: app.current_tenant_id() is absent; 002 has not been applied';
  END IF;
  IF pg_catalog.to_regproc('app.ok') IS NULL THEN
    RAISE EXCEPTION '014 preflight: app.ok() is absent; 001 has not been applied';
  END IF;
  -- to_regprocedure, not to_regproc: all three 011 entry points are overload-free
  -- today, but 013's rollback found to_regproc returning NULL for an AMBIGUOUS
  -- name and reporting a present function as dropped. Naming the full signature
  -- cannot degrade that way.
  IF pg_catalog.to_regprocedure('app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION '014 preflight: app.perform_action/8 is absent; 011 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('app.decide_approval(uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '014 preflight: app.decide_approval/5 is absent; 011 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('app.bulk_decide(jsonb,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '014 preflight: app.bulk_decide/4 is absent; 011 has not been applied';
  END IF;
  IF pg_catalog.to_regclass('core.v_approval_requests') IS NULL THEN
    RAISE EXCEPTION '014 preflight: core.v_approval_requests is absent; 011 has not been applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION '014 preflight: role "authenticated" does not exist; this is not a Supabase database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION '014 preflight: role "anon" does not exist; this is not a Supabase database';
  END IF;
  -- 013 left core.runs and core.agents unwritable per tenant until 016 seeds
  -- their ref_formats rows. 014 neither reads nor writes them, so that is not a
  -- dependency, and it is named here so a later reader does not add one.
END;
$preflight$;

-- ============================================================================
-- §1 · app.apply_tenant_policies() — one posture, N attachments
-- ============================================================================
-- 004's `finalise_table` is the precedent and the argument: eight facts across
-- eighty tables, written per table, is six hundred lines of copy-paste in which
-- exactly one table ends up missing FORCE and nothing notices until that table is
-- the one that leaks. The same is true of a tenant predicate, and worse: a policy
-- typo does not fail to apply, it applies and admits the wrong rows.
--
-- Written once, one pin proves it for all of them — and, as 004 established, the
-- pin tests the FUNCTION on a throwaway table rather than the 114 it happened to
-- be applied to, because otherwise it would not prove the 115th gets the same
-- treatment.
--
-- TWO POLICIES PER TABLE, and the second is the one that matters longest:
--
--   `<table>_tenant_select`     PERMISSIVE, FOR SELECT, TO authenticated.
--                               The read path. This is what makes a row visible.
--
--   `<table>_tenant_isolation`  RESTRICTIVE, FOR ALL, TO authenticated, in BOTH
--                               USING and WITH CHECK.
--
-- A RESTRICTIVE policy is ANDed with every permissive policy rather than ORed, so
-- it cannot be widened by adding another policy beside it — which is precisely how
-- a tenant-isolation guarantee gets lost. 002 reached for the same mechanism for
-- the same reason (`memberships_no_self_edit`), and 011 for `H-02`. It is FOR ALL
-- rather than FOR SELECT because its job is to still be correct on the day
-- somebody grants a write: today no client role holds INSERT, UPDATE or DELETE on
-- any core table, so the write half decides nothing; the day that changes, a
-- cross-tenant write is already impossible and does not depend on whoever makes
-- that change remembering this file. That is not dead code, it is the guard that
-- has to predate the mistake to be worth anything.
--
-- The function refuses a table with no `tenant_id`, exactly as `finalise_table`
-- does, and for the same reason: a table reaching the policy layer without one
-- gets no tenant predicate, and a policy that cannot filter by tenant does not
-- isolate. `core.provenance_subjects` is the one core relation in that state and
-- §3 handles it explicitly, by name, with its reason written down.

-- ⚠ THREE ARGUMENTS, AND THE TWO-ARGUMENT SIGNATURE IS DROPPED FIRST.
-- `CREATE OR REPLACE FUNCTION` matches on the ARGUMENT LIST, so adding
-- `p_permission` — even defaulted — would CREATE A SECOND OVERLOAD rather than
-- replace the first, and two overloads differing only by a defaulted trailing
-- argument make every two-argument call ambiguous. 017 calls this function with
-- two arguments for three of its own tables, so that ambiguity would be a live
-- failure in the next migration, not a theoretical one. The DROP below is what
-- stops it; §6 asserts the overload count is exactly one.
DROP FUNCTION IF EXISTS app.apply_tenant_policies(text, text);
DROP FUNCTION IF EXISTS app.apply_tenant_policies(text, text, text);

CREATE OR REPLACE FUNCTION app.apply_tenant_policies(
  p_schema     text,
  p_table      text,
  p_migration  text,
  p_permission text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_oid        pg_catalog.oid;
  v_notnull    boolean;
  v_read       text;
  v_write      text;
  v_existing   text;
  v_select_pol text := p_table || '_tenant_select';
  v_iso_pol    text := p_table || '_tenant_isolation';
  v_gate       text := '';
BEGIN
  -- ⚠ VALIDATE `p_migration` FIRST, AND VALIDATE ITS SHAPE, NOT JUST ITS
  -- PRESENCE. This is the check that closes a silent hole the DROP above cannot.
  --
  -- The old three-argument spelling — `apply_tenant_policies('core','x','run:read')`,
  -- which the catalog taught and 017 used before the signature changed — does NOT
  -- fail. There is no three-argument overload to resolve to; it binds to THIS
  -- function with `p_migration = 'run:read'` and `p_permission = NULL`, and
  -- produces an UNGATED policy stamped `migration:run:read`. Reproduced on a live
  -- database: the table came out with `has_permission` nowhere in its predicate
  -- and a stamp no rollback will ever match. A security gate silently downgraded
  -- and an unfindable policy, from a call that reads exactly like the documented
  -- one. Dropping the old signature does nothing about it, because the old
  -- signature is not what the call resolves to.
  --
  -- So the slot is typed by its content: a three-digit pack number and nothing
  -- else. 'run:read' is refused, NULL is refused, '' is refused. Same vocabulary
  -- as app.tenant_seed_checks.pack, for the same reason — a migration identifier
  -- that could be any string is a slot any argument can fall into.
  IF p_migration IS NULL OR p_migration !~ '^[0-9]{3}$' THEN
    RAISE EXCEPTION
      'apply_tenant_policies: p_migration must be the three-digit pack that owns '
      'the policy (''014'', ''017''), and is %. If you meant to pass a permission, '
      'it is the FOURTH argument: the three-argument spelling binds it here '
      'instead and produces an ungated policy with a stamp no rollback can find.',
      COALESCE('''' || p_migration || '''', 'NULL')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_oid := pg_catalog.to_regclass(pg_catalog.format('%I.%I', p_schema, p_table));
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'apply_tenant_policies: %.% does not exist', p_schema, p_table;
  END IF;

  -- Refuse a table with no tenant_id. Same contract as finalise_table.
  SELECT a.attnotnull INTO v_notnull
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = v_oid AND a.attname = 'tenant_id'
     AND a.attnum > 0 AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'apply_tenant_policies: %.% has no tenant_id column, so no policy on it '
      'could isolate a tenant. Give it one, or grant it explicitly by name with '
      'the reason written down.', p_schema, p_table;
  END IF;

  -- RLS must already be on. 004 turns it on; 014 does not turn it on for a table
  -- that somehow lacks it, because a table that reached here unforced has a
  -- provenance problem that a silent ALTER would erase.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
     WHERE c.oid = v_oid AND c.relrowsecurity AND c.relforcerowsecurity)
  THEN
    RAISE EXCEPTION
      'apply_tenant_policies: %.% does not have RLS enabled AND forced; 004''s '
      'finalise_table should have done that and did not', p_schema, p_table;
  END IF;

  -- The global-row fallback, DERIVED. A NULL-able tenant_id is 009's national
  -- rule; a NOT NULL one cannot represent a global row and must not be given a
  -- predicate that pretends it can.
  --
  -- ⚠ THE FALLBACK IS A READ CONCESSION AND NOTHING ELSE. `v_read` admits the
  -- global row; `v_write` never does. An earlier version used ONE string for both
  -- halves, so `tenant_id IS NULL` was admitted on writes too — and this file's
  -- own header sells the restrictive policy as making "a cross-tenant write
  -- already impossible on the day somebody grants a write". It did not: on that
  -- day any authenticated caller could have written a row attributed to no tenant
  -- and therefore visible to EVERY tenant, which is worse than a cross-tenant
  -- write because it lands in all of them at once.
  --
  -- Inert today, because no client role holds INSERT or UPDATE on any core table.
  -- Fixed today anyway, while it is two strings instead of one, rather than on
  -- the day a write grant makes it live — which is the whole argument for the
  -- restrictive policy existing before the grant does.
  IF v_notnull THEN
    v_read  := 'tenant_id = (SELECT app.require_tenant_id())';
  ELSE
    v_read  := '(tenant_id = (SELECT app.require_tenant_id()) OR tenant_id IS NULL)';
  END IF;
  v_write := 'tenant_id = (SELECT app.require_tenant_id())';

  -- ⚠ THE ROLE GATE, WHEN THE CALLER ASKS FOR ONE. `p_permission` ANDs a
  -- permission term into the RESTRICTIVE policy's two halves, for the handful of
  -- tables where being a member of the tenant is not sufficient authorization to
  -- read every row (see §4b for which, and why each).
  --
  -- It goes INSIDE the existing `<table>_tenant_isolation` policy rather than
  -- into a policy of its own, for two reasons. The inventory pins that 004 T1c
  -- and 013 T1d already enforce name every policy in `core` as one of exactly two
  -- shapes, and a third shape would break them without making anything safer.
  -- And a restrictive term folded into the restrictive policy is the same boolean
  -- either way: RESTRICTIVE policies AND together, so `A AND B` as one policy and
  -- `A`,`B` as two are indistinguishable to the planner and to an attacker.
  --
  -- `app.has_permission` is SECURITY DEFINER over app.role_permissions, which
  -- `authenticated` cannot read directly, and is already granted EXECUTE to
  -- `authenticated` by 002:637 — so it is runnable in a predicate, which is
  -- evaluated AS THE QUERYING ROLE. A hardcoded role list here would be a second
  -- copy of 002's permission catalogue that nothing keeps in step with the first.
  -- The `(SELECT ...)` wrapper is the InitPlan form used throughout this file:
  -- one evaluation per statement, not per row.
  -- ⚠ ORDER MATTERS HERE, and an earlier version got it wrong in a way only a
  -- probe found: with `UNGATE` excluded from the first branch's condition it fell
  -- through to the ELSE, which is the refusal, so the documented escape hatch was
  -- a dead branch that always raised. `UNGATE` is therefore tested FIRST and on
  -- its own. T16 now exercises all three branches.
  IF p_permission IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app.role_permissions rp WHERE rp.permission = p_permission) THEN
      RAISE EXCEPTION
        'apply_tenant_policies: permission % names no row in app.role_permissions, '
        'so the gate on %.% would refuse every role including ADMIN. A gate nobody '
        'can satisfy is a broken screen, not security.', p_permission, p_schema, p_table;
    END IF;

    -- ⚠ AND THAT IT NARROWS SOMETHING. Existing was not enough: a permission
    -- every role holds — `dashboard:read`, say — passes an existence check and
    -- produces a gate that gates nothing, silently. That is the same shape as the
    -- dead `UNGATE` branch this function used to carry: a written control with a
    -- failure mode nobody meets until they do. `verify (13)` already ran this
    -- check on 014's own three tables; running it HERE makes it true for every
    -- caller, including 018's.
    IF (SELECT pg_catalog.count(*) FROM app.role_permissions rp
         WHERE rp.permission = p_permission)
       >= (SELECT pg_catalog.count(DISTINCT rp.role) FROM app.role_permissions rp) THEN
      RAISE EXCEPTION
        'apply_tenant_policies: permission % is held by every role that holds any '
        'permission, so a gate on %.% built from it narrows nothing and is '
        'decoration with the shape of security.', p_permission, p_schema, p_table;
    END IF;

    v_gate := pg_catalog.format(' AND (SELECT app.has_permission(%L))', p_permission);
  ELSE
    -- ⚠ A TWO-ARGUMENT CALL MUST NOT BE ABLE TO STRIP AN EXISTING GATE.
    --
    -- This function is DROP-then-CREATE by design, so the obvious spelling —
    -- `SELECT app.apply_tenant_policies('core','run_node_io')`, one line,
    -- identical to the three calls 017 already ships — would replace a gated
    -- isolation policy with an ungated one and hand every principal of the tenant
    -- the raw agent prompt and completion text back. Nothing would fail: the
    -- policy would exist, the pin would not be running, and §6's check would not
    -- run again until somebody re-applied 014.
    --
    -- A security control that three documented callers can delete by accident is
    -- not a control, so the function refuses instead. It reads the gate out of the
    -- policy it is about to drop — the database is the manifest, the same way the
    -- rollback's `migration:014` stamp is — and makes removing one a thing you
    -- have to write down.
    -- BOTH halves, not just USING. A gate that reached WITH CHECK and not USING
    -- (or the reverse) is a half-gate, and reading one half would let a
    -- two-argument call quietly finish removing it.
    SELECT pg_catalog.concat_ws(' | ',
             pg_catalog.pg_get_expr(p.polqual, p.polrelid),
             pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))
      INTO v_existing
      FROM pg_catalog.pg_policy p
     WHERE p.polrelid = v_oid AND p.polname = v_iso_pol;

    IF v_existing IS NOT NULL AND pg_catalog.strpos(v_existing, 'has_permission') > 0 THEN
      RAISE EXCEPTION
        'apply_tenant_policies: %.% already carries a role gate and this call '
        'passes no permission, which would silently remove it. Its current '
        'isolation predicate is: %. Pass the same permission again to keep the '
        'gate, pass a different one to change it, or call %s to remove it on '
        'purpose.',
        p_schema, p_table, v_existing,
        pg_catalog.format('app.ungate_tenant_policy(%L, %L, %L)',
          p_schema, p_table, p_migration);
    END IF;
  END IF;


  -- Idempotent by DROP-then-CREATE rather than by a pg_policy lookup: a policy
  -- that exists with the WRONG predicate is the failure mode that matters, and a
  -- presence check would leave it standing. 004 hit the ADD CONSTRAINT IF NOT
  -- EXISTS trap; CREATE POLICY has the same gap and this is the way out of it.
  EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON %I.%I', v_select_pol, p_schema, p_table);
  EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON %I.%I', v_iso_pol,    p_schema, p_table);

  EXECUTE pg_catalog.format(
    'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR SELECT TO authenticated USING (%s)',
    v_select_pol, p_schema, p_table, v_read);

  -- USING is the read half of the restrictive policy — which rows an UPDATE or
  -- DELETE may even see — and keeps the fallback so a global row is not invisible
  -- to the statement that is about to be refused for a better reason. WITH CHECK
  -- is the write half and is always strict: whatever row this caller ends up
  -- writing must carry this caller's tenant.
  EXECUTE pg_catalog.format(
    'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated '
    'USING (%s%s) WITH CHECK (%s%s)',
    v_iso_pol, p_schema, p_table, v_read, v_gate, v_write, v_gate);

  -- ⚠ THE STAMP IS WRITTEN HERE, BY THE FUNCTION, FROM A REQUIRED ARGUMENT.
  --
  -- It used to be written by the CALLER, in prose, after the call — and 014 did
  -- it while 017's three calls to the same function did not. One convention, two
  -- ownership stories in two files, and the rollback that drops by the stamp had
  -- to reason about which was true. Making it an argument with no default means
  -- a caller cannot create a policy here without saying which migration owns it,
  -- and there is exactly one place that turns that answer into a comment.
  --
  -- THE ONE CASE THIS DOES NOT MAKE TIDY, stated here and nowhere else so the two
  -- files cannot disagree again: re-applying 014 on top of an already-applied 017
  -- re-creates 017's three tables' policies, because 014's loop covers every
  -- tenant-scoped core table that exists when it runs — and they come out stamped
  -- `014`, because 014 really was the last thing to create them. That is why
  -- 014's ROLLBACK refuses to run while 017 is applied rather than trying to
  -- reason about provenance after the fact. Reverse order is the only order in
  -- which the stamp and the truth agree.
  EXECUTE pg_catalog.format(
    'COMMENT ON POLICY %I ON %I.%I IS %L', v_select_pol, p_schema, p_table,
    pg_catalog.format(
      'migration:%s — permissive tenant-scoped SELECT.%s', p_migration,
      CASE WHEN v_gate = '' THEN ''
           ELSE ' Narrowed by the restrictive isolation policy beside it, which '
                'carries a permission term.' END));

  EXECUTE pg_catalog.format(
    'COMMENT ON POLICY %I ON %I.%I IS %L', v_iso_pol, p_schema, p_table,
    pg_catalog.format(
      'migration:%s — restrictive FOR ALL tenant isolation%s. Correct on the day '
      'somebody grants a write, which is the only day the write half decides '
      'anything.', p_migration,
      CASE WHEN p_permission IS NULL THEN ''
           ELSE ' AND role gate on ' || p_permission ||
                ': tenant membership is not sufficient authorization here' END));
END;
$fn$;

-- ── THE ESCAPE, AS A NAME RATHER THAN A STRING ─────────────────────────────
-- Removing a role gate is a deliberate act and now looks like one at the call
-- site. It used to be `apply_tenant_policies('core','x','UNGATE')` — a magic
-- string in the same argument that otherwise names a permission, so "what gate"
-- and "may this drop one" were fused into one three-way branch whose safety
-- rested on the order the branches were tested in. That ordering had already
-- produced one dead-code bug: the literal was excluded from the branch that set
-- the gate but not from the one that refused, so the documented escape raised on
-- every call and removed nothing.
--
-- A separate function cannot have that bug. There is no argument to mis-order and
-- no string to mistype into a permission lookup: `grep ungate_tenant_policy` finds
-- every place a gate has ever been removed.
CREATE OR REPLACE FUNCTION app.ungate_tenant_policy(
  p_schema    text,
  p_table     text,
  p_migration text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_oid     pg_catalog.oid;
  v_iso_pol text := p_table || '_tenant_isolation';
  v_before  text;
BEGIN
  IF p_migration IS NULL OR p_migration !~ '^[0-9]{3}$' THEN
    RAISE EXCEPTION
      'ungate_tenant_policy: p_migration must be the three-digit pack removing '
      'the gate, and is %. Removing one is a deliberate act and the record of who '
      'did it is the point.', COALESCE('''' || p_migration || '''', 'NULL')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_oid := pg_catalog.to_regclass(pg_catalog.format('%I.%I', p_schema, p_table));
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ungate_tenant_policy: %.% does not exist', p_schema, p_table;
  END IF;

  SELECT pg_catalog.concat_ws(' | ',
           pg_catalog.pg_get_expr(p.polqual, p.polrelid),
           pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))
    INTO v_before
    FROM pg_catalog.pg_policy p
   WHERE p.polrelid = v_oid AND p.polname = v_iso_pol;

  IF v_before IS NULL OR pg_catalog.strpos(v_before, 'has_permission') = 0 THEN
    RAISE EXCEPTION
      'ungate_tenant_policy: %.% carries no role gate, so there is nothing to '
      'remove. Calling this on an ungated table is a sign the caller believes a '
      'gate exists that does not.', p_schema, p_table;
  END IF;

  RAISE WARNING
    'ungate_tenant_policy: REMOVING the role gate on %.% (was: %). Every principal '
    'of the tenant can now read every row of it. Migration % is doing this on '
    'purpose.', p_schema, p_table, v_before, p_migration;

  -- ⚠ DROP THE GATED POLICY FIRST, then rebuild ungated. Calling
  -- apply_tenant_policies straight through would hit its own refusal — the gate
  -- is still standing at this point, which is exactly the condition that function
  -- refuses on — and the escape would be as dead as the magic string it replaced.
  -- Found by running it, not by reading it, for the second time on this control.
  EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON %I.%I',
    v_iso_pol, p_schema, p_table);

  PERFORM app.apply_tenant_policies(p_schema, p_table, p_migration, NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION app.ungate_tenant_policy(text, text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.ungate_tenant_policy(text, text, text) IS
  'Removes the role gate from a tenant-scoped table''s isolation policy, loudly. '
  'The deliberate counterpart to apply_tenant_policies refusing a call that would '
  'remove one by accident. A separate named function rather than a magic string in '
  'the permission argument, so the escape is greppable and cannot depend on branch '
  'order. Refuses on a table that carries no gate. 014.';

REVOKE ALL ON FUNCTION app.apply_tenant_policies(text, text, text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.apply_tenant_policies(text, text, text, text) IS
  'Stamps the standard two-policy tenant posture on a tenant-scoped table: a '
  'PERMISSIVE SELECT policy and a RESTRICTIVE FOR ALL isolation policy, both TO '
  'authenticated, both resolving the tenant through (SELECT app.require_tenant_id()). '
  'The global-row fallback (tenant_id IS NULL) is derived from the column''s NOT NULL '
  'flag, never from a list, and appears in the READ predicate only: the isolation '
  'policy''s WITH CHECK is always the strict tenant equality, so no caller can ever '
  'write a row attributed to no tenant and therefore visible to every tenant. '
  'Refuses a table with no tenant_id. An optional third argument ANDs an '
  'app.has_permission() term into the restrictive policy''s two halves, for tables '
  'where tenant membership is not sufficient authorization; it lives inside that '
  'policy rather than in a policy of its own because restrictive policies AND '
  'together anyway and the inventory pins in test_004 and test_013 name exactly '
  'two policy shapes in core. 014.';

-- ── THE GRANT THAT MAKES A POLICY PREDICATE RUNNABLE AT ALL ─────────────────
-- Found by executing this migration, not by reading it. With the policies in
-- place, `SET LOCAL ROLE authenticated; SELECT count(*) FROM core.organisations;`
-- did not return zero rows — it failed outright:
--
--   ERROR:  permission denied for function require_tenant_id
--
-- A POLICY PREDICATE IS EVALUATED AS THE QUERYING ROLE, not as the table owner
-- and not as a definer. A function named in a policy must therefore be EXECUTABLE
-- BY THAT ROLE, or the policy does not deny access — it errors, and every read of
-- every table it guards returns a 500 instead of a row set. Deny and error look
-- equally "secure" in a smoke test and are completely different products.
--
-- 002 already understood this and acted on it for the four claim readers its own
-- policies use: `app.current_tenant_id`, `app.role`, `app.has_permission` and
-- `app.is_agent` are all executable by `authenticated` today, measured. It did not
-- grant `app.require_tenant_id`, because no policy in 001-013 used it — 014 is the
-- first pack to put it in a predicate and therefore the first that could notice.
-- The omission was correct until this line and is a defect after it.
--
-- ⚠ THIS IS NOT THE THING DOC 09 §0 RULE 3 FORBIDS, and the distinction is worth
-- keeping straight because the two look alike. That rule says do not grant
-- `app.ok`, `app.err`, `app.current_actor` or `app.perform_action` to
-- `authenticated` "to make a function work" — those read or write past the
-- caller's RLS, and a definer wrapper exists precisely so they never need a client
-- grant. `app.require_tenant_id` does neither. It reads one claim out of the JWT
-- the caller already presented and raises if it is absent; it is STABLE, it
-- touches no table, and it returns information the caller supplied. Granting it
-- tells a client nothing it did not already know. `app.ok` and
-- `app.perform_action` stay revoked, and §6 check (7) proves it.
GRANT EXECUTE ON FUNCTION app.require_tenant_id() TO authenticated;

COMMENT ON FUNCTION app.require_tenant_id() IS
  'Returns the caller''s tenant from the JWT, raising NO_TENANT when absent. '
  'Granted to authenticated by 014 because it is named in every core policy '
  'predicate, and a policy predicate is evaluated as the querying role: without '
  'the grant the policy errors rather than denies. Reads no table and returns only '
  'what the caller''s own token already carries. 002 grants the other four claim '
  'readers for the same reason.';

-- ============================================================================
-- §2 · Apply the posture to every tenant-scoped table in `core`
-- ============================================================================
-- The loop is driven from the CATALOGUE, not from a list of 114 names. A list
-- would be wrong the moment 016 or 017 adds a table, and wrong in the direction
-- that matters: the new table would be deny-all and someone would "fix" it by
-- hand, off-pattern, in a migration about something else. Driving from
-- pg_class means a table added later and finalised by 004 is either covered by
-- re-running this loop or caught by §6's check (1), and never quietly half-covered.
--
-- `core.provenance_subjects` is excluded by name and handled in §3.

DO $apply$
DECLARE
  r         pg_catalog.record;
  v_count   integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname, g.perm
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      -- ⚠ THE GATED SET, DECLARED ONCE AND NOWHERE ELSE. §4b explains which
      -- tables these are and why each one is here; this is the only list, and it
      -- is consulted on the SAME pass that creates the policies rather than by a
      -- second pass that re-creates them. A second pass would have to call
      -- app.apply_tenant_policies with two arguments for the other 110 tables and
      -- three arguments for these, and the function now refuses the two-argument
      -- spelling on a table that already carries a gate — correctly, because that
      -- spelling is how a later migration would strip one by accident.
      LEFT JOIN (VALUES
        ('ai_provider_keys',    'ai:provider:read'),
        -- ⚠ ALL SEVEN TABLES `run:read` GOVERNS, not the one the first review
        -- happened to name. 013 creates seven, and gating one of them while
        -- arguing "restore the decision 002 already wrote down" restores it for a
        -- seventh of the surface. `run_state_cards` is WORSE than the table that
        -- was gated: 013's own header concedes it is not subject to the 30-day
        -- redaction sweep `run_node_io` gets, and it carries goal, plan and open
        -- questions as free text. `run_snapshots.response` is every tool call's
        -- raw output for every run in the tenant.
        --
        -- `runs`, `run_nodes` and `run_events` are included too, and that is a
        -- choice rather than caution: they are the trace's spine, `run:read` is
        -- the permission 002 wrote for reading a run, and a metadata-only
        -- exception would mean deciding that agent_id, model, token counts, cost
        -- and event detail are not part of "reading a run" — which is a product
        -- decision nobody has made and which this file is the wrong place to make
        -- silently. MD and ADMIN hold `run:read`; the AI-ops screens are theirs.
        ('runs',                'run:read'),
        ('run_nodes',           'run:read'),
        ('run_node_io',         'run:read'),
        ('run_events',          'run:read'),
        ('run_state_cards',     'run:read'),
        ('run_checkpoints',     'run:read'),
        ('run_snapshots',       'run:read'),
          -- ⚠ ROLE HALF ONLY, AND THE HEADER SAYS SO. 002 annotates SALES's and
        -- SALES_MANAGER's `portal:token:issue` as `-- scope-narrowed`, meaning it
        -- was meant to compose with `app.client_scope()` / `app.team_scope()`, not
        -- stand alone. This gate restores the role half and NOT the scope half, so
        -- a SALES principal still reads every share-token row in the tenant rather
        -- than only their own clients'. Adding the scope term needs an owner
        -- column on the table that 007 did not give it — `created_by_id` is text
        -- and not a user id — so it is a schema change, not a predicate change,
        -- and it is recorded as a gap with an owner rather than done badly here.
        ('public_share_tokens', 'portal:token:issue')
      ) AS g(relname, perm) ON g.relname = c.relname
     WHERE n.nspname = 'core'
       AND c.relkind = 'r'
       AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                AND a.attnum > 0 AND NOT a.attisdropped)
     ORDER BY c.relname
  LOOP
    PERFORM app.apply_tenant_policies('core', r.relname, '014', r.perm);

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '014: tenant policies applied to % core tables', v_count;

  IF v_count < 100 THEN
    RAISE EXCEPTION
      '014: only % core tables were finalised with a tenant_id; 001-013 create '
      '113 of them and a number this low means the pack applied against an '
      'incomplete database', v_count;
  END IF;
END;
$apply$;

-- ============================================================================
-- §3 · The one core table with no tenant, granted by name with its reason
-- ============================================================================
-- `core.provenance_subjects` is (subject_table text, note text). It is a
-- two-column lookup naming which tables can carry provenance, seeded by 007. It
-- holds no tenant data and could not be given a tenant predicate if it wanted
-- one. `apply_tenant_policies` refuses it on purpose; this is the explicit
-- exception the refusal message asks for, written down rather than routed around
-- by loosening the function.

DROP POLICY IF EXISTS provenance_subjects_read ON core.provenance_subjects;
CREATE POLICY provenance_subjects_read ON core.provenance_subjects
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

COMMENT ON POLICY provenance_subjects_read ON core.provenance_subjects IS
  'migration:014 — Reference data with no tenant dimension: the list of tables that may carry a '
  'provenance row. USING (true) is the whole predicate because there is nothing '
  'to scope by; the guard is that the table holds no tenant data and receives no '
  'write privilege.';

-- ============================================================================
-- §3b · A defect found by executing this migration, fixed where it was found
-- ============================================================================
-- 014's verify check (10) asserts that `tenant_id` leads an index on every table
-- carrying a tenant policy, because a policy column that is not indexed turns
-- every row read into a sequential scan — Supabase's own RLS performance guide
-- measures that at 171ms against <0.1ms. The check was written expecting to be a
-- REGRESSION TEST on 004, since `app.finalise_table` creates that index for every
-- table it touches. It fired on the first run, on exactly one relation:
--
--   `core.rule_set_versions` is the one table in 009 that was hand-rolled instead
--   of being passed through `app.finalise_table`. 009:229-237 re-implements the
--   RLS enable, the FORCE, the revoke, the updated_at trigger and the immutable
--   trigger inline, and in doing so drops the two things the finaliser also does
--   and a hand copy forgets: the tenant index, and the composite
--   `UNIQUE (tenant_id, id)`. Its three indexes are the primary key and two
--   single-column uniques, none of which mentions `tenant_id`.
--
-- This is the exact failure 004's header predicts in the abstract — "written per
-- table it is six hundred lines of copy-paste in which exactly one table ends up
-- missing FORCE and nothing notices until that table is the one that leaks" —
-- landing in the concrete, one table out of 114, found by a check rather than by
-- a reading. FORCE survived the copy; the index did not.
--
-- 014 adds the index rather than deferring it, because 014 is the migration that
-- creates the policy that needs it: shipping the policy and filing the index is
-- shipping a known sequential scan on the compliance registry. The missing
-- composite unique is NOT added here — it is a shape change to a 009 table with
-- rows that may already exist, which belongs in 017's amendment pass, and it is
-- recorded in the catalog as such rather than smuggled into a grants migration.

CREATE INDEX IF NOT EXISTS rule_set_versions_tenant_idx
  ON core.rule_set_versions (tenant_id);

COMMENT ON INDEX core.rule_set_versions_tenant_idx IS
  'Added by 014. 009 created this table without app.finalise_table, so it never '
  'received the tenant index the finaliser gives every other table. Required by '
  'rule_set_versions_tenant_select. The absent composite UNIQUE (tenant_id, id) '
  'from the same omission is 017''s.';

-- ============================================================================
-- §4 · The client grant layer
-- ============================================================================
-- Order matters and is the point of the section. REVOKE first, from PUBLIC and
-- anon, across the whole schema; then grant SELECT, to authenticated only, table
-- by table. Doing it in that order means the end state does not depend on what
-- any earlier pack did or failed to do.
--
-- `anon` is hostile by default (supabase/CLAUDE.md rule 5): it holds EXECUTE on
-- exactly the public-token allowlist and nothing else, and 014 creates no
-- allowlist entry. Every line below that names `anon` names it in a REVOKE.

REVOKE ALL ON ALL TABLES    IN SCHEMA core FROM PUBLIC, anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA core FROM PUBLIC, anon;
REVOKE ALL ON ALL TABLES    IN SCHEMA app  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app  FROM PUBLIC, anon, authenticated;

-- `core` USAGE: without it the grants below are unreachable and PostgREST reports
-- nothing useful. 001:232 ALREADY grants it to `authenticated` — measured, not
-- assumed — so this line changes nothing and is kept only so the requirement is
-- readable beside the grants that depend on it. Its rollback is therefore NOT a
-- revoke: see the rollback file, which used to revoke it and in doing so
-- destroyed a 001 grant.
GRANT USAGE ON SCHEMA core TO authenticated;

-- ⚠ `anon` KEEPS ITS USAGE ON `app`, AND THAT IS DELIBERATE. An earlier draft of
-- this migration revoked it as obvious hardening. It is not hardening, it is a
-- regression, and test_011 T13b caught it by asserting all three API roles still
-- hold that USAGE — 011's `M-04` records 001's schema USAGE as load-bearing for
-- the caller-context RLS helpers and says in as many words that 011 does not
-- revoke it. Schema USAGE on its own conveys no access to any object: `anon` holds
-- SELECT on no table in `app` and EXECUTE on no function in `app`, which T4 of
-- this pack's own pin measures by impersonation rather than inferring. Revoking
-- the schema as well would be a second, weaker guard that breaks a pinned
-- invariant to restate something already true.
--
-- ⚠ `core` IS DIFFERENT, AND NOT FOR THE REASON AN EARLIER DRAFT OF THIS COMMENT
-- GAVE. That draft said `anon` never had USAGE on `core` to begin with, so the
-- line below was "a statement of the end state rather than a change". Measured on
-- a 001-013 database: `core`'s nspacl is
--   postgres=UC/postgres anon=U/postgres authenticated=U/postgres service_role=U/postgres
-- because 001:232 grants USAGE on `core` to all three API roles in one statement.
-- So this line IS a change, and it is the only privilege 014 takes away from a
-- role rather than giving.
--
-- It is kept, deliberately: `anon` holds SELECT on no table in `core` and EXECUTE
-- on no function in `core`, 014 creates no public-token allowlist, and schema
-- USAGE with no object privilege underneath it is a door into an empty room that
-- the next person to write `GRANT SELECT ON ALL TABLES IN SCHEMA core` turns into
-- a door into every room. `app` is NOT treated the same way, because 011's M-04
-- records 001's USAGE there as load-bearing for the caller-context RLS helpers
-- and test_011 T13b pins it; `core` has no such consumer.
--
-- Because it is a change to 001's state, THE ROLLBACK RESTORES IT. That is the
-- same rule that governs 002's table grants: a rollback returns the database to
-- what the previous migration left, including the parts this migration narrowed.
REVOKE USAGE ON SCHEMA core FROM anon;

-- SELECT, and only SELECT, on every core table. See the header: the write path is
-- the envelope, and there is no privilege here that could become a second one.
DO $grants$
DECLARE
  r       pg_catalog.record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    EXECUTE pg_catalog.format('GRANT SELECT ON TABLE core.%I TO authenticated', r.relname);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '014: SELECT granted to authenticated on % core tables', v_count;
END;
$grants$;

-- The four security-invoker views that ARE granted. Each re-runs the underlying
-- tables' policies as the caller, so tenant isolation is inherited rather than
-- re-implemented — which is exactly why the security_invoker flag is re-asserted
-- here rather than assumed. Postgres creates a view SECURITY DEFINER by default;
-- a view that lost the flag in a later edit would bypass every policy above it
-- and look identical in `\dv`.
DO $views$
DECLARE
  r pg_catalog.record;
BEGIN
  FOR r IN
    SELECT c.relname, c.reloptions
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relkind = 'v'
     ORDER BY c.relname
  LOOP
    IF NOT ('security_invoker=true' = ANY (COALESCE(r.reloptions, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION
        '014: core.%s is not security_invoker=true. Postgres defaults a view to '
        'SECURITY DEFINER, which would read every underlying table as the view''s '
        'owner and bypass every policy §2 just created.', r.relname;
    END IF;
  END LOOP;
END;
$views$;

-- ============================================================================
-- §4b · The tables where tenant membership is NOT sufficient authorization
-- ============================================================================
-- THE DEFECT THIS CLOSES. §2 gives every tenant-scoped `core` table the same
-- pair of policies, whose only term is the tenant. §4 then grants SELECT on all
-- of them. Composed, that says: any authenticated principal of a tenant may read
-- every row of every table of that tenant. For 111 of the 114 tables that is the
-- product — a SALES consultant is meant to see the tenant's enquiries.
--
-- For three of them it is a leak, because 002 already decided otherwise and
-- wrote the decision down as a permission that only some roles hold:
--
--   core.ai_provider_keys      `ai:provider:read`     ADMIN only        (002:1135)
--   core.runs, run_nodes,      `run:read`             MD and ADMIN      (002:1116,1212)
--     run_node_io, run_events,
--     run_state_cards,
--     run_checkpoints,
--     run_snapshots
--   core.public_share_tokens   `portal:token:issue`   SALES, SALES_MANAGER,
--                                                     MD, ADMIN         (002:861,919,1102,1196)
--
-- Concretely, before this block: a SALES principal — the lowest-privileged human
-- role in a tenant — could read every provider key row in the tenant (masked key
-- prefix, 32-byte fingerprint, key_ref, provider, region, billing owner), and
-- every run's raw `prompt` and `completion` text, which 013's own retention
-- machinery treats as PII-bearing enough to redact and sweep at 30 days. Neither
-- is a tenant-isolation failure; both are an authorization failure INSIDE a
-- tenant, which is a different question that the tenant predicate cannot answer.
--
-- WHY THESE NINE. Each is governed by a permission 002 already wrote, and the
-- set is now the FULL extent of those permissions rather than the tables a
-- review happened to name. An earlier version of this block gated three, and
-- justified the other six of `run:read`'s seven with "the review did not name
-- them" — which is a provenance argument wearing the clothes of a security one,
-- and is precisely the rationalised gap this pack exists to close. `run:read`
-- governs seven tables in 013; all seven are here.
--
-- WHAT IS STILL NOT GATED, and honestly. Every other `core` table keeps the
-- blanket tenant-scoped SELECT. That is NOT a considered posture table by table:
-- it is the state 014 found, narrowed where 002 had already written a permission
-- that says otherwise, and left alone everywhere else because within-tenant read
-- authorization for the rest has not been designed. Doc 09 puts it at the RPC
-- layer. Until that exists, any principal of a tenant can read any other row of
-- it, and the catalog records that as a GAP with an owner rather than as a
-- decision somebody made.
--
-- WHY RESTRICTIVE AND FOR ALL. RESTRICTIVE so it ANDs with the permissive SELECT
-- policy §2 created and with any permissive policy a later migration adds — a
-- second permissive policy would OR the gate away, and the day somebody adds one
-- is the day this has to still hold. FOR ALL rather than FOR SELECT for the same
-- reason §2's isolation policy is FOR ALL: no client role holds a write privilege
-- on `core` today, so the write half decides nothing now and is already correct
-- on the day that changes.
--
-- WHERE THE GATE IS ACTUALLY APPLIED, AND WHY NOT HERE. The three permissions are
-- carried by the LEFT JOIN in §2's loop, so a gated table is created gated on the
-- first pass. This block only CHECKS. An earlier version re-applied the three
-- tables here with a second call, which meant the same table was created ungated
-- and then gated a moment later — a window inside one transaction, invisible, and
-- the kind of thing that stops being invisible the first time somebody runs half
-- a migration by hand. `app.apply_tenant_policies` now refuses a two-argument
-- call against a table that already carries a gate, which also made that second
-- pass impossible: the refusal is the point, because that two-argument spelling
-- is exactly how a future migration would strip one of these by accident.
--
-- WHY `app.has_permission` AND NOT A ROLE LIST. It is SECURITY DEFINER over
-- app.role_permissions (002), which `authenticated` cannot read directly, and it
-- is already granted EXECUTE to `authenticated` (002:637) — so it is runnable
-- inside a policy predicate, which is evaluated AS THE QUERYING ROLE. A hardcoded
-- role list here would be a second copy of 002's permission catalogue that
-- nothing keeps in step with the first. The `(SELECT ...)` wrapper is the InitPlan
-- form the rest of this file uses: one evaluation per statement, not per row.
DO $role_gates$
DECLARE
  r      pg_catalog.record;
  v_qual text;
BEGIN
  FOR r IN
    SELECT relname, perm FROM (VALUES
      ('ai_provider_keys',    'ai:provider:read'),
      ('runs',                'run:read'),
      ('run_nodes',           'run:read'),
      ('run_node_io',         'run:read'),
      ('run_events',          'run:read'),
      ('run_state_cards',     'run:read'),
      ('run_checkpoints',     'run:read'),
      ('run_snapshots',       'run:read'),
      ('public_share_tokens', 'portal:token:issue')
    ) AS t(relname, perm)
  LOOP
    SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid) INTO v_qual
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = r.relname
       AND p.polname = r.relname || '_tenant_isolation';

    IF v_qual IS NULL OR pg_catalog.strpos(v_qual, r.perm) = 0 THEN
      RAISE EXCEPTION
        '014 §4b: core.% did not come out of §2''s loop carrying its % gate. The '
        'gated set is the LEFT JOIN in §2 and this block only checks it; if the '
        'table was renamed or dropped from that list, §4 is about to grant SELECT '
        'on it to every principal of the tenant. Predicate: %',
        r.relname, r.perm, COALESCE(v_qual, 'NO POLICY');
    END IF;
  END LOOP;
  RAISE NOTICE '014: 3 sensitive core tables carry a permission term in their isolation policy';
END;
$role_gates$;

GRANT SELECT ON core.audit_entries             TO authenticated;
GRANT SELECT ON core.v_contact_consent_current TO authenticated;

-- ⚠ `core.budget_status` AND `core.model_tier_status` ARE NOT GRANTED, AND THE
-- REASON IS A DEFECT IN 013 THAT ONLY A GRANT COULD EXPOSE.
--
-- An earlier draft of this file granted both, as the AI-ops screens obviously
-- need them. test_013's amended T11b2 then failed: `authenticated` still could
-- not read either one. The grant was not missing — it was useless.
--
--   `core.budget_status` is `security_invoker=true` and reads `app.usage_rollup`.
--   A security-invoker view runs its body AS THE CALLER, so reading it requires
--   the caller to hold SELECT on every base relation underneath it. `app` is
--   deliberately neither exposed to PostgREST nor granted to any client role —
--   test_012 T11c and test_013 T11e both assert that, and 013's whole H-09 answer
--   rests on it. So the view is unreadable by a client no matter what is granted
--   ON THE VIEW, and `core.model_tier_status` inherits the problem because it
--   reads `budget_status`.
--
-- The two ways out are both real changes and neither belongs in a grants
-- migration: move the rollup into `core` so the invoker path can reach it, or
-- read both views from a `SECURITY DEFINER` RPC in `core` the way doc 09 does for
-- `v_approval_requests`. Doc 09 already implies the second — the usage screen is
-- an RPC in its spec list, not a table read — so 018 is where this lands.
--
-- Granting them anyway would leave two grants that look like access and deliver a
-- permission error, which is worse than no grant at all: the screen fails the
-- same way either way, and the grant makes the cause invisible. Registered as a
-- carried defect in the catalog rather than papered over here.
REVOKE ALL ON core.budget_status     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON core.model_tier_status FROM PUBLIC, anon, authenticated;

-- `core.v_approval_requests` stays revoked. Doc 09 §12: "Do not grant the view to
-- `authenticated` to shortcut" the approval RPCs. Re-stated as a REVOKE rather
-- than an omission so that a later `GRANT SELECT ON ALL TABLES IN SCHEMA core`
-- has something to undo and the verify block has something to check.
REVOKE ALL ON TABLE core.v_approval_requests FROM PUBLIC, anon, authenticated;

-- ── public.* : 002's twelve authenticated policies enter service ──────────────────────────
-- Identity and tenancy. Without these grants the shell cannot render its own
-- user, and 002's policies stay the dead code the header measured them to be.
-- The write grants are real here, unlike in `core`, because 002's own
-- `_write_admin` policies are ADMIN-gated AND aal2-gated inside the predicate —
-- the envelope does not own team membership, 002 does.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;

-- ⚠ THESE SIX LINES RESTATE 002:696-701 EXACTLY, PRIVILEGE FOR PRIVILEGE.
-- They are written out rather than omitted so that the pre-014 baseline is
-- readable in one place and so that a later edit that widens one of them is a
-- visible diff against a stated intent rather than an invisible drift. If you
-- are about to add a privilege to any line below, it is a change to 002's
-- authorization model and belongs in a migration that says so in its header.
--
-- THE ONE THAT WAS WIDENED, AND WHY IT IS NOT ANY MORE. An earlier draft of this
-- file granted DELETE on `public.memberships`, on the mistaken reading that it
-- was restating 002. It was not: 002 grants SELECT, INSERT and UPDATE there and
-- withholds DELETE deliberately, and the DELETE would have been a privilege
-- escalation with a clean audit trail, by this route:
--
--   `memberships_write_admin` (002:750) is `FOR ALL`, so its USING clause — tenant
--   match AND role = 'ADMIN', with NO aal2 term — already permits a DELETE.
--   `memberships_no_self_edit` (002:764), the RESTRICTIVE policy 002's own comment
--   calls "THE escalation stop", is `FOR UPDATE` ONLY. It never sees a DELETE.
--   So an ADMIN holding the DELETE privilege could delete their own membership row
--   and INSERT a replacement naming a higher role: `app.role()` reads the JWT, not
--   the table, so they are still an ADMIN for the length of the transaction that
--   removes the evidence, and the next token mint reads the row they wrote.
--   It also destroys the soft-delete audit trail 002:768 requires — removal is
--   `status = 'REMOVED'`, an UPDATE, which is the path the restrictive policy
--   guards and the reason no DELETE privilege is needed to remove a member.
--
-- The privilege is withheld AND a restrictive DELETE policy is added below, so
-- the grant layer and the policy layer agree instead of one of them being the
-- only thing standing between an ADMIN and their own role.
GRANT SELECT                         ON public.tenants       TO authenticated;
GRANT UPDATE                         ON public.tenants       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members  TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.memberships   TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.user_profiles TO authenticated;

-- Stated as a REVOKE as well as an omission. A REVOKE of a privilege that was
-- never granted is a no-op — this file's own header says so about 011's fifteen
-- vacuous column revokes — so this line is not the guard. The guard is the
-- policy below and the verify block's assertion. The line is here so that a
-- future `GRANT ALL ON ALL TABLES IN SCHEMA public` has something to undo.
REVOKE DELETE ON public.memberships FROM authenticated;

-- THE SECOND LAYER. 002 wrote no DELETE policy for memberships and recorded that
-- as the reason removal is a soft delete; but `memberships_write_admin` is
-- `FOR ALL`, so the absence of a DELETE policy is not a refusal — it is a
-- permission waiting for a privilege. This RESTRICTIVE policy makes it a refusal.
-- USING (false) rather than a predicate: there is no membership row any client
-- role may hard-delete, including somebody else's, because the audit trail is the
-- point and a row deleted by an ADMIN is as gone as a row deleted by its owner.
DROP POLICY IF EXISTS memberships_no_client_delete ON public.memberships;
CREATE POLICY memberships_no_client_delete ON public.memberships
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);
COMMENT ON POLICY memberships_no_client_delete ON public.memberships IS
  'migration:014 — no client role hard-deletes a membership. 002''s '
  'memberships_no_self_edit is FOR UPDATE only, so without this a DELETE grant '
  'would let an ADMIN delete-and-reinsert their own row past the escalation stop. '
  'Removal is status = ''REMOVED'', an UPDATE, which that policy does guard.';

-- `user_profiles` gets no DELETE: 002 wrote no DELETE policy for it, and under
-- FORCE that is already a refusal. The grant is withheld anyway so the two layers
-- agree — a privilege that only fails at the policy layer is a privilege somebody
-- will eventually make work by adding a policy.

-- ============================================================================
-- §5 · The three `core` wrappers over the 011 envelope
-- ============================================================================
-- Posture from doc 09 §0, verbatim and for its stated reasons: `core` not `app`
-- (config.toml exposes core; app is deliberately absent), SECURITY DEFINER
-- (the body calls app functions the caller does not hold EXECUTE on),
-- `SET search_path = ''` in the ONE spelling test_001 T3 asserts, every return
-- through `app.ok`, and the tenant resolved inside 011 rather than passed in.
--
-- `SET statement_timeout = '10s'` is doc 09 §0's fourth line. It is a function
-- setting rather than a role setting so that it survives PgBouncer handing the
-- session to somebody else.

CREATE OR REPLACE FUNCTION core.perform_action(
  p_type            text,
  p_target_ref      text    DEFAULT NULL,
  p_payload         jsonb   DEFAULT '{}'::jsonb,
  p_requested_by    jsonb   DEFAULT NULL,
  p_confidence      numeric DEFAULT NULL,
  p_reasoning       text    DEFAULT NULL,
  p_evidence        jsonb   DEFAULT '[]'::jsonb,
  p_idempotency_key text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  SELECT app.ok(app.perform_action(
    p_type, p_target_ref, p_payload, p_requested_by,
    p_confidence, p_reasoning, p_evidence, p_idempotency_key));
$fn$;

-- ⚠ AND THE HASH IS REQUIRED ON APPROVE, WHICH IS WHY THIS ONE IS plpgsql.
--
-- 011:2781-2787 compares `p_expected_diff_hash` only when it is non-NULL, so an
-- APPROVE that omits it silently skips the optimistic-concurrency check. That is
-- not hypothetical: `decideApproval` omitted the argument entirely until PR #17
-- (`e20e1ba` on main) added it, and for that whole period the guard the header
-- calls "protected" decided nothing on every real call. It is the 037 shape — a
-- client omission defeating a server-side guard, invisible until it isn't.
--
-- The contract now makes it mandatory: `ApprovalDecideRequest.diffHash` is
-- `string`, not `string | undefined`, with the comment "Required, not optional:
-- the only caller always has one, having just read it off the same approval it is
-- now deciding." So the database can require it too.
--
-- ⚠ AN EARLIER VERSION OF THIS COMMENT ADDED "and a guard that both sides enforce
-- cannot be re-disabled by one of them changing." That was false when it was
-- written. `core.bulk_decide_approvals`, twenty lines below, is granted to the
-- same role, took no hash at all, and forwarded every item with the hash
-- hardcoded NULL — so the bulk path bypassed this refusal entirely while this one
-- looked airtight. A guard is only as good as the narrowest door into the same
-- room, and there were two doors. Both are shut now; the claim is not restated,
-- because the next sibling wrapper would falsify it again.
--
-- ONLY ON APPROVE, deliberately: REJECT and REQUEST_CHANGES do not apply the
-- diff, and 011 does not compare the hash for them either. Refusing them for a
-- missing hash would be a new rule wearing this one's clothes.
--
-- LANGUAGE plpgsql rather than sql purely because a SQL function cannot RAISE.
-- The body is still `app.ok(app.decide_approval(...))` and nothing else, which is
-- what T10b reads.
CREATE OR REPLACE FUNCTION core.decide_approval(
  p_approval_id        uuid,
  p_decision           text,
  p_note               text DEFAULT NULL,
  p_expected_diff_hash text DEFAULT NULL,
  p_idempotency_key    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
BEGIN
  IF p_decision = 'APPROVE'
     AND NULLIF(pg_catalog.btrim(COALESCE(p_expected_diff_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'an APPROVE must carry the diff hash the approver was shown'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED',
              'fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','diffHash','reason','REQUIRED')))::text;
  END IF;

  RETURN app.ok(app.decide_approval(
    p_approval_id, p_decision, p_note, p_expected_diff_hash, p_idempotency_key));
END;
$fn$;

-- All five arguments, in order. Doc 09 §12: "Assert `core.decide_approval` passes
-- all five arguments to `app.decide_approval` — a wrapper that drops the hash
-- argument silently disables" the optimistic-concurrency check, and the caller
-- cannot tell, because the decision still succeeds. T5 asserts the arity.

-- ⚠ `p_items jsonb`, NOT `p_ids uuid[]`, AND THE OLD SIGNATURE IS DROPPED.
--
-- THE HOLE THIS CLOSES. `core.decide_approval` refuses an APPROVE with no diff
-- hash, and the commit that added that refusal claimed a guard both sides enforce
-- "cannot be re-disabled by one of them changing". That was wrong, and this
-- function is why: it is granted to `authenticated` exactly like its sibling, it
-- took no hash at all, and `app.bulk_decide` forwarded every item with the hash
-- HARDCODED NULL. 011 compares the hash only when it is non-NULL, so bulk APPROVE
-- skipped the optimistic-concurrency check completely. One door locked and the
-- door beside it wedged open — and the bulk door is the one an approver uses to
-- clear an inbox quickly, which is exactly when they are not re-reading diffs.
--
-- A hash per approval cannot travel in an array of ids, so the argument is an
-- array of objects. `CREATE OR REPLACE` matches on the argument list, so the old
-- spelling is dropped rather than left beside this one: two overloads differing
-- in their first argument type would make a four-argument call from PostgREST
-- resolve by whatever it could coerce, silently.
DROP FUNCTION IF EXISTS core.bulk_decide_approvals(jsonb, text, text, text);

CREATE OR REPLACE FUNCTION core.bulk_decide_approvals(
  p_items           jsonb,
  p_decision        text,
  p_note            text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  SELECT app.ok(app.bulk_decide(p_items, p_decision, p_note, p_idempotency_key));
$fn$;

REVOKE ALL ON FUNCTION core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.decide_approval(uuid,text,text,text,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.bulk_decide_approvals(jsonb,text,text,text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION core.decide_approval(uuid,text,text,text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION core.bulk_decide_approvals(jsonb,text,text,text)
  TO authenticated;

COMMENT ON FUNCTION core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text) IS
  'The single write path into TrainOS. Wraps app.perform_action (011) in app.ok and '
  'nothing else: no re-validation, no second tenant check, no reclassification of '
  'QUEUED_FOR_APPROVAL, which is a 202 and a success. SECURITY DEFINER buys EXECUTE '
  'on the app function and widens no identity. Doc 09 §2. 014.';

COMMENT ON FUNCTION core.decide_approval(uuid,text,text,text,text) IS
  'Wraps app.decide_approval (011), passing all five arguments including '
  'p_expected_diff_hash — dropping it silently disables the optimistic-concurrency '
  'check with no visible symptom. REFUSES an APPROVE that carries no hash, because '
  '011 compares it only when non-NULL and the client omitted it entirely until '
  'PR #17; the contract now types diffHash as required, so both sides enforce it '
  'and neither can re-disable it alone. Doc 09 §12. 014.';

COMMENT ON FUNCTION core.bulk_decide_approvals(jsonb,text,text,text) IS
  'Wraps app.bulk_decide (011). Named for its consumer: rpcClient.ts:533 calls '
  '"bulk_decide_approvals" and doc 09 §1 specifies that spelling. 014.';

-- The underlying app functions keep their 011 grants EXACTLY. Doc 09 §1: "All
-- three are granted to `service_role` only (011:3408-3415). The wrapper is what
-- makes them reachable; the underlying grant must not change." §6's check (7) re-derives that
-- rather than trusting this comment.

-- ============================================================================
-- §6 · Verify — re-derived from the catalogue, never from this file's intent
-- ============================================================================
-- Every check below reads pg_catalog or information_schema. None of them asserts
-- that a statement above "ran"; they assert the END STATE, which is the only
-- thing a later edit cannot quietly diverge from.

DO $verify$
DECLARE
  v_missing    text;
  v_n          integer;
  v_conf       text[];
BEGIN
  -- (1) Every core table with a tenant_id carries BOTH policies.
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                    AND a.attnum > 0 AND NOT a.attisdropped)
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy p
           WHERE p.polrelid = c.oid
             AND p.polname IN (c.relname || '_tenant_select', c.relname || '_tenant_isolation')) <> 2;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '014 verify: core table(s) missing a tenant policy pair: %', v_missing;
  END IF;

  -- (2) NO client role holds INSERT, UPDATE or DELETE anywhere in core. This is
  --     the guard the fifteen vacuous column revokes in 011 were reaching for,
  --     stated where it can actually be false. Column-level privileges are
  --     included because a column grant does not appear in relacl.
  SELECT pg_catalog.string_agg(
           pg_catalog.format('%s(%s)', c.relname, w.priv), ', ' ORDER BY c.relname, w.priv)
    INTO v_missing
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN pg_catalog.unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS w(priv)
   WHERE n.nspname = 'core' AND c.relkind IN ('r','v','m','p','f')
     AND (has_table_privilege('authenticated', c.oid, w.priv)
       OR has_table_privilege('anon', c.oid, w.priv));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      '014 verify: a client role holds a WRITE privilege in core, which is a path '
      'around the action envelope: %', v_missing;
  END IF;

  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s.%s.%s(%s)', table_schema, table_name, column_name, privilege_type), ', ')
    INTO v_missing
    FROM information_schema.column_privileges
   WHERE table_schema = 'core'
     AND grantee IN ('authenticated','anon')
     AND privilege_type IN ('INSERT','UPDATE','REFERENCES');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '014 verify: a client role holds a column-level write privilege in core: %', v_missing;
  END IF;

  -- (3) anon holds nothing at all, in any of the three schemas.
  --
  --     ⚠ has_table_privilege, NOT information_schema.table_privileges. That view
  --     lists a privilege under the grantee it was granted TO. A privilege granted
  --     to PUBLIC does not appear there under `anon` or `authenticated` even
  --     though both inherit it, so a future `GRANT SELECT ON core.enquiries TO
  --     PUBLIC` would leave this check — and the pin's matching one — reporting a
  --     clean posture while every unauthenticated request read the table.
  --     has_table_privilege resolves role inheritance and PUBLIC, which is the
  --     question actually being asked: can this role do this, by ANY route.
  --     Today's revokes make both spellings agree; the point is the day they stop.
  SELECT pg_catalog.string_agg(
           pg_catalog.format('%s.%s', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO v_missing
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('core','app','public') AND c.relkind IN ('r','v','m','p','f')
     AND has_table_privilege('anon', c.oid,
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '014 verify: anon holds a table privilege, and 014 creates no public-token allowlist: %', v_missing;
  END IF;

  -- (4) authenticated holds nothing in `app`. The schema is unexposed AND
  --     unprivileged; either alone would be one edit from being neither.
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relkind IN ('r','v','m','p','f')
     AND has_table_privilege('authenticated', c.oid,
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '014 verify: a client role holds a privilege on an app table: %', v_missing;
  END IF;

  -- (5) The three views that must stay ungranted, each for its own reason:
  --     v_approval_requests   doc 09 §12 forbids the grant outright.
  --     budget_status         security_invoker over app.usage_rollup, so a grant
  --     model_tier_status     cannot work; see the note at the GRANT block.
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core'
     AND c.relname IN ('v_approval_requests','budget_status','model_tier_status')
     AND (has_table_privilege('authenticated', c.oid, 'SELECT')
       OR has_table_privilege('anon', c.oid, 'SELECT'));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      '014 verify: view(s) %s are granted to a client role. v_approval_requests is '
      'forbidden by doc 09 §12; budget_status and model_tier_status are '
      'security_invoker over app.usage_rollup and a grant on them delivers a '
      'permission error rather than a row.', v_missing;
  END IF;

  -- (6) The three wrappers exist, are SECURITY DEFINER, and carry the EXACT
  --     stored search_path string. Never `proconfig IS NOT NULL`: that passes the
  --     broken quoted-list spelling too (supabase/CLAUDE.md rule 1).
  FOR v_missing IN
    SELECT x FROM pg_catalog.unnest(ARRAY[
      'core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)',
      'core.decide_approval(uuid,text,text,text,text)',
      'core.bulk_decide_approvals(jsonb,text,text,text)']) AS t(x)
  LOOP
    IF pg_catalog.to_regprocedure(v_missing) IS NULL THEN
      RAISE EXCEPTION '014 verify: wrapper % was not created', v_missing;
    END IF;
    SELECT p.proconfig INTO v_conf
      FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_missing);
    IF NOT ('search_path=""' = ANY (COALESCE(v_conf, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION
        '014 verify: % does not carry the exact stored string search_path="" '
        '(proconfig = %)', v_missing, COALESCE(v_conf::text,'NULL');
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p
             WHERE p.oid = pg_catalog.to_regprocedure(v_missing)) THEN
      RAISE EXCEPTION '014 verify: % is not SECURITY DEFINER', v_missing;
    END IF;
    IF NOT has_function_privilege('authenticated', pg_catalog.to_regprocedure(v_missing), 'EXECUTE') THEN
      RAISE EXCEPTION '014 verify: authenticated cannot EXECUTE %', v_missing;
    END IF;
    IF has_function_privilege('anon', pg_catalog.to_regprocedure(v_missing), 'EXECUTE') THEN
      RAISE EXCEPTION '014 verify: anon can EXECUTE %', v_missing;
    END IF;
  END LOOP;

  -- (7) The underlying 011 functions are STILL not reachable by a client.
  --     Doc 09 §1: "the underlying grant must not change."
  FOR v_missing IN
    SELECT x FROM pg_catalog.unnest(ARRAY[
      'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)',
      'app.decide_approval(uuid,text,text,text,text)',
      'app.bulk_decide(jsonb,text,text,text)']) AS t(x)
  LOOP
    IF has_function_privilege('authenticated', pg_catalog.to_regprocedure(v_missing), 'EXECUTE')
       OR has_function_privilege('anon', pg_catalog.to_regprocedure(v_missing), 'EXECUTE') THEN
      RAISE EXCEPTION
        '014 verify: % became reachable by a client role. The wrapper exists so '
        'that it does not have to be.', v_missing;
    END IF;
  END LOOP;

  -- (8) The UPDATE-without-SELECT sweep. An UPDATE policy with no matching SELECT
  --     policy on the same table does not error — the UPDATE finds no row to
  --     update and reports success on zero rows, which is the silent-misbehaviour
  --     case the Supabase RLS performance guide names. Swept across all three
  --     schemas, because 002's tables are the ones that have UPDATE policies.
  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s.%s', n.nspname, c.relname), ', ')
    INTO v_missing
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('core','app','public')
     AND p.polcmd = 'w'                      -- FOR UPDATE
     AND p.polpermissive                     -- a restrictive one is not a grant
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy q
        WHERE q.polrelid = p.polrelid AND q.polpermissive
          AND q.polcmd IN ('r','*'));        -- FOR SELECT, or FOR ALL
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      '014 verify: table(s) with a permissive UPDATE policy and no permissive '
      'SELECT or ALL policy. The UPDATE will match zero rows and report success: %',
      v_missing;
  END IF;

  -- (9) Every policy this pack created is scoped TO authenticated, not TO PUBLIC.
  --     A policy TO PUBLIC is evaluated for anon as well, which is both a
  --     performance cliff (170ms -> <0.1ms in Supabase's own measurement) and a
  --     correctness hazard the moment anon holds any grant.
  SELECT pg_catalog.string_agg(pg_catalog.format('%s.%s', c.relname, p.polname), ', ')
    INTO v_missing
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core'
     AND (p.polname LIKE '%\_tenant\_select' OR p.polname LIKE '%\_tenant\_isolation')
     AND NOT (SELECT 'authenticated'::regrole::oid = ANY (p.polroles));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '014 verify: policy/policies not scoped TO authenticated: %', v_missing;
  END IF;

  -- (10) Every policy column is indexed. Supabase's guide measures 171ms -> <0.1ms
  --      for exactly this, and finalise_table already creates a tenant index on
  --      every table it touches — so this is a regression check on 004, not a
  --      hope about 014.
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname='tenant_id'
                    AND a.attnum > 0 AND NOT a.attisdropped)
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indrelid = c.oid
          AND (SELECT a.attnum FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'tenant_id') = i.indkey[0]);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      '014 verify: core table(s) whose tenant_id is not the leading column of any '
      'index, so every policy evaluation is a sequential scan: %', v_missing;
  END IF;

  -- (11) THE `public.*` GRANT SET IS EXACTLY 002's, PRIVILEGE FOR PRIVILEGE.
  --      Re-derived with has_table_privilege rather than read out of
  --      information_schema.table_privileges, because that view lists privileges
  --      by their named grantee and does NOT report a privilege held through
  --      membership of PUBLIC. A future `GRANT DELETE ON public.memberships TO
  --      PUBLIC` would leave every information_schema check in this file and its
  --      pin green while `authenticated` could delete. has_table_privilege
  --      resolves inheritance and PUBLIC, so it answers the question actually
  --      being asked: can this role do this, by any route.
  FOR v_missing IN
    SELECT x FROM pg_catalog.unnest(ARRAY[
      -- relation                 privileges authenticated MUST hold (002:696-701)
      'tenants:SELECT,UPDATE',
      'teams:SELECT,INSERT,UPDATE,DELETE',
      'team_members:SELECT,INSERT,UPDATE,DELETE',
      'memberships:SELECT,INSERT,UPDATE',
      'user_profiles:SELECT,INSERT,UPDATE']) AS t(x)
  LOOP
    DECLARE
      v_rel  text := pg_catalog.split_part(v_missing, ':', 1);
      v_want text[] := pg_catalog.string_to_array(pg_catalog.split_part(v_missing, ':', 2), ',');
      v_priv text;
    BEGIN
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege('authenticated', 'public.' || v_rel, v_priv) <> (v_priv = ANY (v_want)) THEN
          RAISE EXCEPTION
            '014 verify: authenticated %s %s on public.%s, and 002 says the '
            'opposite. 014 restates 002''s grant set and must not widen it — a '
            'DELETE on memberships in particular is a role-escalation path, '
            'because 002''s escalation stop is FOR UPDATE only.',
            CASE WHEN v_priv = ANY (v_want) THEN 'LACKS' ELSE 'HOLDS' END, v_priv, v_rel;
        END IF;
      END LOOP;
    END;
  END LOOP;

  -- (12) And the policy layer agrees with the grant layer on the one that matters.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'memberships'
       AND p.polname = 'memberships_no_client_delete'
       AND NOT p.polpermissive AND p.polcmd = 'd')
  THEN
    RAISE EXCEPTION
      '014 verify: memberships_no_client_delete is missing or is not a RESTRICTIVE '
      'DELETE policy. Without it the only thing refusing a membership hard-delete '
      'is the absent privilege, and 002''s memberships_write_admin is FOR ALL.';
  END IF;

  -- (13) The three role gates are in place, each inside its table's RESTRICTIVE
  --      isolation policy, each naming a permission that at least one role holds
  --      and at least one role does not. A gate no role satisfies is a broken
  --      screen that reads as security; a gate every role satisfies is decoration.
  --      Read off pg_policy, never off the DDL text above.
  FOR v_missing IN
    SELECT x FROM pg_catalog.unnest(ARRAY[
      'ai_provider_keys:ai:provider:read',
      'runs:run:read',
      'run_nodes:run:read',
      'run_node_io:run:read',
      'run_events:run:read',
      'run_state_cards:run:read',
      'run_checkpoints:run:read',
      'run_snapshots:run:read',
      'public_share_tokens:portal:token:issue']) AS t(x)
  LOOP
    DECLARE
      v_rel   text := pg_catalog.split_part(v_missing, ':', 1);
      v_perm  text := pg_catalog.substr(v_missing, pg_catalog.strpos(v_missing, ':') + 1);
      v_qual  text;
      v_check text;
      v_have  integer;
      v_all   integer;
    BEGIN
      SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid),
             pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
        INTO v_qual, v_check
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'core' AND c.relname = v_rel
         AND p.polname = v_rel || '_tenant_isolation'
         AND NOT p.polpermissive
         AND p.polcmd = '*';
      IF v_qual IS NULL THEN
        RAISE EXCEPTION
          '014 verify: core.%s has no RESTRICTIVE FOR ALL isolation policy to '
          'carry its role gate.', v_rel;
      END IF;
      IF pg_catalog.strpos(v_qual, v_perm) = 0 THEN
        RAISE EXCEPTION
          '014 verify: core.%s''s isolation policy does not consult %s on the read '
          'side, so §4''s blanket SELECT grant lets every role in the tenant read '
          'it and 002 says only the holders of that permission may. Predicate: %s',
          v_rel, v_perm, v_qual;
      END IF;
      IF pg_catalog.strpos(COALESCE(v_check,''), v_perm) = 0 THEN
        RAISE EXCEPTION
          '014 verify: core.%s''s isolation policy gates reads on %s but not '
          'writes. The write half decides nothing today and must already be right '
          'on the day it does. WITH CHECK: %s', v_rel, v_perm, COALESCE(v_check,'NULL');
      END IF;

      SELECT pg_catalog.count(*) INTO v_have
        FROM app.role_permissions rp WHERE rp.permission = v_perm;
      SELECT pg_catalog.count(DISTINCT rp.role) INTO v_all FROM app.role_permissions rp;
      IF v_have = 0 THEN
        RAISE EXCEPTION
          '014 verify: %s is held by no role, so core.%s is unreadable by every '
          'client. A gate nobody can satisfy is a broken screen, not security.',
          v_perm, v_rel;
      END IF;
      IF v_have >= v_all THEN
        RAISE EXCEPTION
          '014 verify: %s is held by every role that holds any permission, so the '
          'gate on core.%s narrows nothing.', v_perm, v_rel;
      END IF;
    END;
  END LOOP;

  -- (13b) EXACTLY ONE OVERLOAD of app.apply_tenant_policies. 014 changed its
  --       signature from two arguments to three; `CREATE OR REPLACE` matches on
  --       the argument list, so without the DROP in §1 there would now be two,
  --       and 017's two-argument calls would be ambiguous (PGRST203 in the
  --       PostgREST case, `function is not unique` here).
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'apply_tenant_policies';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      '014 verify: app.apply_tenant_policies has % overloads, not 1. Two of them '
      'differing only by a defaulted trailing argument make every short call '
      'ambiguous, and 017 makes three of those calls.', v_n;
  END IF;

  -- (14) THE MANIFEST IS COMPLETE. Every policy 014 created carries the
  --      `migration:014` stamp its rollback drops by, and the number of stamped
  --      policies matches what the catalogue says this database's inventory
  --      implies. A policy created without a stamp is a policy the rollback will
  --      leave behind, and the rollback's own count check would then fire against
  --      a database it is halfway through changing — which is a worse place to
  --      find out than here.
  SELECT pg_catalog.count(*) * 2 + 2 INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                    AND a.attnum > 0 AND NOT a.attisdropped);
  IF (SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_description d
          ON d.objoid = p.oid
         AND d.classoid = 'pg_catalog.pg_policy'::pg_catalog.regclass
       WHERE d.description LIKE 'migration:014 %') <> v_n THEN
    RAISE EXCEPTION
      '014 verify: the migration:014 policy manifest does not cover what this '
      'migration created. Expected % stamped policies (two per tenant-scoped core '
      'table, plus provenance_subjects_read and memberships_no_client_delete) and '
      'found %. The rollback drops by that stamp, so an unstamped policy is one it '
      'will leave standing.',
      v_n,
      (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_policy p
         JOIN pg_catalog.pg_description d
           ON d.objoid = p.oid
          AND d.classoid = 'pg_catalog.pg_policy'::pg_catalog.regclass
        WHERE d.description LIKE 'migration:014 %');
  END IF;

  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core';
  RAISE NOTICE '014 verify: OK — % policies on core', v_n;
END;
$verify$;

-- PostgREST caches the schema. New functions and new grants are invisible until
-- it reloads, and the symptom is PGRST202 "function not found" against a
-- database where the function plainly exists. Supabase's own docs prescribe this
-- line after DDL; it is a no-op on a cluster with no PostgREST listening, which
-- is why it is safe on the shim.
NOTIFY pgrst, 'reload schema';

COMMIT;
