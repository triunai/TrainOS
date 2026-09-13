-- ============================================================================
-- ROLLBACK 003 · enum_types
-- ============================================================================
--
-- Forward file: migrations/003_enum_types.sql
--
-- PRIOR STATE THIS RESTORES. After 002 and before 003: `core` exists and is
-- empty. 003 created all 69 types from nothing, so there is no prior definition
-- to reproduce. `app.app_role`, `app.actor_kind` and `app.data_scope` are 002's
-- and are NOT touched.
--
-- ⛔ PRE-FLIGHT. A type cannot be dropped while a column is declared with it,
-- and that is the whole risk here: 004-013 type roughly two hundred columns
-- against these. `DROP TYPE` without CASCADE already refuses in that case, but
-- it refuses ONE TYPE AT A TIME, sixty-nine errors deep, with no statement of
-- what is actually wrong. G1 answers the real question in one message: which
-- columns still depend on these types, so the operator knows which migration to
-- roll back first.
--
-- ⚠ CASCADE IS NOT USED AND MUST NOT BE ADDED. `DROP TYPE ... CASCADE` does not
-- fail on a dependent column — it DROPS THE COLUMN. On `engagements.status`
-- that is silent, irreversible data loss dressed up as a successful rollback.
-- If a drop here fails, the answer is to roll back the migration that created
-- the column, never to add CASCADE.
--
-- DROP ORDER: alphabetical, because enum types do not depend on each other.
-- There is no dependency order to respect and pretending otherwise would imply
-- one exists.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(format('%I.%I.%I (%s)', n.nspname, c.relname, a.attname, t.typname), ', ')
    INTO v_cols
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c      ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n  ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type t       ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
  WHERE tn.nspname = 'core' AND t.typtype = 'e'
    AND a.attnum > 0 AND NOT a.attisdropped
    AND c.relkind IN ('r','p','v','m','c');

  IF v_cols IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 003 ABORTED: column(s) are still declared with a core enum: %. '
      'Roll back the migration that created them first. Do NOT add CASCADE - it '
      'would drop those columns rather than refuse.', v_cols
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 003 pre-flight: clear (no column depends on a core enum).';
END;
$preflight$;

DROP TYPE IF EXISTS core.absence_reason;
DROP TYPE IF EXISTS core.action_status;
DROP TYPE IF EXISTS core.agent_status;
DROP TYPE IF EXISTS core.ai_provider;
DROP TYPE IF EXISTS core.approval_decision;
DROP TYPE IF EXISTS core.approval_status;
DROP TYPE IF EXISTS core.attendance_half;
DROP TYPE IF EXISTS core.attendance_status;
DROP TYPE IF EXISTS core.autonomy_level;
DROP TYPE IF EXISTS core.badge_severity;
DROP TYPE IF EXISTS core.billing_owner;
DROP TYPE IF EXISTS core.booking_state;
DROP TYPE IF EXISTS core.budget_scope;
DROP TYPE IF EXISTS core.budget_state;
DROP TYPE IF EXISTS core.cache_strategy;
DROP TYPE IF EXISTS core.capture_method;
DROP TYPE IF EXISTS core.check_state;
DROP TYPE IF EXISTS core.collection_stage;
DROP TYPE IF EXISTS core.delta_direction;
DROP TYPE IF EXISTS core.diff_op;
DROP TYPE IF EXISTS core.document_presence;
DROP TYPE IF EXISTS core.embedding_status;
DROP TYPE IF EXISTS core.engagement_status;
DROP TYPE IF EXISTS core.enquiry_channel;
DROP TYPE IF EXISTS core.enquiry_status;
DROP TYPE IF EXISTS core.evidence_type;
DROP TYPE IF EXISTS core.filter_op;
DROP TYPE IF EXISTS core.filter_source;
DROP TYPE IF EXISTS core.follow_up_status;
DROP TYPE IF EXISTS core.gap_priority;
DROP TYPE IF EXISTS core.hours_saved_basis;
DROP TYPE IF EXISTS core.hrdc_packet_panel_state;
DROP TYPE IF EXISTS core.hrdc_scheme;
DROP TYPE IF EXISTS core.invoice_status;
DROP TYPE IF EXISTS core.jury_mode;
DROP TYPE IF EXISTS core.knowledge_source_type;
DROP TYPE IF EXISTS core.lifecycle_state;
DROP TYPE IF EXISTS core.message_category;
DROP TYPE IF EXISTS core.monitor_status;
DROP TYPE IF EXISTS core.opportunity_stage;
DROP TYPE IF EXISTS core.organisation_match_reason;
DROP TYPE IF EXISTS core.organisation_status;
DROP TYPE IF EXISTS core.packet_status;
DROP TYPE IF EXISTS core.proposal_status;
DROP TYPE IF EXISTS core.provenance_origin;
DROP TYPE IF EXISTS core.provider_key_status;
DROP TYPE IF EXISTS core.retrieval_scope;
DROP TYPE IF EXISTS core.risk_level;
DROP TYPE IF EXISTS core.routing_strategy;
DROP TYPE IF EXISTS core.rule_change_op;
DROP TYPE IF EXISTS core.rule_resolution_basis;
DROP TYPE IF EXISTS core.rule_status;
DROP TYPE IF EXISTS core.run_event_type;
DROP TYPE IF EXISTS core.run_status;
DROP TYPE IF EXISTS core.run_step_status;
DROP TYPE IF EXISTS core.saved_view_object;
DROP TYPE IF EXISTS core.severity;
DROP TYPE IF EXISTS core.sync_state;
DROP TYPE IF EXISTS core.template_type;
DROP TYPE IF EXISTS core.theme;
DROP TYPE IF EXISTS core.tier_status;
DROP TYPE IF EXISTS core.tna_status;
DROP TYPE IF EXISTS core.trace_node_kind;
DROP TYPE IF EXISTS core.trainer_band;
DROP TYPE IF EXISTS core.travel_region;
DROP TYPE IF EXISTS core.urgency_group;
DROP TYPE IF EXISTS core.usage_group_by;
DROP TYPE IF EXISTS core.venue_mode;
DROP TYPE IF EXISTS core.view_visibility;

DO $verify$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'core' AND t.typtype = 'e';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'rollback 003: % enum type(s) survived the drop', v_left;
  END IF;

  -- 002's three identity types must still be there. A rollback that took the
  -- layer below with it would leave a state neither migration describes.
  IF (SELECT count(*) FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'app' AND t.typtype = 'e') <> 3 THEN
    RAISE EXCEPTION 'rollback 003: app should still hold exactly 002''s three enum types';
  END IF;

  RAISE NOTICE 'rollback 003: complete - 69 core enum types removed; app''s three intact.';
END;
$verify$;

COMMIT;
