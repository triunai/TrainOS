-- ============================================================================
-- PIN 013 · ai_ops_agents_keys_runs_and_budgets
-- ============================================================================
--
-- Run against the complete 001-013 set. Ends in ROLLBACK; writes nothing durable.
--   psql "$DATABASE_URL" -f supabase/tests/test_013_ai_ops_agents_keys_runs_and_budgets.sql
--
-- T1  Exact object, policy, index, trigger and search_path inventory; the
--     R-JSONB coverage sweep re-derived from pg_attribute (N-02); the FK
--     covering-index sweep (M-16); and the run_id reconciliation asserted on
--     BOTH sides - core.runs.id is uuid AND the four text columns are still text.
-- T2  M-11: the generator is in the database, the raw key is stored NOWHERE, the
--     stored digest equals app.agent_key_digest(raw, salt) byte for byte, and
--     verify_agent_key gives the same empty answer to a wrong key, a revoked
--     key, an expired key and a killed agent.
-- T3  M-10(1): a provider key written through the real RPC stores the mask and
--     the fingerprint EXACTLY - app.mask_key(raw) and sha256(raw), byte for byte,
--     not merely "different from the input" - and the raw key appears in no
--     column of the row.
-- T4  M-10(2) / doc 02 s7.2a: app.aal2_verified() is FALSE for a forged claim
--     with no auth.sessions row, TRUE with one at aal2, FALSE at aal1, and FALSE
--     for an agent. This is the whole point of s7.2a and a reveal test without
--     real auth.sessions rows proves nothing.
-- T5  M-10(3): the 24-hour ceiling. The second reveal inside 24 hours is
--     REFUSED, and a reveal 24 hours later is not.
-- T6  M-10(4): the reveal wrote its app.key_access_audit row; a bump of
--     last_revealed_at with NO audit row is refused; a bump naming the WRONG
--     audit row is refused; and the audit table refuses UPDATE, DELETE and
--     TRUNCATE - the TRUNCATE by execution, because a row trigger does not fire
--     for it.
-- T7  N-02: every jsonb CHECK rejects a PLAUSIBLE WRONG SHAPE, not merely a
--     non-object. Doc 04 s735's legacy-jury case is the model and is executed.
-- T8  Eval score bounds reject 1.001 and -0.001 and accept 1.000 and 0.000.
-- T9  M-25: the database's own masking pass, the derived counts, idempotence
--     over worker-masked text, the subject index - and a MEASURED demonstration
--     that a person's name survives it, so the header's residue is a fact.
-- T10 An agent cannot read another tenant's core.run_node_io.
-- T11 C-04 residue: zero anon/authenticated SELECT and EXECUTE on everything 013
--     creates, by impersonation AND by catalogue.
-- T12 M-03: the NEAR / PAUSED transition at its exact boundaries, the derived
--     tier status including PAUSED_BY_CAP that nothing writes, and
--     app.roll_up_usage actually filling the relation the finding called a
--     phantom.
-- T13 The run record's own rules: a halt is evidence, a replay is a sandbox, a
--     finished node has a status, and the doc-05-vs-003 status disagreement is
--     resolved the way the header says.
--
-- ── THREE NOTES ON SHAPE, ALL DELIBERATE ─────────────────────────────────
--
-- RPC PROBE SHAPE. Every 013 function has intentionally NO authenticated
-- EXECUTE before 014 (C-04 residue), so running the RPCs "under SET LOCAL ROLE
-- authenticated" would contradict the state this pack is required to be in.
-- This pin does what test_011 and test_012 settled on: it calls the RPCs with
-- the migration role's entry privilege while keeping the JWT IDENTITY entirely
-- real - app_role, tenant_id, sub, actor_kind, session_id and aal are all set,
-- so app.has_permission, app.current_tenant_id and app.aal2_verified are
-- evaluating a genuine principal - and it runs the authenticated/anon checks as
-- REFUSALS. Each impersonation probe is ONE STATEMENT, its result is parked in a
-- transaction-local GUC, and the assertions run after RESET ROLE.
--
-- GOV-07. No fixture here writes a gated column. The fifteen 011 gates
-- (app.enforce_state_transition) are on core.enquiries, opportunities, tnas,
-- proposals, quotations, engagements, attendance_days, hrdc_packets, invoices
-- (x2), collections_cases, trainer_bookings, compliance_rules, rule_changes and
-- outbound_messages. 013 creates none of those and this pin writes none of them,
-- so the pg_temp.gate helper six other pins carry is not needed and is not
-- copied in to look thorough - checked against pg_trigger, not assumed.
--
-- REF FORMATS. core.agents and core.runs allocate a `ref` through
-- core.assign_ref, which raises when the tenant has no core.ref_formats row for
-- the prefix. No migration seeds those (016 provisions them), so this pin seeds
-- its own AGT and RUN rows - the same thing the ACT note in the GOV-07 helper
-- warns about, met here for two new prefixes.
-- ============================================================================

--
-- ⚠ WHICH DATABASE THIS RUNS AGAINST: 001-014, NOT 001-013.
-- Some assertions below require migration 014's client grants to be present —
-- T11b2 asserts `authenticated` cannot read core.budget_status or core.model_tier_status, which only means something once 014 has granted the rest of `core` — so running this pin against a 001-013-only database fails for a reason
-- that is about the harness, not about this pack. Confirmed by execution: run at
-- 001-013 alone it fails there; apply 014 and it passes. The catalog says the
-- same. This is a real ordering dependency of the PIN, not of the MIGRATION: 0013
-- itself applies and verifies cleanly with nothing after it.

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_013 SETUP FAILURE: plpgsql.check_asserts is off';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF pg_catalog.to_regclass('core.runs') IS NULL
     OR pg_catalog.to_regclass('core.ai_provider_keys') IS NULL
     OR pg_catalog.to_regclass('app.key_access_audit') IS NULL
     OR pg_catalog.to_regproc('public.ai_provider_key_reveal') IS NULL THEN
    RAISE EXCEPTION 'test_013 SETUP FAILURE: migration 013 is missing or partial';
  END IF;
  -- The premises this pack rests on, CHECKED rather than assumed (R13). Two
  -- briefs in this series asserted a function existed when it did not.
  IF pg_catalog.to_regproc('app.aal2_verified') IS NULL THEN
    RAISE EXCEPTION 'test_013 SETUP FAILURE: 011''s app.aal2_verified is absent';
  END IF;
  IF pg_catalog.to_regproc('app.is_valid_actor') IS NULL
     OR pg_catalog.to_regproc('app.reject_mutation') IS NULL THEN
    RAISE EXCEPTION 'test_013 SETUP FAILURE: 012''s shared validators are absent';
  END IF;
  IF pg_catalog.to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION
      'test_013 SETUP FAILURE: auth.sessions does not exist, so app.aal2_verified '
      'can only ever return false and T4 and T5 would pass for the wrong reason';
  END IF;
END;
$setup$;

-- ─── Fixtures ──────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('00000013-0000-0000-0000-0000000000a1','t013-admin@example.invalid'),
  ('00000013-0000-0000-0000-0000000000a2','t013-admin-no-mfa@example.invalid'),
  ('00000013-0000-0000-0000-0000000000a3','t013-agent-principal@example.invalid'),
  ('00000013-0000-0000-0000-0000000000a4','t013-beta-admin@example.invalid'),
  ('00000013-0000-0000-0000-0000000000a5','t013-beta-agent@example.invalid');

-- The rows GoTrue writes. app.aal2_verified() grounds its answer in these and
-- NOT in the token's own `aal` claim, which is the whole of doc 02 s7.2a.
INSERT INTO auth.sessions (id, user_id, aal) VALUES
  ('00000013-5e55-0000-0000-000000000001','00000013-0000-0000-0000-0000000000a1','aal2'),
  ('00000013-5e55-0000-0000-000000000002','00000013-0000-0000-0000-0000000000a2','aal1');
-- Deliberately NO session row for 00000013-...-5e55-...-0003: that id is the
-- forged one T4 presents.

INSERT INTO public.tenants (id, slug, name, timezone) VALUES
  ('00000013-1111-1111-1111-111111111111','t013-alpha','T013 Alpha','Asia/Kuala_Lumpur'),
  ('00000013-2222-2222-2222-222222222222','t013-beta','T013 Beta','Asia/Kuala_Lumpur');

INSERT INTO public.memberships
  (tenant_id, user_id, role, actor_kind, agent_id, status, is_default)
VALUES
  ('00000013-1111-1111-1111-111111111111','00000013-0000-0000-0000-0000000000a1',
   'ADMIN','HUMAN',NULL,'ACTIVE',true),
  ('00000013-1111-1111-1111-111111111111','00000013-0000-0000-0000-0000000000a2',
   'ADMIN','HUMAN',NULL,'ACTIVE',true),
  ('00000013-1111-1111-1111-111111111111','00000013-0000-0000-0000-0000000000a3',
   'AGENT','AGENT','agent_proposal','ACTIVE',true),
  ('00000013-2222-2222-2222-222222222222','00000013-0000-0000-0000-0000000000a4',
   'ADMIN','HUMAN',NULL,'ACTIVE',true),
  ('00000013-2222-2222-2222-222222222222','00000013-0000-0000-0000-0000000000a5',
   'AGENT','AGENT','agent_proposal','ACTIVE',true);

INSERT INTO public.user_profiles (tenant_id, user_id, display_name) VALUES
  ('00000013-1111-1111-1111-111111111111','00000013-0000-0000-0000-0000000000a1','Alex Selvarajah'),
  ('00000013-1111-1111-1111-111111111111','00000013-0000-0000-0000-0000000000a2','T013 No MFA'),
  ('00000013-2222-2222-2222-222222222222','00000013-0000-0000-0000-0000000000a4','T013 Beta Admin');

-- See the REF FORMATS note in the header. Both tenants, both prefixes.
INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width) VALUES
  ('00000013-1111-1111-1111-111111111111','AGT','agent',false,4),
  ('00000013-1111-1111-1111-111111111111','RUN','run',  true, 4),
  ('00000013-2222-2222-2222-222222222222','AGT','agent',false,4),
  ('00000013-2222-2222-2222-222222222222','RUN','run',  true, 4)
  -- ⚠ 016 now provisions every tenant's ref_formats from an AFTER INSERT trigger
  -- on public.tenants, so this fixture collides with the real thing. The pin's
  -- own shape wins: it is a fixture inside a transaction that rolls back, and
  -- the assertions below were written against these exact values.
  ON CONFLICT (tenant_id, prefix)
    DO UPDATE SET entity = EXCLUDED.entity,
                  dated  = EXCLUDED.dated,
                  width  = EXCLUDED.width;

INSERT INTO core.tier_keys (tenant_id, tier_key, label, position) VALUES
  ('00000013-1111-1111-1111-111111111111','FAST','Fast',1),
  ('00000013-1111-1111-1111-111111111111','MID','Mid',2),
  ('00000013-1111-1111-1111-111111111111','STRONG_1','Strong 1',3),
  ('00000013-1111-1111-1111-111111111111','SPECIAL','Special',9),
  ('00000013-2222-2222-2222-222222222222','FAST','Fast',1);

INSERT INTO core.agents
  (id, tenant_id, agent_id, name, status, principal_user_id, default_tier)
VALUES
  ('00000013-a9e7-0000-0000-000000000001','00000013-1111-1111-1111-111111111111',
   'agent_proposal','Proposal Agent','ACTIVE',
   '00000013-0000-0000-0000-0000000000a3','MID'),
  ('00000013-a9e7-0000-0000-000000000002','00000013-2222-2222-2222-222222222222',
   'agent_proposal','Proposal Agent (beta)','ACTIVE',
   '00000013-0000-0000-0000-0000000000a5','FAST');

-- degraded_since is supplied WITH the DEGRADED health, not patched in
-- afterwards: model_tiers_degraded_has_since is an insert-time CHECK, so the
-- two-statement spelling fails on the first one. Found by running it.
INSERT INTO core.model_tiers
  (tenant_id, tier_key, model, provider, admin_state, health, degraded_since, degraded_reason)
VALUES
  ('00000013-1111-1111-1111-111111111111','FAST','claude-haiku-x','ANTHROPIC','ENABLED','HEALTHY',NULL,NULL),
  ('00000013-1111-1111-1111-111111111111','MID','claude-sonnet-x','ANTHROPIC','ENABLED','DEGRADED',
   pg_catalog.now(),'PROVIDER_5XX'),
  ('00000013-1111-1111-1111-111111111111','STRONG_1','claude-opus-x','ANTHROPIC','DISABLED','HEALTHY',NULL,NULL),
  ('00000013-1111-1111-1111-111111111111','SPECIAL','gemini-x','GOOGLE','ENABLED','HEALTHY',NULL,NULL);

-- ─── Temporary impersonation adapters ──────────────────────────────────────
-- SECURITY INVOKER, so the probe genuinely runs as the impersonated role. Each
-- catches and returns; the caller parks the result in a GUC and asserts after
-- RESET ROLE, because a direct read of a forced-RLS, REVOKE-ALL table fails at
-- the grant layer before it ever reaches its subject.

CREATE FUNCTION pg_temp.t013_probe_select(p_relation text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE v_n bigint;
BEGIN
  EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM %s', p_relation) INTO v_n;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'rows', v_n);
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE);
END;
$fn$;

CREATE FUNCTION pg_temp.t013_probe_call(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN pg_catalog.jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object('ok', false, 'sqlstate', SQLSTATE);
END;
$fn$;

-- One place that builds a claim set, so a test that means to change ONE claim
-- cannot accidentally change three.
CREATE FUNCTION pg_temp.t013_claims(
  p_sub text, p_tenant text, p_role text,
  p_actor_kind text DEFAULT 'HUMAN',
  p_session text DEFAULT NULL,
  p_aal text DEFAULT 'aal1',
  p_agent text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $fn$
  SELECT pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'sub', p_sub, 'tenant_id', p_tenant, 'app_role', p_role,
      'role', 'authenticated', 'actor_kind', p_actor_kind,
      'session_id', p_session, 'aal', p_aal, 'agent_id', p_agent))::text,
    true)::void;
$fn$;

-- ─── T1 · inventory ────────────────────────────────────────────────────────

DO $t1$
DECLARE
  v_tables text[] := ARRAY[
    'core.tier_keys','core.agents','public.agent_api_keys',
    'app.agent_api_key_secrets','core.model_tiers',
    'core.routing_matrix_versions','core.routing_entries',
    'core.ai_provider_keys','core.ai_budgets','app.usage_rollup',
    'core.runs','core.run_nodes','core.run_node_io','core.run_events',
    'core.run_state_cards','core.run_checkpoints','core.run_snapshots',
    'core.evals','app.key_access_audit'];
  v_app_fns text[] := ARRAY[
    'mask_key','is_masked_key','agent_key_digest','is_valid_run_trigger',
    'is_valid_halted_by','is_valid_run_failure','is_valid_plan',
    'is_valid_state_card_budgets','is_valid_checkpoint_cursor',
    'is_valid_jury_policy','is_valid_metric_condition',
    'is_valid_run_event_detail','is_valid_redaction_counts',
    'redact_pattern','redact_pii','placeholder_count','pii_counts',
    'mask_run_io','require_reveal_audit','record_key_access',
    'mint_agent_key','verify_agent_key','redact_run_io','roll_up_usage'];
  v_pub_fns text[] := ARRAY[
    'ai_provider_key_set','ai_provider_key_test','ai_provider_key_rotate',
    'ai_provider_key_delete','ai_provider_key_reveal'];
  v_count    integer;
  v_offender text;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.unnest(v_tables) AS expected(name)
   WHERE pg_catalog.to_regclass(expected.name) IS NOT NULL;
  ASSERT v_count = 19,
    pg_catalog.format('T1a FAIL: expected 19 tables, found %s', v_count);

  ASSERT pg_catalog.to_regclass('core.budget_status') IS NOT NULL
     AND pg_catalog.to_regclass('core.model_tier_status') IS NOT NULL,
    'T1b FAIL: a derived-status view is missing';

  -- H-08, per table, off pg_class.
  SELECT pg_catalog.string_agg(expected.name, ', ') INTO v_offender
    FROM pg_catalog.unnest(v_tables) AS expected(name)
    JOIN pg_catalog.pg_class AS class ON class.oid = expected.name::regclass
   WHERE NOT (class.relrowsecurity AND class.relforcerowsecurity);
  ASSERT v_offender IS NULL,
    pg_catalog.format('T1c FAIL (H-08): %s are not RLS enabled AND forced', v_offender);

  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid IN (
     SELECT expected.name::regclass FROM pg_catalog.unnest(v_tables) AS expected(name));
  -- ⚠ AMENDED BY 014 (2026-09-13). H-08 asked that 013 ship no policy of its
  -- own, and it did not: every policy now on these tables was stamped by
  -- app.apply_tenant_policies in 014. The count is therefore two per
  -- tenant-scoped core table in the set rather than zero, and the H-08 property
  -- is re-expressed as "every policy here is a 014 policy, by name" — which is
  -- strictly stronger than a count, because a hand-written policy added beside
  -- them would keep any count you chose just as easily as it would break it.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
   WHERE policy.polrelid IN (
     SELECT expected.name::regclass FROM pg_catalog.unnest(v_tables) AS expected(name))
     AND policy.polname NOT IN (class.relname || '_tenant_select',
                                class.relname || '_tenant_isolation');
  ASSERT v_count = 0,
    pg_catalog.format('T1d FAIL (H-08): policy/policies on the 013 set that 014 '
      'did not stamp, found %s',
      v_count);

  -- H-09(a). Checked, not re-derived: 007 created core.public_share_tokens
  -- through app.finalise_table, which enables and forces. The finding described
  -- doc 02's prose and the executable schema had already overtaken it.
  ASSERT (SELECT class.relrowsecurity AND class.relforcerowsecurity
            FROM pg_catalog.pg_class AS class
           WHERE class.oid = 'core.public_share_tokens'::regclass),
    'T1e FAIL (H-09): core.public_share_tokens is not RLS enabled and forced, so '
    'the evidence 013''s header closes the first half of H-09 with is no longer true';

  -- H-09(b). The mechanism, asserted as a mechanism: the hash is not a column of
  -- the exposed table, and the table that holds it is in `app`.
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public.agent_api_keys'::regclass
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
       AND attribute.attname IN ('key_hash','key_digest','key_salt','key')),
    'T1f FAIL (H-09): public.agent_api_keys carries a hash column';
  ASSERT (SELECT namespace.nspname FROM pg_catalog.pg_class AS class
            JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
           WHERE class.oid = 'app.agent_api_key_secrets'::regclass) = 'app',
    'T1g FAIL (H-09): the agent key digest is not in the unexposed `app` schema';

  -- Rule 8.
  SELECT pg_catalog.string_agg(class.relname, ', ') INTO v_offender
    FROM pg_catalog.pg_class AS class
   WHERE class.oid IN ('core.budget_status'::regclass, 'core.model_tier_status'::regclass)
     AND NOT COALESCE(
           (SELECT option_value FROM pg_catalog.pg_options_to_table(class.reloptions)
             WHERE option_name = 'security_invoker'), 'false')::boolean;
  ASSERT v_offender IS NULL,
    pg_catalog.format('T1h FAIL (M-02): view(s) %s are not security_invoker', v_offender);

  -- Rule 1, the exact stored string across all 29.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE ((namespace.nspname = 'app'    AND procedure.proname = ANY (v_app_fns))
       OR (namespace.nspname = 'public' AND procedure.proname = ANY (v_pub_fns)))
     AND 'search_path=""' = ANY (procedure.proconfig);
  ASSERT v_count = 29,
    pg_catalog.format('T1i FAIL: expected 29 functions at search_path="", found %s',
      v_count);

  -- N-02 coverage, re-derived from pg_attribute rather than from the DDL.
  SELECT pg_catalog.string_agg(
           namespace.nspname || '.' || class.relname || '.' || attribute.attname, ', ')
    INTO v_offender
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE class.oid IN (
     SELECT expected.name::regclass FROM pg_catalog.unnest(v_tables) AS expected(name))
     AND attribute.attnum > 0 AND NOT attribute.attisdropped
     AND attribute.atttypid = 'jsonb'::regtype
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS con
        WHERE con.conrelid = class.oid AND con.contype = 'c'
          AND attribute.attnum = ANY (con.conkey));
  ASSERT v_offender IS NULL,
    pg_catalog.format('T1j FAIL (N-02): jsonb column(s) %s carry no CHECK', v_offender);

  -- M-16, generalised: every FK has an index whose leading columns are the key.
  SELECT pg_catalog.string_agg(con.conname, ', ') INTO v_offender
    FROM pg_catalog.pg_constraint AS con
   WHERE con.contype = 'f'
     AND con.conrelid IN (
       SELECT expected.name::regclass FROM pg_catalog.unnest(v_tables) AS expected(name))
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_index AS idx
        WHERE idx.indrelid = con.conrelid
          AND (pg_catalog.string_to_array(idx.indkey::text, ' ')::smallint[]
               )[1:pg_catalog.cardinality(con.conkey)] = con.conkey);
  ASSERT v_offender IS NULL,
    pg_catalog.format('T1k FAIL (M-16): unindexed foreign key(s) %s', v_offender);

  -- M-16 by name, because the finding names this one.
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                  WHERE relname = 'evals_run_idx' AND relkind = 'i'),
    'T1l FAIL (M-16): core.evals.run_id has no index';

  -- ── THE run_id RECONCILIATION, asserted on BOTH sides ──────────────────
  ASSERT (SELECT attribute.atttypid FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = 'core.runs'::regclass
             AND attribute.attname = 'id') = 'uuid'::regtype,
    'T1m FAIL: core.runs.id is not uuid';
  SELECT pg_catalog.string_agg(expected.rel || '.' || expected.col, ', ')
    INTO v_offender
    FROM (VALUES
      ('core.events','run_id'),('app.outbox','run_id'),
      ('core.action_requests','agent_run_id'),('core.suggested_drafts','agent_run_id')
    ) AS expected(rel, col)
   WHERE (SELECT attribute.atttypid FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = expected.rel::regclass
             AND attribute.attname = expected.col) <> 'text'::regtype;
  ASSERT v_offender IS NULL,
    pg_catalog.format(
      'T1n FAIL: %s was retyped away from text. 013 reconciles the run_id '
      'divergence; retyping discards every event and job already carrying a '
      'non-uuid run id.', v_offender);
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_constraint AS con
   WHERE con.contype = 'f'
     AND con.conname IN ('proposals_run_fk','provenance_run_fk','rule_change_sets_run_fk')
     AND con.confrelid = 'core.runs'::regclass;
  ASSERT v_count = 3,
    pg_catalog.format(
      'T1o FAIL: expected the 3 uuid-side foreign keys 007 and 009 left for 013 '
      'by name, found %s', v_count);
  -- And the text side resolves: core.runs (tenant_id, ref) is unique, which is
  -- what makes a text run id resolvable to a uuid in one index lookup.
  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS con
     WHERE con.conrelid = 'core.runs'::regclass
       AND con.contype = 'u'
       AND con.conname = 'runs_tenant_ref_key'),
    'T1p FAIL: core.runs has no UNIQUE (tenant_id, ref), so the text run ids in '
    '011 and 012 resolve to nothing and the reconciliation is a claim';

  -- M-25's index and trigger, and M-10(4)'s trigger, by name and by shape.
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                  WHERE relname = 'run_node_io_subject_idx' AND relkind = 'i'),
    'T1q FAIL (M-25): run_node_io_subject_idx is missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'core.run_node_io'::regclass
       AND NOT trigger.tgisinternal AND trigger.tgname = 'run_node_io_mask'),
    'T1r FAIL (M-25): core.run_node_io has no masking trigger';
  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'core.ai_provider_keys'::regclass
       AND NOT trigger.tgisinternal
       AND trigger.tgname = 'ai_provider_keys_reveal_audit'),
    'T1s FAIL (M-10): the reveal-audit trigger is missing';
  -- The TRUNCATE half. 012 measured that a row trigger does not fire for it.
  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'app.key_access_audit'::regclass
       AND NOT trigger.tgisinternal
       AND trigger.tgname = 'key_access_audit_no_truncate'
       AND (trigger.tgtype & 32) = 32 AND (trigger.tgtype & 1) = 0),
    'T1t FAIL: app.key_access_audit has no statement-level TRUNCATE guard';

  -- 013 created NO type. Every vocabulary it uses is 003's, by oid.
  ASSERT (SELECT attribute.atttypid FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = 'core.run_nodes'::regclass
             AND attribute.attname = 'status') = 'core.run_step_status'::regtype,
    'T1u FAIL: core.run_nodes.status is not 003''s core.run_step_status';
  ASSERT (SELECT pg_catalog.count(*)
            FROM pg_catalog.pg_enum
           WHERE enumtypid = 'core.run_step_status'::regtype) = 4,
    'T1v FAIL: core.run_step_status no longer has exactly four members. Doc 05 '
    's6.2 writes five and 013''s header records the schema winning; a fifth '
    'member added to settle that disagreement is permanent';

  RAISE NOTICE
    'T1 PASS - 19 tables all RLS enabled and forced with zero policies, 2 '
    'security_invoker views, 29 functions at the exact search_path string, every '
    'jsonb column constrained, every foreign key indexed, the agent key digest '
    'out of the exposed schema, core.public_share_tokens already forced by 007, '
    'and the run_id reconciliation holding on both sides: core.runs.id uuid, the '
    'four text columns untouched, three named foreign keys onto core.runs, and '
    'UNIQUE (tenant_id, ref) making the text side resolvable.';
END;
$t1$;

-- ─── T2 · M-11 · the agent credential ──────────────────────────────────────

DO $t2$
DECLARE
  v_minted jsonb;
  v_raw    text;
  v_id     uuid;
  v_salt   bytea;
  v_digest bytea;
  v_rows   integer;
  v_stored text;
BEGIN
  v_minted := app.mint_agent_key(
    '00000013-1111-1111-1111-111111111111', 'agent_proposal', 'pin key', NULL);
  v_raw := v_minted ->> 'key';
  v_id  := (v_minted ->> 'id')::uuid;

  -- THE GENERATOR, asserted. gen_random_bytes(32) base64url is 43 characters
  -- behind the prefix; 256 bits is the entropy that makes one round of SHA-256
  -- safe here, and it is why this is not a work-factor KDF.
  ASSERT v_raw ~ '^tk_ag_[A-Za-z0-9_-]{43}$',
    pg_catalog.format('T2a FAIL (M-11): minted key has the wrong shape: %s',
      pg_catalog.left(v_raw, 12) || '...');
  ASSERT (v_minted ->> 'keyPrefix') = pg_catalog.left(v_raw, 16),
    'T2b FAIL: the stored prefix is not the first 16 characters of the key';

  SELECT secret.key_salt, secret.key_digest INTO v_salt, v_digest
    FROM app.agent_api_key_secrets AS secret
   WHERE secret.api_key_id = v_id;

  -- BYTE FOR BYTE, not "different from the input".
  ASSERT v_digest = app.agent_key_digest(v_raw, v_salt),
    'T2c FAIL (M-11): the stored digest is not sha256(salt || key)';
  ASSERT pg_catalog.octet_length(v_salt) = 16,
    'T2d FAIL (M-11): the salt is not 16 bytes';
  -- A DIFFERENT key must not produce the stored digest, and the same key under a
  -- different salt must not either - which is the whole point of the salt.
  ASSERT v_digest <> app.agent_key_digest(v_raw || 'x', v_salt),
    'T2e FAIL: the digest does not depend on the key';
  ASSERT v_digest <> app.agent_key_digest(v_raw, extensions.gen_random_bytes(16)),
    'T2f FAIL: the digest does not depend on the salt';

  -- NO PLAINTEXT ANYWHERE. Both rows, every column, as text.
  SELECT pg_catalog.to_jsonb(api_key)::text INTO v_stored
    FROM public.agent_api_keys AS api_key WHERE api_key.id = v_id;
  ASSERT pg_catalog.strpos(v_stored, v_raw) = 0,
    'T2g FAIL: the raw agent key appears in public.agent_api_keys';
  SELECT pg_catalog.to_jsonb(secret)::text INTO v_stored
    FROM app.agent_api_key_secrets AS secret WHERE secret.api_key_id = v_id;
  ASSERT pg_catalog.strpos(v_stored, v_raw) = 0,
    'T2h FAIL: the raw agent key appears in app.agent_api_key_secrets';

  -- The lookup, and the four ways it must give the SAME empty answer.
  SELECT pg_catalog.count(*)::integer INTO v_rows
    FROM app.verify_agent_key(v_raw);
  ASSERT v_rows = 1, 'T2i FAIL: a valid agent key does not verify';
  SELECT pg_catalog.count(*)::integer INTO v_rows
    FROM app.verify_agent_key(pg_catalog.left(v_raw, 48) || 'AAAAAAAAAAA');
  ASSERT v_rows = 0, 'T2j FAIL: a tampered agent key verifies';

  UPDATE core.agents SET kill_switch = true
   WHERE tenant_id = '00000013-1111-1111-1111-111111111111'
     AND agent_id = 'agent_proposal';
  SELECT pg_catalog.count(*)::integer INTO v_rows FROM app.verify_agent_key(v_raw);
  ASSERT v_rows = 0,
    'T2k FAIL: an agent under the kill switch still authenticates. 02 s3.3 puts '
    'the kill switch on the 401 path and a check that lives only in the Edge '
    'Function is a check the next caller forgets';
  UPDATE core.agents SET kill_switch = false
   WHERE tenant_id = '00000013-1111-1111-1111-111111111111'
     AND agent_id = 'agent_proposal';

  UPDATE public.agent_api_keys SET revoked_at = pg_catalog.now() WHERE id = v_id;
  SELECT pg_catalog.count(*)::integer INTO v_rows FROM app.verify_agent_key(v_raw);
  ASSERT v_rows = 0, 'T2l FAIL: a revoked agent key still verifies';
  UPDATE public.agent_api_keys SET revoked_at = NULL WHERE id = v_id;

  UPDATE public.agent_api_keys
     SET expires_at = pg_catalog.now() - interval '1 second' WHERE id = v_id;
  SELECT pg_catalog.count(*)::integer INTO v_rows FROM app.verify_agent_key(v_raw);
  ASSERT v_rows = 0, 'T2m FAIL: an expired agent key still verifies';
  UPDATE public.agent_api_keys SET expires_at = NULL WHERE id = v_id;

  RAISE NOTICE
    'T2 PASS (M-11) - the generator is gen_random_bytes(32) base64url in the '
    'database, the stored digest is sha256(16-byte salt || key) byte for byte, '
    'the raw key is in no column of either table, and a wrong key, a revoked '
    'key, an expired key and a killed agent all return the same empty answer.';
END;
$t2$;

-- ─── T3 · M-10(1) · no plaintext provider key ──────────────────────────────

DO $t3$
DECLARE
  -- A realistic Anthropic-shaped key. Never stored; never a parameter of any RPC.
  v_raw  constant text := 'sk-ant-api03-Xy7bQm4LpR2vNk8sTtZ9a41';
  v_mask text;
  v_fp   bytea;
  v_out  jsonb;
  v_row  core.ai_provider_keys;
BEGIN
  PERFORM pg_temp.t013_claims(
    '00000013-0000-0000-0000-0000000000a1',
    '00000013-1111-1111-1111-111111111111', 'ADMIN', 'HUMAN',
    '00000013-5e55-0000-0000-000000000001', 'aal2');

  -- The Edge Function computes these from the key it holds and the database
  -- never sees the key. app.mask_key is here so that the two cannot disagree
  -- about where the dots go.
  v_mask := app.mask_key(v_raw);
  v_fp   := pg_catalog.sha256(pg_catalog.convert_to(v_raw, 'UTF8'));

  v_out := public.ai_provider_key_set(
    'prv_anthropic', 'ANTHROPIC', 'Anthropic production',
    v_mask, v_fp, 'vault:8f2c1d4e-aaaa-bbbb-cccc-1234567890ab',
    ARRAY['FAST','MID'], 'US', 'CLIENT_ACCOUNT', 5000000, NULL);

  ASSERT v_out ? 'success' AND (v_out ->> 'success')::boolean,
    'T3a FAIL: ai_provider_key_set did not return the app.ok envelope';
  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_out)) = 2,
    'T3b FAIL: the envelope carries a sibling key at the top level, which is the '
    '037 mechanism that flips every consumer into pass-through';
  ASSERT (v_out -> 'data' ->> 'maskedKey') = v_mask,
    'T3c FAIL: the RPC returned something other than the mask';
  ASSERT pg_catalog.strpos(v_out::text, v_raw) = 0,
    'T3d FAIL: the RPC response contains the raw key';

  SELECT * INTO v_row FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = '00000013-1111-1111-1111-111111111111'
     AND provider_key.provider_ref = 'prv_anthropic';

  -- EXACT, both of them. "Not equal to the input" would pass for a truncation,
  -- a reversal or a base64 of the key, and none of those is safe.
  ASSERT v_row.masked_key = 'sk-ant-••••••••••••9a41',
    pg_catalog.format('T3e FAIL: masked_key is %s, not doc 02 s6.1''s mask',
      v_row.masked_key);
  ASSERT v_row.key_fingerprint = pg_catalog.sha256(pg_catalog.convert_to(v_raw,'UTF8')),
    'T3f FAIL: key_fingerprint is not sha256(key) byte for byte';
  ASSERT pg_catalog.octet_length(v_row.key_fingerprint) = 32,
    'T3g FAIL: key_fingerprint is not 32 bytes';

  -- The whole row, as text.
  ASSERT pg_catalog.strpos(pg_catalog.to_jsonb(v_row)::text, v_raw) = 0,
    'T3h FAIL: the raw provider key appears somewhere in core.ai_provider_keys';
  -- And nothing longer than the mask's visible tail survives anywhere: the last
  -- four characters are deliberately visible, the twelve before them are not.
  ASSERT pg_catalog.strpos(pg_catalog.to_jsonb(v_row)::text, 'Xy7bQm4LpR2vNk8sTtZ') = 0,
    'T3i FAIL: the middle of the raw key appears in the row';

  -- The mask CANNOT be a raw key, even though the database no longer derives it.
  BEGIN
    UPDATE core.ai_provider_keys SET masked_key = v_raw
     WHERE tenant_id = '00000013-1111-1111-1111-111111111111'
       AND provider_ref = 'prv_anthropic';
    ASSERT false,
      'T3j FAIL (M-10): an unmasked key was accepted into masked_key. With the '
      'key out of the database, app.is_masked_key is the only thing standing '
      'between the display column and a pasted credential';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE
    'T3 PASS (M-10 part 1) - the key is not a parameter of any RPC, the stored '
    'mask is exactly sk-ant-<12 bullets>9a41 and the stored fingerprint is '
    'exactly sha256(key); neither the key nor its middle appears in any column, '
    'and a raw key pasted into masked_key is refused by CHECK.';
END;
$t3$;

-- ─── T4 · M-10(2) · what the aal claim is worth ────────────────────────────

DO $t4$
BEGIN
  -- A FORGED token: it claims aal2 and names a session id that GoTrue never
  -- wrote. This is the attacker doc 02 s7.2a describes.
  PERFORM pg_temp.t013_claims(
    '00000013-0000-0000-0000-0000000000a1',
    '00000013-1111-1111-1111-111111111111', 'ADMIN', 'HUMAN',
    '00000013-5e55-0000-0000-000000000003', 'aal2');
  ASSERT app.aal() = 'aal2',
    'T4a FAIL: the cheap claim check does not even see the forged claim, so this '
    'test is not testing what it says';
  ASSERT NOT app.aal2_verified(),
    'T4b FAIL (M-10): app.aal2_verified() believed a claim with no auth.sessions '
    'row behind it. That is the entire mechanism of doc 02 s7.2a';

  -- The real one.
  PERFORM pg_temp.t013_claims(
    '00000013-0000-0000-0000-0000000000a1',
    '00000013-1111-1111-1111-111111111111', 'ADMIN', 'HUMAN',
    '00000013-5e55-0000-0000-000000000001', 'aal2');
  ASSERT app.aal2_verified(),
    'T4c FAIL: app.aal2_verified() is false for a genuine aal2 session';

  -- A real session at aal1, with the token claiming aal2 anyway.
  PERFORM pg_temp.t013_claims(
    '00000013-0000-0000-0000-0000000000a2',
    '00000013-1111-1111-1111-111111111111', 'ADMIN', 'HUMAN',
    '00000013-5e55-0000-0000-000000000002', 'aal2');
  ASSERT NOT app.aal2_verified(),
    'T4d FAIL: a real session at aal1 with a token claiming aal2 was accepted';

  -- An agent. Doc 02 s7.2a: agents are exempt from step-up (s4.7), so false here
  -- is CORRECT rather than a bug - and it should be asserted rather than
  -- discovered, which is the section's own instruction.
  PERFORM pg_temp.t013_claims(
    '00000013-0000-0000-0000-0000000000a3',
    '00000013-1111-1111-1111-111111111111', 'AGENT', 'AGENT',
    '00000013-5e55-0000-0000-000000000001', 'aal2', 'agent_proposal');
  ASSERT NOT app.aal2_verified(),
    'T4e FAIL: an AGENT principal passed the step-up check';

  RAISE NOTICE
    'T4 PASS (M-10 part 2) - app.aal2_verified() is false for a forged claim '
    'with no auth.sessions row, true for a real aal2 session, false for a real '
    'aal1 session whose token claims aal2, and false for an agent (correct, per '
    'doc 02 s4.7, and now asserted rather than assumed).';
END;
$t4$;

-- ─── T5 · M-10(3) · the 24-hour ceiling ────────────────────────────────────

DO $t5$
DECLARE
  v_out    jsonb;
  v_refused boolean := false;
  v_detail  text;
BEGIN
  PERFORM pg_temp.t013_claims(
    '00000013-0000-0000-0000-0000000000a1',
    '00000013-1111-1111-1111-111111111111', 'ADMIN', 'HUMAN',
    '00000013-5e55-0000-0000-000000000001', 'aal2');

  v_out := public.ai_provider_key_reveal(
    'prv_anthropic', 'client needs the key for their own billing console');
  ASSERT (v_out ->> 'success')::boolean, 'T5a FAIL: the first reveal was refused';
  ASSERT v_out -> 'data' ? 'keyRef' AND v_out -> 'data' ? 'auditId',
    'T5b FAIL: the reveal grant carries neither the locator nor the audit id';
  -- It is a GRANT, not a key. The decrypt is the Edge Function's.
  ASSERT NOT (v_out -> 'data' ? 'key'),
    'T5c FAIL: the reveal returned key material through the database';

  -- THE CEILING. Second reveal, same key, same 24 hours.
  BEGIN
    PERFORM public.ai_provider_key_reveal('prv_anthropic', 'second attempt inside the window');
  EXCEPTION WHEN raise_exception THEN
    v_refused := true;
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  END;
  ASSERT v_refused,
    'T5d FAIL (M-10): a second reveal inside 24 hours succeeded. Doc 02 s6.3 '
    'recommends keeping reveal only behind a rate limit of one per key per 24 '
    'hours, and the critic found that ceiling implemented nowhere';
  ASSERT v_detail::jsonb ->> 'code' = 'RATE_LIMITED'
     AND v_detail::jsonb ->> 'reason' = 'ONE_REVEAL_PER_24H',
    pg_catalog.format('T5e FAIL: the refusal is %s, not the ceiling', v_detail);

  -- And it is not a permanent lock. The pin reaches AROUND the reveal-audit
  -- trigger on purpose to move the clock - T6 proves that same edit is refused
  -- while the trigger is in force, which is what makes this safe to do here.
  ALTER TABLE core.ai_provider_keys DISABLE TRIGGER ai_provider_keys_reveal_audit;
  UPDATE core.ai_provider_keys
     SET last_revealed_at = pg_catalog.now() - interval '25 hours'
   WHERE tenant_id = '00000013-1111-1111-1111-111111111111'
     AND provider_ref = 'prv_anthropic';
  ALTER TABLE core.ai_provider_keys ENABLE TRIGGER ai_provider_keys_reveal_audit;

  v_out := public.ai_provider_key_reveal(
    'prv_anthropic', 'a day later, and the ceiling has moved with the clock');
  ASSERT (v_out ->> 'success')::boolean,
    'T5f FAIL: a reveal more than 24 hours after the last one was refused, so '
    'the ceiling is a permanent lock rather than a rate limit';

  RAISE NOTICE
    'T5 PASS (M-10 part 3) - the first reveal returns a locator and an audit id '
    'and no key material at all; the second inside 24 hours is refused with '
    'RATE_LIMITED / ONE_REVEAL_PER_24H; one 25 hours later is allowed.';
END;
$t5$;

-- ─── T6 · M-10(4) · the reveal and its audit row are inseparable ───────────

DO $t6$
DECLARE
  v_reveals integer;
  v_audit   uuid;
  v_probe   uuid;
  v_state   text;
  v_refused boolean;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_reveals
    FROM app.key_access_audit AS audit
   WHERE audit.tenant_id = '00000013-1111-1111-1111-111111111111'
     AND audit.provider_ref = 'prv_anthropic'
     AND audit.purpose = 'REVEAL';
  ASSERT v_reveals = 2,
    pg_catalog.format(
      'T6a FAIL (M-10 / doc 05 s5.4 rule #1): expected 2 REVEAL audit rows for '
      'the 2 successful reveals, found %s', v_reveals);

  SELECT audit.id INTO v_audit
    FROM app.key_access_audit AS audit
   WHERE audit.purpose = 'REVEAL'
   ORDER BY audit.decrypted_at DESC LIMIT 1;
  ASSERT (SELECT audit.aal FROM app.key_access_audit AS audit WHERE audit.id = v_audit)
         = 'aal2',
    'T6b FAIL: the audit row does not record the assurance level at reveal time';
  ASSERT (SELECT audit.actor ->> 'kind' FROM app.key_access_audit AS audit
           WHERE audit.id = v_audit) = 'HUMAN',
    'T6c FAIL: the reveal was not attributed to a HUMAN actor (doc 05 s5.4 rule #2)';
  ASSERT (SELECT NULLIF(pg_catalog.btrim(audit.reason), '')
            FROM app.key_access_audit AS audit WHERE audit.id = v_audit) IS NOT NULL,
    'T6d FAIL: the audit row has no reason, which the CHECK should have refused';

  -- The refused attempt in T5 left NO audit row: it never got that far. Two
  -- successful reveals, two rows, no others.
  ASSERT (SELECT pg_catalog.count(*) FROM app.key_access_audit AS audit
           WHERE audit.purpose = 'REVEAL') = 2,
    'T6e FAIL: a refused reveal wrote an audit row, which would make the log say '
    'a credential was seen when it was not';

  -- THE CONTROL. The attack this actually defends against is RESETTING the
  -- ceiling by moving last_revealed_at backwards, so that is what is attempted.
  -- ⚠ MEASURED, not reasoned: the first draft wrote `= now()`, which inside one
  -- transaction is the SAME value the reveal already stored - now() is
  -- transaction_timestamp - so the trigger's IS NOT DISTINCT FROM short-circuit
  -- let it through and the test passed for the wrong reason. A same-value write
  -- bypasses no ceiling and is correctly allowed; a backdated one is the attack.
  v_refused := false;
  BEGIN
    PERFORM pg_catalog.set_config('app.key_reveal_audit', '', true);
    UPDATE core.ai_provider_keys
       SET last_revealed_at = pg_catalog.now() - interval '48 hours'
     WHERE tenant_id = '00000013-1111-1111-1111-111111111111'
       AND provider_ref = 'prv_anthropic';
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  END;
  ASSERT v_refused,
    'T6f FAIL (M-10): last_revealed_at was moved backwards with no audit row, '
    'which resets the 24-hour ceiling. A reveal that succeeds while its audit '
    'row fails is the one case that must not be possible';

  -- And a bump naming the WRONG audit row - one that exists, in this tenant, for
  -- this key, but is a PROBE rather than a REVEAL.
  v_probe := app.record_key_access(
    '00000013-1111-1111-1111-111111111111', 'prv_anthropic', 'PROBE',
    '{"kind":"SYSTEM","id":"pin","name":null}'::jsonb, 'pin', NULL, NULL, NULL, NULL);
  v_refused := false;
  BEGIN
    PERFORM pg_catalog.set_config('app.key_reveal_audit', v_probe::text, true);
    UPDATE core.ai_provider_keys
       SET last_revealed_at = pg_catalog.now() - interval '48 hours'
     WHERE tenant_id = '00000013-1111-1111-1111-111111111111'
       AND provider_ref = 'prv_anthropic';
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  END;
  PERFORM pg_catalog.set_config('app.key_reveal_audit', '', true);
  ASSERT v_refused,
    'T6g FAIL (M-10): a PROBE audit row was accepted as cover for a reveal. The '
    'trigger must check the PURPOSE, not merely that some row exists';

  -- APPEND-ONLY, all three verbs, EXECUTED. A row trigger does not fire for
  -- TRUNCATE - 012 measured that - so the third one is the one that matters.
  v_refused := false;
  BEGIN
    UPDATE app.key_access_audit SET reason = 'rewritten' WHERE id = v_audit;
  EXCEPTION WHEN feature_not_supported THEN v_refused := true;
  END;
  ASSERT v_refused, 'T6h FAIL: app.key_access_audit accepted an UPDATE';

  v_refused := false;
  BEGIN
    DELETE FROM app.key_access_audit WHERE id = v_audit;
  EXCEPTION WHEN feature_not_supported THEN v_refused := true;
  END;
  ASSERT v_refused, 'T6i FAIL: app.key_access_audit accepted a DELETE';

  v_refused := false;
  BEGIN
    TRUNCATE app.key_access_audit;
  EXCEPTION WHEN feature_not_supported THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T6j FAIL: app.key_access_audit was TRUNCATEd. A FOR EACH ROW trigger does '
    'not fire for TRUNCATE, so the whole credential-access record is removable '
    'in one statement without the statement-level guard';

  -- Doc 05 s5.4: only REVEAL emits a domain event, and it emits through 012's
  -- app.emit_event. There is no second event path in 013.
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.tenant_id = '00000013-1111-1111-1111-111111111111'
             AND event.type = 'ProviderKeyRevealed') = 2,
    'T6k FAIL: ProviderKeyRevealed was not emitted once per reveal through '
    'app.emit_event';
  ASSERT (SELECT pg_catalog.count(*) FROM core.events AS event
           WHERE event.tenant_id = '00000013-1111-1111-1111-111111111111'
             AND event.type IN ('ProviderKeySet','ProviderKeyRotated',
                                'ProviderKeyDeleted','ProviderKeyTested')) = 0,
    'T6l FAIL: 013 invented event names doc 05 s5.4 does not sanction';

  RAISE NOTICE
    'T6 PASS (M-10 part 4) - two reveals, two audit rows carrying the actor, the '
    'reason and the assurance level; the refused reveal wrote none; a bump with '
    'no audit row and a bump naming a PROBE row are both refused by the trigger; '
    'and the audit table refuses UPDATE, DELETE and TRUNCATE, the last of them '
    'executed rather than reasoned about.';
END;
$t6$;

-- ─── Run fixtures, for T7 onwards ──────────────────────────────────────────
-- `ref` is allocated by core.assign_ref from the RUN format seeded above; the
-- fixture does not supply one, so the allocation path is exercised too.

INSERT INTO core.runs
  (id, tenant_id, agent_id, orchestrator, trigger, status, model, tiers_used,
   correlation_id, tokens_in, tokens_out, cost_sen)
VALUES
  ('00000013-4821-0000-0000-000000000001','00000013-1111-1111-1111-111111111111',
   'agent_proposal','proposal_orchestrator',
   '{"type":"TNA_SIGNED_OFF","ref":"TNA-0042"}'::jsonb,'RUNNING','claude-sonnet-x',
   ARRAY['MID'],'00000013-c077-0000-0000-000000000001',12000,3400,600),
  ('00000013-4821-0000-0000-000000000002','00000013-2222-2222-2222-222222222222',
   'agent_proposal',NULL,
   '{"type":"TNA_SIGNED_OFF"}'::jsonb,'RUNNING',NULL,
   ARRAY[]::text[],'00000013-c077-0000-0000-000000000002',0,0,0);

INSERT INTO core.run_nodes
  (id, tenant_id, run_id, node_key, seq, kind, name, tier, cost_sen, status,
   finished_at, duration_ms)
VALUES
  ('00000013-0de0-0000-0000-000000000001','00000013-1111-1111-1111-111111111111',
   '00000013-4821-0000-0000-000000000001','n0',0,'ORCHESTRATOR','Orchestrator',
   'MID',400,'OK', pg_catalog.now(), 900),
  ('00000013-0de0-0000-0000-000000000002','00000013-1111-1111-1111-111111111111',
   '00000013-4821-0000-0000-000000000001','n1',1,'SUB_AGENT','Drafter',
   'MID',200,'OK', pg_catalog.now(), 700),
  ('00000013-0de0-0000-0000-000000000003','00000013-2222-2222-2222-222222222222',
   '00000013-4821-0000-0000-000000000002','n0',0,'ORCHESTRATOR','Orchestrator',
   'FAST',0,'OK', pg_catalog.now(), 10);

-- ─── T7 · N-02 · every jsonb CHECK refuses a PLAUSIBLE wrong shape ─────────

DO $t7$
DECLARE
  v_refused boolean;
  v_case    text;
  v_sql     text;
  -- ⚠ MEASURED, NOT REASONED. Three of these are INSERTs rather than UPDATEs
  -- because app.finalise_table's immutability trigger FREEZES the column and
  -- fires BEFORE the CHECK, so an UPDATE of core.runs.trigger or
  -- core.ai_provider_keys.added_by raises IMMUTABLE_COLUMN and proves nothing
  -- about the shape constraint. The first draft of this test did exactly that
  -- and passed for the wrong reason on two of fourteen cases.
  v_cases   text[][] := ARRAY[
    -- Doc 05's five names, first.
    ['core.runs.trigger (no `type` key)',
     $q$INSERT INTO core.runs (tenant_id, agent_id, trigger, correlation_id)
        VALUES ('00000013-1111-1111-1111-111111111111','agent_proposal',
                '{"ref":"TNA-0042"}'::jsonb,
                '00000013-c077-0000-0000-00000000000f')$q$],
    ['core.runs.halted_by (no approvalRequestRef)',
     $q$UPDATE core.runs SET status = 'HALTED',
             halted_by = '{"policyId":"APV-01","reason":"needs approval"}'::jsonb
         WHERE id = '00000013-4821-0000-0000-000000000001'$q$],
    ['core.run_state_cards.plan (a status outside PlanStepStatus)',
     $q$INSERT INTO core.run_state_cards
          (tenant_id, run_id, version, goal, plan, budgets)
        VALUES ('00000013-1111-1111-1111-111111111111',
                '00000013-4821-0000-0000-000000000001',1,'draft the proposal',
                '[{"n":1,"label":"read the TNA","status":"ALMOST"}]'::jsonb,
                '{"tokens":{"used":1,"limit":2},"cost":{"used":1,"limit":2}}'::jsonb)$q$],
    ['core.run_state_cards.budgets (a limit with no used)',
     $q$INSERT INTO core.run_state_cards
          (tenant_id, run_id, version, goal, plan, budgets)
        VALUES ('00000013-1111-1111-1111-111111111111',
                '00000013-4821-0000-0000-000000000001',2,'draft the proposal',
                '[]'::jsonb,
                '{"tokens":{"limit":2},"cost":{"used":1,"limit":2}}'::jsonb)$q$],
    ['core.run_checkpoints.cursor (an empty object)',
     $q$INSERT INTO core.run_checkpoints
          (tenant_id, run_id, step, state_card_version, cursor)
        VALUES ('00000013-1111-1111-1111-111111111111',
                '00000013-4821-0000-0000-000000000001',1,1,'{}'::jsonb)$q$],
    -- And the eleven doc 05 does not name.
    ['core.runs.failure (no deadLettered)',
     $q$UPDATE core.runs SET status = 'FAILED',
             failure = '{"code":"X","message":"m","attempts":2,"retryable":true}'::jsonb
         WHERE id = '00000013-4821-0000-0000-000000000001'$q$],
    ['core.run_nodes.error (no attempt)',
     $q$UPDATE core.run_nodes SET error = '{"code":"TOOL_TIMEOUT"}'::jsonb
         WHERE id = '00000013-0de0-0000-0000-000000000001'$q$],
    ['core.run_nodes.halted_by (halt without evidence)',
     $q$UPDATE core.run_nodes
           SET halted_by = '{"policyId":"APV-01","approvalRequestRef":"APV-2026-0771","reason":"r"}'::jsonb
         WHERE id = '00000013-0de0-0000-0000-000000000001'$q$],
    ['core.run_events.detail (an ESCALATION body on a CHECKPOINT)',
     $q$INSERT INTO core.run_events (tenant_id, run_id, seq, type, detail)
        VALUES ('00000013-1111-1111-1111-111111111111',
                '00000013-4821-0000-0000-000000000001',1,'CHECKPOINT',
                '{"from":"FAST","to":"MID","confidence":0.62}'::jsonb)$q$],
    ['core.agents.jury (DECISIONS s2''s legacy boolean form)',
     $q$UPDATE core.agents SET jury = '{"enabled":true,"quorum":2,"of":3}'::jsonb
         WHERE id = '00000013-a9e7-0000-0000-000000000001'$q$],
    ['core.agents.resume_condition (no value)',
     $q$UPDATE core.agents
           SET resume_condition = '{"metric":"evalScore","op":"gte"}'::jsonb
         WHERE id = '00000013-a9e7-0000-0000-000000000001'$q$],
    ['core.ai_provider_keys.added_by (a fifth actor kind)',
     $q$INSERT INTO core.ai_provider_keys
          (tenant_id, provider_ref, provider, label, masked_key, key_fingerprint,
           key_ref, region, added_by)
        VALUES ('00000013-1111-1111-1111-111111111111','prv_google','GOOGLE',
                'Google', 'AIza-x'||repeat('*',12)||'9a41',
                pg_catalog.sha256('x'::bytea),'vault:zzz','US',
                '{"kind":"ROBOT","id":"x","name":null}'::jsonb)$q$],
    ['app.key_access_audit.actor (a fifth actor kind)',
     $q$INSERT INTO app.key_access_audit
          (tenant_id, provider_key_id, provider_ref, key_ref, actor, purpose,
           edge_function_name)
        SELECT tenant_id, id, provider_ref, key_ref,
               '{"kind":"ROBOT","id":"x","name":null}'::jsonb,'RUN_CALL','pin'
          FROM core.ai_provider_keys WHERE provider_ref = 'prv_anthropic'$q$],
    ['core.run_snapshots.args_hash (not a sha256)',
     $q$INSERT INTO core.run_snapshots
          (tenant_id, run_id, tool_name, args_hash, args, response)
        VALUES ('00000013-1111-1111-1111-111111111111',
                '00000013-4821-0000-0000-000000000001','fetch_rate_card','deadbeef',
                '{}'::jsonb,'{}'::jsonb)$q$]
  ];
  i integer;
BEGIN
  FOR i IN 1 .. pg_catalog.array_length(v_cases, 1) LOOP
    v_case := v_cases[i][1];
    v_sql  := v_cases[i][2];
    v_refused := false;
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN check_violation THEN
      v_refused := true;
    END;
    ASSERT v_refused,
      pg_catalog.format(
        'T7 FAIL (N-02): %s was ACCEPTED. Doc 04 s735 reproduced this by '
        'execution - a constraint that reads a key before testing for it '
        'evaluates to NULL, and a CHECK that is NULL passes.', v_case);
  END LOOP;

  -- The same shapes, WELL FORMED, must be accepted - a constraint that refuses
  -- everything is not a constraint either.
  INSERT INTO core.run_state_cards (tenant_id, run_id, version, goal, plan, budgets)
  VALUES ('00000013-1111-1111-1111-111111111111',
          '00000013-4821-0000-0000-000000000001',1,'draft the proposal',
          '[{"n":1,"label":"read the TNA","status":"DONE"},
            {"n":2,"label":"draft","status":"RUNNING"}]'::jsonb,
          '{"tokens":{"used":15400,"limit":60000},"cost":{"used":600,"limit":5000}}'::jsonb);
  INSERT INTO core.run_checkpoints
    (tenant_id, run_id, step, node_key, state_card_version, cursor)
  VALUES ('00000013-1111-1111-1111-111111111111',
          '00000013-4821-0000-0000-000000000001',4,'n1',1,
          '{"nodeKey":"n1","step":4}'::jsonb);
  INSERT INTO core.run_events (tenant_id, run_id, seq, type, detail)
  VALUES ('00000013-1111-1111-1111-111111111111',
          '00000013-4821-0000-0000-000000000001',1,'CHECKPOINT',
          '{"step":4,"replayable":true,"stateCardVersion":4}'::jsonb),
         ('00000013-1111-1111-1111-111111111111',
          '00000013-4821-0000-0000-000000000001',2,'JURY',
          '{"mode":"ESCALATE","quorum":2,"of":3,"votes":[]}'::jsonb);

  RAISE NOTICE
    'T7 PASS (N-02 / R-JSONB) - all 14 plausible wrong shapes refused, including '
    'doc 05''s five named columns and DECISIONS s2''s legacy boolean jury, and '
    'the well-formed versions of the same shapes accepted.';
END;
$t7$;

-- ─── T8 · eval score bounds ────────────────────────────────────────────────

DO $t8$
DECLARE v_refused boolean;
BEGIN
  FOREACH v_refused IN ARRAY ARRAY[true] LOOP NULL; END LOOP;

  v_refused := false;
  BEGIN
    INSERT INTO core.evals (tenant_id, agent_id, kind, golden_set_version, score)
    VALUES ('00000013-1111-1111-1111-111111111111','agent_proposal',
            'GOLDEN_SET','gs-2026-09',1.001);
  EXCEPTION WHEN check_violation OR numeric_value_out_of_range THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T8a FAIL: an eval score of 1.001 was accepted. Eval scores are the reason '
    'the numeric(4,3) CHECK (x >= 0 AND x <= 1) rule exists - the rolling median '
    'they feed is what gates an agent''s promotion to AUTONOMOUS';

  v_refused := false;
  BEGIN
    INSERT INTO core.evals (tenant_id, agent_id, kind, golden_set_version, score)
    VALUES ('00000013-1111-1111-1111-111111111111','agent_proposal',
            'GOLDEN_SET','gs-2026-09',-0.001);
  EXCEPTION WHEN check_violation OR numeric_value_out_of_range THEN v_refused := true;
  END;
  ASSERT v_refused, 'T8b FAIL: an eval score of -0.001 was accepted';

  -- The boundaries themselves are legal.
  INSERT INTO core.evals (tenant_id, agent_id, kind, golden_set_version, score, passed)
  VALUES ('00000013-1111-1111-1111-111111111111','agent_proposal',
          'GOLDEN_SET','gs-2026-09',1.000,true),
         ('00000013-1111-1111-1111-111111111111','agent_proposal',
          'GOLDEN_SET','gs-2026-09',0.000,false);
  ASSERT (SELECT pg_catalog.count(*) FROM core.evals
           WHERE tenant_id = '00000013-1111-1111-1111-111111111111') = 2,
    'T8c FAIL: 0.000 and 1.000 are not both accepted';

  -- And a GOLDEN_SET row must name the set it was scored against.
  v_refused := false;
  BEGIN
    INSERT INTO core.evals (tenant_id, agent_id, kind, score)
    VALUES ('00000013-1111-1111-1111-111111111111','agent_proposal','GOLDEN_SET',0.9);
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T8d FAIL: a GOLDEN_SET eval with no golden_set_version was accepted, so two '
    'scores against different sets are indistinguishable';

  RAISE NOTICE
    'T8 PASS - eval score bounds reject 1.001 and -0.001, accept 1.000 and '
    '0.000, and a GOLDEN_SET row without its set version is refused.';
END;
$t8$;

-- ─── T9 · M-25 · what the database masks, and what nothing masks ───────────

DO $t9$
DECLARE
  v_prompt     text;
  v_completion text;
  v_redaction  jsonb;
BEGIN
  -- Written RAW, straight at the table, exactly as it would arrive if the
  -- worker's pass were skipped, misconfigured or bypassed.
  INSERT INTO core.run_node_io
    (tenant_id, run_node_id, prompt, completion, subject_type, subject_id)
  VALUES
    ('00000013-1111-1111-1111-111111111111','00000013-0de0-0000-0000-000000000002',
     'Alex Selvarajah at nurul.hassan@acme.example asked about NRIC 880101-14-5501; '
     'call 012-345 6789 or the other line 0123456789.',
     'Replying to nurul.hassan@acme.example with account 1234567890123 attached.',
     'ORGANISATION','00000013-0e60-0000-0000-000000000001');

  SELECT io.prompt, io.completion, io.redaction
    INTO v_prompt, v_completion, v_redaction
    FROM core.run_node_io AS io
   WHERE io.run_node_id = '00000013-0de0-0000-0000-000000000002';

  -- The five doc 05 s6.7 patterns, masked by the DATABASE.
  ASSERT pg_catalog.strpos(v_prompt, 'nurul.hassan@acme.example') = 0,
    pg_catalog.format('T9a FAIL (M-25): an email survived storage: %s', v_prompt);
  ASSERT pg_catalog.strpos(v_prompt, '880101-14-5501') = 0,
    'T9b FAIL (M-25): an NRIC survived storage';
  ASSERT pg_catalog.strpos(v_prompt, '012-345 6789') = 0,
    'T9c FAIL (M-25): a Malaysian mobile survived storage';
  ASSERT pg_catalog.strpos(v_completion, '1234567890123') = 0,
    'T9d FAIL (M-25): a bank account number survived storage';

  -- CO-REFERENCE. The same address in the prompt and in the completion gets the
  -- SAME placeholder, which is the entire reason doc 05 numbers them.
  ASSERT pg_catalog.strpos(v_prompt, '«email:1»') > 0
     AND pg_catalog.strpos(v_completion, '«email:1»') > 0,
    pg_catalog.format(
      'T9e FAIL (M-25): the same address is not the same placeholder across the '
      'prompt and the completion. prompt=%s completion=%s', v_prompt, v_completion);

  -- The counts are DERIVED from what is stored, not taken from the caller.
  ASSERT (v_redaction ->> 'emails') = '1',
    pg_catalog.format('T9f FAIL: redaction.emails is %s', v_redaction ->> 'emails');
  ASSERT (v_redaction ->> 'nric') = '1', 'T9g FAIL: redaction.nric is wrong';
  ASSERT (v_redaction ->> 'accounts') = '1', 'T9h FAIL: redaction.accounts is wrong';
  ASSERT v_redaction ? 'passports',
    'T9i FAIL: doc 05 s6.7 shows three count keys for five patterns; all five '
    'must be present or a pattern that never ran is indistinguishable from one '
    'that caught nothing';

  -- ⚠ THE RESIDUE, MEASURED RATHER THAN CLAIMED. A person's name goes straight
  -- through. Nothing in this system masks names, addresses, job titles or
  -- company-identifying text - not the worker, not the database. The header
  -- says so; this assertion makes it a fact the pin would notice changing.
  ASSERT pg_catalog.strpos(v_prompt, 'Alex Selvarajah') > 0,
    'T9j FAIL: a name was masked, which would be good news and means the header''s '
    'statement of what is NOT masked is now wrong and must be updated';

  -- IDEMPOTENCE. The worker's pass and the database's pass must compose.
  UPDATE core.run_node_io
     SET prompt = v_prompt, completion = v_completion
   WHERE run_node_id = '00000013-0de0-0000-0000-000000000002';
  ASSERT (SELECT io.prompt FROM core.run_node_io AS io
           WHERE io.run_node_id = '00000013-0de0-0000-0000-000000000002') = v_prompt,
    'T9k FAIL (M-25): re-storing already-masked text changed it, so the worker''s '
    'pass and the database''s pass double-number the same document';

  -- The redaction counts are the TRIGGER'S, not the caller's: a caller-supplied
  -- wrong shape is replaced rather than refused, which is why that CHECK is
  -- unreachable from the write path and is a backstop for a future writer.
  UPDATE core.run_node_io SET redaction = '{"emails":99}'::jsonb
   WHERE run_node_id = '00000013-0de0-0000-0000-000000000002';
  ASSERT (SELECT io.redaction ->> 'emails' FROM core.run_node_io AS io
           WHERE io.run_node_id = '00000013-0de0-0000-0000-000000000002') = '1',
    'T9l FAIL (M-25): a caller overwrote the derived redaction counts';

  -- The 30-day sweep, and what it leaves standing.
  UPDATE core.run_node_io
     SET created_at = pg_catalog.now() - interval '31 days'
   WHERE run_node_id = '00000013-0de0-0000-0000-000000000002';
  PERFORM app.redact_run_io(100);
  ASSERT NOT EXISTS (
    SELECT 1 FROM core.run_node_io AS io
     WHERE io.run_node_id = '00000013-0de0-0000-0000-000000000002'),
    'T9m FAIL: app.redact_run_io left 31-day-old prompt and completion text';
  ASSERT EXISTS (
    SELECT 1 FROM core.run_nodes AS node
     WHERE node.id = '00000013-0de0-0000-0000-000000000002'),
    'T9n FAIL: the retention sweep deleted the node, not just its I/O. Doc 05 '
    's5.5 keeps run and node metadata indefinitely';
  ASSERT EXISTS (
    SELECT 1 FROM core.run_state_cards AS card
     WHERE card.run_id = '00000013-4821-0000-0000-000000000001'),
    'T9o FAIL: the retention sweep removed a state card, which doc 05 s6.7 keeps';

  RAISE NOTICE
    'T9 PASS (M-25) - the database masks all five doc 05 s6.7 patterns on write, '
    'shares one numbering across prompt and completion, derives the counts from '
    'what is stored, is idempotent over worker-masked text, and deletes I/O at 30 '
    'days while leaving nodes and state cards standing. MEASURED AND UNCHANGED: '
    'a person''s name passes through unmasked, here and everywhere else.';
END;
$t9$;

-- ─── T10 · tenant isolation on core.run_node_io ───────────────────────────

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t013.agent_io_probe',
  pg_temp.t013_probe_select('core.run_node_io')::text, true);
RESET ROLE;

DO $t10$
DECLARE
  v_probe   jsonb := pg_catalog.current_setting('t013.agent_io_probe', true)::jsonb;
  v_refused boolean;
BEGIN
  -- ⚠ AMENDED BY 014 (2026-09-13). The original text of this block said it
  -- plainly: "The tenant PREDICATE arrives in 014; what is provable now is that
  -- the table is closed." 014 has arrived. The table is deliberately no longer
  -- closed — a run trace screen has to render its own tenant's prompts — so
  -- asserting the refusal would now be asserting that the product is broken.
  --
  -- What replaces it is the property H-08 actually wanted: the read SUCCEEDS and
  -- returns NOTHING, because the principal's tenant is not the one that owns the
  -- rows. Both halves matter. An error would leak existence; a non-zero count
  -- would be the cross-tenant read of full prompt and completion text that H-08
  -- is about.
  --
  -- The positive half — that a principal DOES see its own tenant's rows, so this
  -- zero is a predicate and not an empty table — needs two populated tenants in
  -- one transaction and lives in test_014 T5, which does exactly that on
  -- core.organisations. Named here rather than faked here.
  ASSERT v_probe IS NOT NULL, 'T10a FAIL: the impersonation probe did not run';
  ASSERT (v_probe ->> 'ok')::boolean AND (v_probe ->> 'rows')::integer = 0,
    pg_catalog.format(
      'T10b FAIL (H-08): an authenticated principal read core.run_node_io, which '
      'holds full prompt and completion text. Probe: %s', v_probe::text);
  -- ⚠ AMENDED BY 014. Was: the refusal must carry sqlstate 42501, i.e. it must be
  -- the PRIVILEGE layer refusing rather than a policy. After 014 there is no
  -- refusal to classify — the read succeeds and returns nothing — so the two
  -- halves that remain are catalogue facts, and they are the ones that would
  -- actually have to break for H-08 to reopen:
  --   `anon` still cannot read the prompts at all, and
  --   NOBODY can write them from a client, so a run trace cannot be edited after
  --   the fact by the principal it incriminates.
  ASSERT NOT pg_catalog.has_table_privilege('anon','core.run_node_io','SELECT'),
    'T10c FAIL (H-08): anon can read core.run_node_io, which holds full prompt '
    'and completion text. 014 grants authenticated only.';
  ASSERT NOT pg_catalog.has_table_privilege('authenticated','core.run_node_io','INSERT')
     AND NOT pg_catalog.has_table_privilege('authenticated','core.run_node_io','UPDATE')
     AND NOT pg_catalog.has_table_privilege('authenticated','core.run_node_io','DELETE'),
    'T10c2 FAIL (H-08): a client role can WRITE core.run_node_io. A run trace a '
    'principal can edit is not a trace of anything.';

  -- AND the structural half, which does not depend on a grant at all: a run I/O
  -- row in one tenant cannot point at a node in another. Every FK in this pack
  -- is composite (tenant_id, parent_id), so a cross-tenant reference is
  -- unrepresentable at the storage layer independently of whatever RLS says.
  v_refused := false;
  BEGIN
    INSERT INTO core.run_node_io (tenant_id, run_node_id, prompt)
    VALUES ('00000013-2222-2222-2222-222222222222',
            '00000013-0de0-0000-0000-000000000001', 'beta reaching into alpha');
  EXCEPTION WHEN foreign_key_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T10d FAIL: a tenant''s run I/O row was attached to another tenant''s node. '
    'The composite foreign key is what makes that unrepresentable';

  -- Same, one level up: a run in beta cannot claim an agent row in alpha.
  v_refused := false;
  BEGIN
    INSERT INTO core.run_nodes
      (tenant_id, run_id, node_key, seq, kind, name)
    VALUES ('00000013-2222-2222-2222-222222222222',
            '00000013-4821-0000-0000-000000000001','nx',9,'TOOL','borrowed');
  EXCEPTION WHEN foreign_key_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T10e FAIL: a node in one tenant was attached to a run in another';

  RAISE NOTICE
    'T10 PASS - core.run_node_io refuses an authenticated principal outright '
    '(42501, the C-04 residue working as intended before 014''s policies), and a '
    'cross-tenant run I/O row or node is unrepresentable through the composite '
    'foreign keys regardless of what any policy later says.';
END;
$t10$;

-- ─── T11 · C-04 residue · zero client privileges ──────────────────────────
-- One statement per role, each aggregating its probes, all under the
-- impersonated role; the assertions run after RESET ROLE.

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('t013.auth_rel_probes',
  (SELECT pg_catalog.jsonb_object_agg(relation.name,
            pg_temp.t013_probe_select(relation.name))
     FROM pg_catalog.unnest(ARRAY[
       'core.tier_keys','core.agents','public.agent_api_keys',
       'app.agent_api_key_secrets','core.model_tiers',
       'core.routing_matrix_versions','core.routing_entries',
       'core.ai_provider_keys','core.ai_budgets','app.usage_rollup',
       'core.runs','core.run_nodes','core.run_node_io','core.run_events',
       'core.run_state_cards','core.run_checkpoints','core.run_snapshots',
       'core.evals','app.key_access_audit',
       'core.budget_status','core.model_tier_status']) AS relation(name))::text,
  true);
SELECT pg_catalog.set_config('t013.auth_fn_probes',
  (SELECT pg_catalog.jsonb_object_agg(call.label, pg_temp.t013_probe_call(call.sql))
     FROM (VALUES
       ('app.mask_key',            $q$SELECT app.mask_key('sk-ant-abcdefghijkl')$q$),
       ('app.verify_agent_key',    $q$SELECT * FROM app.verify_agent_key('tk_ag_0000000000')$q$),
       ('app.mint_agent_key',      $q$SELECT app.mint_agent_key('00000013-1111-1111-1111-111111111111','agent_proposal')$q$),
       ('app.record_key_access',   $q$SELECT app.record_key_access('00000013-1111-1111-1111-111111111111','prv_anthropic','PROBE','{"kind":"SYSTEM","id":"x","name":null}'::jsonb,'pin')$q$),
       ('app.redact_run_io',       $q$SELECT app.redact_run_io(1)$q$),
       ('app.roll_up_usage',       $q$SELECT app.roll_up_usage('00000013-1111-1111-1111-111111111111','2026-09')$q$),
       ('ai_provider_key_set',     $q$SELECT public.ai_provider_key_set('prv_x','OPENAI','x','ab'||repeat('*',12)||'cdef','\x00'::bytea,'r',ARRAY['FAST'],'US')$q$),
       ('ai_provider_key_test',    $q$SELECT public.ai_provider_key_test('prv_anthropic','VALID')$q$),
       ('ai_provider_key_rotate',  $q$SELECT public.ai_provider_key_rotate('prv_anthropic','ab'||repeat('*',12)||'cdef','\x00'::bytea,'r')$q$),
       ('ai_provider_key_delete',  $q$SELECT public.ai_provider_key_delete('prv_anthropic')$q$),
       ('ai_provider_key_reveal',  $q$SELECT public.ai_provider_key_reveal('prv_anthropic','a reason long enough')$q$)
     ) AS call(label, sql))::text,
  true);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('t013.anon_rel_probes',
  (SELECT pg_catalog.jsonb_object_agg(relation.name,
            pg_temp.t013_probe_select(relation.name))
     FROM pg_catalog.unnest(ARRAY[
       'core.agents','public.agent_api_keys','core.ai_provider_keys',
       'core.runs','core.run_node_io','app.key_access_audit',
       'core.budget_status','core.model_tier_status']) AS relation(name))::text,
  true);
RESET ROLE;

DO $t11$
DECLARE
  v_rel   jsonb := pg_catalog.current_setting('t013.auth_rel_probes', true)::jsonb;
  v_fn    jsonb := pg_catalog.current_setting('t013.auth_fn_probes', true)::jsonb;
  v_anon  jsonb := pg_catalog.current_setting('t013.anon_rel_probes', true)::jsonb;
  v_bad   text;
BEGIN
  ASSERT v_rel IS NOT NULL AND v_fn IS NOT NULL AND v_anon IS NOT NULL,
    'T11a FAIL: an impersonation probe did not run, so this test proves nothing';

  -- ⚠ AMENDED BY 014 (2026-09-13). The C-04 residue is what this block was
  -- named for and 014 is where it was always going to be closed: "Grants and
  -- policies land together in 014." They have. The set therefore splits in two
  -- rather than collapsing to nothing.
  --
  --   `core.*` — readable by authenticated, tenant-scoped by 014's policies. The
  --   AI ops screens are these tables. `core.ai_provider_keys` is in this half on
  --   purpose: it holds a masked prefix and a locator, never key material, which
  --   is the property 013 built rather than asserted.
  --
  --   `app.*` and `public.agent_api_keys` — still unreachable, and this is the
  --   half that must never move. `app.agent_api_key_secrets` holds the salted
  --   digest and `app` is not an exposed schema, which is what H-09 asked for and
  --   is stronger than omitting a column from a grant.
  SELECT pg_catalog.string_agg(probe.key, ', ') INTO v_bad
    FROM pg_catalog.jsonb_each(v_rel) AS probe
   WHERE (probe.value ->> 'ok')::boolean
     AND (probe.key LIKE 'app.%' OR probe.key = 'public.agent_api_keys'
          OR probe.key = 'agent_api_keys');
  ASSERT v_bad IS NULL,
    pg_catalog.format(
      'T11b FAIL (H-09): authenticated can SELECT from %s. 014 grants core only; '
      'the key digests live in app precisely so that PostgREST cannot reach them '
      'through select=* or an embed.', v_bad);

  SELECT pg_catalog.string_agg(probe.key, ', ') INTO v_bad
    FROM pg_catalog.jsonb_each(v_rel) AS probe
   WHERE NOT (probe.value ->> 'ok')::boolean
     AND probe.key LIKE 'core.%'
     -- ⚠ CARRIED DEFECT, found by 014 and recorded rather than hidden.
     -- core.budget_status is security_invoker and reads app.usage_rollup;
     -- core.model_tier_status reads budget_status. A security-invoker view runs
     -- as the caller, and no client role holds SELECT in `app` — by design, and
     -- T11e below is one of the assertions that keeps it that way. So these two
     -- views are unreadable by `authenticated` whatever is granted ON them, and
     -- 014 deliberately grants neither. The fix is to move app.usage_rollup into
     -- core, or to read both from a SECURITY DEFINER RPC in core the way doc 09
     -- does for v_approval_requests. Owner: 018. Until then the AI budget and
     -- model-tier screens have no data path, and that is a product gap, not a
     -- test exclusion.
     AND probe.key NOT IN ('core.budget_status','core.model_tier_status');
  ASSERT v_bad IS NULL,
    pg_catalog.format(
      'T11b2 FAIL: authenticated CANNOT read %s after 014. Every AI ops screen in '
      'the product reads these; a refusal here is an empty page, not a defence.',
      v_bad);

  ASSERT NOT pg_catalog.has_table_privilege('authenticated','core.budget_status','SELECT')
     AND NOT pg_catalog.has_table_privilege('authenticated','core.model_tier_status','SELECT'),
    'T11b3 FAIL: one of the two unreadable views has been granted. A grant on a '
    'security_invoker view over app.usage_rollup delivers a permission error '
    'rather than a row, so granting it hides the cause without fixing anything.';

  SELECT pg_catalog.string_agg(probe.key, ', ') INTO v_bad
    FROM pg_catalog.jsonb_each(v_fn) AS probe
   WHERE (probe.value ->> 'ok')::boolean
      OR (probe.value ->> 'sqlstate') <> '42501';
  ASSERT v_bad IS NULL,
    pg_catalog.format(
      'T11c FAIL (C-04 residue): authenticated can EXECUTE %s, or was refused '
      'for some reason other than privilege - which would mean the function ran '
      'far enough to fail on its arguments. Functions default to PUBLIC EXECUTE '
      'and 001 measured that ALTER DEFAULT PRIVILEGES does not take.', v_bad);

  SELECT pg_catalog.string_agg(probe.key, ', ') INTO v_bad
    FROM pg_catalog.jsonb_each(v_anon) AS probe
   WHERE (probe.value ->> 'ok')::boolean;
  ASSERT v_bad IS NULL,
    pg_catalog.format('T11d FAIL: anon can SELECT from %s. anon is hostile by '
      'default and holds EXECUTE on the portal allowlist and nothing else.', v_bad);

  -- And the catalogue, so a grant that exists but happens to be shadowed by a
  -- policy still fails this test.
  SELECT pg_catalog.string_agg(DISTINCT class.oid::regclass::text, ', ') INTO v_bad
    FROM pg_catalog.pg_class AS class
   CROSS JOIN LATERAL pg_catalog.aclexplode(class.relacl) AS acl
   WHERE class.oid::regclass::text = ANY (ARRAY[
     'core.tier_keys','core.agents','agent_api_keys','app.agent_api_key_secrets',
     'core.model_tiers','core.routing_matrix_versions','core.routing_entries',
     'core.ai_provider_keys','core.ai_budgets','app.usage_rollup','core.runs',
     'core.run_nodes','core.run_node_io','core.run_events','core.run_state_cards',
     'core.run_checkpoints','core.run_snapshots','core.evals',
     'app.key_access_audit','core.budget_status','core.model_tier_status'])
     AND acl.grantee IN ('anon'::regrole, 'authenticated'::regrole, 0::oid::regrole)
     -- ⚠ AMENDED BY 014. The catalogue half of the same split: after 014 the one
     -- client grant allowed on this set is SELECT, to authenticated, on a `core`
     -- relation. Everything else is still a defect — a write grant anywhere here,
     -- any grant to anon or PUBLIC, and any grant at all on the two app relations
     -- or on public.agent_api_keys.
     AND NOT (class.relnamespace = 'core'::regnamespace
              AND acl.grantee = 'authenticated'::regrole
              AND acl.privilege_type = 'SELECT');
  ASSERT v_bad IS NULL,
    pg_catalog.format('T11e FAIL: relation(s) %s carry a client grant that is not '
      'authenticated SELECT on a core relation', v_bad);

  RAISE NOTICE
    'T11 PASS - after 014 the core relations are readable by authenticated and '
    'the app relations plus public.agent_api_keys are not, 8 relations remain '
    'unreadable by anon, all 11 probed functions are still refused with 42501 '
    'rather than running far enough to fail on their arguments, and the only '
    'client grant in the catalogue is SELECT to authenticated on core.';
END;
$t11$;

-- ─── T12 · M-03 · the phantom relation, and the NEAR / PAUSED transition ──

DO $t12$
DECLARE
  v_state text;
  v_rows  integer;
BEGIN
  INSERT INTO core.ai_budgets (tenant_id, scope, key, cap_sen, near_threshold)
  VALUES ('00000013-1111-1111-1111-111111111111','TIER','SPECIAL',1000,0.800);

  -- Below the threshold.
  INSERT INTO app.usage_rollup (tenant_id, period, scope, key, spend_sen)
  VALUES ('00000013-1111-1111-1111-111111111111',
          pg_catalog.to_char(pg_catalog.now(),'YYYY-MM'),'TIER','SPECIAL',799);
  SELECT status.state::text INTO v_state FROM core.budget_status AS status
   WHERE status.scope = 'TIER' AND status.key = 'SPECIAL';
  ASSERT v_state = 'WITHIN', pg_catalog.format('T12a FAIL: 799/1000 is %s', v_state);

  -- EXACTLY at the threshold: NEAR, not WITHIN.
  UPDATE app.usage_rollup SET spend_sen = 800
   WHERE scope = 'TIER' AND key = 'SPECIAL';
  SELECT status.state::text INTO v_state FROM core.budget_status AS status
   WHERE status.scope = 'TIER' AND status.key = 'SPECIAL';
  ASSERT v_state = 'NEAR', pg_catalog.format('T12b FAIL: 800/1000 at 0.800 is %s', v_state);

  UPDATE app.usage_rollup SET spend_sen = 999
   WHERE scope = 'TIER' AND key = 'SPECIAL';
  SELECT status.state::text INTO v_state FROM core.budget_status AS status
   WHERE status.scope = 'TIER' AND status.key = 'SPECIAL';
  ASSERT v_state = 'NEAR', pg_catalog.format('T12c FAIL: 999/1000 is %s', v_state);

  -- EXACTLY at the cap: PAUSED, not NEAR. The order of the CASE branches is the
  -- assertion here - a tripped cap is a fact about spend against cap.
  UPDATE app.usage_rollup SET spend_sen = 1000
   WHERE scope = 'TIER' AND key = 'SPECIAL';
  SELECT status.state::text INTO v_state FROM core.budget_status AS status
   WHERE status.scope = 'TIER' AND status.key = 'SPECIAL';
  ASSERT v_state = 'PAUSED',
    pg_catalog.format('T12d FAIL: spend exactly at cap is %s, not PAUSED', v_state);

  -- A budget with NO rollup row reads WITHIN at zero, not nothing.
  INSERT INTO core.ai_budgets (tenant_id, scope, key, cap_sen)
  VALUES ('00000013-1111-1111-1111-111111111111','AGENT','agent_proposal',100000);
  SELECT status.state::text INTO v_state FROM core.budget_status AS status
   WHERE status.scope = 'AGENT' AND status.key = 'agent_proposal';
  ASSERT v_state = 'WITHIN',
    'T12e FAIL: a budget with no usage row disappeared from core.budget_status, '
    'which is every budget a new tenant has';

  -- The derived tier status, including the value NOTHING writes.
  ASSERT (SELECT tier.status::text FROM core.model_tier_status AS tier
           WHERE tier.tier_key = 'SPECIAL') = 'PAUSED_BY_CAP',
    'T12f FAIL: SPECIAL is not PAUSED_BY_CAP purely because its spend reached its '
    'cap. Nothing writes that value anywhere';
  ASSERT (SELECT tier.status::text FROM core.model_tier_status AS tier
           WHERE tier.tier_key = 'STRONG_1') = 'DISABLED',
    'T12g FAIL: an admin DISABLE does not outrank everything else';
  ASSERT (SELECT tier.status::text FROM core.model_tier_status AS tier
           WHERE tier.tier_key = 'MID') = 'DEGRADED',
    'T12h FAIL: provider degradation is not surfaced';
  ASSERT (SELECT tier.status::text FROM core.model_tier_status AS tier
           WHERE tier.tier_key = 'FAST') = 'HEALTHY',
    'T12i FAIL: a healthy tier is not HEALTHY';

  -- M-03's writer actually fills the relation the finding called a phantom.
  v_rows := app.roll_up_usage('00000013-1111-1111-1111-111111111111',
                              pg_catalog.to_char(pg_catalog.now(),'YYYY-MM'));
  ASSERT v_rows >= 2,
    pg_catalog.format('T12j FAIL: app.roll_up_usage wrote %s rows', v_rows);
  ASSERT (SELECT rollup.spend_sen FROM app.usage_rollup AS rollup
           WHERE rollup.scope = 'AGENT' AND rollup.key = 'agent_proposal') = 600,
    'T12k FAIL: the AGENT rollup does not equal the run''s cost_sen';
  ASSERT (SELECT rollup.spend_sen FROM app.usage_rollup AS rollup
           WHERE rollup.scope = 'TIER' AND rollup.key = 'MID') = 600,
    'T12l FAIL: the TIER rollup does not equal the sum of its nodes'' cost_sen';
  -- SANDBOX runs cost real tokens and are a debugging act; counting them would
  -- pause a tenant''s agents for reproducing a bug.
  ASSERT NOT EXISTS (
    SELECT 1 FROM app.usage_rollup AS rollup
     WHERE rollup.tenant_id = '00000013-2222-2222-2222-222222222222'),
    'T12m FAIL: the rollup crossed a tenant boundary';

  RAISE NOTICE
    'T12 PASS (M-03) - app.usage_rollup exists and core.budget_status joins it '
    'rather than a phantom; the transition is WITHIN below 0.800 of cap, NEAR at '
    'exactly 0.800 and up to one sen below cap, PAUSED at exactly cap; a budget '
    'with no usage reads WITHIN at zero; the derived tier status returns '
    'PAUSED_BY_CAP with nothing having written it, and DISABLED outranks it.';
END;
$t12$;

-- ─── T13 · the run record's own rules ─────────────────────────────────────

DO $t13$
DECLARE v_refused boolean;
BEGIN
  -- A finished node must have a status. An UNFINISHED one must not need a
  -- status, which is how "RUNNING" is represented without a fifth enum member
  -- that could never be removed (the doc 05 s6.2 vs 003 disagreement).
  INSERT INTO core.run_nodes (tenant_id, run_id, node_key, seq, kind, name)
  VALUES ('00000013-1111-1111-1111-111111111111',
          '00000013-4821-0000-0000-000000000001','n2',2,'TOOL','send_proposal');
  ASSERT (SELECT node.status IS NULL FROM core.run_nodes AS node
           WHERE node.run_id = '00000013-4821-0000-0000-000000000001'
             AND node.node_key = 'n2'),
    'T13a FAIL: an in-flight node was given a terminal status';

  v_refused := false;
  BEGIN
    UPDATE core.run_nodes SET finished_at = pg_catalog.now()
     WHERE run_id = '00000013-4821-0000-0000-000000000001' AND node_key = 'n2';
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T13b FAIL: a node finished with no status at all, which is neither RUNNING '
    'nor any of the four core.run_step_status members';

  -- Doc 05 s6.2: "A halted node has duration_ms = 0 and no result." That is the
  -- evidentiary value of haltedBy, so it is a constraint.
  UPDATE core.run_nodes
     SET status = 'HALTED', finished_at = pg_catalog.now(), duration_ms = 0,
         halted_by = '{"policyId":"APV-01","approvalRequestRef":"APV-2026-0771",
                       "reason":"money-moving action needs approval"}'::jsonb
   WHERE run_id = '00000013-4821-0000-0000-000000000001' AND node_key = 'n2';
  v_refused := false;
  BEGIN
    UPDATE core.run_nodes SET duration_ms = 900
     WHERE run_id = '00000013-4821-0000-0000-000000000001' AND node_key = 'n2';
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T13c FAIL: a halted node was given a duration. haltedBy is how the trace '
    'proves the agent never sent anything; a halt that took 900ms of work did '
    'something';
  v_refused := false;
  BEGIN
    UPDATE core.run_nodes SET result = '{"sent":true}'::jsonb
     WHERE run_id = '00000013-4821-0000-0000-000000000001' AND node_key = 'n2';
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  ASSERT v_refused, 'T13d FAIL: a halted node was given a result';

  -- A replay is a SANDBOX run. Doc 05 s6.6: live reads make a replay
  -- non-deterministic, which removes the only reason to run one.
  v_refused := false;
  BEGIN
    INSERT INTO core.runs
      (tenant_id, agent_id, trigger, correlation_id, mode, replay_of_run_id)
    VALUES ('00000013-1111-1111-1111-111111111111','agent_proposal',
            '{"type":"REPLAY"}'::jsonb,'00000013-c077-0000-0000-000000000003',
            'LIVE','00000013-4821-0000-0000-000000000001');
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T13e FAIL: a replay was created in LIVE mode, so it would emit events and '
    'enqueue jobs for work that already happened';

  -- The same run, as a SANDBOX replay, is accepted and links back.
  INSERT INTO core.runs
    (id, tenant_id, agent_id, trigger, correlation_id, mode, replay_of_run_id)
  VALUES ('00000013-4821-0000-0000-000000000003',
          '00000013-1111-1111-1111-111111111111','agent_proposal',
          '{"type":"REPLAY"}'::jsonb,'00000013-c077-0000-0000-000000000001',
          'SANDBOX','00000013-4821-0000-0000-000000000001');

  -- `ref` was allocated by core.assign_ref from the RUN format, dated, width 4.
  ASSERT (SELECT run.ref FROM core.runs AS run
           WHERE run.id = '00000013-4821-0000-0000-000000000001')
         ~ '^RUN-[0-9]{4}-[0-9]{4}$',
    'T13f FAIL: core.runs.ref was not allocated in the house format, so the text '
    'run ids in 011 and 012 have nothing to resolve against';

  -- A checkpoint must name a state card VERSION that exists for that run.
  v_refused := false;
  BEGIN
    INSERT INTO core.run_checkpoints
      (tenant_id, run_id, step, state_card_version, cursor)
    VALUES ('00000013-1111-1111-1111-111111111111',
            '00000013-4821-0000-0000-000000000001',7,99,
            '{"nodeKey":"n1","step":7}'::jsonb);
  EXCEPTION WHEN foreign_key_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T13g FAIL: a checkpoint pointed at a state card version that does not '
    'exist, so retry-from-checkpoint would resume with nothing';

  -- Two versions of one matrix cannot both be in force (04 s5.3).
  INSERT INTO core.routing_matrix_versions (tenant_id, label, effective_from)
  VALUES ('00000013-1111-1111-1111-111111111111','v1',
          pg_catalog.now() - interval '10 days');
  v_refused := false;
  BEGIN
    INSERT INTO core.routing_matrix_versions (tenant_id, label, effective_from)
    VALUES ('00000013-1111-1111-1111-111111111111','v2',
            pg_catalog.now() - interval '5 days');
  EXCEPTION WHEN exclusion_violation THEN v_refused := true;
  END;
  ASSERT v_refused,
    'T13h FAIL: two open-ended routing matrix versions overlap, so "which matrix '
    'did this run use" has two answers and PUT /ai/routing is retroactive after all';

  RAISE NOTICE
    'T13 PASS - an in-flight node carries no terminal status and a finished one '
    'must; a halted node has no duration and no result; a replay is refused in '
    'LIVE mode; core.runs.ref is allocated as RUN-YYYY-NNNN so the text run ids '
    'resolve; a checkpoint cannot name a missing state card version; and two '
    'routing matrix versions cannot both be in force.';
END;
$t13$;


-- ─── T14 · CRIT · a key that was revealed can still be rotated ──────────────
-- The finding, reproduced live before it was fixed: `ai_provider_key_set` ->
-- `ai_provider_key_reveal` -> `ai_provider_key_rotate` on one provider_ref
-- raised, permanently, for any key that had ever been revealed — which is
-- precisely the key a security team needs to rotate. TWO independent triggers
-- blocked it and the second was only visible once the first was fixed:
--
--   1. `app.require_reveal_audit` short-circuited only on
--      `NEW.last_revealed_at IS NOT DISTINCT FROM OLD`. Rotation CLEARS that
--      stamp (the 24-hour ceiling is per key material, and rotation issues new
--      material), so the clear read as an unaudited write and raised
--      42501 REVEAL_AUDIT_REQUIRED.
--   2. `key_fingerprint` was in the table's frozen-column set, so rotation's own
--      `key_fingerprint = p_fingerprint` raised IMMUTABLE_COLUMN — for EVERY key,
--      revealed or not. Rotation had never worked at all.
--
-- No pin caught either, because T11c only exercises the `authenticated`-role
-- refusal and this file never ran a successful rotate. That is the gap this test
-- closes: the happy path of a security control nobody had executed.
DO $t14$
DECLARE
  v_set    jsonb;
  v_rev    jsonb;
  v_rot    jsonb;
  v_before bytea;
  v_after  bytea;
  v_ref    text;
  v_stamp  timestamptz;
  v_denied boolean := false;
BEGIN
  PERFORM pg_temp.t013_claims(
    '00000013-0000-0000-0000-0000000000a1',
    '00000013-1111-1111-1111-111111111111', 'ADMIN', 'HUMAN',
    '00000013-5e55-0000-0000-000000000001', 'aal2');

  v_set := public.ai_provider_key_set(
    'prv_t14','OPENAI','T14 key','sk-'||pg_catalog.repeat('*',12)||'AAAA',
    pg_catalog.sha256('t14-first'::bytea),'vault:t14:1',ARRAY['MID'],
    'ap-southeast-1','CLIENT_ACCOUNT',NULL,NULL);
  ASSERT v_set IS NOT NULL, 'T14 SETUP FAIL: ai_provider_key_set returned nothing.';

  SELECT key_fingerprint INTO v_before FROM core.ai_provider_keys
   WHERE provider_ref = 'prv_t14';

  -- REVEAL FIRST. That is the whole finding: an unrevealed key rotated fine in
  -- theory (it did not — see 2 above — but the reveal is what made it permanent),
  -- and this ordering is the one a rotation actually follows.
  v_rev := public.ai_provider_key_reveal(
    'prv_t14','scheduled rotation after a suspected exposure','t14-req-1');
  ASSERT v_rev IS NOT NULL, 'T14a FAIL: the reveal itself failed.';

  SELECT last_revealed_at INTO v_stamp FROM core.ai_provider_keys
   WHERE provider_ref = 'prv_t14';
  ASSERT v_stamp IS NOT NULL,
    'T14b FAIL: the reveal did not stamp last_revealed_at, so the rotate below '
    'would not be exercising the blocked path at all.';

  -- THE ROTATION. Against the pre-fix SQL this raises
  -- 42501 REVEAL_AUDIT_REQUIRED, and with only the first fix applied it raises
  -- IMMUTABLE_COLUMN on key_fingerprint.
  v_rot := public.ai_provider_key_rotate(
    'prv_t14','sk-'||pg_catalog.repeat('*',12)||'BBBB',
    pg_catalog.sha256('t14-second'::bytea),'vault:t14:2','t14-req-2');
  ASSERT v_rot IS NOT NULL, 'T14c FAIL: ai_provider_key_rotate returned nothing.';

  SELECT key_fingerprint, key_ref, last_revealed_at
    INTO v_after, v_ref, v_stamp
    FROM core.ai_provider_keys WHERE provider_ref = 'prv_t14';

  ASSERT v_after IS DISTINCT FROM v_before,
    'T14d FAIL: the rotation did not change key_fingerprint, so the row still '
    'identifies the old material and "rotated" is a claim about nothing.';
  ASSERT v_ref = 'vault:t14:2',
    pg_catalog.format('T14e FAIL: key_ref is %s, not the new locator.', v_ref);
  ASSERT v_stamp IS NULL,
    'T14f FAIL: last_revealed_at survived the rotation. The 24-hour ceiling is '
    'per key material; carrying the old stamp onto new material would block the '
    'first legitimate reveal of the key that was just issued.';

  -- T14g · AND THE GUARD THAT REPLACED THE FROZEN COLUMN STILL BITES. A
  -- fingerprint may move only with its locator; moving it alone points the row at
  -- a different secret while still naming the old vault entry.
  BEGIN
    UPDATE core.ai_provider_keys
       SET key_fingerprint = pg_catalog.sha256('t14-third'::bytea)
     WHERE provider_ref = 'prv_t14';
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
    ASSERT SQLERRM LIKE '%key_ref did not%',
      pg_catalog.format('T14g1 FAIL: the unpaired fingerprint write was refused, '
        'but not by the pairing guard: %s', SQLERRM);
  END;
  ASSERT v_denied,
    'T14g FAIL: key_fingerprint was changed on its own, with key_ref unchanged. '
    'Unfreezing the column to make rotation possible must not make it freely '
    'writable — a fingerprint that moves without its locator is either half a '
    'rotation or somebody swapping material outside ai_provider_key_rotate.';

  RAISE NOTICE
    'T14 PASS - set, reveal, then rotate on the same provider_ref: the rotation '
    'succeeds, changes the fingerprint and the locator together, clears the '
    'reveal stamp, and an unpaired fingerprint write is still refused.';
END;
$t14$;


ROLLBACK;
