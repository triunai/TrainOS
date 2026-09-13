-- ============================================================================
-- ROLLBACK 011 · action_envelope_and_policy_gate
-- ============================================================================
--
-- Forward file: migrations/011_action_envelope_and_policy_gate.sql
--
-- PRIOR STATE THIS RESTORES. The database as 010 left it: no gate tables,
-- approval view, effect-status enum, action functions, state-gate triggers or
-- 011 catalogue rows. app.action_types itself SURVIVES and is restored to the
-- empty global catalogue 004 created.
--
-- The surviving app.action_types definition, reproduced in full rather than by
-- reference: key text PK; label text NOT NULL; domain text NOT NULL constrained
-- to SALES/OPS/FINANCE/COMPLIANCE/GOVERNANCE; money_moving, client_facing,
-- hrdc_touching and reversible booleans NOT NULL default false;
-- ceiling_autonomy text NOT NULL default ACT_WITH_APPROVAL constrained to the
-- four autonomy levels; ceiling_reason constrained to MONEY_MOVING,
-- CLIENT_COMMITMENT, HRDC_STATE, SAFETY or NONE; target_entity text NOT NULL;
-- payload_schema jsonb NOT NULL default {"required":[]} with key-presence and
-- array-type CHECK; value_source constrained to QUOTATION, INVOICE, HRDC_CLAIM,
-- PAYMENT, BUDGET_CAP or NONE; max_effect_attempts integer NOT NULL default 5;
-- active boolean NOT NULL default true; created_at timestamptz NOT NULL default
-- now(); money and HRDC ceiling CHECKs; forced RLS; the permissive
-- action_types_definer_read policy; and zero anon/authenticated table grants.
--
-- ⛔ PRE-FLIGHT. Five guards, none with an override.
--
--   G1  Refuse a known 012-015 relation, a later policy/grant, or a later trigger
--       attachment. Rollbacks proceed newest-first; CASCADE is not a scheduler.
--   G2  Refuse any operational row in a gate table. Action payloads, decisions,
--       grants, effects and jury records are audit/business data.
--   G3  Refuse seed drift: exactly the 22 action types, 22 policies per tenant,
--       and 124 registry edges (121 from doc 01 §5.3 + 3 reversal edges) must still be present before they are removed.
--   G4  Refuse any 004 hours-saved baseline that references an 011 action type.
--   G5  Refuse a relation or FK outside 011 that depends on an 011 table.
--
-- DROP ORDER. Reverse of forward creation after removing cross-table bindings:
-- callback/bulk/jury/sweeps/decision/envelope/executors/helpers; view and gate
-- triggers; tenant seed trigger; circular and 007/010 FKs; then state registry,
-- jury, drafts, idempotency, approvals, effects, actions, policies and grants;
-- catalogue rows; validators; finally app.effect_status with RESTRICT.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE
  v_n        bigint;
  v_name     text;
  v_dep      text;
  v_expected text[] := ARRAY[
    'ACCOUNT_TRADING_HOLD','AGENT_AUTONOMY_CHANGE','AGENT_PAUSE','ATTENDANCE_APPROVE',
    'ATTENDANCE_UNLOCK','BROADCAST_SEND','BUDGET_CAP_RAISE','DISCOUNT_APPROVE',
    'ENGAGEMENT_CLOSE_OUT','ENQUIRY_ARCHIVE','FOLLOWUP_SEND',
    'HRDC_PACKET_MARK_SUBMITTED','INVOICE_CREATE','INVOICE_PUSH',
    'OPPORTUNITY_CONVERT','PAYMENT_RECORD','PROPOSAL_SEND','QUOTATION_APPLY',
    'REMINDER_SEND','RULE_CHANGE_APPROVE','TNA_RECOMMENDATION_ACCEPT','TRAINER_BOOK'];
BEGIN
  -- ── G1 · later packs are not applied ─────────────────────────────────────
  SELECT marker.name INTO v_name
    FROM (VALUES
      ('core.events'),('core.event_subjects'),('core.runs'),('core.run_nodes'),
      ('core.run_node_io'),('core.run_events'),('core.run_state_cards'),
      ('core.run_checkpoints'),('core.run_snapshots'),('core.evals'),('core.agents'),
      ('app.outbox'),('app.dead_letters'),('app.event_subscriptions'),
      ('app.webhook_deliveries'),('app.webhook_routes'),('app.key_access_audit'),
      ('app.job_type_map'),('app.ai_budgets')
    ) AS marker(name)
   WHERE pg_catalog.to_regclass(marker.name) IS NOT NULL
   ORDER BY marker.name
   LIMIT 1;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: later-pack relation % exists. Roll back 012-015 first.',
      v_name USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE (namespace.nspname,class.relname) IN (
       ('core','autonomy_grants'),('core','action_policies'),('core','action_requests'),
       ('app','action_effects'),('core','approval_requests'),
       ('core','approval_decisions'),('app','idempotency_keys'),
       ('core','suggested_drafts'),('core','jury_configs'),('core','jury_verdicts'),
       ('core','state_transitions'))
       AND policy.polname <> 'autonomy_grants_agents_cannot_write') THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: a later migration added a gate-table policy; roll it back first.'
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('core.autonomy_grants'),('core.action_policies'),('core.action_requests'),
      ('app.action_effects'),('core.approval_requests'),('core.approval_decisions'),
      ('app.idempotency_keys'),('core.suggested_drafts'),('core.jury_configs'),
      ('core.jury_verdicts'),('core.state_transitions'),('core.v_approval_requests')
    ) AS object(name)
    CROSS JOIN (VALUES ('anon'),('authenticated')) AS client(role_name)
   WHERE pg_catalog.to_regclass(object.name) IS NOT NULL
     AND (pg_catalog.has_table_privilege(client.role_name,object.name,'SELECT')
          OR pg_catalog.has_table_privilege(client.role_name,object.name,'INSERT')
          OR pg_catalog.has_table_privilege(client.role_name,object.name,'UPDATE')
          OR pg_catalog.has_table_privilege(client.role_name,object.name,'DELETE'))) THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: later client grants exist on a gate relation; roll back 014 first.'
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE NOT trigger.tgisinternal
       AND trigger.tgfoid = 'app.enforce_state_transition()'::regprocedure
       AND trigger.tgrelid NOT IN (
         'core.enquiries'::regclass,'core.opportunities'::regclass,'core.tnas'::regclass,
         'core.proposals'::regclass,'core.quotations'::regclass,
         'core.engagements'::regclass,'core.attendance_days'::regclass,
         'core.hrdc_packets'::regclass,'core.invoices'::regclass,
         'core.collections_cases'::regclass,'core.trainer_bookings'::regclass,
         'core.compliance_rules'::regclass,'core.rule_changes'::regclass,
         'core.outbound_messages'::regclass)) THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: a later table uses app.enforce_state_transition().'
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G2 · no operational gate data ────────────────────────────────────────
  FOREACH v_name IN ARRAY ARRAY[
    'core.autonomy_grants','core.action_requests','app.action_effects',
    'core.approval_requests','core.approval_decisions','app.idempotency_keys',
    'core.suggested_drafts','core.jury_configs','core.jury_verdicts']
  LOOP
    IF pg_catalog.to_regclass(v_name) IS NOT NULL THEN
      EXECUTE pg_catalog.format('SELECT count(*) FROM %s',v_name) INTO v_n;
      IF v_n > 0 THEN
        RAISE EXCEPTION
          'rollback 011 ABORTED: % holds % row(s). Export and reconcile them before rollback.',
          v_name,v_n USING ERRCODE = 'dependent_objects_still_exist';
      END IF;
    END IF;
  END LOOP;

  -- ── G3 · only the exact owned seed is about to be removed ────────────────
  IF (SELECT pg_catalog.count(*) FROM app.action_types) <> 22
     OR (SELECT pg_catalog.array_agg(action_type.key ORDER BY action_type.key)
           FROM app.action_types AS action_type) <> v_expected THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: app.action_types is not the exact 22-row 011 seed.'
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.state_transitions) <> 124 THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: state_transitions is not the exact 124-row seed (121 from doc 01 §5.3 plus the three payment-reversal edges 011 adds).'
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.action_policies)
     <> 22 * (SELECT pg_catalog.count(*) FROM public.tenants)
     OR EXISTS (
       SELECT tenant.id FROM public.tenants AS tenant
       LEFT JOIN core.action_policies AS policy ON policy.tenant_id = tenant.id
       GROUP BY tenant.id HAVING pg_catalog.count(policy.id) <> 22) THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: action_policies is not the exact 22-per-tenant seed.'
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G4 · 004-owned baselines must not refer to rows 011 will delete ───────
  SELECT pg_catalog.count(*) INTO v_n
    FROM core.hours_saved_baselines AS baseline
   WHERE baseline.action_type = ANY (v_expected);
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: core.hours_saved_baselines has % reference(s) to 011 action types.',
      v_n USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- ── G5 · no later view or FK depends on an 011 table ─────────────────────
  SELECT pg_catalog.string_agg(DISTINCT dependency.name, ', ' ORDER BY dependency.name)
    INTO v_dep
    FROM (
      SELECT dependent_namespace.nspname || '.' || dependent.relname AS name
        FROM pg_catalog.pg_depend AS dependency
        JOIN pg_catalog.pg_rewrite AS rewrite ON rewrite.oid = dependency.objid
        JOIN pg_catalog.pg_class AS dependent ON dependent.oid = rewrite.ev_class
        JOIN pg_catalog.pg_namespace AS dependent_namespace
          ON dependent_namespace.oid = dependent.relnamespace
       WHERE dependency.refobjid IN (
         SELECT class.oid FROM pg_catalog.pg_class AS class
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
         WHERE (namespace.nspname,class.relname) IN (
           ('core','autonomy_grants'),('core','action_policies'),('core','action_requests'),
           ('app','action_effects'),('core','approval_requests'),
           ('core','approval_decisions'),('app','idempotency_keys'),
           ('core','suggested_drafts'),('core','jury_configs'),('core','jury_verdicts'),
           ('core','state_transitions')))
         AND (dependent_namespace.nspname,dependent.relname) <>
             ('core','v_approval_requests')
      UNION
      SELECT child_namespace.nspname || '.' || child.relname
        FROM pg_catalog.pg_constraint AS constraint_row
        JOIN pg_catalog.pg_class AS child ON child.oid = constraint_row.conrelid
        JOIN pg_catalog.pg_namespace AS child_namespace
          ON child_namespace.oid = child.relnamespace
       WHERE constraint_row.contype = 'f'
         AND constraint_row.confrelid IN (
           SELECT class.oid FROM pg_catalog.pg_class AS class
           JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
           WHERE (namespace.nspname,class.relname) IN (
             ('core','autonomy_grants'),('core','action_policies'),('core','action_requests'),
             ('app','action_effects'),('core','approval_requests'),
             ('core','approval_decisions'),('app','idempotency_keys'),
             ('core','suggested_drafts'),('core','jury_configs'),('core','jury_verdicts'),
             ('core','state_transitions')))
         AND (child_namespace.nspname,child.relname) NOT IN (
           ('core','quotations'),('core','collections_cases'),
           ('core','autonomy_grants'),('core','action_requests'),
           ('app','action_effects'),('core','approval_requests'),
           ('core','approval_decisions'),('app','idempotency_keys'),
           ('core','suggested_drafts'),('core','jury_verdicts'))
    ) AS dependency;
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 011 ABORTED: later relation(s) depend on 011: %',v_dep
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE
    'rollback 011 pre-flight: clear (no later pack, operational rows, seed drift or dependents).';
END;
$preflight$;

-- ─── Reverse bindings on 001-010 tables ────────────────────────────────────
DROP TRIGGER IF EXISTS trg_tenants_seed_action_policies ON public.tenants;
DROP TRIGGER IF EXISTS enquiries_state_gate ON core.enquiries;
DROP TRIGGER IF EXISTS opportunities_state_gate ON core.opportunities;
DROP TRIGGER IF EXISTS tnas_state_gate ON core.tnas;
DROP TRIGGER IF EXISTS proposals_state_gate ON core.proposals;
DROP TRIGGER IF EXISTS quotations_state_gate ON core.quotations;
DROP TRIGGER IF EXISTS engagements_state_gate ON core.engagements;
DROP TRIGGER IF EXISTS attendance_days_state_gate ON core.attendance_days;
DROP TRIGGER IF EXISTS hrdc_packets_state_gate ON core.hrdc_packets;
DROP TRIGGER IF EXISTS invoices_state_gate ON core.invoices;
DROP TRIGGER IF EXISTS invoices_sync_gate ON core.invoices;
DROP TRIGGER IF EXISTS collections_cases_state_gate ON core.collections_cases;
DROP TRIGGER IF EXISTS trainer_bookings_state_gate ON core.trainer_bookings;
DROP TRIGGER IF EXISTS compliance_rules_state_gate ON core.compliance_rules;
DROP TRIGGER IF EXISTS rule_changes_state_gate ON core.rule_changes;
DROP TRIGGER IF EXISTS outbound_messages_state_gate ON core.outbound_messages;
DROP TRIGGER IF EXISTS autonomy_grants_ceiling ON core.autonomy_grants;
DROP TRIGGER IF EXISTS state_transitions_gates_exist ON core.state_transitions;

DROP VIEW IF EXISTS core.v_approval_requests;

-- ─── Reverse function order ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS app.report_effect_result(bigint,app.effect_status,jsonb,jsonb);
-- Both signatures: 011 changed this from uuid[] to jsonb when bulk APPROVE had
-- to start carrying a diff hash per approval, and a database rolled back from an
-- earlier 011 could be carrying either.
DROP FUNCTION IF EXISTS app.bulk_decide(jsonb,text,text,text);
DROP FUNCTION IF EXISTS app.bulk_decide(uuid[],text,text,text);
DROP FUNCTION IF EXISTS app.enqueue_jury_samples(integer);
DROP FUNCTION IF EXISTS app.enqueue_jury(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS app.expire_suggested_drafts(integer);
DROP FUNCTION IF EXISTS app.cleanup_idempotency_keys(integer);
DROP FUNCTION IF EXISTS app.expire_approvals(integer);
DROP FUNCTION IF EXISTS app.notify_approval_breaches(integer);
DROP FUNCTION IF EXISTS app.escalate_approvals(integer);
DROP FUNCTION IF EXISTS app.decide_approval(uuid,text,text,text,text);
DROP FUNCTION IF EXISTS app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text);
DROP FUNCTION IF EXISTS app.apply_effects(uuid);
DROP FUNCTION IF EXISTS app.execute_in_database_action(uuid);
DROP FUNCTION IF EXISTS app.plan_effects(text,text,jsonb);
DROP FUNCTION IF EXISTS app.pick_role_holder(uuid,text,text);
DROP FUNCTION IF EXISTS app.open_approval_count(text);
DROP FUNCTION IF EXISTS app.action_value(text,uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS app.resolve_action_target_id(text,uuid,text,jsonb);

DROP FUNCTION IF EXISTS app.enforce_state_transition();
DROP FUNCTION IF EXISTS app.assert_gates_exist();
DROP FUNCTION IF EXISTS app.enforce_autonomy_ceiling();
DROP FUNCTION IF EXISTS app.seed_action_policies_on_tenant();
DROP FUNCTION IF EXISTS app.seed_action_policies(uuid);

-- ─── Break the deliberate circular and backward FKs ────────────────────────
ALTER TABLE core.autonomy_grants
  DROP CONSTRAINT IF EXISTS autonomy_grants_jury_fk;
ALTER TABLE app.idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_action_fk;
ALTER TABLE core.action_requests
  DROP CONSTRAINT IF EXISTS action_requests_approval_fk,
  DROP CONSTRAINT IF EXISTS action_requests_draft_fk,
  DROP CONSTRAINT IF EXISTS action_requests_idempotency_fk;
ALTER TABLE core.collections_cases
  DROP CONSTRAINT IF EXISTS collections_cases_trading_hold_action_fk;
ALTER TABLE core.quotations
  DROP CONSTRAINT IF EXISTS quotations_discount_action_fk;

-- ─── Tables, exact reverse of section 2 ────────────────────────────────────
DROP TABLE IF EXISTS core.state_transitions  CASCADE;
DROP TABLE IF EXISTS core.jury_verdicts      CASCADE;
DROP TABLE IF EXISTS core.jury_configs       CASCADE;
DROP TABLE IF EXISTS core.suggested_drafts   CASCADE;
DROP TABLE IF EXISTS app.idempotency_keys    CASCADE;
DROP TABLE IF EXISTS core.approval_decisions CASCADE;
DROP TABLE IF EXISTS core.approval_requests  CASCADE;
DROP TABLE IF EXISTS app.action_effects      CASCADE;
DROP TABLE IF EXISTS core.action_requests    CASCADE;
DROP TABLE IF EXISTS core.action_policies    CASCADE;
DROP TABLE IF EXISTS core.autonomy_grants    CASCADE;

-- 004 owns the table and its policy. 011 owns only these rows.
DELETE FROM app.action_types
 WHERE key = ANY (ARRAY[
   'ACCOUNT_TRADING_HOLD','AGENT_AUTONOMY_CHANGE','AGENT_PAUSE','ATTENDANCE_APPROVE',
   'ATTENDANCE_UNLOCK','BROADCAST_SEND','BUDGET_CAP_RAISE','DISCOUNT_APPROVE',
   'ENGAGEMENT_CLOSE_OUT','ENQUIRY_ARCHIVE','FOLLOWUP_SEND',
   'HRDC_PACKET_MARK_SUBMITTED','INVOICE_CREATE','INVOICE_PUSH',
   'OPPORTUNITY_CONVERT','PAYMENT_RECORD','PROPOSAL_SEND','QUOTATION_APPLY',
   'REMINDER_SEND','RULE_CHANGE_APPROVE','TNA_RECOMMENDATION_ACCEPT','TRAINER_BOOK']);

-- Pure helpers and the 002-gap helper no longer have table dependants.
DROP FUNCTION IF EXISTS app.aal2_verified();
DROP FUNCTION IF EXISTS app.policy_matches(jsonb,text,jsonb);
DROP FUNCTION IF EXISTS app.jnum(jsonb);
DROP FUNCTION IF EXISTS app.autonomy_rank(text);
DROP FUNCTION IF EXISTS app.is_valid_condition_set(jsonb);

-- RESTRICT is intentional. Any surviving use names the object that must be
-- rolled back first; a CASCADE here could remove a later column silently.
DROP TYPE IF EXISTS app.effect_status;

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT pg_catalog.string_agg(namespace.nspname || '.' || class.relname, ', ')
    INTO v_left
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE (namespace.nspname,class.relname) IN (
     ('core','autonomy_grants'),('core','action_policies'),('core','action_requests'),
     ('app','action_effects'),('core','approval_requests'),
     ('core','approval_decisions'),('app','idempotency_keys'),
     ('core','suggested_drafts'),('core','jury_configs'),('core','jury_verdicts'),
     ('core','state_transitions'),('core','v_approval_requests'));
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 011: relation(s) survived: %',v_left;
  END IF;
  IF pg_catalog.to_regtype('app.effect_status') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 011: app.effect_status survived';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM app.action_types) <> 0 THEN
    RAISE EXCEPTION 'rollback 011: app.action_types was not restored to 004''s empty state';
  END IF;
  IF pg_catalog.to_regclass('app.action_types') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = 'app.action_types'::regclass
          AND policy.polname = 'action_types_definer_read') THEN
    RAISE EXCEPTION 'rollback 011: 004''s action_types table/policy was damaged';
  END IF;
  RAISE NOTICE
    'rollback 011: complete - 11 tables, 1 view, 28 functions, 22 action types, '
    '124 transitions and app.effect_status removed; 004''s catalogue restored.';
END;
$verify$;

COMMIT;
