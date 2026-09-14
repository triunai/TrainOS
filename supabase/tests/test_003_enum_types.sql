-- ============================================================================
-- PIN 003 · enum_types
-- ============================================================================
--
-- Run only AFTER 003 has been applied. Writes nothing; ends in ROLLBACK.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f supabase/tests/test_003_enum_types.sql
--
-- WHAT THIS PIN IS FOR. 003 has no behaviour to exercise, so a pin that only
-- counted types would prove almost nothing. The whole list is therefore pinned
-- VALUE BY VALUE AND IN ORDER, because the two ways this migration can be wrong
-- are both invisible to a count:
--
--   * A misspelt label is perfectly valid SQL. `ACT_WITH_APROVAL` creates
--     cleanly, matches nothing at run time, and the first symptom is a row that
--     will not insert in staging weeks later.
--   * ORDER is semantic for a Postgres enum. Comparison operators and ORDER BY
--     use the declaration order, not the alphabet, so `urgency_group` sorting
--     BREACHING before TODAY is a behaviour, not a formatting choice. A type
--     recreated with the same labels in a different order passes every
--     membership test and silently reorders an approvals queue.
--
-- The expected list below is generated from the migration, so this file and the
-- migration are the same list by construction. If they ever disagree, one of
-- them was hand-edited, which is the thing worth catching.
--
-- RUNNABILITY NOTES
-- 1. No fixtures, no auth.users rows, no role swap: types are not privileged
--    objects and nothing here reads a claim.
-- 2. It ends in ROLLBACK anyway, so a future edit that does write is still safe.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_003 SETUP FAILURE: ASSERT did not raise - check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

CREATE TEMP TABLE t003_expected (type_name text PRIMARY KEY, labels text[]) ON COMMIT DROP;

INSERT INTO t003_expected (type_name, labels) VALUES
    ('absence_reason', ARRAY['MEDICAL_LEAVE', 'WORK_CONFLICT', 'NO_SHOW', 'OTHER']::text[]),
    ('action_status', ARRAY['EXECUTED', 'QUEUED_FOR_APPROVAL', 'SUGGESTED', 'REJECTED']::text[]),
    ('agent_status', ARRAY['ACTIVE', 'PAUSED', 'RETIRED']::text[]),
    -- ⚠ AMENDED BY 029: 4 -> 6. 029 adds OPENROUTER and OTHER (enums.ts:737);
    -- ADD VALUE appends, so the four 003 labels keep their order.
    ('ai_provider', ARRAY['ANTHROPIC', 'GOOGLE', 'OPENAI', 'DEEPSEEK', 'OPENROUTER', 'OTHER']::text[]),
    ('approval_decision', ARRAY['APPROVE', 'REQUEST_CHANGES', 'REJECT']::text[]),
    ('approval_status', ARRAY['PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'EXPIRED']::text[]),
    ('attendance_status', ARRAY['OPEN', 'PENDING_APPROVAL', 'LOCKED']::text[]),
    ('autonomy_level', ARRAY['OBSERVE', 'SUGGEST', 'ACT_WITH_APPROVAL', 'AUTONOMOUS']::text[]),
    ('badge_severity', ARRAY['DEFAULT', 'ALERT']::text[]),
    ('billing_owner', ARRAY['CLIENT_ACCOUNT', 'PASS_THROUGH']::text[]),
    ('budget_scope', ARRAY['TIER', 'AGENT', 'ACTION_TYPE']::text[]),
    ('budget_state', ARRAY['WITHIN', 'NEAR', 'PAUSED']::text[]),
    ('cache_strategy', ARRAY['NONE', 'PROMPT_15M', 'PROMPT_1H', 'PROMPT_24H', 'CONTEXT_1H']::text[]),
    ('capture_method', ARRAY['QR', 'SIGNATURE', 'MANUAL']::text[]),
    ('check_state', ARRAY['PASS', 'WARN', 'FAIL', 'NOT_APPLICABLE']::text[]),
    ('collection_stage', ARRAY['REMINDER_1', 'REMINDER_2', 'REMINDER_3', 'HUMAN_CALL', 'TRADING_HOLD']::text[]),
    ('delta_direction', ARRAY['UP', 'DOWN', 'FLAT']::text[]),
    ('diff_op', ARRAY['ADD', 'UPDATE', 'REMOVE']::text[]),
    ('document_presence', ARRAY['PRESENT', 'MISSING']::text[]),
    ('embedding_status', ARRAY['INDEXED', 'PENDING', 'FAILED']::text[]),
    ('engagement_status', ARRAY['PROPOSED', 'CONFIRMED', 'SCHEDULED', 'IN_DELIVERY', 'DELIVERED', 'CLOSED', 'CANCELLED']::text[]),
    ('enquiry_channel', ARRAY['EMAIL', 'WHATSAPP', 'WEB_FORM', 'PHONE']::text[]),
    ('enquiry_status', ARRAY['OPEN', 'ASSIGNED', 'CONVERTED', 'ARCHIVED', 'NOT_AN_ENQUIRY']::text[]),
    ('evidence_type', ARRAY['EMAIL', 'TNA', 'PROGRAMME', 'TRAINER', 'TRAINER_AVAILABILITY', 'QUOTATION', 'QUESTIONNAIRE', 'HISTORY', 'CATALOGUE', 'HRDC_STATEMENT', 'PARTICIPANT_QUERY', 'ORGANISATION', 'CONTACT', 'INVOICE', 'PROPOSAL', 'ACTION']::text[]),
    ('filter_op', ARRAY['eq', 'in', 'gte', 'lte', 'contains', 'between']::text[]),
    ('filter_source', ARRAY['REQUEST', 'VIEW']::text[]),
    ('gap_priority', ARRAY['HIGH', 'MEDIUM', 'LOW']::text[]),
    ('hours_saved_basis', ARRAY['MEASURED', 'ILLUSTRATIVE']::text[]),
    ('hrdc_packet_panel_state', ARRAY['ON_TRACK', 'DEADLINE_AT_RISK', 'BLOCKED', 'SUBMITTED']::text[]),
    ('hrdc_scheme', ARRAY['SBL_KHAS', 'SBL', 'HRDC_PLACEMENT']::text[]),
    ('invoice_status', ARRAY['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID']::text[]),
    ('jury_mode', ARRAY['GATE', 'SAMPLE', 'ESCALATE']::text[]),
    ('knowledge_source_type', ARRAY['HRDC_CIRCULAR']::text[]),
    ('lifecycle_state', ARRAY['DONE', 'CURRENT', 'PENDING', 'BLOCKED', 'SKIPPED', 'FAILED']::text[]),
    ('message_category', ARRAY['MARKETING', 'UTILITY', 'SERVICE']::text[]),
    ('monitor_status', ARRAY['WATCHING', 'CHANGED_REVIEW_PENDING', 'FAILED', 'MANUAL']::text[]),
    ('opportunity_stage', ARRAY['NEW', 'QUALIFYING', 'TNA_SENT', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST']::text[]),
    ('organisation_match_reason', ARRAY['EXACT_DOMAIN', 'FUZZY_NAME', 'MANUAL']::text[]),
    ('organisation_status', ARRAY['PROSPECT', 'ACTIVE_CLIENT', 'DORMANT']::text[]),
    ('packet_status', ARRAY['DRAFT', 'READY', 'SUBMITTED', 'PAID', 'REJECTED']::text[]),
    ('proposal_status', ARRAY['DRAFT', 'AWAITING_APPROVAL', 'SENT', 'VIEWED', 'ACCEPTED', 'LOST']::text[]),
    ('provenance_origin', ARRAY['HUMAN', 'SYSTEM', 'AI_SUGGESTED', 'AI_GENERATED', 'AI_EXECUTED']::text[]),
    ('provider_key_status', ARRAY['NOT_SET', 'VALID', 'INVALID', 'EXPIRING']::text[]),
    ('retrieval_scope', ARRAY['COMPLIANCE', 'CLIENT_FACING']::text[]),
    ('risk_level', ARRAY['LOW', 'MEDIUM', 'HIGH']::text[]),
    ('routing_strategy', ARRAY['THROUGHPUT', 'PRICE', 'FIXED']::text[]),
    ('rule_change_op', ARRAY['ADD', 'MODIFY', 'SUPERSEDE']::text[]),
    ('rule_resolution_basis', ARRAY['GRANT_SUBMITTED', 'CLAIM_SUBMITTED']::text[]),
    ('rule_status', ARRAY['PROPOSED', 'ACTIVE', 'SUPERSEDED']::text[]),
    ('run_event_type', ARRAY['ESCALATION', 'JURY', 'TRUNCATION', 'HANDOFF', 'CHECKPOINT', 'POLICY_HALT', 'CACHE_HIT', 'BUDGET_EXCEEDED']::text[]),
    ('run_status', ARRAY['RUNNING', 'SUCCEEDED', 'FAILED', 'HALTED']::text[]),
    ('run_step_status', ARRAY['OK', 'RETRIED', 'FAILED', 'HALTED']::text[]),
    ('saved_view_object', ARRAY['LEAD', 'ENQUIRY', 'APPROVAL']::text[]),
    ('severity', ARRAY['INFO', 'WARN', 'DANGER', 'ALERT']::text[]),
    ('sync_state', ARRAY['NOT_SENT', 'SENT', 'VALIDATED', 'ERROR']::text[]),
    ('template_type', ARRAY['PROPOSAL', 'QUOTATION', 'CERTIFICATE', 'EMAIL', 'WHATSAPP', 'INVOICE', 'TNA_QUESTIONNAIRE', 'EVALUATION', 'HRDC_PACKET']::text[]),
    ('theme', ARRAY['LIGHT', 'DARK', 'SYSTEM']::text[]),
    ('tier_status', ARRAY['HEALTHY', 'DEGRADED', 'PAUSED_BY_CAP', 'DISABLED']::text[]),
    ('tna_status', ARRAY['DRAFT', 'SENT', 'COMPLETE', 'REOPENED']::text[]),
    ('trace_node_kind', ARRAY['ORCHESTRATOR', 'SUB_AGENT', 'TOOL']::text[]),
    ('urgency_group', ARRAY['BREACHING', 'TODAY', 'THIS_WEEK', 'LATER']::text[]),
    ('usage_group_by', ARRAY['TIER', 'AGENT', 'ACTION_TYPE']::text[]),
    ('attendance_half', ARRAY['AM', 'PM']::text[]),
    ('booking_state', ARRAY['SOFT_HOLD', 'CONFIRMED', 'RELEASED', 'CANCELLED']::text[]),
    ('follow_up_status', ARRAY['DUE', 'OVERDUE', 'SENT', 'DISMISSED']::text[]),
    ('trainer_band', ARRAY['A', 'B', 'C']::text[]),
    ('travel_region', ARRAY['KLANG_VALLEY', 'PENINSULAR', 'EAST_MALAYSIA']::text[]),
    ('venue_mode', ARRAY['CLIENT_SITE', 'OWN_VENUE', 'EXTERNAL']::text[]),
    ('view_visibility', ARRAY['PRIVATE', 'TEAM', 'TENANT']::text[]);

-- === T1 · every expected type exists ========================================
DO $t1$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(e.type_name, ', ') INTO v_missing
  FROM t003_expected e
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'core' AND t.typname = e.type_name AND t.typtype = 'e');
  ASSERT v_missing IS NULL, format('T1 FAIL: enum type(s) missing from core: %s', v_missing);
  RAISE NOTICE 'T1 PASS - all 69 expected enum types exist in core.';
END;
$t1$;

-- === T2 · no EXTRA enum type crept into core ================================
--     A type nobody expected is a type nobody generated, i.e. a hand edit.
--
--     ⚠ CORRECTED 2026-09-13. This pin used to fail outright, and it failed for
--     a reason worth recording rather than patching away: it was only ever run
--     immediately after 003, against a database where 003 was the last
--     migration applied. Run against the FULL pack it reported seven
--     "unexpected" enums - rate_card_status, rule_side, rule_kind, rule_op,
--     rule_reference_kind, rule_offset_unit and delivery_mode - every one of
--     them a legitimate type created by 006 or 009.
--
--     That is the pin being wrong, not the schema, and it is exactly the class
--     of defect the harness change caught: pins are now executed against the
--     whole applied set, not at the point in the sequence that flatters them.
--
--     The allowance is an EXPLICIT list with an owning migration against each
--     name, not a predicate like "or created after 003". A later migration that
--     adds an enum must add its name here, and that is the feature: this pin's
--     entire job is to notice a type nobody declared.
DO $t2$
DECLARE v_extra text;
BEGIN
  SELECT string_agg(t.typname, ', ') INTO v_extra
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'core' AND t.typtype = 'e'
    AND t.typname NOT IN (SELECT type_name FROM t003_expected)
    AND t.typname NOT IN (
      -- owned by 006_catalogue_programmes_and_trainers
      'rate_card_status',
      -- owned by 009_compliance_rules_checks_hrdc
      'rule_side', 'rule_kind', 'rule_op', 'rule_reference_kind',
      'rule_offset_unit', 'delivery_mode',
      -- owned by 010_finance_invoices_payments_collections
      'tax_identifier_kind', 'einvoice_status'
    );
  ASSERT v_extra IS NULL, format('T2 FAIL: unexpected enum type(s) in core: %s', v_extra);
  RAISE NOTICE 'T2 PASS - no unexpected enum types in core (7 later-migration enums allowed by name).';
END;
$t2$;

-- === T3 · labels match EXACTLY, and IN ORDER ================================
DO $t3$
DECLARE r record; v_actual text[]; v_fail text := '';
BEGIN
  FOR r IN SELECT type_name, labels FROM t003_expected ORDER BY type_name LOOP
    SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO v_actual
    FROM pg_catalog.pg_enum e
    JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'core' AND t.typname = r.type_name;

    IF v_actual IS DISTINCT FROM r.labels THEN
      v_fail := v_fail || format('%s: expected %s, got %s; ', r.type_name, r.labels, v_actual);
    END IF;
  END LOOP;
  ASSERT v_fail = '', format('T3 FAIL: %s', v_fail);
  RAISE NOTICE 'T3 PASS - every enum label matches, in declaration order.';
END;
$t3$;

-- === T4 · ordering is semantic, demonstrated rather than asserted abstractly =
DO $t4$
BEGIN
  -- If urgency_group were ever recreated alphabetically, BREACHING would sort
  -- after THIS_WEEK and the approvals queue would put the breaching items last.
  ASSERT 'BREACHING'::core.urgency_group < 'TODAY'::core.urgency_group,
    'T4a FAIL: urgency_group no longer sorts BREACHING first - the approvals queue is reordered';
  ASSERT 'TODAY'::core.urgency_group < 'THIS_WEEK'::core.urgency_group,
    'T4b FAIL: urgency_group TODAY/THIS_WEEK order is wrong';
  ASSERT 'OBSERVE'::core.autonomy_level < 'AUTONOMOUS'::core.autonomy_level,
    'T4c FAIL: autonomy_level does not ascend from OBSERVE to AUTONOMOUS - a '
    'ceiling comparison written as level <= ceiling now means the opposite';
  ASSERT 'SUGGEST'::core.autonomy_level < 'ACT_WITH_APPROVAL'::core.autonomy_level,
    'T4d FAIL: autonomy_level mid-order is wrong';
  RAISE NOTICE 'T4 PASS - urgency and autonomy orderings are semantically correct.';
END;
$t4$;

-- === T5 · every type carries its provenance comment =========================
DO $t5$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(t.typname, ', ') INTO v_bad
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'core' AND t.typtype = 'e'
    AND obj_description(t.oid, 'pg_type') IS NULL;
  ASSERT v_bad IS NULL, format('T5 FAIL: enum type(s) with no provenance comment: %s', v_bad);
  RAISE NOTICE 'T5 PASS - every enum records where its values came from.';
END;
$t5$;

-- === T6 · the identity types were NOT duplicated into core ==================
DO $t6$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'core' AND t.typname IN ('actor_kind','app_role')),
    'T6a FAIL: actor_kind or app_role exists in core as well as app. Two types of '
    'the same name is a column typed against the wrong one and a cast that works.';
  ASSERT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'app' AND t.typname = 'actor_kind'),
    'T6b FAIL: app.actor_kind is missing - 002 is not applied';
  RAISE NOTICE 'T6 PASS - actor_kind and app_role live only in app.';
END;
$t6$;

DO $done$
BEGIN
  RAISE NOTICE 'test_003 ALL PASS (T1-T6, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
