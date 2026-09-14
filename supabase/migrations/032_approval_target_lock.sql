-- ═══════════════════════════════════════════════════════════════════════════
-- 032 · Approval target lock (H2) + OPP-01 content repair (H3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- H2. `app.decide_approval` (011:2820) locks `core.approval_requests` and
-- `core.action_requests` FOR UPDATE before it does anything else, but the
-- diff-hash recompute that decides whether the effects changed since the
-- queue-time diff was rendered (011:3000-3018) calls `app.plan_effects` and
-- `app.action_value` WITHOUT first locking the row those functions actually
-- read — a quotation via `app.action_value`'s `QUOTATION` branch
-- (011:1519-1558), an invoice via its `INVOICE` branch, an HRDC packet via
-- `HRDC_CLAIM`, a proposal via the `PROPOSAL_SEND` special case. Between that
-- unlocked read and `app.apply_effects` a few lines later (011:3030-3044),
-- another session holding no lock at all — `put_quotation`, say — can commit
-- a price change: the hash the approver's decision is checked against was
-- computed from a row that is no longer the row `apply_effects` (and
-- everything built on the approved action afterwards) will actually act on.
-- 021's own `R18` closes exactly this shape for `OPPORTUNITY_STAGE_CHANGE` by
-- locking the opportunity FOR UPDATE before re-validating and applying
-- (021:3689-3704) — H2's fix is the same lock, moved one step earlier, to
-- before the diff-hash recompute that the money-moving action types
-- (`app.action_value`'s `QUOTATION`/`INVOICE`/`HRDC_CLAIM` branches, and the
-- `PROPOSAL_SEND` special case) actually depend on.
--
-- `app.lock_action_value_target` is the new helper: given an action type, a
-- tenant and a resolved target id, it locks FOR UPDATE the exact row(s)
-- `app.action_value` reads for that type's `value_source`, mirroring
-- `action_value`'s own CASE rather than re-deriving it. `PAYMENT` and
-- `BUDGET_CAP` read their amount from the action's own immutable payload
-- (011:1574-1577), never from a table, so there is nothing to lock for them;
-- `NONE` has no value at all. Calling it is a no-op for those, and that is
-- the correct behaviour, not a gap — a value that can never change between
-- queue time and decide time needs no lock to stay consistent.
--
-- `app.decide_approval` gains exactly ONE new line, immediately before the
-- `APPROVE` branch's `v_fresh := app.plan_effects(...)` — the earliest point
-- the target id is known (`app.resolve_action_target_id` has already run
-- once, at queue time, but decide_approval never kept that id; it is
-- resolved again here, cheaply, from the same `v_action.target_ref` and
-- `v_action.payload` decide_approval already holds under its own row locks).
-- Every other line of the function is 011's, byte-for-byte. `app.bulk_decide`
-- (011:3427) is untouched and needs no edit: every branch of it calls
-- `app.decide_approval` per item (011:3572), so the fix is inherited
-- automatically — verified by reading `app.bulk_decide`'s body, not assumed.
--
-- H3. `app.seed_opportunity_stage_policy` (021:3818) inserts the OPP-01
-- policy row `ON CONFLICT (tenant_id,id) DO NOTHING`. If a row with id
-- `OPP-01` already exists for a tenant — any content, seeded by hand, by a
-- future migration, by an operator working around a different bug — the
-- INSERT silently no-ops and 021's own verify (V4c) only checks that A row
-- named OPP-01 exists, never that its `action_type`, `active`,
-- `approver_role` or `conditions` are the ones the policy actually needs.
-- A wrong pre-existing row (wrong approver role, `active = false`, a
-- condition that never matches WON/LOST) therefore fails OPEN and OPP-01's
-- entire purpose — SALES_MANAGER approval before a deal closes — silently
-- does not apply, with no error anywhere. Confirmed on hosted before this
-- migration was authored: OPP-01 exists for `akademi-perdana`, is `active`,
-- and its `approver_role` is `SALES_MANAGER` — content is currently correct,
-- so this is a live-but-dormant defect, not an active incident.
--
-- The fix converts the seed from `ON CONFLICT DO NOTHING` to
-- `ON CONFLICT (tenant_id,id) DO UPDATE`, converging every field to the
-- canonical values on every call — including a re-run against a tenant whose
-- OPP-01 row was already wrong — and 032 re-runs the (now-repairing)
-- function for every existing tenant, so any wrong row already on a database
-- this migration is applied to is corrected in the same transaction rather
-- than left to the next tenant-creation trigger fire.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('app.decide_approval(uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '032 preflight: app.decide_approval/5 is absent; 011 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('app.action_value(text,uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION '032 preflight: app.action_value/4 is absent; 011 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('app.seed_opportunity_stage_policy(uuid)') IS NULL THEN
    RAISE EXCEPTION '032 preflight: app.seed_opportunity_stage_policy/1 is absent; 021 has not been applied';
  END IF;
END;
$preflight$;

-- ═══ H2 · app.lock_action_value_target, and decide_approval's one new line ═

CREATE OR REPLACE FUNCTION app.lock_action_value_target(
  p_type      text,
  p_tenant_id uuid,
  p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_source text;
BEGIN
  IF p_target_id IS NULL THEN
    RETURN;
  END IF;

  -- 004 cannot store value_source=PROPOSAL (see action_value's own comment);
  -- PROPOSAL_SEND is resolved the same way here, ahead of the value_source
  -- lookup, for the same reason.
  IF p_type = 'PROPOSAL_SEND' THEN
    PERFORM 1 FROM core.proposals
     WHERE tenant_id = p_tenant_id AND id = p_target_id
     FOR UPDATE;
    RETURN;
  END IF;

  SELECT action_type.value_source INTO v_source
    FROM app.action_types AS action_type
   WHERE action_type.key = p_type;

  CASE v_source
    WHEN 'QUOTATION' THEN
      PERFORM 1 FROM core.quotations
       WHERE tenant_id = p_tenant_id AND id = p_target_id
       FOR UPDATE;
    WHEN 'INVOICE' THEN
      PERFORM 1 FROM core.invoices
       WHERE tenant_id = p_tenant_id AND id = p_target_id
       FOR UPDATE;
    WHEN 'HRDC_CLAIM' THEN
      -- Same candidate set app.action_value's HRDC_CLAIM branch reads (a
      -- packet matched by id OR by engagement_id) — locked here rather than
      -- narrowed to the one action_value ultimately prefers, so the row it
      -- picks cannot change out from under the preference itself.
      PERFORM 1 FROM core.hrdc_packets
       WHERE tenant_id = p_tenant_id
         AND (id = p_target_id OR engagement_id = p_target_id)
       FOR UPDATE;
    ELSE
      -- PAYMENT, BUDGET_CAP: value comes from the action's own immutable
      -- payload, never from a row — nothing to lock. NONE: no value at all.
      -- NULL (unknown type or no value_source row): likewise nothing to lock;
      -- app.action_value itself is what raises on an unknown type, not this
      -- helper's job to pre-empt.
      NULL;
  END CASE;
END;
$fn$;

COMMENT ON FUNCTION app.lock_action_value_target(text,uuid,uuid) IS
  '032 (H2). Locks FOR UPDATE the exact row(s) app.action_value reads for a '
  'given action type''s value_source, mirroring action_value''s own CASE. '
  'Called from app.decide_approval immediately before the diff-hash '
  'recompute, so a concurrent edit to the target (a quotation''s price, an '
  'invoice''s total) cannot land between the check and app.apply_effects — '
  'the same shape as R18''s opportunity lock (021:3689-3704), applied to '
  'money-moving value sources instead of a stage transition.';

REVOKE ALL ON FUNCTION app.lock_action_value_target(text,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- decide_approval, reproduced in full: every line is 011's except the one
-- marked "⚠ 032 (H2)" immediately below.
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
  v_value_target uuid;
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

  -- H-04: NULL must raise before either arm of the authorisation disjunction.
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

  -- H-03: this expression is deliberately positive. NULL is not “different”.
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

  -- H-05: the decision endpoint is its own money-commitment boundary. CLIENT is
  -- held to it exactly as in perform_action.
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
    -- ⚠ 032 (H2). Lock the row app.action_value is about to read BEFORE
    -- reading it, exactly as R18 locks the opportunity before re-validating
    -- it (021:3689-3704). Without this, a concurrent edit to the target
    -- (put_quotation, say) can land between this hash recompute and
    -- app.apply_effects a few lines below, so the effects actually applied
    -- are not provably the effects the approver's hash check just verified.
    v_value_target := app.resolve_action_target_id(
      v_action.action_type, v_action.tenant_id, v_action.target_ref, v_action.payload);
    PERFORM app.lock_action_value_target(v_action.action_type, v_action.tenant_id, v_value_target);

    -- The same two parts, in the same order, as the queue-time hash above — see
    -- the comment there for why the effects alone could never change. This is the
    -- read that makes the comparison mean something: app.action_value goes to the
    -- record, so a quotation edited after it was queued hashes differently here.
    v_fresh := app.plan_effects(v_action.action_type,v_action.target_ref,v_action.payload);
    v_hash := pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'effects', v_fresh,
          'value', app.action_value(
                     v_action.action_type, v_action.tenant_id,
                     v_value_target,
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

-- Grants unchanged: 011:3408-3413 already grants app.decide_approval to
-- service_role only, and CREATE OR REPLACE on an unchanged signature does not
-- reset existing grants. That revoke, though, is a DYNAMIC one — 011 §13
-- loops `EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, '
-- 'anon, authenticated', v_function)` over an array of bare names, which no
-- static tool (including check:grants M2) can read as a literal REVOKE.
-- Asserted here too, literally, so this migration is self-contained under M2.
REVOKE ALL ON FUNCTION app.decide_approval(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- ═══ H3 · OPP-01 seed, content-repairing rather than presence-only ════════

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
  -- 032 (H3). Was DO NOTHING: a pre-existing OPP-01 row of ANY content —
  -- wrong approver_role, active=false, a condition that never matches
  -- WON/LOST — silently blocked the canonical row from ever landing, and
  -- 021's own verify only checked that a row named OPP-01 existed, not what
  -- it said. DO UPDATE converges every field to the canonical values on
  -- every call, including a repair of a row that was already wrong.
  ON CONFLICT (tenant_id,id) DO UPDATE SET
    action_type            = EXCLUDED.action_type,
    description             = EXCLUDED.description,
    conditions               = EXCLUDED.conditions,
    combinator               = EXCLUDED.combinator,
    approver_role            = EXCLUDED.approver_role,
    sla_minutes              = EXCLUDED.sla_minutes,
    escalate_to_role         = EXCLUDED.escalate_to_role,
    escalate_after_minutes   = EXCLUDED.escalate_after_minutes,
    expire_after_minutes     = EXCLUDED.expire_after_minutes,
    priority                 = EXCLUDED.priority,
    active                   = EXCLUDED.active;
  -- Unconditional SET rather than a self-referential WHERE guard: ROW_COUNT
  -- is now 1 on every call (insert or repair), which is fine — nothing reads
  -- this return value to distinguish "freshly created" from "already
  -- correct" (grepped: only PERFORMed, by the trigger and by 032's own
  -- repair pass below).
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION app.seed_opportunity_stage_policy(uuid) IS
  '021, repaired by 032 (H3). ON CONFLICT DO UPDATE, not DO NOTHING: a '
  'pre-existing OPP-01 row of any content is converged to canonical values '
  'rather than left standing. The UPDATE is unconditional (no return-value '
  'or trigger reads this function''s output to distinguish fresh-insert from '
  'already-correct), so a re-run against an already-correct row is a no-op '
  'in effect, one row touched in bookkeeping.';

-- check:grants M2: 021 already revokes this from PUBLIC/anon/authenticated
-- (021:3855) and CREATE OR REPLACE does not reset it; reasserted here so
-- this migration is self-contained.
REVOKE ALL ON FUNCTION app.seed_opportunity_stage_policy(uuid) FROM PUBLIC, anon, authenticated;

-- Repair pass: every tenant that exists gets its OPP-01 row converged right
-- now, in this transaction, rather than waiting for the next
-- seed_opportunity_stage_policy_on_tenant() trigger fire (which only fires
-- on tenant INSERT and would never touch an existing wrong row).
DO $repair$
DECLARE v_tenant_count integer := 0;
BEGIN
  PERFORM app.seed_opportunity_stage_policy(tenant.id)
    FROM public.tenants AS tenant;
  SELECT pg_catalog.count(*) INTO v_tenant_count FROM public.tenants;
  RAISE NOTICE '032: OPP-01 content converged for % tenant(s)', v_tenant_count;
END;
$repair$;

-- ═══ Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_body text;
  v_bad  text[];
BEGIN
  -- V1 · decide_approval calls the new lock helper before plan_effects.
  v_body := app._body_sql('app.decide_approval(uuid,text,text,text,text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'app.lock_action_value_target') = 0 THEN
    RAISE EXCEPTION '032 verify V1: decide_approval no longer calls app.lock_action_value_target';
  END IF;
  IF pg_catalog.strpos(v_body, 'app.lock_action_value_target')
       > pg_catalog.strpos(v_body, 'app.plan_effects(v_action.action_type')
  THEN
    RAISE EXCEPTION '032 verify V1: the lock call is not before plan_effects';
  END IF;

  -- V2 · bulk_decide still delegates to decide_approval per item (so the fix
  -- is inherited, not duplicated or bypassed).
  v_body := app._body_sql('app.bulk_decide(jsonb,text,text,text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'app.decide_approval(v_id') = 0 THEN
    RAISE EXCEPTION '032 verify V2: bulk_decide no longer calls app.decide_approval per item';
  END IF;

  -- V3 · OPP-01 content is canonical for every existing tenant, not merely
  -- present.
  SELECT pg_catalog.array_agg(tenant.id::text) INTO v_bad
    FROM public.tenants AS tenant
    LEFT JOIN core.action_policies AS policy
      ON policy.tenant_id = tenant.id AND policy.id = 'OPP-01'
   WHERE policy.id IS NULL
      OR policy.action_type <> 'OPPORTUNITY_STAGE_CHANGE'
      OR policy.active IS NOT true
      OR policy.approver_role <> 'SALES_MANAGER'
      OR policy.conditions IS DISTINCT FROM
           '[{"field":"payload.stage","op":"in","value":["WON","LOST"]}]'::jsonb;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '032 verify V3: tenant(s) with a wrong or missing OPP-01 row: %', v_bad;
  END IF;

  -- V4 · the seed function is content-repairing (DO UPDATE), not DO NOTHING.
  v_body := app._body_sql('app.seed_opportunity_stage_policy(uuid)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'DO UPDATE') = 0 THEN
    RAISE EXCEPTION '032 verify V4: seed_opportunity_stage_policy is still DO NOTHING';
  END IF;
END
$verify$;

COMMIT;
