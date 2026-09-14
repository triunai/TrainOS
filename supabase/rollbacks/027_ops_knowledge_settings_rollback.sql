-- ═══════════════════════════════════════════════════════════════════════════
-- 027 ROLLBACK · Automation, knowledge and AI-settings read/write surface
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Drop the sixteen new functions and their two private helpers, drop
-- core.library_assets, delete the two new app.role_permissions rows, then
-- restore 021's effective app.execute_in_database_action definition in full.
-- Refuses if core.library_assets holds rows (data loss the operator should
-- decide on, not a migration).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DO $refuse$
DECLARE v_rows integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_rows FROM core.library_assets;
  IF v_rows > 0 THEN
    RAISE EXCEPTION '027 rollback refused: core.library_assets holds % row(s). '
      'Nothing was changed. Decide what happens to that data before dropping the table.', v_rows
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END
$refuse$;

DROP FUNCTION IF EXISTS core.list_agents();
DROP FUNCTION IF EXISTS core.pause_agent(text, jsonb);
DROP FUNCTION IF EXISTS core.list_runs(jsonb);
DROP FUNCTION IF EXISTS core.get_run(text);
DROP FUNCTION IF EXISTS core.retry_run(text, text);
DROP FUNCTION IF EXISTS core.dead_letter_run(text, jsonb);
DROP FUNCTION IF EXISTS core.create_knowledge_source(jsonb);
DROP FUNCTION IF EXISTS core.check_knowledge_source(text);
DROP FUNCTION IF EXISTS core.reingest_knowledge_source(text);
DROP FUNCTION IF EXISTS core.list_library_assets(jsonb);
DROP FUNCTION IF EXISTS core.get_ai_routing();
DROP FUNCTION IF EXISTS core.put_ai_routing(jsonb);
DROP FUNCTION IF EXISTS core.list_providers();
DROP FUNCTION IF EXISTS core.get_usage(text, text);
DROP FUNCTION IF EXISTS core.put_budget(text, text, jsonb);
DROP FUNCTION IF EXISTS core.get_tenant();
DROP FUNCTION IF EXISTS app._run_row(core.runs);
DROP FUNCTION IF EXISTS app._knowledge_source_row(core.knowledge_sources);

DROP TABLE IF EXISTS core.library_assets;

DELETE FROM app.role_permissions WHERE permission IN ('library:read', 'tenant:read');

-- Restore 021's effective definition byte for byte. 027 replaced only the
-- BUDGET_CAP_RAISE stub, and a rollback must put that prior stub back rather
-- than leave the later executor installed.
CREATE OR REPLACE FUNCTION app.execute_in_database_action(p_action_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_request core.action_requests%ROWTYPE;
BEGIN
  SELECT request.* INTO v_request
    FROM core.action_requests AS request
   WHERE request.id = p_action_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'action request % does not exist', p_action_request_id
      USING ERRCODE = 'no_data_found';
  END IF;

  CASE v_request.action_type
    WHEN 'ENQUIRY_ARCHIVE' THEN
      UPDATE core.enquiries SET status = COALESCE(v_request.payload ->> 'status','ARCHIVED')::core.enquiry_status
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'OPPORTUNITY_CONVERT' THEN
      UPDATE core.enquiries SET status = 'CONVERTED'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    -- 021 · R18. Locked, then re-checked: an approval decided later must still
    -- refuse a deal that moved while it waited.
    WHEN 'OPPORTUNITY_STAGE_CHANGE' THEN
      PERFORM 1 FROM core.opportunities
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id
       FOR UPDATE;
      PERFORM app.check_opportunity_stage_move(
        v_request.tenant_id, v_request.target_id, v_request.payload);
      UPDATE core.opportunities
         SET stage = (v_request.payload ->> 'stage')::core.opportunity_stage,
             stage_changed_at = pg_catalog.now(),
             -- 005's opportunities_lost_needs_reason names LOST; the reason
             -- lands in the column that CHECK reads, and nowhere else.
             lost_reason = CASE WHEN (v_request.payload ->> 'stage')::core.opportunity_stage = 'LOST'
                                THEN v_request.payload ->> 'reason' ELSE lost_reason END
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'TNA_RECOMMENDATION_ACCEPT' THEN
      UPDATE core.tnas SET status = 'COMPLETE', completed_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'PROPOSAL_SEND' THEN
      UPDATE core.proposals SET status = 'SENT', sent_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'QUOTATION_APPLY' THEN
      UPDATE core.quotations SET status = 'APPLIED'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'DISCOUNT_APPROVE' THEN
      UPDATE core.quotations
         SET sell_price_sen = COALESCE((v_request.payload ->> 'sellPriceSen')::bigint, sell_price_sen),
             discount_approval_id = v_request.id
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'TRAINER_BOOK' THEN
      UPDATE core.trainer_bookings SET state = 'CONFIRMED'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'ENGAGEMENT_CLOSE_OUT' THEN
      UPDATE core.engagements SET status = 'CLOSED', closed_out_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'ATTENDANCE_APPROVE' THEN
      UPDATE core.attendance_days
         SET status = 'LOCKED', approved_by_kind = v_request.requested_by_kind::app.actor_kind,
             approved_by_id = v_request.requested_by_id,
             approved_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'ATTENDANCE_UNLOCK' THEN
      UPDATE core.attendance_days
         SET status = 'OPEN', unlock_reason = v_request.payload ->> 'reason'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'HRDC_PACKET_MARK_SUBMITTED' THEN
      UPDATE core.hrdc_packets
         SET status = 'SUBMITTED',
             claim_reference = v_request.payload ->> 'claimReference',
             claim_submitted_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'INVOICE_CREATE' THEN
      INSERT INTO core.invoices
        (id,tenant_id,organisation_id,engagement_id,status,created_by_kind,created_by_id)
      VALUES
        (v_request.target_id,v_request.tenant_id,
         (v_request.payload ->> 'organisationId')::uuid,
         NULLIF(v_request.payload ->> 'engagementId','')::uuid,
         'DRAFT',v_request.requested_by_kind::app.actor_kind,v_request.requested_by_id);
    WHEN 'INVOICE_PUSH' THEN
      UPDATE core.invoices
         SET status = 'SENT', issued_at = COALESCE(issued_at,pg_catalog.now()),
             sync_state = 'SENT', sync_last_attempt_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'PAYMENT_RECORD' THEN
      INSERT INTO core.payments
        (tenant_id,invoice_id,amount_sen,currency,method,external_reference,
         created_by_kind,created_by_id)
      VALUES
        (v_request.tenant_id,v_request.target_id,
         (v_request.payload #>> '{amount,amount}')::bigint,
         COALESCE(v_request.payload #>> '{amount,currency}','MYR')::core.currency_code,
         COALESCE(v_request.payload ->> 'method','BANK_TRANSFER'),
         v_request.payload ->> 'externalReference',
         v_request.requested_by_kind::app.actor_kind,v_request.requested_by_id);
    WHEN 'REMINDER_SEND' THEN
      UPDATE core.collections_cases
         SET stage = (v_request.payload ->> 'stage')::core.collection_stage,
             stage_entered_at = pg_catalog.now()
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'FOLLOWUP_SEND' THEN
      UPDATE core.follow_ups SET status = 'SENT'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'BROADCAST_SEND' THEN
      NULL; -- fan-out is external and 012 owns its jobs
    WHEN 'AGENT_AUTONOMY_CHANGE' THEN
      INSERT INTO core.autonomy_grants
        (id,tenant_id,agent_id,action_type,level,approver_role,value_threshold_sen,
         min_confidence,granted_by)
      VALUES
        (v_request.target_id,v_request.tenant_id,v_request.payload ->> 'agentId',
         v_request.payload ->> 'actionType',v_request.payload ->> 'level',
         v_request.payload ->> 'approverRole',
         (v_request.payload ->> 'valueThresholdSen')::bigint,
         COALESCE((v_request.payload ->> 'minConfidence')::numeric,0.700),
         v_request.requested_by_id)
      ON CONFLICT (tenant_id,agent_id,action_type) DO UPDATE
        SET level = EXCLUDED.level,
            approver_role = EXCLUDED.approver_role,
            value_threshold_sen = EXCLUDED.value_threshold_sen,
            min_confidence = EXCLUDED.min_confidence,
            granted_by = EXCLUDED.granted_by,
            granted_at = pg_catalog.now();
    WHEN 'AGENT_PAUSE' THEN
      UPDATE core.autonomy_grants
         SET paused = true, paused_at = pg_catalog.now(),
             paused_reason = COALESCE(v_request.payload ->> 'reason','MANUAL')
       WHERE tenant_id = v_request.tenant_id
         AND agent_id = v_request.payload ->> 'agentId'
         AND (v_request.payload ->> 'actionType' IS NULL
              OR action_type = v_request.payload ->> 'actionType');
    WHEN 'BUDGET_CAP_RAISE' THEN
      NULL; -- app.ai_budgets is created by 013, not invented here
    WHEN 'RULE_CHANGE_APPROVE' THEN
      UPDATE core.rule_changes SET status = 'APPROVED'
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    WHEN 'ACCOUNT_TRADING_HOLD' THEN
      UPDATE core.collections_cases
         SET stage = 'TRADING_HOLD', stage_entered_at = pg_catalog.now(),
             trading_hold_action_id = v_request.id
       WHERE tenant_id = v_request.tenant_id AND id = v_request.target_id;
    ELSE
      RAISE EXCEPTION 'unknown action type %L', v_request.action_type
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$fn$;

COMMIT;
