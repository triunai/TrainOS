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
-- The whole of 001-013 granted no table, view, sequence or function privilege to
-- `anon` or `authenticated`. The catalog records that as the `C-04` residue and
-- says in four places that "policies and grants land together in 014". This is
-- that landing, and the reason they must land together is mechanical rather than
-- tidy-minded:
--
--   A POLICY WITHOUT A GRANT IS DEAD CODE. 002 authored twelve policies naming
--   `authenticated` on `public.tenants`, `teams`, `team_members`, `memberships`
--   and `user_profiles`. Measured on the shim before this migration:
--   `relacl` on every one of those tables is `{postgres=arwdDxtm/postgres}` and
--   nothing else. `authenticated` holds no privilege, so the policies have never
--   once been consulted. They read as security and are inert. 014 grants them
--   into service and the pin proves they now decide something.
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
-- OBJECTS. One function, 235 policies over 115 relations, the client grant layer
-- over 114 `core` tables + 4 `core` views + 5 `public` tables, and three
-- `SECURITY DEFINER` wrappers in `core`. No table, no type, no trigger.
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
-- The other four views (`core.audit_entries`, `budget_status`,
-- `model_tier_status`, `v_contact_consent_current`) ARE granted SELECT. All four
-- are `security_invoker=true`, so each one re-runs the underlying tables' policies
-- as the caller and inherits tenant isolation from them rather than needing its
-- own. That is a property, not a hope, and T4 measures it by reading each view as
-- two different tenants.
--
-- ── WHAT THE THREE WRAPPERS DO AND DO NOT DO ────────────────────────────────
--
-- `app.perform_action`, `app.decide_approval` and `app.bulk_decide` are granted to
-- `service_role` only (011:3408-3415) and `app` is not in PostgREST's exposed
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
  IF pg_catalog.to_regprocedure('app.bulk_decide(uuid[],text,text,text)') IS NULL THEN
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

CREATE OR REPLACE FUNCTION app.apply_tenant_policies(p_schema text, p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_oid        pg_catalog.oid;
  v_notnull    boolean;
  v_pred       text;
  v_select_pol text := p_table || '_tenant_select';
  v_iso_pol    text := p_table || '_tenant_isolation';
BEGIN
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
  IF v_notnull THEN
    v_pred := 'tenant_id = (SELECT app.require_tenant_id())';
  ELSE
    v_pred := '(tenant_id = (SELECT app.require_tenant_id()) OR tenant_id IS NULL)';
  END IF;

  -- Idempotent by DROP-then-CREATE rather than by a pg_policy lookup: a policy
  -- that exists with the WRONG predicate is the failure mode that matters, and a
  -- presence check would leave it standing. 004 hit the ADD CONSTRAINT IF NOT
  -- EXISTS trap; CREATE POLICY has the same gap and this is the way out of it.
  EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON %I.%I', v_select_pol, p_schema, p_table);
  EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON %I.%I', v_iso_pol,    p_schema, p_table);

  EXECUTE pg_catalog.format(
    'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR SELECT TO authenticated USING (%s)',
    v_select_pol, p_schema, p_table, v_pred);

  EXECUTE pg_catalog.format(
    'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated '
    'USING (%s) WITH CHECK (%s)',
    v_iso_pol, p_schema, p_table, v_pred, v_pred);
END;
$fn$;

REVOKE ALL ON FUNCTION app.apply_tenant_policies(text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.apply_tenant_policies(text, text) IS
  'Stamps the standard two-policy tenant posture on a tenant-scoped table: a '
  'PERMISSIVE SELECT policy and a RESTRICTIVE FOR ALL isolation policy, both TO '
  'authenticated, both resolving the tenant through (SELECT app.require_tenant_id()). '
  'The global-row fallback (tenant_id IS NULL) is derived from the column''s NOT NULL '
  'flag, never from a list. Refuses a table with no tenant_id. 014.';

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
-- re-running this loop or caught by §7's sweep, and never quietly half-covered.
--
-- `core.provenance_subjects` is excluded by name and handled in §3.

DO $apply$
DECLARE
  r         pg_catalog.record;
  v_count   integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core'
       AND c.relkind = 'r'
       AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                AND a.attnum > 0 AND NOT a.attisdropped)
     ORDER BY c.relname
  LOOP
    PERFORM app.apply_tenant_policies('core', r.relname);
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
  'Reference data with no tenant dimension: the list of tables that may carry a '
  'provenance row. USING (true) is the whole predicate because there is nothing '
  'to scope by; the guard is that the table holds no tenant data and receives no '
  'write privilege. 014.';

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
--   of being passed through `app.finalise_table`. 009:229-236 re-implements the
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
-- nothing useful. `app` deliberately gets no USAGE for anon and never has —
-- 011's M-04 note records that 001's USAGE on `app` for authenticated is
-- load-bearing for the caller-context RLS helpers, so it is left exactly alone.
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
-- `core` is different only because `anon` never had USAGE on it to begin with;
-- the line below is therefore a statement of the end state rather than a change,
-- and it is kept so the posture is readable in one place.
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

GRANT SELECT                         ON public.tenants       TO authenticated;
GRANT UPDATE                         ON public.tenants       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships   TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.user_profiles TO authenticated;

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

CREATE OR REPLACE FUNCTION core.decide_approval(
  p_approval_id        uuid,
  p_decision           text,
  p_note               text DEFAULT NULL,
  p_expected_diff_hash text DEFAULT NULL,
  p_idempotency_key    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  SELECT app.ok(app.decide_approval(
    p_approval_id, p_decision, p_note, p_expected_diff_hash, p_idempotency_key));
$fn$;

-- All five arguments, in order. Doc 09 §12: "Assert `core.decide_approval` passes
-- all five arguments to `app.decide_approval` — a wrapper that drops the hash
-- argument silently disables" the optimistic-concurrency check, and the caller
-- cannot tell, because the decision still succeeds. T5 asserts the arity.

CREATE OR REPLACE FUNCTION core.bulk_decide_approvals(
  p_ids             uuid[],
  p_decision        text,
  p_note            text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  SELECT app.ok(app.bulk_decide(p_ids, p_decision, p_note, p_idempotency_key));
$fn$;

REVOKE ALL ON FUNCTION core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.decide_approval(uuid,text,text,text,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.bulk_decide_approvals(uuid[],text,text,text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION core.decide_approval(uuid,text,text,text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION core.bulk_decide_approvals(uuid[],text,text,text)
  TO authenticated;

COMMENT ON FUNCTION core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text) IS
  'The single write path into TrainOS. Wraps app.perform_action (011) in app.ok and '
  'nothing else: no re-validation, no second tenant check, no reclassification of '
  'QUEUED_FOR_APPROVAL, which is a 202 and a success. SECURITY DEFINER buys EXECUTE '
  'on the app function and widens no identity. Doc 09 §2. 014.';

COMMENT ON FUNCTION core.decide_approval(uuid,text,text,text,text) IS
  'Wraps app.decide_approval (011), passing all five arguments including '
  'p_expected_diff_hash — dropping it silently disables the optimistic-concurrency '
  'check with no visible symptom. Doc 09 §12. 014.';

COMMENT ON FUNCTION core.bulk_decide_approvals(uuid[],text,text,text) IS
  'Wraps app.bulk_decide (011). Named for its consumer: rpcClient.ts:533 calls '
  '"bulk_decide_approvals" and doc 09 §1 specifies that spelling. 014.';

-- The underlying app functions keep their 011 grants EXACTLY. Doc 09 §1: "All
-- three are granted to `service_role` only (011:3408-3415). The wrapper is what
-- makes them reachable; the underlying grant must not change." §7 re-derives that
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
  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s.%s(%s)', table_schema, table_name, privilege_type), ', ')
    INTO v_missing
    FROM information_schema.table_privileges
   WHERE table_schema = 'core'
     AND grantee IN ('authenticated','anon')
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
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
  SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s.%s', table_schema, table_name), ', ')
    INTO v_missing
    FROM information_schema.table_privileges
   WHERE table_schema IN ('core','app','public') AND grantee = 'anon';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '014 verify: anon holds a table privilege, and 014 creates no public-token allowlist: %', v_missing;
  END IF;

  -- (4) authenticated holds nothing in `app`. The schema is unexposed AND
  --     unprivileged; either alone would be one edit from being neither.
  SELECT pg_catalog.string_agg(DISTINCT table_name, ', ') INTO v_missing
    FROM information_schema.table_privileges
   WHERE table_schema = 'app' AND grantee IN ('authenticated','anon');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '014 verify: a client role holds a privilege on an app table: %', v_missing;
  END IF;

  -- (5) The three views that must stay ungranted, each for its own reason:
  --     v_approval_requests   doc 09 §12 forbids the grant outright.
  --     budget_status         security_invoker over app.usage_rollup, so a grant
  --     model_tier_status     cannot work; see the note at the GRANT block.
  SELECT pg_catalog.string_agg(DISTINCT table_name, ', ') INTO v_missing
    FROM information_schema.table_privileges
   WHERE table_schema='core'
     AND table_name IN ('v_approval_requests','budget_status','model_tier_status')
     AND grantee IN ('authenticated','anon');
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
      'core.bulk_decide_approvals(uuid[],text,text,text)']) AS t(x)
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
      'app.bulk_decide(uuid[],text,text,text)']) AS t(x)
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
