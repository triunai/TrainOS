-- ═══════════════════════════════════════════════════════════════════════════
-- 032 ROLLBACK · Approval target lock (H2) + OPP-01 content repair (H3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores 011's `app.decide_approval` and 021's `app.seed_opportunity_
-- stage_policy` bodies verbatim, and drops `app.lock_action_value_target`.
-- Does NOT revert the OPP-01 rows 032's repair pass converged — a rollback
-- undoes the CODE, not a data repair that made a previously-wrong row
-- correct; reintroducing wrong OPP-01 content on rollback would be a second,
-- worse defect on top of the first.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION app.decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_note text DEFAULT NULL,
  p_expected_diff_hash text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant       uuid := app.require_tenant_id();
  v_actor        record;
  v_approval     core.approval_requests%ROWTYPE;
  v_action       core.action_requests%ROWTYPE;
  v_type         app.action_types%ROWTYPE;
  v_idempotency  app.idempotency_keys%ROWTYPE;
  v_request_hash text;
  v_fresh        jsonb;
  v_hash         text;
  v_result       jsonb;
  v_decided_at   timestamptz := pg_catalog.now();
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_approval_id::text)::bigint);

  IF p_idempotency_key IS NOT NULL THEN
    IF v_actor.actor_id IS NULL THEN
      RAISE EXCEPTION 'a principal is required for idempotency'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
    v_request_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'approvalId',p_approval_id,'decision',p_decision,'note',p_note,
        'expectedDiffHash',p_expected_diff_hash)::text,'UTF8')),'hex');

    INSERT INTO app.idempotency_keys
      (tenant_id,actor_id,endpoint,key,request_hash)
    VALUES
      (v_tenant,v_actor.actor_id,'POST /v1/approvals/{id}/decide',
       p_idempotency_key,v_request_hash)
    ON CONFLICT (tenant_id,actor_id,endpoint,key) DO NOTHING
    RETURNING * INTO v_idempotency;

    IF v_idempotency.id IS NULL THEN
      SELECT keyrow.* INTO v_idempotency
        FROM app.idempotency_keys AS keyrow
       WHERE keyrow.tenant_id = v_tenant
         AND keyrow.actor_id = v_actor.actor_id
         AND keyrow.endpoint = 'POST /v1/approvals/{id}/decide'
         AND keyrow.key = p_idempotency_key;
      IF v_idempotency.request_hash IS DISTINCT FROM v_request_hash THEN
        RAISE EXCEPTION 'idempotency key reused with a different decision'
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object('code','IDEMPOTENT_REPLAY')::text;
      END IF;
      PERFORM pg_catalog.set_config(
        'response.headers','[{"Idempotent-Replay":"true"}]',true);
      PERFORM pg_catalog.set_config('response.status','200',true);
      RETURN v_idempotency.response;
    END IF;
  END IF;

  SELECT approval.* INTO v_approval
    FROM core.approval_requests AS approval
   WHERE approval.id = p_approval_id AND approval.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;
  IF v_approval.status <> 'PENDING' THEN
    RAISE EXCEPTION 'approval % was already %', v_approval.ref, v_approval.status
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','ALREADY_DECIDED','status',v_approval.status,
              'decidedBy',v_approval.decided_by_id,
              'decidedAt',v_approval.decided_at)::text;
  END IF;

  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'the principal has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','reason','APP_ROLE_REQUIRED')::text;
  END IF;
  IF NOT app.has_permission('approval:decide') THEN
    RAISE EXCEPTION 'this principal may not decide approvals'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','requiredRole',v_approval.approver_role)::text;
  END IF;
  IF NOT (v_actor.role = v_approval.approver_role
          OR (v_approval.escalated_at IS NOT NULL
              AND v_actor.role = v_approval.escalated_to_role)
          OR v_actor.role = 'MD') THEN
    RAISE EXCEPTION 'this approval belongs to a different role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','requiredRole',v_approval.approver_role)::text;
  END IF;

  IF NOT (v_approval.requested_by_id IS NOT NULL
          AND v_approval.requested_by_id <> v_actor.actor_id) THEN
    RAISE EXCEPTION 'a user may not decide their own or an unattributed request'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','policyId','GOV-03',
              'requiredRole',v_approval.approver_role)::text;
  END IF;

  SELECT request.* INTO v_action
    FROM core.action_requests AS request
   WHERE request.tenant_id = v_tenant
     AND request.id = v_approval.action_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval action request is missing'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT action_type.* INTO v_type
    FROM app.action_types AS action_type
   WHERE action_type.key = v_action.action_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval action type is missing'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_type.money_moving AND v_actor.actor_kind IN ('HUMAN','CLIENT')
     AND NOT app.aal2_verified() THEN
    RAISE EXCEPTION 'AAL2 is required to decide a money-moving action'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','reason','AAL2_REQUIRED')::text;
  END IF;

  CASE p_decision
    WHEN 'APPROVE' THEN NULL;
    WHEN 'REQUEST_CHANGES' THEN NULL;
    WHEN 'REJECT' THEN NULL;
    ELSE
      RAISE EXCEPTION 'unknown approval decision %L', p_decision
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','VALIDATION_FAILED','reason','UNKNOWN_DECISION')::text;
  END CASE;
  IF p_decision IN ('REJECT','REQUEST_CHANGES')
     AND NULLIF(pg_catalog.btrim(COALESCE(p_note,'')), '') IS NULL THEN
    RAISE EXCEPTION 'a note is required to reject or request changes'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','note','reason','REQUIRED')))::text;
  END IF;

  IF v_action.action_type = 'AGENT_AUTONOMY_CHANGE' AND p_decision = 'APPROVE'
     AND EXISTS (
       SELECT 1 FROM core.jury_verdicts AS jury
        WHERE jury.approval_request_id = v_approval.id
          AND jury.mode = 'GATE' AND jury.status <> 'COMPLETE') THEN
    RAISE EXCEPTION 'the promotion jury has not returned a verdict'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','JURY_PENDING')::text;
  END IF;

  IF p_decision = 'APPROVE' THEN
    v_fresh := app.plan_effects(v_action.action_type,v_action.target_ref,v_action.payload);
    v_hash := pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'effects', v_fresh,
          'value', app.action_value(
                     v_action.action_type, v_action.tenant_id,
                     app.resolve_action_target_id(v_action.action_type, v_action.tenant_id,
                                                  v_action.target_ref, v_action.payload),
                     v_action.payload))::text,
        'UTF8')),'hex');
    IF v_hash IS DISTINCT FROM v_approval.diff_hash THEN
      RAISE EXCEPTION 'the effects changed since the diff was rendered'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','DIFF_CHANGED','diffChanged',true,
                'diff',v_fresh,'diffHash',v_hash)::text;
    END IF;
    IF p_expected_diff_hash IS NOT NULL
       AND p_expected_diff_hash IS DISTINCT FROM v_approval.diff_hash THEN
      RAISE EXCEPTION 'the rendered diff is stale'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','DIFF_CHANGED','diffChanged',true,
                'diff',v_approval.diff,'diffHash',v_approval.diff_hash)::text;
    END IF;
  END IF;

  CASE p_decision
    WHEN 'APPROVE' THEN
      UPDATE core.approval_requests
         SET status = 'APPROVED',decision = 'APPROVE',decision_note = p_note,
             decided_by_id = v_actor.actor_id,decided_by_name = v_actor.actor_id,
             decided_at = v_decided_at
       WHERE id = v_approval.id AND status = 'PENDING';
      UPDATE core.action_requests
         SET status = 'EXECUTING'
       WHERE id = v_action.id AND status = 'QUEUED_FOR_APPROVAL';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'approval action is not queued'
          USING ERRCODE = 'object_not_in_prerequisite_state';
      END IF;
      PERFORM app.apply_effects(v_action.id);
      v_result := pg_catalog.jsonb_build_object(
        'status','APPROVED',
        'decidedBy',pg_catalog.jsonb_build_object(
          'id',v_actor.actor_id,'name',v_actor.actor_id),
        'decidedAt',v_decided_at,'effects',v_action.effects);
    WHEN 'REJECT' THEN
      UPDATE core.approval_requests
         SET status = 'REJECTED',decision = 'REJECT',decision_note = p_note,
             decided_by_id = v_actor.actor_id,decided_by_name = v_actor.actor_id,
             decided_at = v_decided_at
       WHERE id = v_approval.id AND status = 'PENDING';
      UPDATE core.action_requests
         SET status = 'REJECTED',error_code = 'APPROVAL_REJECTED',
             error_details = pg_catalog.jsonb_build_object(
               'code','APPROVAL_REJECTED','note',p_note),
             completed_at = v_decided_at
       WHERE id = v_action.id;
      v_result := pg_catalog.jsonb_build_object(
        'status','REJECTED','effects','[]'::jsonb,
        'decidedBy',pg_catalog.jsonb_build_object(
          'id',v_actor.actor_id,'name',v_actor.actor_id),
        'decidedAt',v_decided_at);
    WHEN 'REQUEST_CHANGES' THEN
      UPDATE core.approval_requests
         SET status = 'CHANGES_REQUESTED',decision = 'REQUEST_CHANGES',
             decision_note = p_note,decided_by_id = v_actor.actor_id,
             decided_by_name = v_actor.actor_id,decided_at = v_decided_at
       WHERE id = v_approval.id AND status = 'PENDING';
      UPDATE core.action_requests
         SET status = 'REJECTED',error_code = 'CHANGES_REQUESTED',
             error_details = pg_catalog.jsonb_build_object(
               'code','CHANGES_REQUESTED','note',p_note),
             completed_at = v_decided_at
       WHERE id = v_action.id;
      v_result := pg_catalog.jsonb_build_object(
        'status','CHANGES_REQUESTED','effects','[]'::jsonb,'note',p_note,
        'decidedBy',pg_catalog.jsonb_build_object(
          'id',v_actor.actor_id,'name',v_actor.actor_id),
        'decidedAt',v_decided_at);
  END CASE;

  INSERT INTO core.approval_decisions
    (tenant_id,approval_request_id,decision,note,decided_by_id,
     decided_by_name,decided_by_role,diff_hash_at_decision)
  VALUES
    (v_tenant,v_approval.id,p_decision,p_note,v_actor.actor_id,
     v_actor.actor_id,v_actor.role,v_approval.diff_hash);

  IF v_idempotency.id IS NOT NULL THEN
    UPDATE app.idempotency_keys
       SET state = 'COMPLETED',response = v_result,status_code = 200,
           action_request_id = v_action.id,completed_at = pg_catalog.now(),
           expires_at = pg_catalog.now() + interval '24 hours'
     WHERE id = v_idempotency.id;
  END IF;
  PERFORM pg_catalog.set_config('response.status','200',true);
  RETURN v_result;
END;
$fn$;

DROP FUNCTION IF EXISTS app.lock_action_value_target(text,uuid,uuid);

CREATE OR REPLACE FUNCTION app.seed_opportunity_stage_policy(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  INSERT INTO core.action_policies
    (tenant_id,id,action_type,description,conditions,combinator,approver_role,
     sla_minutes,escalate_to_role,escalate_after_minutes,expire_after_minutes,
     priority,active)
  VALUES
    (p_tenant_id,'OPP-01','OPPORTUNITY_STAGE_CHANGE',
     'Moving a deal to Won or Lost ends it and needs a sales manager',
     '[{"field":"payload.stage","op":"in","value":["WON","LOST"]}]','ANY',
     'SALES_MANAGER',240,'MD',360,1440,100,true)
  ON CONFLICT (tenant_id,id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION app.seed_opportunity_stage_policy(uuid) IS NULL;
COMMENT ON FUNCTION app.decide_approval(uuid,text,text,text,text) IS NULL;

DO $verify$
DECLARE v_body text;
BEGIN
  IF pg_catalog.to_regprocedure('app.lock_action_value_target(text,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '032 rollback verify: app.lock_action_value_target still exists';
  END IF;
  v_body := app._body_sql('app.decide_approval(uuid,text,text,text,text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'lock_action_value_target') > 0 THEN
    RAISE EXCEPTION '032 rollback verify: decide_approval still references the lock helper';
  END IF;
  v_body := app._body_sql('app.seed_opportunity_stage_policy(uuid)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'DO UPDATE') > 0 THEN
    RAISE EXCEPTION '032 rollback verify: seed_opportunity_stage_policy is still content-repairing';
  END IF;
END
$verify$;

COMMIT;
