-- ═══════════════════════════════════════════════════════════════════════════
-- 021 ROLLBACK · Role authorization, OPPORTUNITY_STAGE_CHANGE, the 019 seed fix
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores exactly what 020 left. Every function 021 replaced is re-created
-- from its prior text IN FULL: 24 from 018, one from 020, three from 011, one
-- from 019.
--
-- ORDER, the reverse of the forward file:
--   1. §4: drop the owner policy and un-FORCE app.seeded_pipelines
--   2. §2: refuse if any OPPORTUNITY_STAGE_CHANGE request, approval, grant or
--      draft exists (those are history, and deleting the type would orphan or
--      destroy it); otherwise drop the tenant trigger and its functions, delete
--      every OPP-01 policy row, delete the action type, and restore 011's three
--      dispatch functions, then drop the move check they called
--   3. §3: restore 019's app.seed_pipelines
--   4. §1: restore 020's get_audit and the 24 018 bodies, and restate their grants
--   5. verify
--
-- One transaction: the refusal in step 2 leaves nothing half-reversed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ═══ 1 · app.seeded_pipelines back to 019's posture ════════════════════════

ALTER TABLE app.seeded_pipelines NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seeded_pipelines_owner_all ON app.seeded_pipelines;

-- ═══ 2 · OPPORTUNITY_STAGE_CHANGE out of the envelope ══════════════════════

DO $refuse$
DECLARE v_used text;
BEGIN
  SELECT pg_catalog.string_agg(used.what || '=' || used.n::text, ', ') INTO v_used
    FROM (SELECT 'action_requests' AS what, pg_catalog.count(*) AS n FROM core.action_requests WHERE action_type = 'OPPORTUNITY_STAGE_CHANGE'
          UNION ALL SELECT 'approval_requests', pg_catalog.count(*) FROM core.approval_requests WHERE action_type = 'OPPORTUNITY_STAGE_CHANGE'
          UNION ALL SELECT 'autonomy_grants', pg_catalog.count(*) FROM core.autonomy_grants WHERE action_type = 'OPPORTUNITY_STAGE_CHANGE'
          UNION ALL SELECT 'suggested_drafts', pg_catalog.count(*) FROM core.suggested_drafts WHERE action_type = 'OPPORTUNITY_STAGE_CHANGE'
          UNION ALL SELECT 'routing_entries', pg_catalog.count(*) FROM core.routing_entries WHERE action_type = 'OPPORTUNITY_STAGE_CHANGE'
          UNION ALL SELECT 'jury_configs', pg_catalog.count(*) FROM core.jury_configs WHERE action_type = 'OPPORTUNITY_STAGE_CHANGE'
          UNION ALL SELECT 'hours_saved_baselines', pg_catalog.count(*) FROM core.hours_saved_baselines WHERE action_type = 'OPPORTUNITY_STAGE_CHANGE'
          UNION ALL SELECT 'evals', pg_catalog.count(*) FROM core.evals WHERE action_type = 'OPPORTUNITY_STAGE_CHANGE') AS used
   WHERE used.n > 0;
  IF v_used IS NOT NULL THEN
    RAISE EXCEPTION '021 rollback refused: OPPORTUNITY_STAGE_CHANGE is referenced by live history (%). '
      'Nothing was changed. That history is the audit of deals that moved; decide what happens to it '
      'before removing the type.', v_used
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END
$refuse$;

DROP TRIGGER IF EXISTS trg_tenants_seed_opportunity_stage_policy ON public.tenants;
DROP FUNCTION IF EXISTS app.seed_opportunity_stage_policy_on_tenant();
DROP FUNCTION IF EXISTS app.seed_opportunity_stage_policy(uuid);
DELETE FROM core.action_policies WHERE id = 'OPP-01' AND action_type = 'OPPORTUNITY_STAGE_CHANGE';
DELETE FROM app.action_types WHERE key = 'OPPORTUNITY_STAGE_CHANGE';

CREATE OR REPLACE FUNCTION app.resolve_action_target_id(
  p_type text,
  p_tenant_id uuid,
  p_target_ref text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE v_id uuid;
BEGIN
  CASE p_type
    WHEN 'ENQUIRY_ARCHIVE', 'OPPORTUNITY_CONVERT' THEN
      SELECT row.id INTO v_id FROM core.enquiries AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'TNA_RECOMMENDATION_ACCEPT' THEN
      SELECT row.id INTO v_id FROM core.tnas AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'PROPOSAL_SEND' THEN
      SELECT row.id INTO v_id FROM core.proposals AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'QUOTATION_APPLY', 'DISCOUNT_APPROVE' THEN
      SELECT row.id INTO v_id FROM core.quotations AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'TRAINER_BOOK' THEN
      SELECT row.id INTO v_id FROM core.trainer_bookings AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'ENGAGEMENT_CLOSE_OUT' THEN
      SELECT row.id INTO v_id FROM core.engagements AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'ATTENDANCE_APPROVE', 'ATTENDANCE_UNLOCK' THEN
      BEGIN
        v_id := NULLIF(p_payload ->> 'id', '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_id := NULL;
      END;
    WHEN 'HRDC_PACKET_MARK_SUBMITTED' THEN
      SELECT row.id INTO v_id FROM core.hrdc_packets AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'INVOICE_CREATE' THEN
      BEGIN
        v_id := NULLIF(p_payload ->> 'id', '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_id := NULL;
      END;
    WHEN 'INVOICE_PUSH', 'PAYMENT_RECORD' THEN
      SELECT row.id INTO v_id FROM core.invoices AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'REMINDER_SEND', 'ACCOUNT_TRADING_HOLD' THEN
      SELECT row.id INTO v_id FROM core.collections_cases AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'FOLLOWUP_SEND' THEN
      SELECT row.id INTO v_id FROM core.follow_ups AS row
       WHERE row.tenant_id = p_tenant_id AND row.ref = p_target_ref;
    WHEN 'RULE_CHANGE_APPROVE' THEN
      BEGIN
        v_id := NULLIF(p_payload ->> 'id', '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_id := NULL;
      END;
    WHEN 'AGENT_AUTONOMY_CHANGE' THEN
      SELECT row.id INTO v_id FROM core.autonomy_grants AS row
       WHERE row.tenant_id = p_tenant_id
         AND row.agent_id = p_payload ->> 'agentId'
         AND row.action_type = p_payload ->> 'actionType';
      IF v_id IS NULL THEN
        v_id := pg_catalog.gen_random_uuid();
      END IF;
    WHEN 'AGENT_PAUSE', 'BUDGET_CAP_RAISE', 'BROADCAST_SEND' THEN
      v_id := NULL;
    ELSE
      RAISE EXCEPTION 'unknown action type %L', p_type
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.plan_effects(
  p_type text,
  p_target_ref text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  v_effects jsonb;
BEGIN
  CASE p_type
    WHEN 'ENQUIRY_ARCHIVE' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','Enquiry','ref',p_target_ref,
        'description','Archive the enquiry'));
    WHEN 'OPPORTUNITY_CONVERT' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','Enquiry','ref',p_target_ref,
        'description','Mark the source enquiry converted'));
    WHEN 'TNA_RECOMMENDATION_ACCEPT' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','TNA','ref',p_target_ref,
        'description','Accept the TNA recommendation'));
    WHEN 'PROPOSAL_SEND' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','Proposal','ref',p_target_ref,
          'description','Mark the proposal sent'),
        pg_catalog.jsonb_build_object('op','ADD','entity','Email','ref',p_target_ref,
          'description','Render and send the proposal email'));
    WHEN 'QUOTATION_APPLY' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','Quotation','ref',p_target_ref,
        'description','Apply the quotation'));
    WHEN 'DISCOUNT_APPROVE' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','Quotation','ref',p_target_ref,
        'description','Record the approved discount'));
    WHEN 'TRAINER_BOOK' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','TrainerBooking','ref',p_target_ref,
          'description','Confirm the trainer booking'),
        pg_catalog.jsonb_build_object('op','ADD','entity','Notification','ref',p_target_ref,
          'description','Notify the trainer'));
    WHEN 'ENGAGEMENT_CLOSE_OUT' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','Engagement','ref',p_target_ref,
          'description','Close the engagement'),
        pg_catalog.jsonb_build_object('op','ADD','entity','EvaluationLink','ref',p_target_ref,
          'description','Send evaluation links'));
    WHEN 'ATTENDANCE_APPROVE' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','AttendanceDay','ref',p_target_ref,
        'description','Lock approved attendance'));
    WHEN 'ATTENDANCE_UNLOCK' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','AttendanceDay','ref',p_target_ref,
          'description','Unlock attendance with an audit reason'),
        pg_catalog.jsonb_build_object('op','ADD','entity','Notification','ref',p_target_ref,
          'description','Notify operations and finance'));
    WHEN 'HRDC_PACKET_MARK_SUBMITTED' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','HRDCPacket','ref',p_target_ref,
        'description','Record the HRD Corp claim submission'));
    WHEN 'INVOICE_CREATE' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','ADD','entity','Invoice','ref',p_target_ref,
        'description','Create the invoice'));
    WHEN 'INVOICE_PUSH' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','Invoice','ref',p_target_ref,
          'description','Mark the invoice push dispatched'),
        pg_catalog.jsonb_build_object('op','ADD','entity','AccountingPackage','ref',p_target_ref,
          'description','Push the invoice to the accounting package'));
    WHEN 'PAYMENT_RECORD' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','ADD','entity','Payment','ref',p_target_ref,
        'description','Record the payment and recompute the invoice balance'));
    WHEN 'REMINDER_SEND' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','CollectionsCase','ref',p_target_ref,
          'description','Advance the collections stage'),
        pg_catalog.jsonb_build_object('op','ADD','entity','Message','ref',p_target_ref,
          'description','Send the collections reminder'));
    WHEN 'FOLLOWUP_SEND' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','FollowUp','ref',p_target_ref,
          'description','Mark the follow-up sent'),
        pg_catalog.jsonb_build_object('op','ADD','entity','Message','ref',p_target_ref,
          'description','Send the follow-up message'));
    WHEN 'BROADCAST_SEND' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','ADD','entity','Message','ref',p_target_ref,
        'description','Fan out the approved broadcast'));
    WHEN 'AGENT_AUTONOMY_CHANGE' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','AutonomyGrant','ref',p_payload ->> 'agentId',
        'description','Change the agent autonomy grant'));
    WHEN 'AGENT_PAUSE' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','AutonomyGrant','ref',p_payload ->> 'agentId',
        'description','Pause the agent grants'));
    WHEN 'BUDGET_CAP_RAISE' THEN
      v_effects := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'op','UPDATE','entity','AIBudget','ref',p_target_ref,
        'description','Raise the AI budget cap'));
    WHEN 'RULE_CHANGE_APPROVE' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','RuleChange','ref',p_target_ref,
          'description','Approve the extracted rule change'),
        pg_catalog.jsonb_build_object('op','ADD','entity','ComplianceRecheck','ref',p_target_ref,
          'description','Re-evaluate affected engagements'));
    WHEN 'ACCOUNT_TRADING_HOLD' THEN
      v_effects := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('op','UPDATE','entity','CollectionsCase','ref',p_target_ref,
          'description','Place the account on trading hold'),
        pg_catalog.jsonb_build_object('op','ADD','entity','Notification','ref',p_target_ref,
          'description','Notify the account owner'));
    ELSE
      RAISE EXCEPTION 'unknown action type %L', p_type
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
  RETURN v_effects;
END;
$fn$;

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

DROP FUNCTION IF EXISTS app.check_opportunity_stage_move(uuid, uuid, jsonb);

-- ═══ 3 · 019's app.seed_pipelines ═════════════════════════════════════════

CREATE OR REPLACE FUNCTION app.seed_pipelines(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_rows integer := 0; v_steps integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'seed_pipelines: p_tenant_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- `core.pipelines` carries `trg_pipelines_ref` -> `core.assign_ref('PIP')`,
  -- which RAISES if the tenant has no `PIP` row in `core.ref_formats`. 016
  -- seeds those from its own AFTER INSERT trigger, and per-row AFTER INSERT
  -- triggers fire in ALPHABETICAL ORDER BY TRIGGER NAME — so this pack's
  -- trigger is named to sort after `trg_tenants_seed_ref_formats`. Asserted
  -- here as well, because a name-ordering dependency that is only a comment is
  -- a dependency waiting to be renamed.
  IF NOT EXISTS (SELECT 1 FROM core.ref_formats AS format
                  WHERE format.tenant_id = p_tenant_id AND format.prefix = 'PIP') THEN
    RAISE EXCEPTION
      'seed_pipelines: tenant % has no PIP ref_format yet. 016 seeds it from '
      'trg_tenants_seed_ref_formats, and AFTER INSERT triggers fire in '
      'alphabetical order by name — this seed must sort after it.', p_tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- RECORDED AS IT IS INSERTED. `RETURNING` under `ON CONFLICT DO NOTHING`
  -- yields ONLY the rows this statement actually wrote, which is precisely the
  -- set the rollback is entitled to delete.
  WITH inserted AS (
  INSERT INTO core.pipelines
    (id, tenant_id, object, name, is_default, version, status,
     created_by_kind, created_by_id)
  SELECT pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object)::uuid,
         p_tenant_id, spec.object, spec.name, true, 1, 'ACTIVE', 'SYSTEM', 'migration:019'
    FROM (VALUES
            -- Doc 01 §3.6: two lifecycles, two rows. The nine-step delivery
            -- lifecycle is API_CONTRACT.md's `GET /v1/engagements/{id}`
            -- example and the contract's ENGAGEMENT_STAGE_KEYS.
            ('ENGAGEMENT',  'Delivery lifecycle'),
            -- The seven opportunity stages are doc 01 §5.3's own
            -- `opportunities.stage` edge set and the contract's
            -- OPPORTUNITY_STAGES, in that order.
            ('OPPORTUNITY', 'Deal board')
          ) AS spec(object, name)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
  ), recorded AS (
  INSERT INTO app.seeded_pipelines (row_kind, tenant_id, row_id)
  SELECT 'PIPELINE', p_tenant_id, inserted.id FROM inserted
  ON CONFLICT (row_kind, row_id) DO NOTHING
  RETURNING 1)
  -- COUNTED OFF `inserted`, NOT off ROW_COUNT. ROW_COUNT would now report the
  -- LEDGER's insert, and a stale ledger row from a pipeline deleted outside
  -- `app.unseed_pipelines` would make a real seed report zero — which is how
  -- `app.seed_pipelines_all()` would start believing it had nothing to do.
  SELECT pg_catalog.count(*)::integer INTO v_rows FROM inserted;

  WITH inserted AS (
  INSERT INTO core.pipeline_steps
    (id, tenant_id, pipeline_id, step_key, label, position, terminal, blocking_check_keys)
  SELECT pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object || ':' || spec.step_key)::uuid,
         p_tenant_id,
         pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object)::uuid,
         spec.step_key, spec.label, spec.position, spec.terminal,
         -- `blocking_check_keys` stays empty: §17 sets HRDC_CLAIM to BLOCKED
         -- from a FAILING CHECK RESULT, not from a named key list, and 017
         -- seeds the three check keys per tenant. Anything else here would be
         -- configuration with no citation behind it.
         ARRAY[]::text[]
    FROM (VALUES
            -- ENGAGEMENT — API_CONTRACT.md:549-553, contract ENGAGEMENT_STAGE_KEYS,
            -- doc 01 §5.3 per row (engagements.status, trainer_bookings.state,
            -- attendance_days.status, hrdc_packets.status, invoices.status).
            ('ENGAGEMENT','WON',              'Won',               1::smallint, false),
            ('ENGAGEMENT','TRAINER_CONFIRMED','Trainer confirmed', 2::smallint, false),
            ('ENGAGEMENT','SCHEDULED',        'Scheduled',         3::smallint, false),
            ('ENGAGEMENT','REGISTERED',       'Registered',        4::smallint, false),
            ('ENGAGEMENT','DELIVERED',        'Delivered',         5::smallint, false),
            ('ENGAGEMENT','ATTENDANCE_LOCKED','Attendance locked', 6::smallint, false),
            ('ENGAGEMENT','HRDC_CLAIM',       'HRDC claim',        7::smallint, false),
            ('ENGAGEMENT','INVOICED',         'Invoiced',          8::smallint, false),
            ('ENGAGEMENT','PAID',             'Paid',              9::smallint, true),
            -- OPPORTUNITY — doc 01 §5.3 `opportunities.stage`, contract
            -- OPPORTUNITY_STAGES. WON and LOST are terminal and sit BESIDE each
            -- other, which is ruling R16's whole point: a screen that inferred
            -- an ending from the highest position would put LOST after WON.
            ('OPPORTUNITY','NEW',           'New',           1::smallint, false),
            ('OPPORTUNITY','QUALIFYING',    'Qualifying',    2::smallint, false),
            ('OPPORTUNITY','TNA_SENT',      'TNA sent',      3::smallint, false),
            ('OPPORTUNITY','PROPOSAL_SENT', 'Proposal sent', 4::smallint, false),
            ('OPPORTUNITY','NEGOTIATION',   'Negotiation',   5::smallint, false),
            ('OPPORTUNITY','WON',           'Won',           6::smallint, true),
            ('OPPORTUNITY','LOST',          'Lost',          7::smallint, true)
          ) AS spec(object, step_key, label, position, terminal)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
  ), recorded AS (
  INSERT INTO app.seeded_pipelines (row_kind, tenant_id, row_id)
  SELECT 'STEP', p_tenant_id, inserted.id FROM inserted
  ON CONFLICT (row_kind, row_id) DO NOTHING
  RETURNING 1)
  SELECT pg_catalog.count(*)::integer INTO v_steps FROM inserted;

  RETURN v_rows + v_steps;
END;
$fn$;

-- ═══ 4 · 020's get_audit, and the 018 bodies ═══════════════════════════════

CREATE OR REPLACE FUNCTION core.get_audit(p_resource_type text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_subject text;
  v_request uuid;
  v_rows    jsonb;
BEGIN
  -- 020 · AUTHZ FIRST, before any read, so the refusal does not vary with id.
  IF NOT app.has_permission('audit:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','audit:read'));
  END IF;

  SELECT segment.subject_type INTO v_subject
    FROM (VALUES
            ('approvals',     'APPROVAL_REQUEST'),
            ('proposals',     'PROPOSAL'),
            ('quotations',    'QUOTATION'),
            ('enquiries',     'ENQUIRY'),
            ('organisations', 'ORGANISATION'),
            ('opportunities', 'OPPORTUNITY'),
            ('contacts',      'CONTACT'),
            ('tnas',          'TNA'),
            ('programmes',    'PROGRAMME'),
            ('trainers',      'TRAINER'),
            ('engagements',   'ENGAGEMENT'),
            ('invoices',      'INVOICE'),
            ('follow-ups',    'FOLLOW_UP'),
            ('runs',          'RUN'),
            ('agents',        'AGENT')
         ) AS segment(resource, subject_type)
   WHERE segment.resource = p_resource_type;
  v_subject := COALESCE(v_subject, p_resource_type);

  IF v_subject = 'APPROVAL_REQUEST' THEN
    SELECT approval.action_request_id INTO v_request
      FROM core.approval_requests AS approval
     WHERE approval.tenant_id = v_tenant
       AND (approval.id::text = p_id OR approval.ref = p_id);
  END IF;

  -- ONE ROW PER EVENT. An event reached both as the subject and through the
  -- approval's correlation appears once.
  SELECT COALESCE(pg_catalog.jsonb_agg(entry.item ORDER BY entry.at DESC, entry.id DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT DISTINCT ON (audit.id)
             audit.id,
             audit.at,
             pg_catalog.jsonb_build_object(
               'at',      audit.at,
               'actor',   audit.actor,
               'event',   audit.event,
               'summary', COALESCE(audit.summary, audit.event))
             || CASE WHEN audit.run_id IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('runId', audit.run_id) END AS item
        FROM core.audit_entries AS audit
       WHERE audit.tenant_id = v_tenant
         AND ((audit.subject_type = v_subject
               AND (audit.subject_id::text = p_id OR audit.aggregate_ref = p_id))
              OR (v_request IS NOT NULL
                  AND audit.correlation_id = v_request
                  AND audit.subject_role = 'SUBJECT'))
       ORDER BY audit.id, audit.at DESC
    ) AS entry;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object(
      'next', NULL, 'total', pg_catalog.jsonb_array_length(v_rows))));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.badge_counts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant    uuid := app.require_tenant_id();
  v_actor     record;
  v_approvals integer;
  v_hrdc      integer;
  v_failures  integer;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('reason','NO_APP_ROLE'));
  END IF;

  -- The approvals badge is 011's own count, not a second query over the same
  -- rows. A second copy of the "which approvals are mine and open" predicate
  -- would drift from the first.
  v_approvals := COALESCE(app.open_approval_count(v_actor.actor_id), 0);

  SELECT pg_catalog.count(*)::integer INTO v_hrdc
    FROM core.hrdc_packets AS packet
   WHERE packet.tenant_id = v_tenant
     AND packet.voided_at IS NULL
     AND packet.panel_state IN ('DEADLINE_AT_RISK','BLOCKED');

  SELECT pg_catalog.count(*)::integer INTO v_failures
    FROM core.runs AS run
   WHERE run.tenant_id = v_tenant
     AND run.status IN ('FAILED','HALTED')
     AND run.acknowledged_at IS NULL;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'approvals',     v_approvals,
    'hrdcDeadlines', COALESCE(v_hrdc, 0),
    'agentFailures', COALESCE(v_failures, 0)));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.list_enquiries(
  p_filter jsonb DEFAULT '[]'::jsonb,
  p_sort   text  DEFAULT NULL,
  p_page   jsonb DEFAULT '{"size":50}'::jsonb,
  p_view   text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_size     integer;
  v_cursor   text;
  v_cur_at   timestamptz;
  v_cur_id   uuid;
  v_clauses  text[] := ARRAY[]::text[];
  v_applied  jsonb  := '[]'::jsonb;
  v_errors   jsonb  := '[]'::jsonb;
  v_merged   jsonb  := '[]'::jsonb;
  v_clause   jsonb;
  v_field    text;
  v_op       text;
  v_column   text;
  v_kind     text;
  v_desc     boolean := true;
  v_sort_col text := 'received_at';
  v_sort_fld text := 'receivedAt';
  v_where    text;
  v_sql      text;
  v_rows     jsonb;
  v_total    integer;
  v_next     text;
  v_last_at  timestamptz;
  v_last_id  uuid;
  v_count    integer;
  v_keyed    text;
BEGIN
  -- ── page ────────────────────────────────────────────────────────────────
  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','page.size','reason', SQLERRM))));
  END;

  v_cursor := NULLIF(p_page ->> 'cursor', '');
  IF v_cursor IS NOT NULL THEN
    BEGIN
      SELECT decoded.at, decoded.id INTO v_cur_at, v_cur_id
        FROM app._cursor_decode(v_cursor) AS decoded;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','page.cursor','reason','MALFORMED_CURSOR'))));
    END;
  END IF;

  -- SAVED VIEW. One resolution path for all five lists (§1
  -- `app._view_filters`): it gates on `core.saved_view_object`, refuses a view
  -- that does not resolve in THIS tenant, and tags what it contributes
  -- `source: VIEW`. A list whose object has no enum value refuses rather than
  -- dropping the parameter.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'ENQUIRY', p_filter);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','view','reason', SQLERRM))));
  END;

  SELECT v_merged || COALESCE(pg_catalog.jsonb_agg(element.value || pg_catalog.jsonb_build_object('source','REQUEST')), '[]'::jsonb)
    INTO v_merged
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter, '[]'::jsonb)) AS element(value);

  -- ── filters ─────────────────────────────────────────────────────────────
  -- FAIL CLOSED. An unrecognised field or op is VALIDATION_FAILED with
  -- `details.fields[]`, never an ignored clause: ignoring a filter shows rows
  -- the reader explicitly asked to exclude, which reads as a data error rather
  -- than as a refusal.
  FOR v_clause IN SELECT element.value FROM pg_catalog.jsonb_array_elements(v_merged) AS element(value)
  LOOP
    v_field := v_clause ->> 'field';
    v_op    := v_clause ->> 'op';

    SELECT allowed.column_name, allowed.kind INTO v_column, v_kind
      FROM (VALUES
              ('status',             'status',                  'text'),
              ('channel',            'channel',                 'text'),
              ('needsHumanReview',   'needs_human_review',      'bool'),
              ('receivedAt',         'received_at',             'ts'),
              ('assignedTo',         'assigned_to_user_id',     'uuid'),
              ('matchedOrganisation','matched_organisation_id', 'uuid'),
              ('subject',            'subject',                 'text'),
              ('estimatedValue',     'estimated_value_sen',     'number'),
              ('classification',     'classification_label',    'text')
            ) AS allowed(field, column_name, kind)
     WHERE allowed.field = v_field;

    IF v_column IS NULL THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', COALESCE(v_field,'(null)'), 'reason','UNKNOWN_FILTER_FIELD'));
      CONTINUE;
    END IF;

    BEGIN
      v_clauses := v_clauses || app._predicate(v_column, v_kind, v_op, v_clause -> 'value');
      v_applied := v_applied || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'op', v_op,
        'value', COALESCE(v_clause -> 'value', 'null'::jsonb),
        'source', COALESCE(v_clause ->> 'source', 'REQUEST')));
    EXCEPTION WHEN invalid_parameter_value THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'reason', SQLERRM, 'code', COALESCE(v_op,'(null)')));
    END;
    v_column := NULL; v_kind := NULL;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_errors) > 0 THEN
    RETURN app.err('VALIDATION_FAILED',
      pg_catalog.jsonb_build_object('fields', v_errors));
  END IF;

  -- ── sort ────────────────────────────────────────────────────────────────
  -- A malformed sort must read as a malformed sort, which is why the four
  -- query parts arrive as four arguments rather than one bag.
  IF NULLIF(p_sort, '') IS NOT NULL THEN
    v_desc := pg_catalog.left(p_sort, 1) = '-';
    v_sort_fld := CASE WHEN v_desc THEN pg_catalog.substr(p_sort, 2) ELSE p_sort END;
    SELECT allowed.column_name INTO v_sort_col
      FROM (VALUES
              ('receivedAt','received_at'),
              ('createdAt','created_at'),
              ('updatedAt','updated_at'),
              ('estimatedValue','estimated_value_sen'),
              ('subject','subject'),
              ('status','status')
            ) AS allowed(field, column_name)
     WHERE allowed.field = v_sort_fld;
    IF v_sort_col IS NULL THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','sort','reason','UNKNOWN_SORT_FIELD','code', v_sort_fld))));
    END IF;
  END IF;

  v_where := CASE WHEN pg_catalog.array_length(v_clauses, 1) IS NULL THEN 'true'
                  ELSE pg_catalog.array_to_string(v_clauses, ' AND ') END;

  -- COUNT BEFORE KEYSET, CURSOR FROM A REAL LOOKAHEAD — both orderings now
  -- live in `app._keyset_scope` / `app._next_cursor` (§1), so no copy of this
  -- engine can get either one wrong on its own. See the helpers' header for
  -- the two defects this pair replaces.
  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.enquiries'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id) AS scope;

  v_sql := pg_catalog.format($q$
    WITH page AS (
      SELECT * FROM core.enquiries
       WHERE tenant_id = $1 AND %s
       ORDER BY %I %s, id %s
       LIMIT $2
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.ord), '[]'::jsonb),
           pg_catalog.count(*)::integer,
           -- THE CURSOR IS THE LAST ROW IN DISPLAY ORDER, not the maximum sort
           -- key. Under a DESCENDING sort those are opposite ends of the page,
           -- and taking the max hands back a cursor pointing at the row the
           -- reader has already seen — page two then repeats page one's tail.
           -- Caught by T4e, which counted the rows on page two.
           (pg_catalog.array_agg(row.sort_at ORDER BY row.ord DESC))[1],
           (pg_catalog.array_agg(row.id      ORDER BY row.ord DESC))[1]
      FROM (
        SELECT pg_catalog.row_number() OVER (ORDER BY e.%I %s, e.id %s) AS ord,
               e.id, e.%I AS sort_at,
               pg_catalog.jsonb_build_object(
                 'id',         e.id::text,
                 'ref',        e.ref,
                 'createdAt',  e.created_at,
                 'updatedAt',  e.updated_at,
                 'createdBy',  app._actor(e.created_by_kind::text, e.created_by_id, e.created_by_name),
                 'channel',    e.channel::text,
                 'status',     e.status::text,
                 'receivedAt', e.received_at,
                 'from', pg_catalog.jsonb_build_object(
                            'name',  e.from_name,
                            'email', e.from_email::text,
                            'phone', e.from_phone),
                 'subject', COALESCE(e.subject, ''),
                 'preview', COALESCE(e.preview, ''),
                 'classification',
                   pg_catalog.jsonb_build_object(
                     'label', COALESCE(e.classification_label, 'UNCLASSIFIED'),
                     'provenance', COALESCE(
                        app._provenance('enquiries', e.id, 'classification_label'),
                        pg_catalog.jsonb_build_object('origin','HUMAN')))
                   || CASE WHEN e.needs_human_review
                           THEN pg_catalog.jsonb_build_object('needsHumanReview', true)
                           ELSE '{}'::jsonb END,
                 'estimatedValue', app._money(e.estimated_value_sen, e.currency),
                 'matchedOrganisation',
                   CASE WHEN org.id IS NULL THEN NULL
                        ELSE pg_catalog.jsonb_build_object(
                               'id',   org.id::text,
                               'ref',  org.ref,
                               'name', org.name,
                               'matchReason', COALESCE(e.match_reason::text, 'MANUAL'))
                   END,
                 'assignedTo',
                   CASE WHEN e.assigned_to_user_id IS NULL THEN NULL
                        ELSE app._actor('HUMAN', e.assigned_to_user_id::text, assignee.display_name)
                   END
               ) AS item
          FROM page AS e
          LEFT JOIN core.organisations AS org
                 ON org.tenant_id = e.tenant_id AND org.id = e.matched_organisation_id
          LEFT JOIN public.user_profiles AS assignee
                 ON assignee.tenant_id = e.tenant_id AND assignee.user_id = e.assigned_to_user_id
      ) AS row$q$,
    v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col);

  EXECUTE v_sql INTO v_rows, v_count, v_last_at, v_last_id USING v_tenant, v_size;

  -- `next` IS NULL ON THE LAST PAGE, NEVER ABSENT. The client's unwrap rule is
  -- sensitive to key sets and an omitted key changes the shape — this is the
  -- one doc 09 §5 says a test catches and a reviewer does not, so the pin
  -- asserts present-and-null explicitly.
  v_next := app._next_cursor('core.enquiries'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_enquiry(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant     uuid := app.require_tenant_id();
  v_row        core.enquiries%ROWTYPE;
  v_org        core.organisations%ROWTYPE;
  v_assignee   text;
  v_extraction jsonb := '{}'::jsonb;
  v_related    jsonb;
  v_suggested  jsonb;
  v_key        text;
  v_value      text;
  v_field_id   uuid;
BEGIN
  -- `p_id` accepts EITHER the uuid or the `ref` (`ENQ-2026-0912`): the app
  -- routes on refs, and this matches the fixture client's `byIdOrRef`. The
  -- comparison is `id::text = p_id`, never `p_id::uuid`, so a ref never dies
  -- on `invalid_text_representation` before the ref branch is reached.
  SELECT enquiry.* INTO v_row FROM core.enquiries AS enquiry
   WHERE enquiry.tenant_id = v_tenant
     AND (enquiry.id::text = p_id OR enquiry.ref = p_id);

  -- NOT_FOUND does NOT distinguish "exists in another tenant" from "does not
  -- exist". Any difference between the two is a cross-tenant existence oracle,
  -- and it leaks by timing as readily as by message, so there is one branch.
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT org.* INTO v_org FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant AND org.id = v_row.matched_organisation_id;

  SELECT profile.display_name INTO v_assignee FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.assigned_to_user_id;

  -- §4 extraction: the four fields, each carrying its OWN provenance, and
  -- ABSENT PROVENANCE MEANS HUMAN-AUTHORED — `app._provenance` returns NULL
  -- when no row matches and `app._provenanced` then omits the KEY. A null
  -- provenance would badge every hand-typed field as AI.
  FOR v_key IN SELECT unnest FROM pg_catalog.unnest(ARRAY['topic','audience','timing','budget'])
  LOOP
    SELECT field.id, field.value INTO v_field_id, v_value
      FROM core.enquiry_extraction_fields AS field
     WHERE field.tenant_id = v_tenant
       AND field.enquiry_id = v_row.id
       AND field.field_key = v_key;

    v_extraction := v_extraction || pg_catalog.jsonb_build_object(
      v_key,
      app._provenanced(
        CASE
          WHEN v_field_id IS NULL OR v_value IS NULL THEN NULL
          -- §4 types `budget` as `Money | null`, not as a string. The stored
          -- value is the integer sen; a non-numeric stored value is data the
          -- worker got wrong and is surfaced as null rather than as a crash.
          WHEN v_key = 'budget' THEN
            CASE WHEN v_value ~ '^-?[0-9]+$'
                 THEN app._money(v_value::bigint, v_row.currency)
                 ELSE NULL END
          ELSE pg_catalog.to_jsonb(v_value)
        END,
        CASE WHEN v_field_id IS NULL THEN NULL
             ELSE app._provenance('enquiry_extraction_fields', v_field_id, v_key) END));
    v_field_id := NULL; v_value := NULL;
  END LOOP;

  -- §4 related chips: the records this enquiry actually points at. Built from
  -- real rows, so an enquiry with no organisation match shows no chip rather
  -- than an empty one.
  SELECT COALESCE(pg_catalog.jsonb_agg(related.item ORDER BY related.ord), '[]'::jsonb)
    INTO v_related
    FROM (
      SELECT 1 AS ord, pg_catalog.jsonb_build_object(
               'type','ORGANISATION','ref', v_org.ref, 'label', v_org.name) AS item
       WHERE v_org.id IS NOT NULL
      UNION ALL
      SELECT 2, pg_catalog.jsonb_build_object(
               'type','CONTACT','ref', contact.ref, 'label', contact.name)
        FROM core.contacts AS contact
       WHERE contact.tenant_id = v_tenant AND contact.id = v_row.matched_contact_id
      UNION ALL
      SELECT 3, pg_catalog.jsonb_build_object(
               'type','ACTION','ref', opportunity.ref,
               'label', 'Opportunity ' || opportunity.stage::text)
        FROM core.opportunities AS opportunity
       WHERE opportunity.tenant_id = v_tenant AND opportunity.source_enquiry_id = v_row.id
    ) AS related;

  -- §4 `suggestedAction` is OPTIONAL and is omitted when no draft is open.
  -- An empty object here would render an empty suggestion card.
  SELECT pg_catalog.jsonb_build_object(
           'type',     draft.action_type,
           'autonomy', COALESCE(request.granted_level, request.autonomy_level, 'SUGGEST'),
           'summary',  COALESCE(draft.body, draft.action_type),
           'payload',  draft.payload)
         || CASE WHEN pg_catalog.jsonb_typeof(draft.planned_effects) = 'array'
                  AND pg_catalog.jsonb_array_length(draft.planned_effects) > 0
                 THEN pg_catalog.jsonb_build_object('diff', draft.planned_effects)
                 ELSE '{}'::jsonb END
         || CASE WHEN draft.provenance = '{}'::jsonb THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('provenance', draft.provenance) END
    INTO v_suggested
    FROM core.suggested_drafts AS draft
    JOIN core.action_requests AS request
      ON request.tenant_id = draft.tenant_id AND request.id = draft.action_request_id
   WHERE draft.tenant_id = v_tenant
     AND draft.target_ref = v_row.ref
     AND draft.status = 'PENDING'
     AND draft.expires_at > pg_catalog.now()
   ORDER BY draft.created_at DESC
   LIMIT 1;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',         v_row.id::text,
      'ref',        v_row.ref,
      'createdAt',  v_row.created_at,
      'updatedAt',  v_row.updated_at,
      'createdBy',  app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'channel',    v_row.channel::text,
      'status',     v_row.status::text,
      'receivedAt', v_row.received_at,
      'from', pg_catalog.jsonb_build_object(
                'name',  v_row.from_name,
                'email', v_row.from_email::text,
                'phone', v_row.from_phone),
      'subject', COALESCE(v_row.subject, ''),
      'preview', COALESCE(v_row.preview, ''),
      'body',    COALESCE(v_row.body, ''),
      'classification',
        pg_catalog.jsonb_build_object(
          'label', COALESCE(v_row.classification_label, 'UNCLASSIFIED'),
          'provenance', COALESCE(
             app._provenance('enquiries', v_row.id, 'classification_label'),
             pg_catalog.jsonb_build_object('origin','HUMAN')))
        || CASE WHEN v_row.needs_human_review
                THEN pg_catalog.jsonb_build_object('needsHumanReview', true)
                ELSE '{}'::jsonb END,
      'estimatedValue', app._money(v_row.estimated_value_sen, v_row.currency),
      'matchedOrganisation',
        CASE WHEN v_org.id IS NULL THEN NULL
             ELSE pg_catalog.jsonb_build_object(
                    'id', v_org.id::text, 'ref', v_org.ref, 'name', v_org.name,
                    'matchReason', COALESCE(v_row.match_reason::text, 'MANUAL'))
        END,
      'assignedTo',
        CASE WHEN v_row.assigned_to_user_id IS NULL THEN NULL
             ELSE app._actor('HUMAN', v_row.assigned_to_user_id::text, v_assignee) END,
      'extraction', v_extraction,
      'related',    v_related)
    || CASE WHEN v_suggested IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('suggestedAction', v_suggested) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.patch_enquiry_extraction(p_id text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_actor   record;
  v_row     core.enquiries%ROWTYPE;
  v_field   text;
  v_value   jsonb;
  v_text    text;
  v_field_id uuid;
  v_name    text;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  v_field := p_patch ->> 'field';
  v_value := p_patch -> 'value';

  -- Only the four §4 extraction fields. An unknown field is VALIDATION_FAILED,
  -- never a silently created row: the fixtures oracle refuses the same way and
  -- the conformance suite compares the two.
  IF v_field IS NULL OR v_field NOT IN ('topic','audience','timing','budget') THEN
    RAISE EXCEPTION 'unknown extraction field'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','field','reason','UNKNOWN_EXTRACTION_FIELD')))::text;
  END IF;

  SELECT enquiry.* INTO v_row FROM core.enquiries AS enquiry
   WHERE enquiry.tenant_id = v_tenant
     AND (enquiry.id::text = p_id OR enquiry.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such enquiry'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- `budget` is Money on the wire and integer sen in the column. Everything
  -- else is a string. A JSON null erases the value rather than storing "null".
  v_text := CASE
              WHEN v_value IS NULL OR v_value = 'null'::jsonb THEN NULL
              WHEN v_field = 'budget' THEN (v_value ->> 'amount')
              ELSE v_value #>> '{}'
            END;

  INSERT INTO core.enquiry_extraction_fields
    (tenant_id, enquiry_id, field_key, value, created_by_kind, created_by_id, created_by_name)
  VALUES (v_tenant, v_row.id, v_field, v_text,
          COALESCE(v_actor.actor_kind,'HUMAN')::app.actor_kind, v_actor.actor_id, NULL)
  ON CONFLICT (tenant_id, enquiry_id, field_key)
    DO UPDATE SET value = EXCLUDED.value
  RETURNING id INTO v_field_id;

  SELECT profile.display_name INTO v_name FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id::text = v_actor.actor_id;

  -- §1: A HUMAN EDIT OF AN AI VALUE FLIPS `origin` TO `AI_SUGGESTED` AND STAMPS
  -- `editedBy`. It does NOT erase the provenance — the lineage is what tells a
  -- later reader the number started as a model's guess, and the editor is what
  -- tells them who took responsibility for it. The fixtures oracle does exactly
  -- this and the conformance suite compares the two.
  --
  -- A field with NO provenance row stays without one: a human editing a
  -- human-authored value has nothing to disclose, and inserting a row here
  -- would badge it as AI-touched for ever after.
  -- ORIGIN IS NOT TOUCHED — it is immutable by 005's trigger, and it should be:
  -- the value's origin is a historical fact. Stamping the editor is what turns
  -- the badge into "AI, edited", and `app._provenance` derives `AI_SUGGESTED`
  -- from the pair on the way out.
  UPDATE core.provenance AS prov
     SET edited_by      = CASE WHEN v_actor.actor_kind = 'HUMAN'
                               THEN v_actor.actor_id::uuid ELSE prov.edited_by END,
         edited_by_name = COALESCE(v_name, v_actor.actor_id),
         edited_at      = pg_catalog.now()
   WHERE prov.tenant_id = v_tenant
     AND prov.subject_table = 'enquiry_extraction_fields'
     AND prov.subject_id = v_field_id
     AND prov.field = v_field;

  UPDATE core.enquiries AS enquiry SET updated_at = pg_catalog.now()
   WHERE enquiry.tenant_id = v_tenant AND enquiry.id = v_row.id;

  -- The whole EnquiryDetail comes back, not just the patched field: the editor
  -- re-renders from one payload and cannot drift from the record.
  RETURN core.get_enquiry(v_row.id::text);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.list_follow_ups(
  p_filter jsonb DEFAULT '[]'::jsonb,
  p_sort   text  DEFAULT NULL,
  p_page   jsonb DEFAULT '{"size":50}'::jsonb,
  p_view   text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_size    integer;
  v_cur_at  timestamptz;
  v_cur_id  uuid;
  v_clauses text[] := ARRAY[]::text[];
  v_errors  jsonb  := '[]'::jsonb;
  v_applied jsonb  := '[]'::jsonb;
  v_clause  jsonb;
  v_field   text;
  v_op      text;
  v_column  text;
  v_kind    text;
  v_desc    boolean := false;
  v_sort_col text := 'due_date';
  v_sort_fld text;
  v_where   text;
  v_rows    jsonb;
  v_total   integer;
  v_count   integer;
  v_next    text;
  v_last_at timestamptz;
  v_last_id uuid;
  v_cursor  text;
  v_keyed   text;
  v_merged  jsonb  := '[]'::jsonb;
BEGIN
  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','page.size','reason', SQLERRM))));
  END;

  v_cursor := NULLIF(p_page ->> 'cursor', '');
  IF v_cursor IS NOT NULL THEN
    BEGIN
      SELECT decoded.at, decoded.id INTO v_cur_at, v_cur_id
        FROM app._cursor_decode(v_cursor) AS decoded;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','page.cursor','reason','MALFORMED_CURSOR'))));
    END;
  END IF;

  -- SAVED VIEW. This parameter was DECLARED AND NEVER READ: a reader who asked
  -- for a saved view got every row in the tenant with `appliedFilters: []` and
  -- `success: true`. `core.saved_view_object` has no value for this list's
  -- object, so a view for it cannot exist and the only honest answers are
  -- "refuse" or "resolve it once the enum has the value". `app._view_filters`
  -- gives both: it refuses off the enum today and resolves the day the
  -- contract adds the value, with no edit here.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'FOLLOW_UP', p_filter);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','view','reason', SQLERRM))));
  END;

  SELECT v_merged || COALESCE(pg_catalog.jsonb_agg(element.value), '[]'::jsonb) INTO v_merged
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter, '[]'::jsonb)) AS element(value);

  FOR v_clause IN SELECT element.value FROM pg_catalog.jsonb_array_elements(v_merged) AS element(value)
  LOOP
    v_field := v_clause ->> 'field';
    v_op    := v_clause ->> 'op';
    SELECT allowed.column_name, allowed.kind INTO v_column, v_kind
      FROM (VALUES ('status','status','text'), ('autonomy','autonomy','text'),
                   ('dueDate','due_date','ts'), ('owner','owner_id','uuid'),
                   ('organisation','organisation_id','uuid'),
                   ('contact','contact_id','uuid'), ('reason','reason','text'))
           AS allowed(field, column_name, kind)
     WHERE allowed.field = v_field;
    IF v_column IS NULL THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', COALESCE(v_field,'(null)'), 'reason','UNKNOWN_FILTER_FIELD'));
      CONTINUE;
    END IF;
    BEGIN
      -- `dueDate` is a DATE column, so the ts predicate casts cleanly; the
      -- whitelist keeps the cast honest.
      v_clauses := v_clauses || app._predicate(v_column,
                     CASE WHEN v_column = 'due_date' THEN 'text' ELSE v_kind END, v_op, v_clause -> 'value');
      v_applied := v_applied || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'op', v_op,
        'value', COALESCE(v_clause -> 'value','null'::jsonb),
        'source', COALESCE(v_clause ->> 'source', 'REQUEST')));
    EXCEPTION WHEN invalid_parameter_value THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'reason', SQLERRM, 'code', COALESCE(v_op,'(null)')));
    END;
    v_column := NULL; v_kind := NULL;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_errors) > 0 THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object('fields', v_errors));
  END IF;

  IF NULLIF(p_sort,'') IS NOT NULL THEN
    v_desc := pg_catalog.left(p_sort,1) = '-';
    v_sort_fld := CASE WHEN v_desc THEN pg_catalog.substr(p_sort,2) ELSE p_sort END;
    SELECT allowed.column_name INTO v_sort_col
      FROM (VALUES ('dueDate','due_date'),('createdAt','created_at'),('updatedAt','updated_at'))
           AS allowed(field, column_name)
     WHERE allowed.field = v_sort_fld;
    IF v_sort_col IS NULL THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','sort','reason','UNKNOWN_SORT_FIELD','code', v_sort_fld))));
    END IF;
  END IF;
  -- The fixtures oracle defaults this list to `dueDate` ASCENDING, and the
  -- client sends `p_sort: null` when the caller does not choose. So the DEFAULT
  -- LIVES HERE or the two answer differently — soonest-due first is the only
  -- order a follow-up queue can sensibly open in.

  v_where := CASE WHEN pg_catalog.array_length(v_clauses,1) IS NULL THEN 'true'
                  ELSE pg_catalog.array_to_string(v_clauses,' AND ') END;

  -- COUNT BEFORE KEYSET, CURSOR FROM A REAL LOOKAHEAD — both orderings now
  -- live in `app._keyset_scope` / `app._next_cursor` (§1), so no copy of this
  -- engine can get either one wrong on its own. See the helpers' header for
  -- the two defects this pair replaces.
  -- `p_date_sort => true`: `due_date` is a DATE column, so the keyset tuple
  -- casts it to timestamptz to compare against the cursor's own type. The two
  -- timestamptz sort columns are unaffected by the cast.
  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.follow_ups'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id, true) AS scope;

  -- THE PAGE IS SELECTED BEFORE THE JOINS, in a CTE, exactly as
  -- `core.list_enquiries` does it — and here that is a correctness rule rather
  -- than a style. `app._predicate` and the keyset tuple both emit BARE column
  -- names, and `core.contacts` and `core.organisations` each carry their own
  -- `id`, `status` and `created_at`. Applied against the three-way join those
  -- names are AMBIGUOUS, and Postgres refuses the whole query with
  -- `column reference "id" is ambiguous` — a 500, not a refusal. It was latent
  -- only because nothing had ever paged this list or filtered it on `status`.
  -- Against one relation there is nothing for a bare name to be ambiguous
  -- with. Pinned by T31d-T31f.
  EXECUTE pg_catalog.format($q$
    WITH page AS (
      SELECT * FROM core.follow_ups
       WHERE tenant_id = $1 AND %s
       ORDER BY %I %s, id %s
       LIMIT $2
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.ord), '[]'::jsonb),
           pg_catalog.count(*)::integer,
           (pg_catalog.array_agg(row.sort_at ORDER BY row.ord DESC))[1],
           (pg_catalog.array_agg(row.id      ORDER BY row.ord DESC))[1]
      FROM (
        SELECT pg_catalog.row_number() OVER (ORDER BY f.%I %s, f.id %s) AS ord,
               f.id, f.%I::timestamptz AS sort_at,
               pg_catalog.jsonb_build_object(
                 'id',   f.id::text,
                 'ref',  f.ref,
                 'contact',      pg_catalog.jsonb_build_object('ref', contact.ref, 'name', contact.name),
                 'organisation', pg_catalog.jsonb_build_object('ref', org.ref,     'name', org.name),
                 'reason',   f.reason,
                 'dueDate',  f.due_date,
                 'status',   f.status::text,
                 'autonomy', f.autonomy::text) AS item
          FROM page AS f
          JOIN core.contacts      AS contact ON contact.tenant_id = f.tenant_id AND contact.id = f.contact_id
          JOIN core.organisations AS org     ON org.tenant_id     = f.tenant_id AND org.id     = f.organisation_id
      ) AS row$q$,
    v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col)
    INTO v_rows, v_count, v_last_at, v_last_id USING v_tenant, v_size;

  v_next := app._next_cursor('core.follow_ups'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id, true);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_follow_up_draft(p_id text, p_channel text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_follow  core.follow_ups%ROWTYPE;
  v_draft   core.outbound_messages%ROWTYPE;
  v_rate    core.message_rates%ROWTYPE;
  v_consent core.contact_consents%ROWTYPE;
  v_source  text;
  v_out     jsonb;
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('EMAIL','WHATSAPP') THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','channel','reason','UNSUPPORTED_CHANNEL'))));
  END IF;

  SELECT follow_up.* INTO v_follow FROM core.follow_ups AS follow_up
   WHERE follow_up.tenant_id = v_tenant
     AND (follow_up.id::text = p_id OR follow_up.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  -- A DRAFT IS PER CHANNEL. The fixtures oracle keys its store
  -- `<followUpRef>::<CHANNEL>` and 404s per channel rather than handing back an
  -- empty draft, because an empty draft renders as a composer with nothing in
  -- it and reads as "the agent wrote nothing" instead of "nothing was drafted
  -- for this channel".
  SELECT message.* INTO v_draft FROM core.outbound_messages AS message
   WHERE message.tenant_id = v_tenant
     AND message.follow_up_id = v_follow.id
     AND message.channel::text = p_channel
   ORDER BY message.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object(
      'id', v_follow.ref, 'channel', p_channel));
  END IF;

  SELECT rate.* INTO v_rate FROM core.message_rates AS rate
   WHERE rate.tenant_id = v_tenant AND rate.id = v_draft.message_rate_id;

  SELECT consent.* INTO v_consent FROM core.contact_consents AS consent
   WHERE consent.tenant_id = v_tenant
     AND consent.contact_id = v_follow.contact_id
     AND consent.channel::text = p_channel
     AND consent.withdrawn_at IS NULL
   ORDER BY consent.recorded_at DESC
   LIMIT 1;

  -- §16 Q4 / RULING R11 — THE FAILURE IS A VALUE, NOT A ZERO.
  -- `rateSource` is REQUIRED and the two money fields are OPTIONAL precisely so
  -- that a failed rate lookup has an honest answer. A server whose lookup
  -- failed has no number to send, and sending a stale rate or a zero and
  -- rendering it to four decimal places is the most convincing way to be wrong
  -- about money. UNAVAILABLE when there is no rate row; CACHED when the row has
  -- gone past `stale_after`; LIVE otherwise.
  v_source := CASE
                WHEN v_rate.id IS NULL OR v_draft.rate_per_message_sen IS NULL THEN 'UNAVAILABLE'
                WHEN v_rate.stale_after IS NOT NULL AND v_rate.stale_after < pg_catalog.now() THEN 'CACHED'
                ELSE 'LIVE'
              END;

  v_out := pg_catalog.jsonb_build_object(
    'channel',    v_draft.channel::text,
    'templateId', v_draft.template_id::text,
    'category',   COALESCE(v_draft.category::text, 'UTILITY'),
    'body',       COALESCE(v_draft.body, ''),
    'recipients', 1,
    'rateSource', v_source,
    'consent', pg_catalog.jsonb_build_object(
      'channel',    p_channel,
      'granted',    COALESCE(v_consent.granted, false),
      'recordedAt', v_consent.recorded_at));

  IF v_source <> 'UNAVAILABLE' THEN
    v_out := v_out
      || pg_catalog.jsonb_build_object('ratePerMessage',
           app._money(v_draft.rate_per_message_sen, v_draft.currency::text))
      || pg_catalog.jsonb_build_object('estimatedCost',
           app._money(COALESCE(v_draft.estimated_cost_sen, v_draft.rate_per_message_sen),
                      v_draft.currency::text));
    -- The UNROUNDED rate as a string, because §4's marketing rate is RM 0.3467
    -- and the utility rate RM 0.0564: rounded to the sen the strip would print
    -- RM 0.35 beside RM 0.06 and the six-fold difference it exists to show
    -- would be read off two different precisions.
    IF COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact) IS NOT NULL THEN
      v_out := v_out || pg_catalog.jsonb_build_object('ratePerMessageExact',
        pg_catalog.trim(pg_catalog.to_char(
          COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact), 'FM9990.000000')));
    END IF;
  END IF;

  IF v_source = 'CACHED' AND v_rate.fetched_at IS NOT NULL THEN
    v_out := v_out || pg_catalog.jsonb_build_object('rateFetchedAt', v_rate.fetched_at);
  END IF;

  IF app._provenance('outbound_messages', v_draft.id, NULL) IS NOT NULL THEN
    v_out := v_out || pg_catalog.jsonb_build_object('provenance',
      app._provenance('outbound_messages', v_draft.id, NULL));
  END IF;

  RETURN app.ok(v_out);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_organisation(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant    uuid := app.require_tenant_id();
  v_row       core.organisations%ROWTYPE;
  v_owner     text;
  v_lifetime  bigint;
  v_pipeline  bigint;
  v_overdue   bigint;
  v_levy      bigint;
  v_health    smallint;
BEGIN
  SELECT org.* INTO v_row FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant
     AND (org.id::text = p_id OR org.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT profile.display_name INTO v_owner FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.owner_id;

  -- The §5 metric strip. Each figure is a sum over real rows, in integer sen,
  -- and each carries its own `drillTo` so no screen hardcodes a drill route.
  SELECT COALESCE(pg_catalog.sum(invoice.total_sen), 0) INTO v_lifetime
    FROM core.invoices AS invoice
   WHERE invoice.tenant_id = v_tenant
     AND invoice.organisation_id = v_row.id
     AND invoice.voided_at IS NULL;

  SELECT COALESCE(pg_catalog.sum(opportunity.value_sen), 0) INTO v_pipeline
    FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant
     AND opportunity.organisation_id = v_row.id
     AND opportunity.stage NOT IN ('WON','LOST');

  SELECT COALESCE(pg_catalog.sum(invoice.outstanding_sen), 0) INTO v_overdue
    FROM core.invoices AS invoice
   WHERE invoice.tenant_id = v_tenant
     AND invoice.organisation_id = v_row.id
     AND invoice.voided_at IS NULL
     AND invoice.outstanding_sen > 0
     AND invoice.due_at < CURRENT_DATE;

  -- The most recent statement, not a sum: levy available is a balance and
  -- adding two statements together would double it.
  SELECT statement.levy_available_sen INTO v_levy
    FROM core.hrdc_levy_statements AS statement
   WHERE statement.tenant_id = v_tenant
     AND statement.organisation_id = v_row.id
   ORDER BY statement.as_of DESC
   LIMIT 1;

  SELECT snapshot.score INTO v_health
    FROM core.organisation_health_snapshots AS snapshot
   WHERE snapshot.tenant_id = v_tenant
     AND snapshot.organisation_id = v_row.id
   ORDER BY snapshot.computed_at DESC
   LIMIT 1;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',        v_row.id::text,
    'ref',       v_row.ref,
    'name',      v_row.name,
    'industry',  COALESCE(v_row.industry, ''),
    'location',  COALESCE(v_row.location, ''),
    'owner',     app._actor('HUMAN', v_row.owner_id::text, v_owner),
    'status',    v_row.status::text,
    'hrdcRegistered',   v_row.hrdc_registered,
    'hrdcEmployerCode', v_row.hrdc_employer_code,
    'metrics', pg_catalog.jsonb_build_object(
      'lifetimeValue', pg_catalog.jsonb_build_object(
        'value', app._money(v_lifetime, 'MYR'),
        'drillTo', '/organisations/' || v_row.ref || '/invoices'),
      'openPipeline', pg_catalog.jsonb_build_object(
        'value', app._money(v_pipeline, 'MYR'),
        'drillTo', '/organisations/' || v_row.ref || '/opportunities'),
      'arOverdue', pg_catalog.jsonb_build_object(
        'value', app._money(v_overdue, 'MYR'),
        'drillTo', '/organisations/' || v_row.ref || '/receivables'),
      'hrdcLevyAvailable', pg_catalog.jsonb_build_object(
        'value', app._money(COALESCE(v_levy, 0), 'MYR'),
        'drillTo', '/organisations/' || v_row.ref || '/hrdc'),
      -- §5: healthScore is a 0–100 composite, NOT a rate and NOT Money, so it
      -- is the one metric whose `value` is a bare number.
      'healthScore', pg_catalog.jsonb_build_object(
        'value', COALESCE(v_health, v_row.health_score, 0),
        'drillTo', '/organisations/' || v_row.ref)),
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_opportunity(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_row     core.opportunities%ROWTYPE;
  v_org_ref text;
  v_enq_ref text;
  v_owner   text;
BEGIN
  SELECT opportunity.* INTO v_row FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant
     AND (opportunity.id::text = p_id OR opportunity.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT org.ref INTO v_org_ref FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant AND org.id = v_row.organisation_id;
  SELECT enquiry.ref INTO v_enq_ref FROM core.enquiries AS enquiry
   WHERE enquiry.tenant_id = v_tenant AND enquiry.id = v_row.source_enquiry_id;
  SELECT profile.display_name INTO v_owner FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.owner_id;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',        v_row.id::text,
      'ref',       v_row.ref,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'organisationRef', v_org_ref,
      'stage',  v_row.stage::text,
      'value',  app._money(COALESCE(v_row.value_sen, 0), v_row.currency),
      'owner',  app._actor('HUMAN', v_row.owner_id::text, v_owner))
    -- Optional keys are OMITTED, not nulled. `probability` absent means the
    -- deal has not been scored, which is different from a score of zero.
    || CASE WHEN v_row.probability IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('probability', v_row.probability) END
    || CASE WHEN v_enq_ref IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('sourceEnquiryRef', v_enq_ref) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_contact(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.contacts%ROWTYPE;
  v_org_ref  text;
  v_email    boolean := false;
  v_whatsapp boolean := false;
BEGIN
  SELECT contact.* INTO v_row FROM core.contacts AS contact
   WHERE contact.tenant_id = v_tenant
     AND (contact.id::text = p_id OR contact.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT org.ref INTO v_org_ref FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant AND org.id = v_row.organisation_id;

  -- CURRENT consent per channel: the latest non-withdrawn grant. A withdrawn
  -- row must read as `false`, not as the absence of a row, or a withdrawal
  -- silently reverts to whatever was recorded before it.
  SELECT COALESCE(pg_catalog.bool_or(consent.granted) FILTER (WHERE consent.channel = 'EMAIL'), false),
         COALESCE(pg_catalog.bool_or(consent.granted) FILTER (WHERE consent.channel = 'WHATSAPP'), false)
    INTO v_email, v_whatsapp
    FROM core.contact_consents AS consent
   WHERE consent.tenant_id = v_tenant
     AND consent.contact_id = v_row.id
     AND consent.withdrawn_at IS NULL;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',        v_row.id::text,
      'ref',       v_row.ref,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'organisationRef', v_org_ref,
      'name',    v_row.name,
      'role',    COALESCE(v_row.job_title, ''),
      'email',   v_row.email::text,
      'phone',   v_row.phone,
      'primary', v_row.is_primary,
      'consent', pg_catalog.jsonb_build_object('email', v_email, 'whatsapp', v_whatsapp))
    || CASE WHEN v_row.pdpa_flag IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('pdpaFlag', v_row.pdpa_flag) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_tna(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_row     core.tnas%ROWTYPE;
  v_opp_ref text;
  v_gaps    jsonb;
  v_cons    jsonb;
  v_evid    jsonb;
BEGIN
  SELECT tna.* INTO v_row FROM core.tnas AS tna
   WHERE tna.tenant_id = v_tenant
     AND (tna.id::text = p_id OR tna.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT opportunity.ref INTO v_opp_ref FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant AND opportunity.id = v_row.opportunity_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'name',         gap.name,
             'description',  COALESCE(gap.description, ''),
             'priority',     gap.priority::text,
             'evidenceRefs', pg_catalog.to_jsonb(gap.evidence_refs))
           || CASE WHEN app._provenance('tna_gaps', gap.id, NULL) IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object(
                          'provenance', app._provenance('tna_gaps', gap.id, NULL)) END
           ORDER BY gap.priority, gap.name), '[]'::jsonb)
    INTO v_gaps
    FROM core.tna_gaps AS gap
   WHERE gap.tenant_id = v_tenant AND gap.tna_id = v_row.id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('code', constraint_row.code, 'label', constraint_row.label)
           -- §6: `severity` is present ONLY when the constraint is at risk.
           -- Emitting it always would paint every constraint as a warning.
           || CASE WHEN constraint_row.severity IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('severity', constraint_row.severity::text) END
           ORDER BY constraint_row.code), '[]'::jsonb)
    INTO v_cons
    FROM core.tna_constraints AS constraint_row
   WHERE constraint_row.tenant_id = v_tenant AND constraint_row.tna_id = v_row.id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('type', evidence.source_type::text, 'ref', evidence.source_ref)
           || CASE WHEN evidence.excerpt IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('excerpt', evidence.excerpt) END
           ORDER BY evidence.created_at), '[]'::jsonb)
    INTO v_evid
    FROM core.tna_evidence AS evidence
   WHERE evidence.tenant_id = v_tenant AND evidence.tna_id = v_row.id;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',        v_row.id::text,
    'ref',       v_row.ref,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
    'opportunityRef', v_opp_ref,
    'status',      v_row.status::text,
    -- §12 widens `completedBy` to `AnyActor`, which includes CLIENT: a TNA
    -- questionnaire is normally completed by the client, not by staff.
    'completedBy', app._actor(v_row.completed_by_kind::text, v_row.completed_by_id, v_row.completed_by_name),
    'completedAt', v_row.completed_at,
    'audience', pg_catalog.jsonb_build_object(
      'headcount', COALESCE(v_row.audience_headcount, 0),
      'level',     COALESCE(v_row.audience_level, ''),
      'sites',     pg_catalog.to_jsonb(COALESCE(v_row.audience_sites, ARRAY[]::text[])),
      'language',  COALESCE(pg_catalog.rtrim(v_row.audience_language), 'EN')),
    'constraints', v_cons,
    'budget',      app._money(v_row.budget_sen, v_row.currency),
    'gaps',        v_gaps,
    'evidence',    v_evid));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_tna_recommendations(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_tna     core.tnas%ROWTYPE;
  v_rows    jsonb;
  v_version text;
  v_weights jsonb;
  v_prov    jsonb;
  v_first   uuid;
BEGIN
  -- THIS NEVER GENERATES ON DEMAND. `core.tna_recommendations` holds rows a
  -- WORKER produced; this endpoint reads them. An LLM call inside a request is
  -- the thing the §10 worker split exists to prevent, and it would blow the
  -- 10s statement timeout under load. The §8 pin asserts this body contains no
  -- `net.http_post` and no reference to `core.runs`, so "generate on read"
  -- cannot be added later without tripping it.
  SELECT tna.* INTO v_tna FROM core.tnas AS tna
   WHERE tna.tenant_id = v_tenant
     AND (tna.id::text = p_id OR tna.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(item.row ORDER BY item.rank, item.fit DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT COALESCE(recommendation.rank, 32767::smallint) AS rank,
             recommendation.fit_score AS fit,
             pg_catalog.jsonb_build_object(
               'programmeId', recommendation.programme_id::text,
               'name',        programme.name,
               'fitScore',    recommendation.fit_score,
               'rationale',   COALESCE(recommendation.rationale, ''))
             || CASE WHEN recommendation.price_indication_sen IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('priceIndication',
                            app._money(recommendation.price_indication_sen, recommendation.currency)) END
             -- Trainer availability is read from the roster the scheduler
             -- keeps, never recomputed: two answers to "is this trainer free"
             -- is one answer too many.
             || CASE WHEN NOT EXISTS (
                       SELECT 1 FROM core.programme_trainers AS link
                        WHERE link.tenant_id = v_tenant
                          AND link.programme_id = recommendation.programme_id)
                     THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('trainerAvailability', COALESCE((
                       SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'trainerRef', trainer.ref,
                                'name',       trainer.name,
                                'available',  NOT EXISTS (
                                   SELECT 1 FROM core.trainer_availability AS slot
                                    WHERE slot.tenant_id = v_tenant
                                      AND slot.trainer_id = trainer.id
                                      AND slot.state <> 'AVAILABLE'
                                      AND slot.on_date >= CURRENT_DATE))
                              ORDER BY trainer.name)
                         FROM core.programme_trainers AS link
                         JOIN core.trainers AS trainer
                           ON trainer.tenant_id = link.tenant_id AND trainer.id = link.trainer_id
                        WHERE link.tenant_id = v_tenant
                          AND link.programme_id = recommendation.programme_id), '[]'::jsonb)) END AS row
        FROM core.tna_recommendations AS recommendation
        JOIN core.programmes AS programme
          ON programme.tenant_id = recommendation.tenant_id
         AND programme.id = recommendation.programme_id
       WHERE recommendation.tenant_id = v_tenant
         AND recommendation.tna_id = v_tna.id
    ) AS item;

  SELECT recommendation.scoring_model_version, recommendation.scoring_weights, recommendation.id
    INTO v_version, v_weights, v_first
    FROM core.tna_recommendations AS recommendation
   WHERE recommendation.tenant_id = v_tenant AND recommendation.tna_id = v_tna.id
   ORDER BY recommendation.rank NULLS LAST
   LIMIT 1;

  -- AN EMPTY `data` IS A LEGITIMATE ANSWER — the worker has not run yet — and
  -- must NOT be a 404. doc 09 §8 is explicit about this, and it is the
  -- difference between "no fit found" and "this TNA does not exist".
  IF v_first IS NOT NULL THEN
    v_prov := app._provenance('tna_recommendations', v_first, NULL);
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    -- `provenance` is REQUIRED on this response. With no provenance row the
    -- honest answer is `SYSTEM`: the ranking exists and a machine produced it,
    -- but nothing recorded a model behind it.
    'provenance', COALESCE(v_prov, pg_catalog.jsonb_build_object('origin','SYSTEM')),
    'scoringModel', pg_catalog.jsonb_build_object(
      'version', COALESCE(v_version, 'v0-unscored'),
      'weights', COALESCE(v_weights, '{}'::jsonb))));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.create_proposal(
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant      uuid := app.require_tenant_id();
  v_actor       record;
  v_opportunity core.opportunities%ROWTYPE;
  v_template    core.templates%ROWTYPE;
  v_programme   core.programmes%ROWTYPE;
  v_proposal    core.proposals%ROWTYPE;
  v_hash        text;
  v_key         app.idempotency_keys%ROWTYPE;
  v_missing     jsonb := '[]'::jsonb;
  v_replayed    uuid;
BEGIN
  -- A WRITE, so every refusal is a RAISE and not an `app.err`: a refusal must
  -- not leave a partial proposal or a claimed idempotency key behind.
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  p_body := COALESCE(p_body, '{}'::jsonb);
  IF NULLIF(p_body ->> 'opportunityRef','') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','opportunityRef','reason','REQUIRED'));
  END IF;
  IF NULLIF(p_body ->> 'templateId','') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','templateId','reason','REQUIRED'));
  END IF;
  IF NULLIF(p_body ->> 'programmeId','') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','programmeId','reason','REQUIRED'));
  END IF;
  IF pg_catalog.jsonb_array_length(v_missing) > 0 THEN
    RAISE EXCEPTION 'proposal body validation failed'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', v_missing)::text;
  END IF;

  -- IDEMPOTENCY IS REQUIRED, NOT OPTIONAL (doc 09 §9): two governed writes
  -- were already found sending no key at all, which is how a double-click
  -- becomes two proposals.
  IF NULLIF(p_idempotency_key,'') IS NULL THEN
    RAISE EXCEPTION 'an idempotency key is required for this write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','idempotencyKey','reason','REQUIRED')))::text;
  END IF;

  -- LOCK BEFORE CLAIM, exactly as 011:2091 does. The advisory lock serialises
  -- two concurrent requests carrying the same key so the second one sees the
  -- first one's row instead of racing it through the unique index.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_body::text, 'UTF8')), 'hex');

  INSERT INTO app.idempotency_keys (tenant_id, actor_id, endpoint, key, request_hash)
  VALUES (v_tenant, v_actor.actor_id, 'POST /v1/proposals', p_idempotency_key, v_hash)
  ON CONFLICT (tenant_id, actor_id, endpoint, key) DO NOTHING
  RETURNING * INTO v_key;

  IF v_key.id IS NULL THEN
    SELECT existing.* INTO v_key FROM app.idempotency_keys AS existing
     WHERE existing.tenant_id = v_tenant AND existing.actor_id = v_actor.actor_id
       AND existing.endpoint = 'POST /v1/proposals' AND existing.key = p_idempotency_key;
    -- A REUSED KEY WITH A DIFFERENT BODY IS `IDEMPOTENT_REPLAY`, not a second
    -- proposal. Same key, same body is a retry and returns the original.
    IF v_key.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different body'
        USING ERRCODE = 'TRNOS',
              -- `reason` SEPARATES THE TWO MEANINGS THIS CODE CARRIED. This one
              -- is PERMANENT: the key is spent on a different body and retrying
              -- will never succeed. The IN_FLIGHT case below is TRANSIENT and
              -- the client should retry shortly. Both raised
              -- `{'code':'IDEMPOTENT_REPLAY'}` and nothing told them apart, so a
              -- client could only guess between "your request conflicts" and
              -- "wait a moment".
              DETAIL = pg_catalog.jsonb_build_object(
                         'code','IDEMPOTENT_REPLAY',
                         'reason','KEY_REUSED_WITH_DIFFERENT_BODY',
                         'retryable', false)::text;
    END IF;
    v_replayed := NULLIF(v_key.response ->> 'id','')::uuid;
    IF v_replayed IS NOT NULL THEN
      PERFORM pg_catalog.set_config('response.headers','[{"Idempotent-Replay":"true"}]', true);
      RETURN core.get_proposal(v_replayed::text);
    END IF;
    -- The key is claimed but IN_FLIGHT: a concurrent request holds it and has
    -- not finished. Refusing is correct; inventing a second proposal is not.
    RAISE EXCEPTION 'a request with this idempotency key is still in flight'
      USING ERRCODE = 'TRNOS',
            -- TRANSIENT, and now distinguishable from the permanent case above.
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','IDEMPOTENT_REPLAY',
                       'reason','IN_FLIGHT',
                       'retryable', true)::text;
  END IF;

  SELECT opportunity.* INTO v_opportunity FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant
     AND (opportunity.ref = (p_body ->> 'opportunityRef')
          OR opportunity.id::text = (p_body ->> 'opportunityRef'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown opportunityRef'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','NOT_FOUND','reason','UNKNOWN_OPPORTUNITY')::text;
  END IF;

  SELECT template.* INTO v_template FROM core.templates AS template
   WHERE template.tenant_id = v_tenant
     AND (template.id::text = (p_body ->> 'templateId') OR template.ref = (p_body ->> 'templateId'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown templateId'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','NOT_FOUND','reason','UNKNOWN_TEMPLATE')::text;
  END IF;

  SELECT programme.* INTO v_programme FROM core.programmes AS programme
   WHERE programme.tenant_id = v_tenant
     AND (programme.id::text = (p_body ->> 'programmeId') OR programme.ref = (p_body ->> 'programmeId'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown programmeId'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','NOT_FOUND','reason','UNKNOWN_PROGRAMME')::text;
  END IF;

  INSERT INTO core.proposals
    (tenant_id, opportunity_id, organisation_id, template_id, programme_id, status,
     value_sen, currency, created_by_kind, created_by_id, created_by_name)
  VALUES
    (v_tenant, v_opportunity.id, v_opportunity.organisation_id, v_template.id, v_programme.id,
     'DRAFT',
     -- The opening value is the opportunity's, or the programme's list price
     -- when the deal has not been valued. NOT a computed price: pricing is
     -- `core.put_quotation`'s and the §18 money rule lives in 007.
     COALESCE(v_opportunity.value_sen, v_programme.list_price_sen),
     'MYR',
     COALESCE(v_actor.actor_kind, 'HUMAN')::app.actor_kind, v_actor.actor_id, NULL)
  RETURNING * INTO v_proposal;

  -- Sections come from the template, in the template's own order. A proposal
  -- that invented its own section list would diverge from the template the
  -- moment either changed.
  INSERT INTO core.proposal_sections
    (tenant_id, proposal_id, n, title, body, needs_review,
     created_by_kind, created_by_id, created_by_name)
  SELECT v_tenant, v_proposal.id, section.n, section.title, section.default_body, false,
         COALESCE(v_actor.actor_kind, 'HUMAN')::app.actor_kind, v_actor.actor_id, NULL
    FROM core.template_sections AS section
   WHERE section.tenant_id = v_tenant AND section.template_id = v_template.id
   ORDER BY section.n;

  -- The key stops being decorative here, and the §8 pin asserts this row.
  -- WHY `response` CARRIES A `status` KEY: 011's own
  -- `idempotency_keys_response_shape` CHECK accepts a response object only
  -- when it has `status`, or `data` + `count`. An `app.ok(...)` envelope has
  -- neither, so what is stored is the REPLAY RECORD — the outcome and the id
  -- of the row that was created — and the replay branch above re-projects the
  -- proposal fresh rather than serving a stale copy. That is also better
  -- behaviour: a retry three minutes later sees the current proposal.
  UPDATE app.idempotency_keys
     SET state = 'COMPLETED',
         response = pg_catalog.jsonb_build_object(
           'status','EXECUTED','entity','proposal','id', v_proposal.id::text),
         status_code = 201,
         completed_at = pg_catalog.now(),
         expires_at = pg_catalog.now() + interval '24 hours'
   WHERE id = v_key.id;

  -- §6: "Status 201 has no meaning over PostgREST; the created record IS the
  -- response."
  RETURN core.get_proposal(v_proposal.id::text);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.list_proposals(
  p_filter jsonb DEFAULT '[]'::jsonb,
  p_sort   text  DEFAULT NULL,
  p_page   jsonb DEFAULT '{"size":50}'::jsonb,
  p_view   text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_size    integer;
  v_cur_at  timestamptz;
  v_cur_id  uuid;
  v_clauses text[] := ARRAY[]::text[];
  v_errors  jsonb  := '[]'::jsonb;
  v_applied jsonb  := '[]'::jsonb;
  v_clause  jsonb;
  v_field   text;
  v_op      text;
  v_column  text;
  v_kind    text;
  v_desc    boolean := true;
  v_sort_col text := 'created_at';
  v_sort_fld text;
  v_where   text;
  v_ids     uuid[];
  v_rows    jsonb;
  v_total   integer;
  v_count   integer;
  v_next    text;
  v_last_at timestamptz;
  v_last_id uuid;
  v_cursor  text;
  v_keyed   text;
  v_merged  jsonb  := '[]'::jsonb;
BEGIN
  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','page.size','reason', SQLERRM))));
  END;

  v_cursor := NULLIF(p_page ->> 'cursor','');
  IF v_cursor IS NOT NULL THEN
    BEGIN
      SELECT decoded.at, decoded.id INTO v_cur_at, v_cur_id
        FROM app._cursor_decode(v_cursor) AS decoded;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','page.cursor','reason','MALFORMED_CURSOR'))));
    END;
  END IF;

  -- SAVED VIEW. This parameter was DECLARED AND NEVER READ: a reader who asked
  -- for a saved view got every row in the tenant with `appliedFilters: []` and
  -- `success: true`. `core.saved_view_object` has no value for this list's
  -- object, so a view for it cannot exist and the only honest answers are
  -- "refuse" or "resolve it once the enum has the value". `app._view_filters`
  -- gives both: it refuses off the enum today and resolves the day the
  -- contract adds the value, with no edit here.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'PROPOSAL', p_filter);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','view','reason', SQLERRM))));
  END;

  SELECT v_merged || COALESCE(pg_catalog.jsonb_agg(element.value), '[]'::jsonb) INTO v_merged
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter, '[]'::jsonb)) AS element(value);

  FOR v_clause IN SELECT element.value FROM pg_catalog.jsonb_array_elements(v_merged) AS element(value)
  LOOP
    v_field := v_clause ->> 'field';
    v_op    := v_clause ->> 'op';
    SELECT allowed.column_name, allowed.kind INTO v_column, v_kind
      FROM (VALUES ('status','status','text'),('opportunity','opportunity_id','uuid'),
                   ('organisation','organisation_id','uuid'),('template','template_id','uuid'),
                   ('value','value_sen','number'),('createdAt','created_at','ts'),
                   ('sentAt','sent_at','ts'))
           AS allowed(field, column_name, kind)
     WHERE allowed.field = v_field;
    IF v_column IS NULL THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', COALESCE(v_field,'(null)'), 'reason','UNKNOWN_FILTER_FIELD'));
      CONTINUE;
    END IF;
    BEGIN
      v_clauses := v_clauses || app._predicate(v_column, v_kind, v_op, v_clause -> 'value');
      v_applied := v_applied || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'op', v_op,
        'value', COALESCE(v_clause -> 'value','null'::jsonb),
        'source', COALESCE(v_clause ->> 'source', 'REQUEST')));
    EXCEPTION WHEN invalid_parameter_value THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'reason', SQLERRM, 'code', COALESCE(v_op,'(null)')));
    END;
    v_column := NULL; v_kind := NULL;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_errors) > 0 THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object('fields', v_errors));
  END IF;

  IF NULLIF(p_sort,'') IS NOT NULL THEN
    v_desc := pg_catalog.left(p_sort,1) = '-';
    v_sort_fld := CASE WHEN v_desc THEN pg_catalog.substr(p_sort,2) ELSE p_sort END;
    SELECT allowed.column_name INTO v_sort_col
      FROM (VALUES ('createdAt','created_at'),('updatedAt','updated_at'),
                   ('value','value_sen'),('sentAt','sent_at'))
           AS allowed(field, column_name)
     WHERE allowed.field = v_sort_fld;
    IF v_sort_col IS NULL THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','sort','reason','UNKNOWN_SORT_FIELD','code', v_sort_fld))));
    END IF;
  END IF;

  v_where := CASE WHEN pg_catalog.array_length(v_clauses,1) IS NULL THEN 'true'
                  ELSE pg_catalog.array_to_string(v_clauses,' AND ') END;

  -- COUNT BEFORE KEYSET, CURSOR FROM A REAL LOOKAHEAD — both orderings now
  -- live in `app._keyset_scope` / `app._next_cursor` (§1), so no copy of this
  -- engine can get either one wrong on its own. See the helpers' header for
  -- the two defects this pair replaces.
  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.proposals'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id) AS scope;

  -- THE PAGE IS SELECTED HERE AND EACH ROW IS PROJECTED BY `core.get_proposal`.
  -- A `Proposal` carries its `sections[]`, each with its own provenance, and a
  -- second projection of that shape in this function would be a second place
  -- for it to drift. One projection, called per row on a bounded page.
  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.array_agg(p.id ORDER BY p.%I %s, p.id %s), ARRAY[]::uuid[])
      FROM (SELECT id, %I FROM core.proposals
             WHERE tenant_id = $1 AND %s
             ORDER BY %I %s, id %s
             LIMIT $2) AS p$q$,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END)
    INTO v_ids USING v_tenant, v_size;

  SELECT COALESCE(pg_catalog.jsonb_agg(core.get_proposal(element.id::text) -> 'data'
                                       ORDER BY element.ord), '[]'::jsonb),
         pg_catalog.count(*)::integer
    INTO v_rows, v_count
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS element(id, ord);

  -- The last row of the page in DISPLAY ORDER is the cursor anchor. It is read
  -- unconditionally now: `app._next_cursor` decides whether a next page exists
  -- by looking past that row, so the anchor has to exist before the question
  -- can be asked.
  IF pg_catalog.array_length(v_ids, 1) IS NOT NULL THEN
    EXECUTE pg_catalog.format('SELECT %I, id FROM core.proposals WHERE tenant_id = $1 AND id = $2', v_sort_col)
      INTO v_last_at, v_last_id USING v_tenant, v_ids[pg_catalog.array_length(v_ids,1)];
  END IF;
  v_next := app._next_cursor('core.proposals'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_proposal(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.proposals%ROWTYPE;
  v_opp_ref  text;
  v_sections jsonb;
BEGIN
  SELECT proposal.* INTO v_row FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant
     AND (proposal.id::text = p_id OR proposal.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT opportunity.ref INTO v_opp_ref FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant AND opportunity.id = v_row.opportunity_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(item.row ORDER BY item.n), '[]'::jsonb)
    INTO v_sections
    FROM (
      SELECT section.n,
             pg_catalog.jsonb_build_object('n', section.n, 'title', section.title)
             || CASE WHEN section.body IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('body', section.body) END
             || CASE WHEN section.merge_fields_used IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('mergeFieldsUsed',
                            pg_catalog.to_jsonb(section.merge_fields_used)) END
             -- `needsReview` is set when a section was generated BELOW the
             -- confidence threshold. Emitted only when true, so the editor
             -- flags the sections that need a human and no others.
             || CASE WHEN section.needs_review
                     THEN pg_catalog.jsonb_build_object('needsReview', true)
                     ELSE '{}'::jsonb END
             || CASE WHEN app._provenance('proposal_sections', section.id, NULL) IS NULL
                     THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('provenance',
                            app._provenance('proposal_sections', section.id, NULL)) END AS row
        FROM core.proposal_sections AS section
       WHERE section.tenant_id = v_tenant AND section.proposal_id = v_row.id
    ) AS item;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',        v_row.id::text,
      'ref',       v_row.ref,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'opportunityRef', v_opp_ref,
      'templateId', v_row.template_id::text,
      'status',     v_row.status::text,
      'value',      app._money(COALESCE(v_row.value_sen, 0), v_row.currency::text),
      'marginRate', COALESCE(v_row.margin_rate, 0),
      'sections',   v_sections)
    || CASE WHEN v_row.run_id IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('runId', v_row.run_id::text) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.add_proposal_section(
  p_id              text,
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_actor    record;
  v_proposal core.proposals%ROWTYPE;
  v_title    text;
  v_n        smallint;
  v_hash     text;
  v_key      app.idempotency_keys%ROWTYPE;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  p_body  := COALESCE(p_body, '{}'::jsonb);
  v_title := pg_catalog.btrim(COALESCE(p_body ->> 'title',''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'a section needs a title'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','title','reason','REQUIRED')))::text;
  END IF;

  IF NULLIF(p_idempotency_key,'') IS NULL THEN
    RAISE EXCEPTION 'an idempotency key is required for this write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','idempotencyKey','reason','REQUIRED')))::text;
  END IF;

  SELECT proposal.* INTO v_proposal FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant
     AND (proposal.id::text = p_id OR proposal.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such proposal'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
              pg_catalog.jsonb_build_object('id', v_proposal.id::text, 'body', p_body)::text,'UTF8')),'hex');

  INSERT INTO app.idempotency_keys (tenant_id, actor_id, endpoint, key, request_hash)
  VALUES (v_tenant, v_actor.actor_id, 'POST /v1/proposals/sections', p_idempotency_key, v_hash)
  ON CONFLICT (tenant_id, actor_id, endpoint, key) DO NOTHING
  RETURNING * INTO v_key;

  IF v_key.id IS NULL THEN
    SELECT existing.* INTO v_key FROM app.idempotency_keys AS existing
     WHERE existing.tenant_id = v_tenant AND existing.actor_id = v_actor.actor_id
       AND existing.endpoint = 'POST /v1/proposals/sections' AND existing.key = p_idempotency_key;
    IF v_key.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different body'
        USING ERRCODE = 'TRNOS',
              -- `reason` SEPARATES THE TWO MEANINGS THIS CODE CARRIED. This one
              -- is PERMANENT: the key is spent on a different body and retrying
              -- will never succeed. The IN_FLIGHT case below is TRANSIENT and
              -- the client should retry shortly. Both raised
              -- `{'code':'IDEMPOTENT_REPLAY'}` and nothing told them apart, so a
              -- client could only guess between "your request conflicts" and
              -- "wait a moment".
              DETAIL = pg_catalog.jsonb_build_object(
                         'code','IDEMPOTENT_REPLAY',
                         'reason','KEY_REUSED_WITH_DIFFERENT_BODY',
                         'retryable', false)::text;
    END IF;
    -- Same key, same body: the section was already added. Return the proposal
    -- as it stands rather than adding a second identical section, which is the
    -- double-click this key exists to absorb.
    PERFORM pg_catalog.set_config('response.headers','[{"Idempotent-Replay":"true"}]', true);
    RETURN core.get_proposal(v_proposal.id::text);
  END IF;

  -- `n` IS max(n) + 1, NOT count + 1. A proposal whose section 2 was deleted
  -- has three sections numbered 1, 3, 4; count + 1 would hand the new section
  -- the number 4 and collide with the existing one. The fixtures oracle does
  -- the same, and the unique constraint would have caught it eventually — on
  -- somebody's screen rather than here.
  SELECT COALESCE(pg_catalog.max(section.n), 0)::smallint + 1 INTO v_n
    FROM core.proposal_sections AS section
   WHERE section.tenant_id = v_tenant AND section.proposal_id = v_proposal.id;

  -- NO PROVENANCE ROW IS WRITTEN. A section a human typed is human-authored,
  -- and absence is how that is said — inserting one here would badge every
  -- hand-written section as AI-touched.
  INSERT INTO core.proposal_sections
    (tenant_id, proposal_id, n, title, body, needs_review,
     created_by_kind, created_by_id, created_by_name)
  VALUES (v_tenant, v_proposal.id, v_n, v_title, p_body ->> 'body', false,
          COALESCE(v_actor.actor_kind,'HUMAN')::app.actor_kind, v_actor.actor_id, NULL);

  UPDATE core.proposals AS proposal SET updated_at = pg_catalog.now()
   WHERE proposal.tenant_id = v_tenant AND proposal.id = v_proposal.id;

  UPDATE app.idempotency_keys
     SET state = 'COMPLETED',
         response = pg_catalog.jsonb_build_object(
           'status','EXECUTED','entity','proposal_section',
           'id', v_proposal.id::text, 'n', v_n),
         status_code = 201, completed_at = pg_catalog.now(),
         expires_at = pg_catalog.now() + interval '24 hours'
   WHERE id = v_key.id;

  RETURN core.get_proposal(v_proposal.id::text);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.put_proposal_section(
  p_id              text,
  p_n               integer,
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_actor    record;
  v_proposal core.proposals%ROWTYPE;
  v_section  core.proposal_sections%ROWTYPE;
  v_name     text;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  p_body := COALESCE(p_body, '{}'::jsonb);
  -- `body` is REQUIRED and `title` is optional — that is the contract's
  -- `ProposalSectionWrite`, and it is the opposite way round from add.
  IF NOT (p_body ? 'body') THEN
    RAISE EXCEPTION 'a section edit needs a body'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','body','reason','REQUIRED')))::text;
  END IF;

  SELECT proposal.* INTO v_proposal FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant
     AND (proposal.id::text = p_id OR proposal.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such proposal'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  SELECT section.* INTO v_section FROM core.proposal_sections AS section
   WHERE section.tenant_id = v_tenant
     AND section.proposal_id = v_proposal.id
     AND section.n = p_n::smallint;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such section on this proposal'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','NOT_FOUND','reason','UNKNOWN_SECTION','n', p_n)::text;
  END IF;

  UPDATE core.proposal_sections AS section
     SET body  = p_body ->> 'body',
         -- An EMPTY title is ignored rather than written: a blank heading is
         -- never what an editor meant, and the fixtures oracle agrees.
         title = COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_body ->> 'title','')),''), section.title)
   WHERE section.tenant_id = v_tenant AND section.id = v_section.id;

  SELECT profile.display_name INTO v_name FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id::text = v_actor.actor_id;

  -- A HUMAN EDIT OF AN AI SECTION KEEPS THE AI LINEAGE AND RECORDS THE EDITOR:
  -- origin flips to AI_SUGGESTED and `editedBy` is stamped. A section with no
  -- provenance row was human-authored to begin with and gains none.
  -- Same rule as the enquiry patch: the editor is stamped, `origin` is left
  -- alone because it is immutable AND because it is a fact about where the
  -- section came from, and the badge value is derived in `app._provenance`.
  UPDATE core.provenance AS prov
     SET edited_by      = CASE WHEN v_actor.actor_kind = 'HUMAN'
                               THEN v_actor.actor_id::uuid ELSE prov.edited_by END,
         edited_by_name = COALESCE(v_name, v_actor.actor_id),
         edited_at      = pg_catalog.now()
   WHERE prov.tenant_id = v_tenant
     AND prov.subject_table = 'proposal_sections'
     AND prov.subject_id = v_section.id;

  UPDATE core.proposals AS proposal SET updated_at = pg_catalog.now()
   WHERE proposal.tenant_id = v_tenant AND proposal.id = v_proposal.id;

  RETURN core.get_proposal(v_proposal.id::text);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.regenerate_proposal_section(p_id text, p_n integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_proposal core.proposals%ROWTYPE;
  v_section  core.proposal_sections%ROWTYPE;
  v_run      core.runs%ROWTYPE;
  v_event    uuid;
  v_actor    record;
  v_profile_name text;
  v_jobs     integer;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  SELECT profile.display_name INTO v_profile_name
    FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant
     AND profile.user_id::text = v_actor.actor_id;

  -- THIS IS A WRITE FUNCTION, SO IT REFUSES WITH `RAISE ... TRNOS`, NOT
  -- `app.err`. `app.err` COMMITS. Before this change every refusal here
  -- returned an `app.err` envelope, and the header's own rule (§"HOW A REFUSAL
  -- TRAVELS") puts write functions on RAISE precisely so that nobody has to
  -- re-verify by hand, for each new branch, that no write precedes it. That
  -- verification is now load-bearing rather than incidental: this function
  -- enqueues a job, and a refusal after the enqueue that COMMITTED would leave
  -- a worker holding work for a request the server said no to.
  --
  -- NO IDEMPOTENCY KEY, DELIBERATELY. A second press of "Regenerate" must
  -- produce a NEW draft, not replay the one the author just rejected. The
  -- client sends no key for this endpoint for exactly that reason.
  SELECT proposal.* INTO v_proposal FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant
     AND (proposal.id::text = p_id OR proposal.ref = p_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','NOT_FOUND', 'id', p_id)::text;
  END IF;

  SELECT section.* INTO v_section FROM core.proposal_sections AS section
   WHERE section.tenant_id = v_tenant
     AND section.proposal_id = v_proposal.id
     AND section.n = p_n::smallint;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal section not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','NOT_FOUND', 'id', p_id, 'n', p_n)::text;
  END IF;

  -- THE DRAFTING AGENT MUST BE REGISTERED. `core.runs` FKs
  -- `(tenant_id, agent_id)` to `core.agents`, so a tenant that has not
  -- registered `agent_proposal` would get a raw foreign-key violation. A tenant
  -- with no drafting agent is a configuration fact, not a server fault, and it
  -- is said as one.
  IF NOT EXISTS (SELECT 1 FROM core.agents AS agent
                  WHERE agent.tenant_id = v_tenant AND agent.agent_id = 'agent_proposal') THEN
    RAISE EXCEPTION 'no drafting agent registered'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','VALIDATION_FAILED',
                       'reason','NO_DRAFTING_AGENT', 'agentId','agent_proposal')::text;
  END IF;

  -- An agent that is paused or killed must not be handed work. 013 owns both
  -- switches; this reads them rather than re-deciding what "paused" means.
  IF EXISTS (SELECT 1 FROM core.agents AS agent
              WHERE agent.tenant_id = v_tenant AND agent.agent_id = 'agent_proposal'
                AND (agent.kill_switch OR agent.paused_at IS NOT NULL
                     OR agent.status <> 'ACTIVE')) THEN
    RAISE EXCEPTION 'drafting agent is paused'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','AGENT_PAUSED', 'agentId','agent_proposal')::text;
  END IF;

  -- THIS RPC DOES NOT CALL A MODEL AND MUST NOT. Ruling R-A puts every LLM call
  -- behind the worker, ruling R-B forbids `pg_net`, and a generation inside a
  -- request would blow the 10s statement timeout under load. What it does is
  -- ENQUEUE the work and hand back the run the worker will fill — the same
  -- split `core.get_tna_recommendations` relies on for reading worker-produced
  -- rows.
  --
  -- ⚠ THIS COMMENT USED TO SAY THAT AND THE CODE DID NOT DO IT. The function
  -- inserted a `RUNNING` run, flipped `needs_review`, and returned 200. No
  -- `app.perform_action`, no `app.emit_event`, no `app.enqueue_effect_jobs`, no
  -- outbox row, and no AFTER INSERT trigger on `core.runs` to make one. Nothing
  -- ever completed the run. Press Regenerate five times and the tenant held
  -- five orphan RUNNING runs and five unchanged sections. The enqueue below is
  -- the missing half; T33 asserts a job row exists after the call.
  --
  -- WHY `app.emit_event` AND NOT `app.perform_action`. 011's envelope gates
  -- ACTIONS against `app.action_types` and an autonomy policy, and its effect
  -- planner (`app.plan_effects`) emits effects only for the action types it
  -- knows. There is no action type for regenerating a proposal section and 018
  -- may not add one to 011's catalogue or teach 011's planner a new branch, so
  -- `perform_action` would refuse and `enqueue_effect_jobs` would enqueue zero.
  -- 012's event path is the one that fits and the one 012 designed for this:
  -- `app.emit_event` writes the event, its subject index rows and ONE JOB PER
  -- ENABLED SUBSCRIPTION in the caller's transaction, carries `p_run_id`
  -- (`app.outbox.run_id` and `outbox_run_idx` exist for exactly this), and
  -- 012's own comment on `app.event_subscriptions` says routing "is data, not
  -- code, so adding a side effect to an event is an insert rather than a
  -- deploy". 018 makes that insert in §10d rather than editing 012.
  --
  -- `runId` is REQUIRED on the response, so the run row is created here and the
  -- worker attaches to it. A response with an invented run id would point the
  -- run drawer at nothing.
  INSERT INTO core.runs
    (tenant_id, agent_id, trigger, mode, status, tiers_used, guardrails,
     started_at, correlation_id)
  VALUES (v_tenant, 'agent_proposal',
          -- 013's `runs_trigger_shape` CHECK requires a `type` string and,
          -- when present, a string-or-null `ref`. `mode` is LIVE | SANDBOX,
          -- not a description of the work — read off the constraint rather
          -- than guessed.
          pg_catalog.jsonb_build_object(
            'type','PROPOSAL_SECTION_REGENERATE',
            'ref',  v_proposal.ref,
            'sectionN', p_n),
          'LIVE', 'RUNNING', ARRAY[]::text[], ARRAY[]::text[],
          pg_catalog.now(), pg_catalog.gen_random_uuid())
  RETURNING * INTO v_run;

  -- The section is marked as awaiting the worker rather than rewritten here:
  -- until the run lands, the body on screen is still the one the author read.
  UPDATE core.proposal_sections AS section
     SET needs_review = true
   WHERE section.tenant_id = v_tenant AND section.id = v_section.id;

  SELECT section.* INTO v_section FROM core.proposal_sections AS section
   WHERE section.tenant_id = v_tenant AND section.id = v_section.id;

  -- THE ENQUEUE. Same transaction as the run and the flag: if this rolls back,
  -- neither the event nor its jobs exist, so there is no window in which a
  -- worker is holding work for a regeneration that did not happen.
  v_event := app.emit_event(
    p_tenant_id      => v_tenant,
    p_type           => 'PROPOSAL_SECTION_REGENERATE_REQUESTED',
    -- UPPER_SNAKE: `core.events.aggregate_type` CHECKs `^[A-Z][A-Z0-9_]*$`
    -- (012:490), and `app.aggregate_type_for` writes the same spelling.
    p_aggregate_type => 'PROPOSAL',
    p_aggregate_id   => v_proposal.id,
    p_aggregate_ref  => v_proposal.ref,
    p_payload        => pg_catalog.jsonb_build_object(
                          'proposalId', v_proposal.id::text,
                          'proposalRef', v_proposal.ref,
                          'sectionN',   p_n,
                          'sectionId',  v_section.id::text,
                          'agentId',    'agent_proposal'),
    p_summary        => pg_catalog.format('Section %s of %s queued for regeneration',
                                          p_n, v_proposal.ref),
    -- `app.is_valid_actor` (012:328) requires the `name` KEY to be PRESENT and
    -- string-or-null — absent and null are different bugs and only one is a
    -- shape error — so this is built explicitly rather than through
    -- `app._actor`, which OMITS the key when the name is unknown.
    p_actor          => pg_catalog.jsonb_build_object(
                          'kind', COALESCE(v_actor.actor_kind, 'SYSTEM'),
                          'id',   COALESCE(v_actor.actor_id, 'system'),
                          'name', pg_catalog.to_jsonb(v_profile_name)),
    p_correlation_id => v_run.correlation_id,
    p_run_id         => v_run.id::text,
    p_related        => pg_catalog.jsonb_build_array(
                          pg_catalog.jsonb_build_object(
                            'type','PROPOSAL_SECTION', 'id', v_section.id)));

  -- AND THE JOB MUST ACTUALLY BE THERE. `app.emit_event` enqueues one job per
  -- ENABLED subscription and silently enqueues none when there are none — a
  -- disabled or deleted routing row would put this function straight back into
  -- the state it was just fixed out of, with a green 200 and nothing queued.
  -- Refusing is the honest answer: the run and the `needs_review` flag roll
  -- back with it, so a tenant never accumulates orphan RUNNING runs.
  SELECT pg_catalog.count(*)::integer INTO v_jobs
    FROM app.outbox AS job
   WHERE job.tenant_id = v_tenant AND job.event_id = v_event;
  IF v_jobs < 1 THEN
    RAISE EXCEPTION 'no job was enqueued for run %', v_run.id
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','SERVER_ERROR',
                       'reason','REGENERATE_NOT_ROUTED',
                       'eventType','PROPOSAL_SECTION_REGENERATE_REQUESTED')::text;
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'section',
      pg_catalog.jsonb_build_object('n', v_section.n, 'title', v_section.title)
      || CASE WHEN v_section.body IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('body', v_section.body) END
      || CASE WHEN v_section.merge_fields_used IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('mergeFieldsUsed',
                     pg_catalog.to_jsonb(v_section.merge_fields_used)) END
      || pg_catalog.jsonb_build_object('needsReview', v_section.needs_review)
      || CASE WHEN app._provenance('proposal_sections', v_section.id, NULL) IS NULL
              THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('provenance',
                     app._provenance('proposal_sections', v_section.id, NULL)) END,
    'runId', v_run.id::text));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_quotation(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.quotations%ROWTYPE;
  v_prop_ref text;
  v_version  text;
  v_year     integer;
  v_lines    jsonb;
BEGIN
  SELECT quotation.* INTO v_row FROM core.quotations AS quotation
   WHERE quotation.tenant_id = v_tenant
     AND (quotation.id::text = p_id OR quotation.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT proposal.ref INTO v_prop_ref FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant AND proposal.id = v_row.proposal_id;

  -- §18 supersede: every quotation stores the rate card version it was priced
  -- against, so a card that changes tomorrow does not silently re-price a
  -- quotation sent yesterday.
  SELECT card.version, pg_catalog.date_part('year', card.effective_from)::integer
    INTO v_version, v_year
    FROM core.rate_cards AS card
   WHERE card.tenant_id = v_tenant AND card.id = v_row.rate_card_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(item.row ORDER BY item.n), '[]'::jsonb)
    INTO v_lines
    FROM (
      SELECT line.n,
             pg_catalog.jsonb_build_object(
               'item',  line.item,
               'qty',   line.qty,
               -- `total` is READ from the GENERATED column, never recomputed
               -- here. 007 defines it as
               -- `app.round_half_up_sen(unit_price_sen * qty)`; a second
               -- expression in this file would be a second money rule.
               'total', app._money(line.total_sen, line.currency::text))
             || CASE WHEN line.detail IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('detail', line.detail) END
             || CASE WHEN line.unit IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('unit', line.unit) END
             || pg_catalog.jsonb_build_object('rate',
                  app._money(line.unit_price_sen, line.currency::text)) AS row
        FROM core.quotation_lines AS line
       WHERE line.tenant_id = v_tenant AND line.quotation_id = v_row.id
    ) AS item;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',        v_row.id::text,
      'ref',       v_row.ref,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'proposalRef', v_prop_ref,
      'status',      v_row.status,
      'rateCardVersion', COALESCE(v_version, 'v0-placeholder'),
      'lines',        v_lines,
      'sellPrice',    app._money(v_row.sell_price_sen,  v_row.currency::text),
      'directCost',   app._money(v_row.direct_cost_sen, v_row.currency::text),
      'marginRate',   COALESCE(v_row.margin_rate, 0),
      'floorPrice',   app._money(v_row.floor_price_sen, v_row.currency::text),
      'floorMarginRate',    v_row.floor_margin_rate,
      -- RULING R6: both floors made explicit, plus which one binds. Before
      -- R6 nothing recorded WHICH constraint produced `floorPrice`, and the
      -- two are acted on differently — an absolute breach is a conversation
      -- about the tier, a margin breach is a conversation about cost.
      --
      -- 007 stores the basis as 'PROGRAMME' | 'MARGIN' (a GENERATED column);
      -- the contract's `BindingFloorBasis` is 'ABSOLUTE' | 'MARGIN'. They are
      -- the same fact under two names and the mapping happens HERE, once,
      -- rather than in every screen that reads it.
      'absoluteFloorPrice', app._money(v_row.programme_floor_price_sen, v_row.currency::text),
      'marginFloorPrice',   app._money(v_row.margin_floor_price_sen,    v_row.currency::text),
      'bindingFloorBasis',  CASE WHEN v_row.binding_floor_basis = 'PROGRAMME'
                                 THEN 'ABSOLUTE' ELSE v_row.binding_floor_basis END,
      'commissionRate',     COALESCE(v_row.commission_rate, 0),
      'commission',         app._money(COALESCE(v_row.commission_sen, 0), v_row.currency::text),
      'commissionPayableOn', COALESCE(v_row.commission_payable_on, 'COLLECTION'))
    || CASE WHEN v_year IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('rateCardYear', v_year) END
    -- §15 item 3 / §18: a per-pax figure that does not multiply cleanly is
    -- DISPLAY ONLY. It lives under `display`, never as a line, and never in
    -- any sum.
    || CASE WHEN v_row.display_per_pax_sen IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('display',
                   pg_catalog.jsonb_build_object('perPax',
                     app._money(v_row.display_per_pax_sen, v_row.currency::text))) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.put_quotation(
  p_id              text,
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_actor    record;
  v_row      core.quotations%ROWTYPE;
  v_line     jsonb;
  v_n        smallint := 0;   -- capped below; see LINE_CAP
  v_qty      numeric;
  v_unit     bigint;
  v_claimed  bigint;
  v_computed bigint;
  v_hash     text;
  v_key      app.idempotency_keys%ROWTYPE;
  v_after      core.quotations%ROWTYPE;
  v_sell       bigint;
  v_sum_sell   bigint;
  v_sum_cost   bigint;
  v_line_count integer;
  v_tax        record;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  SELECT quotation.* INTO v_row FROM core.quotations AS quotation
   WHERE quotation.tenant_id = v_tenant
     AND (quotation.id::text = p_id OR quotation.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such quotation'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  IF NULLIF(p_idempotency_key,'') IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                pg_catalog.jsonb_build_object('id', p_id, 'body', p_body)::text, 'UTF8')), 'hex');
    INSERT INTO app.idempotency_keys (tenant_id, actor_id, endpoint, key, request_hash)
    VALUES (v_tenant, v_actor.actor_id, 'PUT /v1/quotations', p_idempotency_key, v_hash)
    ON CONFLICT (tenant_id, actor_id, endpoint, key) DO NOTHING
    RETURNING * INTO v_key;
    IF v_key.id IS NULL THEN
      SELECT existing.* INTO v_key FROM app.idempotency_keys AS existing
       WHERE existing.tenant_id = v_tenant AND existing.actor_id = v_actor.actor_id
         AND existing.endpoint = 'PUT /v1/quotations' AND existing.key = p_idempotency_key;
      IF v_key.request_hash IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'idempotency key reused with a different body'
          USING ERRCODE = 'TRNOS',
                -- PERMANENT; see the note in core.create_proposal.
                DETAIL = pg_catalog.jsonb_build_object(
                           'code','IDEMPOTENT_REPLAY',
                           'reason','KEY_REUSED_WITH_DIFFERENT_BODY',
                           'retryable', false)::text;
      END IF;
      -- A PUT is idempotent by definition, so a same-body replay returns the
      -- current record rather than rewriting identical lines.
      PERFORM pg_catalog.set_config('response.headers','[{"Idempotent-Replay":"true"}]', true);
      RETURN core.get_quotation(v_row.id::text);
    END IF;
  END IF;

  p_body := COALESCE(p_body, '{}'::jsonb);

  IF p_body ? 'lines' AND pg_catalog.jsonb_typeof(p_body -> 'lines') = 'array' THEN
    -- LINES ARE TRUTH (§18). The submitted `total` on each line is VALIDATED
    -- against `app.round_half_up_sen(rate × qty)` — 001:372, the one rounding
    -- function in the codebase — and a disagreement is refused rather than
    -- silently corrected. Getting this wrong does not look like a bug: it
    -- looks like an invoice one sen out, which `reconcileInvoice` rejects
    -- later with `details.reason: "TOTAL_NOT_RECONCILED"`.
    --
    -- Nothing here multiplies money in floating point. `qty` is numeric,
    -- `unit_price_sen` is bigint, and the product goes through
    -- `app.round_half_up_sen` before it is compared to anything.
    FOR v_line IN SELECT element.value
                    FROM pg_catalog.jsonb_array_elements(p_body -> 'lines') AS element(value)
    LOOP
      -- LINE_CAP. `v_n` is `smallint`, so a body with more than 32,767 lines used
    -- to raise a raw numeric overflow — a 500 rather than a refusal. The cap is
    -- well below that and is a product statement: a quotation is a document
    -- somebody reads.
    IF v_n >= 500 THEN
      RAISE EXCEPTION 'too many quotation lines'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                         'code','VALIDATION_FAILED',
                         'fields', pg_catalog.jsonb_build_array(
                           pg_catalog.jsonb_build_object(
                             'field','lines','reason','TOO_MANY_LINES','max',500)))::text;
    END IF;
    v_n := v_n + 1;
      IF pg_catalog.jsonb_typeof(v_line -> 'qty') <> 'number' THEN
        RAISE EXCEPTION 'line qty must be a number'
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object(
                  'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                    pg_catalog.jsonb_build_object(
                      'field','lines[' || v_n || '].qty','reason','NOT_A_NUMBER')))::text;
      END IF;
      v_qty  := (v_line ->> 'qty')::numeric;
      v_unit := COALESCE(NULLIF(v_line #>> '{rate,amount}','')::bigint, 0);
      v_computed := app.round_half_up_sen(v_unit::numeric * v_qty);
      v_claimed  := NULLIF(v_line #>> '{total,amount}','')::bigint;

      IF v_claimed IS NOT NULL AND v_claimed <> v_computed THEN
        RAISE EXCEPTION 'line % total does not equal rate x qty rounded half-up', v_n
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object(
                  'code','VALIDATION_FAILED',
                  'reason','TOTAL_NOT_RECONCILED',
                  'fields', pg_catalog.jsonb_build_array(
                    pg_catalog.jsonb_build_object(
                      'field','lines[' || v_n || '].total',
                      'reason','TOTAL_NOT_RECONCILED')),
                  'claimed', v_claimed, 'computed', v_computed)::text;
      END IF;
    END LOOP;

    DELETE FROM core.quotation_lines AS line
     WHERE line.tenant_id = v_tenant AND line.quotation_id = v_row.id;

    -- `total_sen` is DELIBERATELY NOT INSERTED: it is a GENERATED column and
    -- the database computes it. `is_cost` decides which side of the margin a
    -- line falls on, and `basis` carries 007's own vocabulary.
    INSERT INTO core.quotation_lines
      (tenant_id, quotation_id, n, item, detail, basis, qty, unit, unit_price_sen, is_cost)
    SELECT v_tenant, v_row.id,
           (pg_catalog.row_number() OVER ())::smallint,
           COALESCE(element.value ->> 'item', 'Line'),
           element.value ->> 'detail',
           COALESCE(element.value ->> 'basis', 'PER_UNIT'),
           (element.value ->> 'qty')::numeric,
           element.value ->> 'unit',
           COALESCE(NULLIF(element.value #>> '{rate,amount}','')::bigint, 0),
           COALESCE((element.value ->> 'isCost')::boolean, false)
      FROM pg_catalog.jsonb_array_elements(p_body -> 'lines') AS element(value);
  END IF;

  -- A submitted `sellPrice` is CHECKED against the lines, never written over
  -- them. 007's `core.quotation_recalc()` has already summed the rounded
  -- non-cost lines onto the header, so a disagreement here is the client
  -- claiming a total its own lines do not produce.
  IF p_body ? 'sellPrice' THEN
    SELECT quotation.sell_price_sen INTO v_sell FROM core.quotations AS quotation
     WHERE quotation.tenant_id = v_tenant AND quotation.id = v_row.id;
    IF NULLIF(p_body #>> '{sellPrice,amount}','')::bigint IS DISTINCT FROM v_sell THEN
      RAISE EXCEPTION 'submitted sellPrice does not equal the sum of the rounded lines'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','VALIDATION_FAILED',
                'reason','TOTAL_NOT_RECONCILED',
                'claimed', NULLIF(p_body #>> '{sellPrice,amount}','')::bigint,
                'computed', v_sell)::text;
    END IF;
  END IF;

  -- ── RULING R-C · SST COMES FROM core.tax_policies, NEVER FROM A CONSTANT ─
  --
  -- STATUS CHANGED SINCE 018 WAS FIRST WRITTEN, and this is the whole of the
  -- change. When 018 was authored against 001-013, neither `core.tax_policies`
  -- nor `app.resolve_tax_policy()` existed, so the PR recorded R-C as a
  -- dependency and the pin emitted a skip. 017 §SST created both, and 017 also
  -- added six SST columns to `core.quotations`. Two of them —
  -- `sst_sen` and `gross_price_sen` — are GENERATED from
  -- `sell_price_sen * sst_rate`. The other four are PLAIN COLUMNS WITH
  -- DEFAULTS AND NO TRIGGER BEHIND THEM: `sst_rate` defaults to 0 and
  -- `sst_reason` to 'STANDARD_RATED'.
  --
  -- So a quotation written by anything that does not resolve a policy is
  -- standard-rated at zero per cent — a quotation that looks taxed and carries
  -- no tax. 017's own resolver says why that must not happen: "A missing policy
  -- must not silently become a zero rate: that is an invoice filed with no SST
  -- and no reason." Filling those four columns is the RPC's job, and R-C names
  -- this RPC. It is done HERE, once, on the write path.
  --
  -- THE CATEGORY. `app.resolve_tax_policy` selects on `service_category`. 017
  -- seeds two national policies: `CORPORATE_TRAINING` (Group G professionals,
  -- 800 bps, `is_default = true`) and `EDUCATION_ACT_INSTITUTION` (exempt).
  -- A quotation is priced for corporate training, so `CORPORATE_TRAINING` is
  -- the category. Choosing the exempt one requires knowing the BUYER is an
  -- Education Act institution, and no column in 001-017 records that — see the
  -- PR. Hardcoding the default would be the defect R-C exists to prevent;
  -- resolving the default category through the registry is not, because the
  -- rate, the exemption and the policy id all come from the row.
  --
  -- The resolver RAISES `no_data_found` rather than returning nothing. That is
  -- deliberate on 017's side and is translated here rather than swallowed: a
  -- quotation that cannot be taxed is a refusal, not a zero.
  -- ⚠ H4 · THIS BLOCK USED TO RUN ON EVERY CALL, INCLUDING AN EMPTY BODY.
  -- `p_body` is coalesced to `'{}'` above, so `core.put_quotation(id, '{}')` —
  -- no lines, no price, nothing — performed a tax rewrite and nothing else. Two
  -- consequences, one latent and one immediate:
  --
  --   * The category is hardcoded `CORPORATE_TRAINING`, so any quotation ever
  --     set to `TRAINING_EXEMPT` by another path was silently reset to
  --     `STANDARD_RATED` at 8% on the next save — and `sst_sen` and
  --     `gross_price_sen` are GENERATED from `sell_price_sen * sst_rate`, so
  --     the CUSTOMER-FACING GROSS changed. Latent only because no other writer
  --     sets the exempt policy today.
  --   * A no-op PUT was a write: it bumped `updated_at` and fired 007's
  --     triggers on a request that changed nothing.
  --
  -- It now runs only when the tax treatment is ABSENT or the PRICE MOVED —
  -- and only when THE TABLE DOES NOT ALREADY OWN THE RULE.
  --
  -- ⚠ THE OTHER HALF OF DOC 09 §14.8 HAS SINCE BEEN BUILT, BY THE 017 LANE.
  -- §14.8 offered a disjunction: "a trigger on `core.quotations`, or the same
  -- resolution in every writer." `origin/cloud/migrations` now carries
  -- `core.resolve_quotation_sst()` on `trg_quotations_resolve_sst`, BEFORE
  -- INSERT OR UPDATE, which fills all three columns when the caller supplies
  -- neither and keeps the caller's position when it supplies both. That is the
  -- better half, and where it exists this RPC must not also write — two writers
  -- for one rule is the divergence the project's consolidation rule forbids,
  -- and the loser would be the exemption, which only the trigger can preserve.
  --
  -- The check is on the TRIGGER'S EXISTENCE rather than on a version number,
  -- because 018 has to apply correctly against both 017s that exist while this
  -- branch is unrebased: the one on `lane/rpc-018`'s base, where `sst_rate`
  -- defaults to 0 and nothing fills it, and the one on `cloud/migrations`,
  -- where the trigger does. Against the first this block is the only thing
  -- standing between a quotation and a zero rate; against the second it is a
  -- second writer, and it stands down.
  SELECT quotation.sell_price_sen INTO v_sell FROM core.quotations AS quotation
   WHERE quotation.tenant_id = v_tenant AND quotation.id = v_row.id;

  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trg
        WHERE trg.tgrelid = 'core.quotations'::regclass
          AND trg.tgname  = 'trg_quotations_resolve_sst'
          AND NOT trg.tgisinternal)
     AND (v_row.sst_policy_id IS NULL
          OR v_row.sell_price_sen IS DISTINCT FROM v_sell) THEN
  BEGIN
    SELECT resolved.* INTO STRICT v_tax
      FROM app.resolve_tax_policy(v_tenant, 'CORPORATE_TRAINING') AS resolved;
  EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'no SST policy is registered for corporate training'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED',
              'reason','NO_TAX_POLICY',
              'category','CORPORATE_TRAINING')::text;
  END;

  UPDATE core.quotations AS quotation
     SET sst_policy_id = v_tax.policy_id,
         sst_rate      = v_tax.rate,
         -- 017's CHECK pairs these: TRAINING_EXEMPT demands a zero rate AND a
         -- non-blank reason, so the exempt branch supplies both or neither.
         sst_reason    = CASE WHEN v_tax.exempt THEN 'TRAINING_EXEMPT'
                              ELSE 'STANDARD_RATED' END,
         sst_exempt_reason = CASE
           WHEN v_tax.exempt AND v_tax.exempt_reason_required
             THEN 'Resolved from tax policy ' || v_tax.policy_code
                  || ' (' || v_tax.scope || ')'
           ELSE NULL END
   WHERE quotation.tenant_id = v_tenant AND quotation.id = v_row.id;
  END IF;

  -- ── TRANSLATING 007'S TWO ASSERTIONS INTO CONTRACT ERROR CODES ──────────
  --
  -- 007 enforces the money rule with two DEFERRABLE INITIALLY DEFERRED
  -- constraint triggers, which fire at COMMIT — outside this function, where
  -- the error can no longer be turned into a contract error code and reaches
  -- the client as a raw integrity violation with 007's own message.
  --
  -- `SET CONSTRAINTS ... IMMEDIATE` DOES NOT SOLVE THIS, and that was measured
  -- rather than assumed: inside a PL/pgSQL block with an exception handler the
  -- statement succeeds and fires nothing, because the handler opens a
  -- subtransaction and the deferred-event queue is not processed there. The
  -- first version of this function used it and T14 caught 007's raw message
  -- coming through untranslated.
  --
  -- So the check is made HERE, by READING BACK the columns 007 GENERATED.
  -- This computes no money of its own — `sell_price_sen` and
  -- `direct_cost_sen` were written by `core.quotation_recalc()`, and
  -- `below_floor`, `floor_price_sen`, `margin_floor_price_sen`,
  -- `binding_floor_basis` and `margin_rate` are generated columns. 007 remains
  -- the enforcement; its deferred triggers still fire at COMMIT as the
  -- backstop. This is the translation layer, and it refuses FIRST so the
  -- client gets FLOOR_PRICE_BREACH and TOTAL_NOT_RECONCILED rather than 23000.
  SELECT quotation.* INTO v_after FROM core.quotations AS quotation
   WHERE quotation.tenant_id = v_tenant AND quotation.id = v_row.id;

  SELECT COALESCE(pg_catalog.sum(line.total_sen) FILTER (WHERE NOT line.is_cost), 0),
         COALESCE(pg_catalog.sum(line.total_sen) FILTER (WHERE     line.is_cost), 0),
         pg_catalog.count(*)::integer
    INTO v_sum_sell, v_sum_cost, v_line_count
    FROM core.quotation_lines AS line
   WHERE line.tenant_id = v_tenant AND line.quotation_id = v_row.id;

  -- A quotation with NO lines is a draft being started, not a disagreement —
  -- 007 makes the same exemption, and the two must agree or a legal draft is
  -- refused by one and accepted by the other.
  IF v_line_count > 0
     AND (v_after.sell_price_sen <> v_sum_sell OR v_after.direct_cost_sen <> v_sum_cost) THEN
    RAISE EXCEPTION 'quotation header does not equal the sum of its rounded lines'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED',
              'reason','TOTAL_NOT_RECONCILED',
              'claimedSell', v_after.sell_price_sen, 'lineSell', v_sum_sell,
              'claimedCost', v_after.direct_cost_sen, 'lineCost', v_sum_cost)::text;
  END IF;

  IF v_line_count > 0 AND v_after.below_floor AND v_after.discount_approval_id IS NULL THEN
    -- The full RULING R6 bag. `floorPrice` alone says a price is too low; it
    -- does not say WHICH constraint made it too low, and the two are acted on
    -- differently — an absolute breach is a conversation about the tier, a
    -- margin breach is a conversation about cost.
    --
    -- `POLICY_APPROVAL_REQUIRED` IS NOT RAISED HERE: a discount that needs
    -- approval goes through `DISCOUNT_APPROVE` on `core.perform_action`, which
    -- is the one endpoint that gates approvals. Raising it here would put a
    -- second approval path beside the spine.
    RAISE EXCEPTION 'quotation is priced below its binding floor'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FLOOR_PRICE_BREACH',
              'floorPrice',          app._money(v_after.floor_price_sen, v_after.currency::text),
              'resultingMarginRate', COALESCE(v_after.margin_rate, 0),
              'requiresPolicy',      'APV-02',
              'absoluteFloorPrice',  app._money(v_after.programme_floor_price_sen, v_after.currency::text),
              'marginFloorPrice',    app._money(v_after.margin_floor_price_sen, v_after.currency::text),
              'bindingFloorBasis',   CASE WHEN v_after.binding_floor_basis = 'PROGRAMME'
                                          THEN 'ABSOLUTE' ELSE v_after.binding_floor_basis END)::text;
  END IF;

  IF v_key.id IS NOT NULL THEN
    UPDATE app.idempotency_keys
       SET state = 'COMPLETED',
           response = pg_catalog.jsonb_build_object(
             'status','EXECUTED','entity','quotation','id', v_row.id::text),
           status_code = 200,
           completed_at = pg_catalog.now(),
           expires_at = pg_catalog.now() + interval '24 hours'
     WHERE id = v_key.id;
  END IF;

  RETURN core.get_quotation(v_row.id::text);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_rate_card()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_card   core.rate_cards%ROWTYPE;
BEGIN
  -- The ACTIVE card for today. `validity` is 007's daterange, so "the card in
  -- force" is a containment test rather than an ordering trick — a card that
  -- expired yesterday must not price anything today.
  SELECT card.* INTO v_card FROM core.rate_cards AS card
   WHERE card.tenant_id = v_tenant
     AND card.status = 'ACTIVE'
     AND card.validity @> CURRENT_DATE
   ORDER BY card.effective_from DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('reason','NO_ACTIVE_RATE_CARD'));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    -- §18: until Finance supplies values the API returns `v0-placeholder` and
    -- clients render the placeholder label, so nobody quotes from it. The
    -- version is READ, never defaulted, so a real card can never be mistaken
    -- for a placeholder or the reverse.
    'version',       v_card.version,
    'effectiveFrom', v_card.effective_from,
    'effectiveTo',   v_card.effective_to,
    'currency',      v_card.currency::text,
    'trainerDayRate', COALESCE((
      SELECT pg_catalog.jsonb_agg(band.row ORDER BY band.band)
        FROM (
          SELECT day.band::text AS band,
                 pg_catalog.jsonb_build_object(
                   'band', day.band::text,
                   'rate', app._money(day.day_rate_sen, v_card.currency::text))
                 -- A per-trainer override is OPTIONAL and is emitted only when
                 -- one exists: an empty override array reads as "checked, none"
                 -- which is a different claim from "not overridden".
                 || CASE WHEN EXISTS (
                      SELECT 1 FROM core.rate_card_trainer_days AS ovr
                       WHERE ovr.tenant_id = v_tenant AND ovr.rate_card_id = v_card.id
                         AND ovr.band = day.band AND ovr.trainer_id IS NOT NULL)
                    THEN pg_catalog.jsonb_build_object('override', (
                      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'trainerRef', trainer.ref,
                               'rate', app._money(ovr.day_rate_sen, v_card.currency::text))
                             ORDER BY trainer.ref)
                        FROM core.rate_card_trainer_days AS ovr
                        JOIN core.trainers AS trainer
                          ON trainer.tenant_id = ovr.tenant_id AND trainer.id = ovr.trainer_id
                       WHERE ovr.tenant_id = v_tenant AND ovr.rate_card_id = v_card.id
                         AND ovr.band = day.band AND ovr.trainer_id IS NOT NULL))
                    ELSE '{}'::jsonb END AS row
            FROM core.rate_card_trainer_days AS day
           WHERE day.tenant_id = v_tenant AND day.rate_card_id = v_card.id
             AND day.trainer_id IS NULL
        ) AS band), '[]'::jsonb),
    'materialsPerPax', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'programmeType', material.programme_type,
               'rate', app._money(material.per_pax_sen, v_card.currency::text))
             ORDER BY material.programme_type)
        FROM core.rate_card_materials AS material
       WHERE material.tenant_id = v_tenant AND material.rate_card_id = v_card.id), '[]'::jsonb),
    'venue', COALESCE((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('mode', venue.mode::text)
               -- EXTERNAL is QUOTED, so it carries no fixed rate. The key is
               -- omitted rather than zeroed: a zero here would read as free.
               || CASE WHEN venue.day_rate_sen IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('rate',
                              app._money(venue.day_rate_sen, v_card.currency::text)) END
             ORDER BY venue.mode)
        FROM core.rate_card_venues AS venue
       WHERE venue.tenant_id = v_tenant AND venue.rate_card_id = v_card.id), '[]'::jsonb),
    'travel', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'region', travel.region::text,
               'rate', app._money(travel.per_trip_sen, v_card.currency::text))
             ORDER BY travel.region)
        FROM core.rate_card_travel AS travel
       WHERE travel.tenant_id = v_tenant AND travel.rate_card_id = v_card.id), '[]'::jsonb),
    -- `mealsPerPax` is a SINGLE OBJECT in the contract, not an array, even
    -- though the table is keyed by programme type. The first row by programme
    -- type is the card's meal rate; a second would need a contract change.
    'mealsPerPax', COALESCE((
      SELECT pg_catalog.jsonb_build_object(
               'rate',       app._money(meal.per_pax_sen, v_card.currency::text),
               'acmCeiling', app._money(meal.acm_ceiling_sen, v_card.currency::text))
        FROM core.rate_card_meals AS meal
       WHERE meal.tenant_id = v_tenant AND meal.rate_card_id = v_card.id
       ORDER BY meal.programme_type
       LIMIT 1),
      pg_catalog.jsonb_build_object(
        'rate',       app._money(0, v_card.currency::text),
        'acmCeiling', app._money(0, v_card.currency::text))),
    'commissionPct', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'role', commission.role::text,
               -- `band` is an int8range in the column and a string in the
               -- contract. The range's own text form is the honest rendering:
               -- it carries the bounds AND their inclusivity.
               'band', commission.band::text,
               'pct',  commission.pct)
             ORDER BY commission.role, commission.band)
        FROM core.rate_card_commissions AS commission
       WHERE commission.tenant_id = v_tenant AND commission.rate_card_id = v_card.id), '[]'::jsonb),
    'marginFloorPct', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'programmeType', floor_row.programme_type,
               'pct',           floor_row.floor_pct)
             ORDER BY floor_row.programme_type)
        FROM core.rate_card_margin_floors AS floor_row
       WHERE floor_row.tenant_id = v_tenant AND floor_row.rate_card_id = v_card.id), '[]'::jsonb),
    'discountAuthority', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'role',   authority.role::text,
               'maxPct', authority.max_pct)
             ORDER BY authority.role)
        FROM core.rate_card_discount_authorities AS authority
       WHERE authority.tenant_id = v_tenant AND authority.rate_card_id = v_card.id), '[]'::jsonb)));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_policy(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.action_policies%ROWTYPE;
BEGIN
  -- `core.action_policies.id` is TEXT ('APV-01'), not a uuid — the policy id
  -- is the business identifier and is what the §3 error bag carries back as
  -- `details.policyId`. So there is one lookup here, not an id-or-ref pair.
  SELECT policy.* INTO v_row FROM core.action_policies AS policy
   WHERE policy.tenant_id = v_tenant AND policy.id = p_id;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'actionType',   v_row.action_type,
      'description',  v_row.description,
      'conditions',   v_row.conditions,
      'combinator',   v_row.combinator,
      'approverRole', v_row.approver_role,
      'slaMinutes',   v_row.sla_minutes)
    || CASE WHEN v_row.escalate_to_role IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('escalateToRole', v_row.escalate_to_role) END
    || CASE WHEN v_row.escalate_after_minutes IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('escalateAfterMinutes', v_row.escalate_after_minutes) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_pipeline_config(p_object text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_pipeline core.pipelines%ROWTYPE;
  v_stages   jsonb;
BEGIN
  -- THE SECOND SPINE. Stage names and order render from `core.pipeline_steps`
  -- rows, in `position` order, with the label the row carries. A hardcoded
  -- stage list anywhere in SQL is a defect (`supabase/CLAUDE.md`), and this is
  -- the endpoint every LifecycleStepper in the product reads.
  --
  -- KNOWN DIVERGENCE, stated rather than papered over: 004's
  -- `pipelines_object_check` allows ENGAGEMENT | OPPORTUNITY | PACKET, while
  -- the contract's `PIPELINE_OBJECTS` is ENGAGEMENT | DEAL_CHAIN |
  -- OPPORTUNITY. `DEAL_CHAIN` therefore has no rows and answers NOT_FOUND,
  -- and `PACKET` is reachable but is not a contract value. This function does
  -- NOT map one onto the other: inventing an alias would hide a schema/contract
  -- disagreement that has to be settled in 003/004, not here. See the PR.
  IF NULLIF(p_object,'') IS NULL THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','object','reason','REQUIRED'))));
  END IF;

  SELECT pipeline.* INTO v_pipeline FROM core.pipelines AS pipeline
   WHERE pipeline.tenant_id = v_tenant
     AND pipeline.object = p_object
     AND pipeline.status = 'ACTIVE'
   ORDER BY pipeline.is_default DESC, pipeline.version DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('object', p_object));
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'key',      step.step_key,
             'label',    step.label,
             'order',    step.position,
             -- Ruling R16: `terminal` is stored, not inferred from `order`.
             -- Inferring an ending from the highest order is how a computed
             -- chain puts LOST after WON rather than beside it.
             'terminal', step.terminal)
           ORDER BY step.position), '[]'::jsonb)
    INTO v_stages
    FROM core.pipeline_steps AS step
   WHERE step.tenant_id = v_tenant AND step.pipeline_id = v_pipeline.id;

  -- Ruling R16's `outcome` is NOT emitted: `core.pipeline_steps` has no
  -- outcome column in 001–013 and `core.stage_outcome` is listed in
  -- `supabase/HANDOFF.md` as a pending 003/004 change. The field is optional
  -- in the contract, and omitting it is honest; emitting a guess is not.
  RETURN app.ok(pg_catalog.jsonb_build_object(
    'object', v_pipeline.object,
    'stages', v_stages));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_programme(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.programmes%ROWTYPE;
BEGIN
  SELECT programme.* INTO v_row FROM core.programmes AS programme
   WHERE programme.tenant_id = v_tenant
     AND (programme.id::text = p_id OR programme.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',        v_row.id::text,
    'ref',       v_row.ref,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
    'name',     v_row.name,
    'category', v_row.category,
    'days',     v_row.days,
    'version',  v_row.version,
    'status',   v_row.status,
    'hrdcScheme',    v_row.hrdc_scheme::text,
    'hrdcClaimable', v_row.hrdc_claimable,
    -- `floorPrice` is the SERVER value the costing screen validates against —
    -- never a client constant, which is the whole reason it is on the record.
    'listPrice',    app._money(v_row.list_price_sen,  v_row.currency),
    'listPricePax', v_row.list_price_pax,
    'floorPrice',   app._money(v_row.floor_price_sen, v_row.currency),
    'floorMarginRate', v_row.floor_margin_rate,
    'outcomes',  pg_catalog.to_jsonb(v_row.outcomes),
    'modules', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'n', module.n, 'title', module.title,
               'format', module.format, 'durationMinutes', module.duration_minutes)
             ORDER BY module.n)
        FROM core.programme_modules AS module
       WHERE module.tenant_id = v_tenant AND module.programme_id = v_row.id), '[]'::jsonb),
    'pricingTiers', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'maxPax', tier.max_pax,
               'price',  app._money(tier.price_sen, tier.currency))
             ORDER BY tier.max_pax)
        FROM core.programme_pricing_tiers AS tier
       WHERE tier.tenant_id = v_tenant AND tier.programme_id = v_row.id), '[]'::jsonb),
    'trainerPool', COALESCE((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'trainerRef',   trainer.ref,
                 'name',         trainer.name,
                 'tttCertified', trainer.ttt_certified)
               || CASE WHEN trainer.ttt_ref IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('tttRef', trainer.ttt_ref) END
               || CASE WHEN COALESCE(link.rating_override, trainer.rating) IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('rating',
                              COALESCE(link.rating_override, trainer.rating)) END
             ORDER BY trainer.name)
        FROM core.programme_trainers AS link
        JOIN core.trainers AS trainer
          ON trainer.tenant_id = link.tenant_id AND trainer.id = link.trainer_id
       WHERE link.tenant_id = v_tenant AND link.programme_id = v_row.id), '[]'::jsonb),
    'materials', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'type',      material.material_type,
               'version',   material.version,
               'languages', pg_catalog.to_jsonb(material.languages))
             ORDER BY material.material_type)
        FROM core.programme_materials AS material
       WHERE material.tenant_id = v_tenant AND material.programme_id = v_row.id), '[]'::jsonb),
    'stats', pg_catalog.jsonb_build_object(
      'deliveries',        v_row.deliveries_count,
      'averageEvaluation', COALESCE(v_row.average_evaluation, 0))));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_compliance_rule(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.compliance_rules%ROWTYPE;
  v_verifier text;
  v_affected integer;
BEGIN
  -- `core.compliance_rules.tenant_id` is NULLABLE: a rule read from an HRD
  -- Corp circular is the registry's, not a tenant's, and a null tenant means
  -- "applies to everyone". Both are readable here; neither leaks another
  -- tenant's overrides.
  SELECT rule.* INTO v_row FROM core.compliance_rules AS rule
   WHERE (rule.tenant_id = v_tenant OR rule.tenant_id IS NULL)
     AND (rule.id::text = p_id OR rule.rule_code = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT profile.display_name INTO v_verifier FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.verified_by_user_id;

  SELECT pg_catalog.count(DISTINCT affected.engagement_id)::integer INTO v_affected
    FROM core.rule_change_affected_engagements AS affected
    JOIN core.rule_changes AS change
      ON change.tenant_id = affected.tenant_id AND change.id = affected.rule_change_id
   WHERE affected.tenant_id = v_tenant
     AND (change.target_rule_id = v_row.id OR change.new_rule_id = v_row.id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',      v_row.id::text,
    'scheme',  COALESCE(v_row.scheme::text, v_row.scheme_key),
    'subject', v_row.subject,
    'expression', pg_catalog.jsonb_build_object(
      'field',     v_row.subject_field,
      'op',        v_row.op::text,
      'reference', v_row.reference)
      || CASE WHEN v_row.offset_amount = 0 THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('offsetDays', v_row.offset_amount) END
      -- DECISIONS §3: calendar days, not working days, until circular text
      -- says otherwise. The unit is stored, so this reads it rather than
      -- assuming the default it happens to agree with today.
      || CASE WHEN v_row.offset_unit IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('dayBasis',
                     CASE WHEN v_row.offset_unit::text = 'WORKING_DAY' THEN 'WORKING'
                          ELSE 'CALENDAR' END) END,
    'effectiveFrom', v_row.effective_from,
    'effectiveTo',   v_row.effective_to,
    'status',        v_row.status::text,
    'source', pg_catalog.jsonb_build_object(
      'documentId', COALESCE(v_row.source_document_id, ''),
      'title',      COALESCE(v_row.source_title, ''),
      'section',    COALESCE(v_row.source_section, ''),
      'page',       COALESCE(v_row.source_page, 0),
      'excerpt',    COALESCE(v_row.source_excerpt, '')),
    'supersedesId',   v_row.supersedes_rule_id::text,
    'supersededById', v_row.superseded_by_rule_id::text,
    'usedByChecks',   pg_catalog.to_jsonb(v_row.used_by_check_keys),
    'affectedOpenEngagements', COALESCE(v_affected, 0),
    -- DECISIONS §3 loads every rule as PROPOSED until compliance verifies it
    -- against the circular PDF, which is why these two are NULLABLE rather
    -- than absent: an unverified rule has to be visibly unverified.
    'verifiedBy', app._actor('HUMAN', v_row.verified_by_user_id::text, v_verifier),
    'verifiedAt', v_row.verified_at)
    || CASE WHEN app._provenance('compliance_rules', v_row.id, NULL) IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('provenance',
                   app._provenance('compliance_rules', v_row.id, NULL)) END);
END;
$fn$;

DO $grants$
DECLARE v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
     WHERE p.pronamespace = 'core'::regnamespace
       AND p.proname IN ('badge_counts','get_audit','list_enquiries','get_enquiry','patch_enquiry_extraction','list_follow_ups','get_follow_up_draft','get_organisation','get_opportunity','get_contact','get_tna','get_tna_recommendations','create_proposal','list_proposals','get_proposal','add_proposal_section','put_proposal_section','regenerate_proposal_section','get_quotation','put_quotation','get_rate_card','get_policy','get_pipeline_config','get_programme','get_compliance_rule')
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
  END LOOP;
END
$grants$;

-- ═══ 5 · Verify ════════════════════════════════════════════════════════════

DO $verify$
BEGIN
  IF pg_catalog.strpos(app._body_sql('core.get_enquiry(text)'::regprocedure), 'app.has_permission(') > 0
     OR pg_catalog.strpos(app._body_sql('core.get_audit(text,text)'::regprocedure), '(''APPROVAL'',') > 0
     OR pg_catalog.to_regprocedure('app.check_opportunity_stage_move(uuid,uuid,jsonb)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM app.action_types WHERE key = 'OPPORTUNITY_STAGE_CHANGE')
     OR (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'app.seeded_pipelines'::regclass) THEN
    RAISE EXCEPTION '021 rollback verify: a 021 object or body is still in place';
  END IF;
END
$verify$;

COMMIT;
