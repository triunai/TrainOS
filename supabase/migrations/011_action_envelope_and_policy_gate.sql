-- ============================================================================
-- Migration 011: the action envelope, policy gate, approvals, idempotency,
-- effect ledger, jury seam, and the complete GOV-07 transition registry.
-- ============================================================================
--
-- FEATURE. This is the write spine. Every action is evaluated once, logged once,
-- and dispatched to exactly one of EXECUTED, QUEUED_FOR_APPROVAL or SUGGESTED.
-- The policy input is derived from stored rows, never trusted from the payload.
--
-- OBJECTS. Eleven tables, one security-invoker view, one shared effect-status
-- enum, twenty-eight functions, the per-tenant 22-row policy catalogue seed, all
-- 22 action types, and 124 registry edges: all 121 from doc 01 s5.3 plus three
-- payment-reversal edges that section omits and 010's reversal path requires.
-- See the note at the seed; they are flagged, not smuggled.
--
-- FINDINGS CLOSED HERE, WITH THEIR MECHANICAL EVIDENCE
--
--   C-04 residue  Nothing in 011 grants anon or authenticated any table, view,
--                 sequence or function privilege. This is carried from 010,
--                 not re-derived. The verify block and test_011 inspect every
--                 relation and function created here role-by-role. Policies and
--                 client grants still land together in 014.
--   N-03          perform_action explicitly validates payload_schema itself and
--                 calls jsonb_array_elements_text(payload_schema->'required')
--                 WITHOUT the fail-open coalesce. The pin temporarily removes
--                 004's table CHECK, writes the old malformed shape, and proves
--                 the receiver still raises.
--   H-02          autonomy_grants_agents_cannot_write is AS RESTRICTIVE FOR ALL,
--                 with NOT app.is_agent() in BOTH USING and WITH CHECK. It is
--                 the one RLS policy deliberately landing before 014: the pin
--                 adds a temporary permissive policy beside it and proves the
--                 restrictive policy still wins for INSERT.
--   H-03          approval_requests receives no client INSERT grant. Assignment
--                 and decision eligibility use `x IS NOT NULL AND x <> y`; a
--                 NULL requester is refused, never treated as “different”.
--   H-04          decide_approval raises on a NULL app_role before calling the
--                 authorisation disjunction, and separately requires
--                 app.has_permission('approval:decide').
--   H-05          perform_action and decide_approval call the non-forgeable
--                 app.aal2_verified() for HUMAN money-moving actions. Contrary
--                 to the task premise, 002 does NOT create that function; 011
--                 creates it against auth.sessions, accepting either `aal` or
--                 `aal_level` and failing closed when the platform table/column
--                 is absent. It is internal and has no client EXECUTE grant.
--   H-07          enforce_state_transition checks EXECUTING/EXECUTED, target_id,
--                 and tenant with IS DISTINCT FROM. Fifteen triggers cover every
--                 one of the fifteen gated columns that actually exists in
--                 001-010; the gated columns are revoked from anon,
--                 authenticated and service_role here as doc 01 s5.1 requires.
--   H-10          The tenant timezone from public.tenants is used. Every
--                 timestamptz deadline and `now()` is converted before the date
--                 subtraction; DATE columns are already tenant-local dates and
--                 are compared to `(now() at time zone tenant.timezone)::date`.
--                 The approval view converts local midnight back with AT TIME
--                 ZONE before comparing it to timestamptz.
--   H-13/M-13     Every sweep function uses FOR UPDATE SKIP LOCKED plus LIMIT;
--                 every outer UPDATE repeats the live status predicate.
--   M-02          core.v_approval_requests is security_invoker=true at creation.
--   M-04          001's USAGE on app is load-bearing for caller-context RLS
--                 helpers. 011 does not revoke schema USAGE.
--   M-12          enforce_autonomy_ceiling raises when the action type or its
--                 ceiling cannot be read; NULL never becomes permission.
--   M-21          an identical idempotent replay returns the original body with
--                 response.status=200, irrespective of the stored original 202.
--   R14           app.effect_status is the single shared vocabulary used by the
--                 ledger and report_effect_result. The callback's exhaustive
--                 CASE raises for every enum member except SUCCEEDED/FAILED;
--                 a value outside the enum raises at its typed boundary. 012 is
--                 to reuse this enum and must not duplicate it.
--
-- EXECUTABLE-SCHEMA RULINGS (R13: the migration is fact; prose is a claim)
--
--   * 004 already owns GLOBAL app.action_types. Doc 03's surviving
--     core.action_types references are not followed.
--   * 004's value_source CHECK has no PROPOSAL member even though doc 03 uses
--     one. PROPOSAL_SEND is therefore seeded with NONE and app.action_value
--     resolves that action explicitly from core.proposals.value_sen.
--   * app.current_actor() returns (actor_id, actor_kind, role), not (id,kind,role).
--     Doc 03 also assumes app.role_holders() arrived in 002, but no applied
--     migration defines it. pick_role_holder performs the same membership and
--     permission intersection against the real 002 tables. open_approval_count
--     is still created with doc 03's claim-derived signature; cron sweeps use
--     the inline tenant count because they legitimately iterate tenants without
--     an end-user tenant claim.
--   * core.hrdc_packets has claim_reference/claim_submitted_at, not the prose's
--     submission_reference/submitted_at; engagements has closed_out_at, not
--     closed_at. Executors use the real names.
--   * The s3 executor matrix names columns/tables that 001-010 never created:
--     enquiries.archived_reason; tasks; opportunity_programmes;
--     quotations.draft_locked/rate_card_version/discount_pct/
--     approved_below_floor/approval_ref; trainer_assignments;
--     engagements.trainer_id; evaluations; collections_queue; broadcasts;
--     messages; contacts.last_contacted_at; organisations.trading_hold_at; and
--     app.ai_budgets. The nearest real relations are core.trainer_bookings,
--     core.collections_cases, core.outbound_messages and
--     core.invoice_sync_entries. 011 writes only real primary-target columns;
--     its frozen effects ledger keeps the omitted secondary/external intent
--     visible for the owning future schema instead of inventing impostor rows.
--   * TNA_RECOMMENDATION_ACCEPT targets a TNA, while the real accepted_at lives
--     on one of potentially many core.tna_recommendations and the payload has no
--     recommendation id. No arbitrary child is selected. INVOICE_CREATE likewise
--     has no line payload even though s3 says sb-money builds lines, so 011 can
--     create only the real header described by the action payload.
--   * H-07's required `target_id = NEW.id` authorises one gated row. Several s3
--     prose executors ask one action targeted at a proposal/enquiry/attendance day
--     to cross a second gated opportunity/packet row. Those secondary transitions
--     are not performed: weakening target binding to make them work would reopen
--     H-07. A future multi-target envelope must name and pin every target.
--   * core.outbound_messages cannot store DELIVERED or READ and core.rule_changes
--     cannot store WITHHELD (it has a separate `withheld` boolean). The complete
--     121-row registry is still seeded exactly as ordered; impossible edges are
--     documented facts until the owning table migration expands its vocabulary.
--   * core.agents and app.ai_budgets do not exist in 001-010. Creating truncated
--     impostors here would collide with 013, so their two future trigger
--     attachments are deliberately not fabricated. The verify count is the
--     fifteen extant gated columns, not the eventual seventeen. Tenant suspension,
--     agent membership suspension and per-action grant pause provide the kill
--     switches that the real 001-010 schema can enforce today; budget state is
--     owned by 013.
--   * A SQL PRIMARY KEY cannot contain the NULL `from_status` needed for INSERT
--     edges. core.state_transitions is therefore keyed by a UNIQUE NULLS NOT
--     DISTINCT index over the required four columns. Its `id`, `tenant_id` and
--     `updated_at` are mechanical columns required by app.finalise_table; the
--     zero tenant is a non-FK global-control sentinel and is never used to scope
--     a transition lookup.
--
-- WHAT IS DELIBERATELY NOT BUILT. No cron schedule (015 owns schedules), no event
-- or outbox table (012 owns those), no network call, no 013 agent/budget table,
-- and no 014 client policy/grant. External effects stop at typed DISPATCHED rows;
-- 012 will enqueue those rows and call report_effect_result. Jury rows likewise
-- stop at PENDING for the future worker. This is the transaction boundary doc 03
-- requires, without a forward reference that makes 011 unrunnable.
--
-- Rollback: rollbacks/011_action_envelope_and_policy_gate_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ 1 · Shared vocabulary and pure validators ══════════════════════════════

CREATE TYPE app.effect_status AS ENUM
  ('PLANNED','APPLIED','DISPATCHED','SUCCEEDED','FAILED','SETTLED','DEAD_LETTERED');

COMMENT ON TYPE app.effect_status IS
  'The single 011/012 effect seam. PLANNED/APPLIED/DISPATCHED/SETTLED/'
  'DEAD_LETTERED are ledger states; SUCCEEDED/FAILED are the only worker reports. ';

CREATE OR REPLACE FUNCTION app.is_valid_condition_set(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'array'
     AND COALESCE((
       SELECT pg_catalog.bool_and(
         e.value ? 'field'
         AND e.value ? 'op'
         AND pg_catalog.jsonb_typeof(e.value -> 'field') = 'string'
         AND pg_catalog.jsonb_typeof(e.value -> 'op') = 'string'
         AND e.value ->> 'op' IN ('eq','ne','in','gte','lte','gt','lt','contains','exists')
         AND (e.value ->> 'op' = 'exists' OR e.value ? 'value')
         AND (e.value ->> 'op' <> 'in'
              OR pg_catalog.jsonb_typeof(e.value -> 'value') = 'array')
         AND (e.value ->> 'op' NOT IN ('gte','lte','gt','lt')
              OR pg_catalog.jsonb_typeof(e.value -> 'value') = 'number')
       )
       FROM pg_catalog.jsonb_array_elements(p_value) AS e(value)
     ), true);
$fn$;

CREATE OR REPLACE FUNCTION app.autonomy_rank(p_level text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
BEGIN
  CASE p_level
    WHEN 'OBSERVE' THEN RETURN 0;
    WHEN 'SUGGEST' THEN RETURN 1;
    WHEN 'ACT_WITH_APPROVAL' THEN RETURN 2;
    WHEN 'AUTONOMOUS' THEN RETURN 3;
    ELSE
      RAISE EXCEPTION 'unknown autonomy level %L', p_level
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.jnum(p_value jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
BEGIN
  RETURN (p_value #>> '{}')::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.policy_matches(
  p_conditions jsonb,
  p_combinator text,
  p_document jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  v_condition jsonb;
  v_lhs       jsonb;
  v_rhs       jsonb;
  v_op        text;
  v_match     boolean;
  v_seen      integer := 0;
  v_any       boolean := false;
  v_all       boolean := true;
BEGIN
  IF NOT app.is_valid_condition_set(p_conditions) THEN
    RAISE EXCEPTION 'invalid policy condition set'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_combinator NOT IN ('ANY','ALL') THEN
    RAISE EXCEPTION 'unknown policy combinator %L', p_combinator
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_condition IN
    SELECT e.value FROM pg_catalog.jsonb_array_elements(p_conditions) AS e(value)
  LOOP
    v_seen := v_seen + 1;
    v_lhs := p_document #> pg_catalog.string_to_array(v_condition ->> 'field', '.');
    v_rhs := v_condition -> 'value';
    v_op := v_condition ->> 'op';

    CASE v_op
      WHEN 'eq' THEN v_match := v_lhs = v_rhs;
      WHEN 'ne' THEN v_match := v_lhs IS DISTINCT FROM v_rhs;
      WHEN 'in' THEN v_match := v_rhs @> v_lhs;
      WHEN 'gte' THEN v_match := app.jnum(v_lhs) >= app.jnum(v_rhs);
      WHEN 'lte' THEN v_match := app.jnum(v_lhs) <= app.jnum(v_rhs);
      WHEN 'gt' THEN v_match := app.jnum(v_lhs) > app.jnum(v_rhs);
      WHEN 'lt' THEN v_match := app.jnum(v_lhs) < app.jnum(v_rhs);
      WHEN 'contains' THEN
        v_match := pg_catalog.strpos(COALESCE(v_lhs #>> '{}', ''),
                                    COALESCE(v_rhs #>> '{}', '')) > 0;
      WHEN 'exists' THEN
        v_match := (v_lhs IS NOT NULL AND v_lhs <> 'null'::jsonb)
                   = COALESCE((v_rhs #>> '{}')::boolean, true);
      ELSE
        RAISE EXCEPTION 'unknown policy operator %L', v_op
          USING ERRCODE = 'invalid_parameter_value';
    END CASE;

    v_any := v_any OR COALESCE(v_match, false);
    v_all := v_all AND COALESCE(v_match, false);
  END LOOP;

  IF p_combinator = 'ALL' THEN
    RETURN CASE WHEN v_seen = 0 THEN true ELSE v_all END;
  END IF;
  RETURN CASE WHEN v_seen = 0 THEN false ELSE v_any END;
END;
$fn$;

-- 002's design document specifies this helper, but migration 002 does not
-- create it. Dynamic SQL keeps 011 executable in the bare validation shim,
-- where auth.sessions is absent, while the hosted path is grounded in the row
-- GoTrue wrote. An unknown sessions shape fails closed.
CREATE OR REPLACE FUNCTION app.aal2_verified()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_session_id uuid;
  v_result     boolean := false;
  v_rel        regclass;
BEGIN
  IF app.is_agent() THEN
    RETURN false;
  END IF;

  BEGIN
    v_session_id := NULLIF(app.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  IF v_session_id IS NULL OR (SELECT auth.uid()) IS NULL THEN
    RETURN false;
  END IF;

  v_rel := pg_catalog.to_regclass('auth.sessions');
  IF v_rel IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = v_rel AND attname = 'aal' AND attnum > 0 AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.sessions s '
         || 'WHERE s.id = $1 AND s.user_id = $2 AND s.aal::text = ''aal2'')'
      INTO v_result USING v_session_id, (SELECT auth.uid());
  ELSIF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = v_rel AND attname = 'aal_level' AND attnum > 0 AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.sessions s '
         || 'WHERE s.id = $1 AND s.user_id = $2 AND s.aal_level::text = ''aal2'')'
      INTO v_result USING v_session_id, (SELECT auth.uid());
  ELSE
    RETURN false;
  END IF;

  RETURN COALESCE(v_result, false);
END;
$fn$;

-- ═══ 2 · Gate tables ════════════════════════════════════════════════════════

CREATE TABLE core.autonomy_grants (
  id                       uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id                uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  agent_id                 text        NOT NULL,
  action_type              text        NOT NULL REFERENCES app.action_types(key) ON DELETE RESTRICT,
  level                    text        NOT NULL
                           CHECK (level IN ('OBSERVE','SUGGEST','ACT_WITH_APPROVAL','AUTONOMOUS')),
  approver_role            text        CHECK (approver_role IN ('SALES_MANAGER','OPS','FINANCE','MD','ADMIN')),
  value_threshold_sen      bigint      CHECK (value_threshold_sen IS NULL OR value_threshold_sen >= 0),
  currency                 char(3)     NOT NULL DEFAULT 'MYR',
  min_confidence           numeric(4,3) NOT NULL DEFAULT 0.700
                           CHECK (min_confidence >= 0 AND min_confidence <= 1),
  paused                   boolean     NOT NULL DEFAULT false,
  paused_at                timestamptz,
  paused_reason            text,
  resume_condition         jsonb,
  promotion_condition      jsonb,
  promoted_from_level      text CHECK (promoted_from_level IS NULL OR promoted_from_level IN
                             ('OBSERVE','SUGGEST','ACT_WITH_APPROVAL','AUTONOMOUS')),
  promoted_at              timestamptz,
  promoted_by              text,
  promotion_jury_verdict_id uuid,
  promotion_blocked_reason text,
  granted_by               text        NOT NULL,
  granted_at               timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at               timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at               timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT autonomy_grants_threshold_needs_autonomous
    CHECK (value_threshold_sen IS NULL OR level = 'AUTONOMOUS'),
  CONSTRAINT autonomy_grants_resume_shape
    CHECK (resume_condition IS NULL OR
           (pg_catalog.jsonb_typeof(resume_condition) = 'object'
            AND resume_condition ? 'metric' AND resume_condition ? 'op'
            AND resume_condition ? 'value')),
  CONSTRAINT autonomy_grants_promotion_shape
    CHECK (promotion_condition IS NULL OR
           (pg_catalog.jsonb_typeof(promotion_condition) = 'object'
            AND promotion_condition ? 'metric' AND promotion_condition ? 'op'
            AND promotion_condition ? 'value'))
);

SELECT app.finalise_table('core','autonomy_grants',false,NULL,
  ARRAY['agent_id','action_type','granted_at']);

CREATE UNIQUE INDEX autonomy_grants_lookup
  ON core.autonomy_grants (tenant_id, agent_id, action_type)
  INCLUDE (level, min_confidence, value_threshold_sen, approver_role, paused);

-- H-02. This is intentionally the sole pre-014 domain policy. It grants no
-- access by itself; it only ANDs a permanent agent-deny with whatever 014 adds.
CREATE POLICY autonomy_grants_agents_cannot_write ON core.autonomy_grants
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (NOT (SELECT app.is_agent()))
  WITH CHECK (NOT (SELECT app.is_agent()));

CREATE TABLE core.action_policies (
  id                     text        NOT NULL,
  tenant_id              uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_type            text        NOT NULL REFERENCES app.action_types(key) ON DELETE RESTRICT,
  description            text        NOT NULL,
  conditions             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  combinator             text        NOT NULL DEFAULT 'ANY' CHECK (combinator IN ('ANY','ALL')),
  approver_role          text        NOT NULL
                         CHECK (approver_role IN ('SALES_MANAGER','OPS','FINANCE','MD','ADMIN')),
  self_authorise         boolean     NOT NULL DEFAULT false,
  sla_minutes            integer     NOT NULL DEFAULT 240 CHECK (sla_minutes > 0),
  escalate_to_role       text        CHECK (escalate_to_role IS NULL OR escalate_to_role IN
                           ('SALES_MANAGER','OPS','FINANCE','MD','ADMIN')),
  escalate_after_minutes integer     CHECK (escalate_after_minutes IS NULL OR escalate_after_minutes > 0),
  expire_after_minutes   integer     NOT NULL DEFAULT 1440 CHECK (expire_after_minutes > 0),
  priority               integer     NOT NULL DEFAULT 100,
  active                 boolean     NOT NULL DEFAULT true,
  effective_from         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  effective_to           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at             timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT action_policies_conditions_valid CHECK (app.is_valid_condition_set(conditions)),
  CONSTRAINT action_policies_escalation_pair CHECK (
    (escalate_to_role IS NULL) = (escalate_after_minutes IS NULL)),
  CONSTRAINT action_policies_escalate_before_expiry CHECK (
    escalate_after_minutes IS NULL OR escalate_after_minutes < expire_after_minutes),
  CONSTRAINT action_policies_effective_order CHECK (
    effective_to IS NULL OR effective_to > effective_from)
);

SELECT app.finalise_table('core','action_policies',false,NULL,ARRAY['id','action_type']);
CREATE INDEX action_policies_by_action
  ON core.action_policies (tenant_id, action_type, priority) WHERE active;

CREATE TABLE core.action_requests (
  id                  uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                 text,
  action_type         text        NOT NULL REFERENCES app.action_types(key) ON DELETE RESTRICT,
  target_ref          text,
  target_entity       text,
  target_id           uuid,
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  value_sen           bigint,
  currency            char(3),
  requested_by_kind   text        NOT NULL CHECK (requested_by_kind IN ('HUMAN','AGENT','SYSTEM','CLIENT')),
  requested_by_id     text        NOT NULL,
  requested_by_role   text,
  agent_run_id        text,
  confidence          numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  reasoning           text,
  evidence            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  context_flags       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  autonomy_level      text        CHECK (autonomy_level IS NULL OR autonomy_level IN
                            ('OBSERVE','SUGGEST','ACT_WITH_APPROVAL','AUTONOMOUS','SELF_AUTHORISED')),
  granted_level       text        CHECK (granted_level IS NULL OR granted_level IN
                            ('OBSERVE','SUGGEST','ACT_WITH_APPROVAL','AUTONOMOUS')),
  matched_policy_id   text,
  evaluation_trace    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status              text        NOT NULL CHECK (status IN
                            ('EXECUTING','EXECUTED','PARTIALLY_FAILED','QUEUED_FOR_APPROVAL',
                             'SUGGESTED','REJECTED','FAILED')),
  effects             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  effects_hash        text,
  approval_request_id uuid,
  suggested_draft_id  uuid,
  error_code          text,
  error_details       jsonb,
  idempotency_key_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at          timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at        timestamptz,
  CONSTRAINT action_requests_payload_shape CHECK (
    pg_catalog.jsonb_typeof(payload) = 'object'
    AND (payload = '{}'::jsonb OR payload ?| ARRAY[
      'reason','channel','amount','stage','agentId','actionType','level','requestedCap',
      'claimReference','id','organisationId','engagementId','body','category','runId',
      'status','sellPriceSen','discountAuthorityExceeded','resultingMarginRate',
      'method','externalReference','contactId','approverRole','valueThresholdSen',
      'minConfidence'])),
  CONSTRAINT action_requests_evidence_shape CHECK (
    pg_catalog.jsonb_typeof(evidence) = 'array'
    AND (pg_catalog.jsonb_array_length(evidence) = 0 OR
         ((evidence -> 0) ? 'type' AND (evidence -> 0) ? 'ref'))),
  CONSTRAINT action_requests_context_shape CHECK (
    pg_catalog.jsonb_typeof(context_flags) = 'object'
    AND (context_flags = '{}'::jsonb OR context_flags ?| ARRAY[
      'firstProposalToOrg','belowFloorPrice','overdueBalanceOnAccount','attendanceLocked',
      'deadlineWithinDays','consentWithdrawn','packetIncomplete','claimReferenceExists',
      'firstOfKind','paymentAmountMatchesOutstanding','discountAuthorityExceeded',
      'resultingMarginRate'])),
  CONSTRAINT action_requests_trace_shape CHECK (
    pg_catalog.jsonb_typeof(evaluation_trace) = 'array'
    AND (pg_catalog.jsonb_array_length(evaluation_trace) = 0 OR
         ((evaluation_trace -> 0) ? 'step' AND (evaluation_trace -> 0) ? 'input'))),
  CONSTRAINT action_requests_effects_shape CHECK (
    pg_catalog.jsonb_typeof(effects) = 'array'
    AND (pg_catalog.jsonb_array_length(effects) = 0 OR
         ((effects -> 0) ? 'op' AND (effects -> 0) ? 'entity'
          AND (effects -> 0) ? 'description'))),
  CONSTRAINT action_requests_error_shape CHECK (
    error_details IS NULL OR
    (pg_catalog.jsonb_typeof(error_details) = 'object' AND error_details ? 'code'))
);

SELECT app.finalise_table('core','action_requests',true,'ACT',ARRAY['action_type','requested_by_id']);
CREATE INDEX action_requests_by_type
  ON core.action_requests (tenant_id, action_type, created_at DESC);
CREATE INDEX action_requests_by_target
  ON core.action_requests (tenant_id, target_ref, created_at DESC) WHERE target_ref IS NOT NULL;
CREATE INDEX action_requests_by_run
  ON core.action_requests (tenant_id, agent_run_id) WHERE agent_run_id IS NOT NULL;
CREATE INDEX action_requests_executed
  ON core.action_requests (tenant_id, action_type, completed_at)
  WHERE status IN ('EXECUTED','PARTIALLY_FAILED');
CREATE INDEX action_requests_executing
  ON core.action_requests (tenant_id, created_at) WHERE status = 'EXECUTING';

CREATE TABLE app.action_effects (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  action_request_id uuid        NOT NULL,
  seq               integer     NOT NULL CHECK (seq > 0),
  op                text        NOT NULL CHECK (op IN ('ADD','UPDATE','REMOVE')),
  entity            text        NOT NULL,
  ref               text,
  description       text        NOT NULL,
  kind              text        NOT NULL CHECK (kind IN ('IN_DATABASE','EXTERNAL')),
  status            app.effect_status NOT NULL DEFAULT 'PLANNED',
  job_id            uuid,
  job_key           text,
  attempts          integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retryable         boolean     NOT NULL DEFAULT true,
  last_error        jsonb,
  applied_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (action_request_id, seq),
  UNIQUE (tenant_id, job_key),
  CONSTRAINT action_effects_request_fk FOREIGN KEY (tenant_id, action_request_id)
    REFERENCES core.action_requests (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT action_effects_ledger_status_only CHECK (
    status NOT IN ('SUCCEEDED','FAILED')),
  CONSTRAINT action_effects_last_error_shape CHECK (
    last_error IS NULL OR
    (pg_catalog.jsonb_typeof(last_error) = 'object'
     AND last_error ? 'code' AND last_error ? 'message' AND last_error ? 'retryable'))
);

SELECT app.finalise_table('app','action_effects',false,NULL,
  ARRAY['action_request_id','seq','op','entity','kind']);
CREATE INDEX action_effects_open ON app.action_effects (tenant_id, status, id)
  WHERE status IN ('PLANNED','DISPATCHED');

CREATE TABLE core.approval_requests (
  id                  uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                 text,
  action_request_id   uuid        NOT NULL,
  policy_id           text        NOT NULL,
  action_type         text        NOT NULL REFERENCES app.action_types(key) ON DELETE RESTRICT,
  subject             text        NOT NULL,
  target_ref          text,
  value_sen           bigint,
  currency            char(3),
  margin_rate         numeric(6,4),
  requested_by_kind   text        NOT NULL CHECK (requested_by_kind IN ('HUMAN','AGENT','SYSTEM','CLIENT')),
  -- Nullable only so the decision-side fraud backstop can fail closed over
  -- legacy/corrupt rows. perform_action never writes NULL here.
  requested_by_id     text,
  requested_by_name   text,
  agent_run_id        text,
  confidence          numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  autonomy            text,
  reason              text        NOT NULL,
  recommendation      jsonb,
  evidence            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  deviations          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  risk                jsonb,
  diff                jsonb       NOT NULL,
  diff_hash           text        NOT NULL,
  preview_url         text,
  approver_role       text        NOT NULL CHECK (approver_role IN
                            ('SALES_MANAGER','OPS','FINANCE','MD','ADMIN')),
  assigned_to_id      text,
  assigned_to_name    text,
  sla_due_at          timestamptz NOT NULL,
  escalate_at         timestamptz,
  escalated_at        timestamptz,
  escalated_to_role   text,
  expires_at          timestamptz NOT NULL,
  breach_notified_at  timestamptz,
  bulk_approvable     boolean     NOT NULL,
  status              text        NOT NULL DEFAULT 'PENDING' CHECK (status IN
                            ('PENDING','APPROVED','CHANGES_REQUESTED','REJECTED','EXPIRED')),
  decision            text        CHECK (decision IN ('APPROVE','REQUEST_CHANGES','REJECT')),
  decision_note       text,
  decided_by_id       text,
  decided_by_name     text,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at          timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT approval_requests_action_fk FOREIGN KEY (tenant_id, action_request_id)
    REFERENCES core.action_requests (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT approval_requests_decided_fields CHECK (
    (status = 'PENDING' AND decision IS NULL AND decided_at IS NULL)
    OR (status = 'EXPIRED' AND decision IS NULL)
    OR (status IN ('APPROVED','CHANGES_REQUESTED','REJECTED')
        AND decision IS NOT NULL AND decided_by_id IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT approval_requests_note_required CHECK (
    decision IS NULL OR decision = 'APPROVE'
    OR NULLIF(pg_catalog.btrim(decision_note), '') IS NOT NULL),
  CONSTRAINT approval_requests_recommendation_shape CHECK (
    recommendation IS NULL OR
    (pg_catalog.jsonb_typeof(recommendation) = 'object'
     AND recommendation ? 'verdict' AND recommendation ? 'rationale')),
  CONSTRAINT approval_requests_risk_shape CHECK (
    risk IS NULL OR
    (pg_catalog.jsonb_typeof(risk) = 'object' AND risk ? 'level' AND risk ? 'note')),
  CONSTRAINT approval_requests_evidence_shape CHECK (
    pg_catalog.jsonb_typeof(evidence) = 'array'
    AND (pg_catalog.jsonb_array_length(evidence) = 0 OR
         ((evidence -> 0) ? 'type' AND (evidence -> 0) ? 'ref'))),
  CONSTRAINT approval_requests_deviations_shape CHECK (
    pg_catalog.jsonb_typeof(deviations) = 'array'
    AND (pg_catalog.jsonb_array_length(deviations) = 0 OR (deviations -> 0) IS NOT NULL)),
  CONSTRAINT approval_requests_diff_shape CHECK (
    pg_catalog.jsonb_typeof(diff) = 'array'
    AND (pg_catalog.jsonb_array_length(diff) = 0 OR
         ((diff -> 0) ? 'op' AND (diff -> 0) ? 'entity' AND (diff -> 0) ? 'description')))
);

SELECT app.finalise_table('core','approval_requests',true,'APV',ARRAY['action_request_id']);
CREATE INDEX approval_requests_queue ON core.approval_requests
  (tenant_id, approver_role, sla_due_at) WHERE status = 'PENDING';
CREATE INDEX approval_requests_assigned ON core.approval_requests
  (tenant_id, assigned_to_id, sla_due_at) WHERE status = 'PENDING';
CREATE INDEX approval_requests_due ON core.approval_requests (sla_due_at)
  WHERE status = 'PENDING';
CREATE INDEX approval_requests_escalation ON core.approval_requests (escalate_at)
  WHERE status = 'PENDING' AND escalated_at IS NULL;
CREATE UNIQUE INDEX approval_requests_one_open_per_action
  ON core.approval_requests (action_request_id) WHERE status = 'PENDING';

CREATE TABLE core.approval_decisions (
  id                    uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  approval_request_id   uuid        NOT NULL,
  decision              text        NOT NULL CHECK (decision IN ('APPROVE','REQUEST_CHANGES','REJECT')),
  note                  text,
  decided_by_id         text        NOT NULL,
  decided_by_name       text,
  decided_by_role       text        NOT NULL,
  via_bulk              boolean     NOT NULL DEFAULT false,
  diff_hash_at_decision text        NOT NULL,
  decided_at            timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at            timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at            timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT approval_decisions_request_fk FOREIGN KEY (tenant_id, approval_request_id)
    REFERENCES core.approval_requests (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT approval_decisions_note_required CHECK (
    decision = 'APPROVE' OR NULLIF(pg_catalog.btrim(note), '') IS NOT NULL)
);

SELECT app.finalise_table('core','approval_decisions',false,NULL,
  ARRAY['approval_request_id','decision','decided_by_id','decided_at']);
CREATE INDEX approval_decisions_by_request
  ON core.approval_decisions (tenant_id, approval_request_id, decided_at DESC);
CREATE INDEX approval_decisions_recent
  ON core.approval_decisions (tenant_id, decided_at DESC);

CREATE TABLE app.idempotency_keys (
  id                uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id          text        NOT NULL,
  endpoint          text        NOT NULL,
  key               text        NOT NULL,
  request_hash      text        NOT NULL,
  state             text        NOT NULL DEFAULT 'IN_FLIGHT' CHECK (state IN ('IN_FLIGHT','COMPLETED')),
  status_code       integer,
  response          jsonb,
  action_request_id uuid,
  locked_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at      timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT (pg_catalog.now() + interval '24 hours'),
  created_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (tenant_id, actor_id, endpoint, key),
  CONSTRAINT idempotency_keys_response_shape CHECK (
    response IS NULL OR
    (pg_catalog.jsonb_typeof(response) = 'object'
     AND (response ? 'status'
          OR (response ? 'data' AND response ? 'count'
              AND pg_catalog.jsonb_typeof(response -> 'data') = 'array'
              AND pg_catalog.jsonb_typeof(response -> 'count') = 'number')))),
  CONSTRAINT idempotency_keys_completion_pair CHECK (
    (state = 'IN_FLIGHT' AND completed_at IS NULL AND response IS NULL)
    OR (state = 'COMPLETED' AND completed_at IS NOT NULL AND response IS NOT NULL))
);

SELECT app.finalise_table('app','idempotency_keys',false,NULL,
  ARRAY['actor_id','endpoint','key','request_hash']);
CREATE INDEX idempotency_keys_expiry ON app.idempotency_keys (expires_at);

CREATE TABLE core.suggested_drafts (
  id                         uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id                  uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref                        text,
  action_request_id          uuid        NOT NULL,
  action_type                text        NOT NULL REFERENCES app.action_types(key) ON DELETE RESTRICT,
  target_ref                 text,
  body                       text,
  payload                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  planned_effects            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  provenance                 jsonb       NOT NULL,
  status                     text        NOT NULL DEFAULT 'OPEN'
                             CHECK (status IN ('OPEN','ACCEPTED','DISMISSED','EXPIRED')),
  accepted_action_request_id uuid,
  dismissed_reason           text,
  expires_at                 timestamptz NOT NULL DEFAULT (pg_catalog.now() + interval '7 days'),
  created_at                 timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at                 timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT suggested_drafts_action_fk FOREIGN KEY (tenant_id, action_request_id)
    REFERENCES core.action_requests (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT suggested_drafts_accepted_action_fk FOREIGN KEY (tenant_id, accepted_action_request_id)
    REFERENCES core.action_requests (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT suggested_drafts_payload_shape CHECK (
    pg_catalog.jsonb_typeof(payload) = 'object'
    AND (payload = '{}'::jsonb OR payload ?| ARRAY[
      'reason','channel','amount','stage','agentId','actionType','level','requestedCap',
      'claimReference','id','organisationId','engagementId','body','category','runId',
      'status','sellPriceSen','discountAuthorityExceeded','resultingMarginRate',
      'method','externalReference','contactId','approverRole','valueThresholdSen',
      'minConfidence'])),
  CONSTRAINT suggested_drafts_effects_shape CHECK (
    pg_catalog.jsonb_typeof(planned_effects) = 'array'
    AND (pg_catalog.jsonb_array_length(planned_effects) = 0 OR
         ((planned_effects -> 0) ? 'op' AND (planned_effects -> 0) ? 'entity'
          AND (planned_effects -> 0) ? 'description'))),
  CONSTRAINT suggested_drafts_provenance_shape CHECK (
    pg_catalog.jsonb_typeof(provenance) = 'object'
    AND provenance ? 'origin' AND provenance ? 'generatedAt')
);

SELECT app.finalise_table('core','suggested_drafts',true,'DRF',ARRAY['action_request_id']);
CREATE INDEX suggested_drafts_open ON core.suggested_drafts
  (tenant_id, action_type, expires_at) WHERE status = 'OPEN';

CREATE TABLE core.jury_configs (
  id                       uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id                uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_type              text        NOT NULL REFERENCES app.action_types(key) ON DELETE RESTRICT,
  mode                     text        NOT NULL CHECK (mode IN ('GATE','SAMPLE','ESCALATE')),
  quorum                   integer     NOT NULL DEFAULT 2,
  "of"                     integer     NOT NULL DEFAULT 3,
  tiers                    text[]      NOT NULL DEFAULT ARRAY['STRONG_1','STRONG_2','STRONG_3'],
  sample_rate              numeric(4,3) CHECK (sample_rate IS NULL OR sample_rate BETWEEN 0 AND 1),
  trigger_min_confidence   numeric(4,3) CHECK (trigger_min_confidence IS NULL
                                                OR trigger_min_confidence BETWEEN 0 AND 1),
  trigger_max_value_sen    bigint      CHECK (trigger_max_value_sen IS NULL
                                                OR trigger_max_value_sen >= 0),
  trigger_first_of_kind    boolean     NOT NULL DEFAULT false,
  active                   boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at               timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (tenant_id, action_type),
  CONSTRAINT jury_configs_quorum_sane CHECK (quorum >= 1 AND quorum <= "of" AND "of" <= 5),
  CONSTRAINT jury_configs_sample_rate_needs_sample CHECK (mode <> 'SAMPLE' OR sample_rate IS NOT NULL)
);

SELECT app.finalise_table('core','jury_configs',false,NULL,ARRAY['action_type']);

CREATE TABLE core.jury_verdicts (
  id                  uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  action_request_id   uuid,
  approval_request_id uuid,
  autonomy_grant_id   uuid,
  mode                text        NOT NULL CHECK (mode IN ('GATE','SAMPLE','ESCALATE')),
  trigger_reason      text        CHECK (trigger_reason IS NULL OR trigger_reason IN
                            ('LOW_CONFIDENCE','HIGH_VALUE','FIRST_OF_KIND','SAMPLED','PROMOTION')),
  quorum              integer     NOT NULL,
  "of"                integer     NOT NULL,
  tiers               text[]      NOT NULL,
  golden_set_id       text,
  opinions            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  verdict             text        CHECK (verdict IS NULL OR verdict IN ('AGREE','DISAGREE','INCONCLUSIVE')),
  dissenters          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  cost_sen            bigint      CHECK (cost_sen IS NULL OR cost_sen >= 0),
  job_id              uuid,
  status              text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETE','FAILED')),
  created_at          timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at          timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at        timestamptz,
  CONSTRAINT jury_verdicts_action_fk FOREIGN KEY (tenant_id, action_request_id)
    REFERENCES core.action_requests (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT jury_verdicts_approval_fk FOREIGN KEY (tenant_id, approval_request_id)
    REFERENCES core.approval_requests (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT jury_verdicts_grant_fk FOREIGN KEY (tenant_id, autonomy_grant_id)
    REFERENCES core.autonomy_grants (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT jury_verdicts_opinions_shape CHECK (
    pg_catalog.jsonb_typeof(opinions) = 'array'
    AND (pg_catalog.jsonb_array_length(opinions) = 0 OR
         ((opinions -> 0) ? 'tier' AND (opinions -> 0) ? 'verdict'
          AND (opinions -> 0) ? 'confidence' AND (opinions -> 0) ? 'rationale'))),
  CONSTRAINT jury_verdicts_dissenters_shape CHECK (
    pg_catalog.jsonb_typeof(dissenters) = 'array'
    AND (pg_catalog.jsonb_array_length(dissenters) = 0 OR (dissenters -> 0) ? 'tier'))
);

SELECT app.finalise_table('core','jury_verdicts',false,NULL,
  ARRAY['mode','created_at']);
CREATE INDEX jury_verdicts_pending ON core.jury_verdicts
  (tenant_id, status, created_at) WHERE status = 'PENDING';
CREATE UNIQUE INDEX jury_verdicts_one_mode_per_approval
  ON core.jury_verdicts (approval_request_id,mode)
  WHERE approval_request_id IS NOT NULL;

-- Global control data, mechanically finalised as explained in the header.
CREATE TABLE core.state_transitions (
  id           uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id    uuid        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  entity       text        NOT NULL,
  column_name  text        NOT NULL DEFAULT 'status',
  from_status  text,
  to_status    text        NOT NULL,
  gated_by     text[],
  created_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT state_transitions_gate_shape CHECK (
    gated_by IS NULL OR pg_catalog.cardinality(gated_by) > 0)
);

SELECT app.finalise_table('core','state_transitions',false,NULL,
  ARRAY['entity','column_name','from_status','to_status']);
CREATE UNIQUE INDEX state_transitions_edge_key
  ON core.state_transitions (entity, column_name, from_status, to_status) NULLS NOT DISTINCT;
CREATE INDEX state_transitions_lookup
  ON core.state_transitions (entity, column_name, from_status, to_status);

-- Close the three forward references 007/010 deliberately left for this pack.
ALTER TABLE core.quotations
  ADD CONSTRAINT quotations_discount_action_fk
  FOREIGN KEY (tenant_id, discount_approval_id)
  REFERENCES core.action_requests (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE core.collections_cases
  ADD CONSTRAINT collections_cases_trading_hold_action_fk
  FOREIGN KEY (tenant_id, trading_hold_action_id)
  REFERENCES core.action_requests (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE core.action_requests
  ADD CONSTRAINT action_requests_approval_fk
    FOREIGN KEY (tenant_id, approval_request_id)
    REFERENCES core.approval_requests (tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT action_requests_draft_fk
    FOREIGN KEY (tenant_id, suggested_draft_id)
    REFERENCES core.suggested_drafts (tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT action_requests_idempotency_fk
    FOREIGN KEY (tenant_id, idempotency_key_id)
    REFERENCES app.idempotency_keys (tenant_id, id)
    ON DELETE SET NULL (idempotency_key_id);

ALTER TABLE app.idempotency_keys
  ADD CONSTRAINT idempotency_keys_action_fk
  FOREIGN KEY (tenant_id, action_request_id)
  REFERENCES core.action_requests (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE core.autonomy_grants
  ADD CONSTRAINT autonomy_grants_jury_fk
  FOREIGN KEY (tenant_id, promotion_jury_verdict_id)
  REFERENCES core.jury_verdicts (tenant_id, id) ON DELETE RESTRICT;

-- ═══ 3 · Catalogue seeds ════════════════════════════════════════════════════

INSERT INTO app.action_types
  (key,label,domain,money_moving,client_facing,hrdc_touching,reversible,
   ceiling_autonomy,ceiling_reason,target_entity,payload_schema,value_source)
VALUES
  ('ENQUIRY_ARCHIVE','Archive enquiry','SALES',false,false,false,true,
   'AUTONOMOUS','NONE','enquiry','{"required":[]}'::jsonb,'NONE'),
  ('OPPORTUNITY_CONVERT','Convert opportunity','SALES',false,false,false,true,
   'AUTONOMOUS','NONE','enquiry','{"required":[]}'::jsonb,'NONE'),
  ('TNA_RECOMMENDATION_ACCEPT','Accept TNA recommendation','SALES',false,false,false,true,
   'AUTONOMOUS','NONE','tna','{"required":[]}'::jsonb,'NONE'),
  ('PROPOSAL_SEND','Send proposal','SALES',false,true,false,false,
   'ACT_WITH_APPROVAL','CLIENT_COMMITMENT','proposal','{"required":["channel"]}'::jsonb,'NONE'),
  ('QUOTATION_APPLY','Apply quotation','SALES',true,false,false,true,
   'ACT_WITH_APPROVAL','MONEY_MOVING','quotation','{"required":[]}'::jsonb,'QUOTATION'),
  ('DISCOUNT_APPROVE','Approve discount','SALES',true,false,false,true,
   'ACT_WITH_APPROVAL','MONEY_MOVING','quotation','{"required":[]}'::jsonb,'QUOTATION'),
  ('TRAINER_BOOK','Book trainer','OPS',true,false,false,true,
   'ACT_WITH_APPROVAL','MONEY_MOVING','trainer_booking','{"required":[]}'::jsonb,'NONE'),
  ('ENGAGEMENT_CLOSE_OUT','Close engagement','OPS',false,true,true,false,
   'ACT_WITH_APPROVAL','HRDC_STATE','engagement','{"required":[]}'::jsonb,'NONE'),
  ('ATTENDANCE_APPROVE','Approve attendance','COMPLIANCE',false,false,true,false,
   'ACT_WITH_APPROVAL','HRDC_STATE','attendance_day','{"required":[]}'::jsonb,'NONE'),
  ('ATTENDANCE_UNLOCK','Unlock attendance','COMPLIANCE',false,false,true,true,
   'ACT_WITH_APPROVAL','HRDC_STATE','attendance_day','{"required":["reason"]}'::jsonb,'NONE'),
  ('HRDC_PACKET_MARK_SUBMITTED','Mark HRDC packet submitted','COMPLIANCE',false,false,true,false,
   'ACT_WITH_APPROVAL','HRDC_STATE','hrdc_packet','{"required":["claimReference"]}'::jsonb,'HRDC_CLAIM'),
  ('INVOICE_CREATE','Create invoice','FINANCE',true,true,false,true,
   'ACT_WITH_APPROVAL','MONEY_MOVING','invoice','{"required":["id","organisationId"]}'::jsonb,'INVOICE'),
  ('INVOICE_PUSH','Push invoice','FINANCE',true,true,false,true,
   'ACT_WITH_APPROVAL','MONEY_MOVING','invoice','{"required":[]}'::jsonb,'INVOICE'),
  ('PAYMENT_RECORD','Record payment','FINANCE',true,false,false,true,
   'ACT_WITH_APPROVAL','MONEY_MOVING','invoice','{"required":["amount"]}'::jsonb,'PAYMENT'),
  ('REMINDER_SEND','Send reminder','FINANCE',false,true,false,true,
   'ACT_WITH_APPROVAL','CLIENT_COMMITMENT','collections_case','{"required":["stage"]}'::jsonb,'NONE'),
  ('FOLLOWUP_SEND','Send follow-up','SALES',false,true,false,true,
   'ACT_WITH_APPROVAL','CLIENT_COMMITMENT','follow_up','{"required":["channel"]}'::jsonb,'NONE'),
  ('BROADCAST_SEND','Send broadcast','SALES',false,true,false,false,
   'ACT_WITH_APPROVAL','CLIENT_COMMITMENT','broadcast','{"required":["channel"]}'::jsonb,'NONE'),
  ('AGENT_AUTONOMY_CHANGE','Change agent autonomy','GOVERNANCE',false,false,false,true,
   'ACT_WITH_APPROVAL','SAFETY','autonomy_grant',
   '{"required":["agentId","actionType","level"]}'::jsonb,'NONE'),
  ('AGENT_PAUSE','Pause agent','GOVERNANCE',false,false,false,true,
   'AUTONOMOUS','SAFETY','agent','{"required":["agentId"]}'::jsonb,'NONE'),
  ('BUDGET_CAP_RAISE','Raise budget cap','GOVERNANCE',true,false,false,true,
   'ACT_WITH_APPROVAL','MONEY_MOVING','ai_budget','{"required":["requestedCap"]}'::jsonb,'BUDGET_CAP'),
  ('RULE_CHANGE_APPROVE','Approve rule change','COMPLIANCE',false,false,true,false,
   'ACT_WITH_APPROVAL','HRDC_STATE','rule_change','{"required":[]}'::jsonb,'NONE'),
  ('ACCOUNT_TRADING_HOLD','Place account trading hold','FINANCE',true,true,false,true,
   'ACT_WITH_APPROVAL','MONEY_MOVING','collections_case','{"required":[]}'::jsonb,'NONE');

-- Twenty-two catalogue rows per tenant. The AFTER INSERT trigger makes the seed
-- true for tenants provisioned after migrations have run; the backfill below
-- handles tenants that already exist.
CREATE OR REPLACE FUNCTION app.seed_action_policies(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  -- `expire_after_minutes` is listed explicitly rather than left to the column
  -- DEFAULT of 1440. It was omitted in the draft, and CMP-05 — SLA 24 h,
  -- escalate at 48 h, following the 2x-SLA pattern its siblings use — then took
  -- the 1440 default and violated the table's own
  -- `escalate_after_minutes < expire_after_minutes` CHECK: the escalation would
  -- have been scheduled for a day after the approval had already expired, which
  -- is H-13's failure shape arriving through the seed instead of through the
  -- sweep. Every row now states both numbers, so the relationship between them
  -- is visible at the row rather than assembled from a default somewhere else.
  INSERT INTO core.action_policies
    (tenant_id,id,action_type,description,conditions,combinator,approver_role,
     sla_minutes,escalate_to_role,escalate_after_minutes,expire_after_minutes,
     priority,active)
  VALUES
    (p_tenant_id,'APV-01','PROPOSAL_SEND',
     'Proposal send above RM 15,000 or first proposal to an organisation',
     '[{"field":"value.amount","op":"gte","value":1500000},
       {"field":"context.firstProposalToOrg","op":"eq","value":true}]','ANY',
     'SALES_MANAGER',240,'MD',360,1440,100,true),
    (p_tenant_id,'APV-02','DISCOUNT_APPROVE','Quotation is below its binding floor',
     '[{"field":"context.belowFloorPrice","op":"eq","value":true}]','ANY',
     'SALES_MANAGER',240,'MD',360,1440,100,true),
    (p_tenant_id,'APV-03','DISCOUNT_APPROVE','Resulting margin is below half the floor margin',
     '[{"field":"context.resultingMarginRate","op":"lt","value":0.175}]','ANY',
     'MD',240,NULL,NULL,1440,50,true),
    (p_tenant_id,'APV-04','QUOTATION_APPLY','Discount exceeds requester authority',
     '[{"field":"context.discountAuthorityExceeded","op":"eq","value":true}]','ANY',
     'SALES_MANAGER',240,'MD',360,1440,100,true),
    (p_tenant_id,'APV-05','TRAINER_BOOK','Trainer booking always needs operations approval',
     '[]','ALL','OPS',480,'MD',720,1440,100,true),
    (p_tenant_id,'APV-06','ENGAGEMENT_CLOSE_OUT','Attendance unlocked or packet incomplete',
     '[{"field":"context.attendanceLocked","op":"eq","value":false},
       {"field":"context.packetIncomplete","op":"eq","value":true}]','ANY',
     'OPS',480,NULL,NULL,1440,100,true),
    (p_tenant_id,'APV-07','BROADCAST_SEND','Broadcasts always need approval',
     '[]','ALL','SALES_MANAGER',240,'MD',360,1440,100,true),
    (p_tenant_id,'APV-08','FOLLOWUP_SEND','Marketing follow-up needs approval',
     '[{"field":"payload.category","op":"eq","value":"MARKETING"}]','ANY',
     'SALES_MANAGER',240,NULL,NULL,1440,100,true),
    (p_tenant_id,'FIN-01','INVOICE_CREATE','Invoice creation always needs finance approval',
     '[]','ALL','FINANCE',240,'MD',360,1440,100,true),
    (p_tenant_id,'FIN-02','INVOICE_PUSH','Invoice push always needs finance approval',
     '[]','ALL','FINANCE',240,'MD',360,1440,100,true),
    (p_tenant_id,'FIN-03','REMINDER_SEND','First and second reminders need finance approval',
     '[{"field":"payload.stage","op":"in","value":["REMINDER_1","REMINDER_2"]}]','ANY',
     'FINANCE',240,NULL,NULL,1440,100,true),
    (p_tenant_id,'FIN-04','REMINDER_SEND','Third reminder is always human',
     '[{"field":"payload.stage","op":"eq","value":"REMINDER_3"}]','ANY',
     'FINANCE',240,'MD',360,1440,50,true),
    (p_tenant_id,'FIN-05','ACCOUNT_TRADING_HOLD','Trading hold always needs MD approval',
     '[]','ALL','MD',480,NULL,NULL,1440,100,true),
    (p_tenant_id,'FIN-06','PAYMENT_RECORD','Write-off or overpayment needs finance approval',
     '[{"field":"context.paymentAmountMatchesOutstanding","op":"eq","value":false}]','ANY',
     'FINANCE',240,NULL,NULL,1440,100,true),
    (p_tenant_id,'FIN-07','BUDGET_CAP_RAISE','Budget cap raise always needs MD approval',
     '[]','ALL','MD',480,NULL,NULL,1440,100,true),
    (p_tenant_id,'CMP-01','ATTENDANCE_APPROVE','Attendance lock always needs operations approval',
     '[]','ALL','OPS',240,NULL,NULL,1440,100,true),
    (p_tenant_id,'CMP-02','ATTENDANCE_UNLOCK','Attendance unlock needs finance approval',
     '[]','ALL','FINANCE',120,'MD',240,1440,100,true),
    (p_tenant_id,'CMP-03','ATTENDANCE_UNLOCK','Claim reference requires MD approval to unlock',
     '[{"field":"context.claimReferenceExists","op":"eq","value":true}]','ANY',
     'MD',120,NULL,NULL,1440,50,true),
    (p_tenant_id,'CMP-04','HRDC_PACKET_MARK_SUBMITTED','HRDC submission needs finance approval',
     '[]','ALL','FINANCE',240,NULL,NULL,1440,100,true),
    (p_tenant_id,'CMP-05','RULE_CHANGE_APPROVE','Rule change needs finance approval',
     '[]','ALL','FINANCE',1440,'ADMIN',2880,5760,100,true),
    (p_tenant_id,'GOV-01','AGENT_AUTONOMY_CHANGE','Autonomy change always needs MD approval',
     '[]','ALL','MD',1440,NULL,NULL,1440,100,true),
    -- A catalogue marker, deliberately inactive: AGENT_PAUSE is hard-exempt in
    -- perform_action and must never be intercepted by a configurable row.
    (p_tenant_id,'GOV-02','AGENT_PAUSE','Stopping an agent is never policy-gated',
     '[]','ALL','MD',1,NULL,NULL,1440,100,false)
  ON CONFLICT (tenant_id,id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.seed_action_policies_on_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM app.seed_action_policies(NEW.id);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_tenants_seed_action_policies ON public.tenants;
CREATE TRIGGER trg_tenants_seed_action_policies
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app.seed_action_policies_on_tenant();

SELECT app.seed_action_policies(t.id) FROM public.tenants AS t;

-- Doc 01 s5.3 in full (121 rows) plus three reversal edges it omits: 124 rows,
-- counted and asserted below. The three are marked in place with their evidence.
INSERT INTO core.state_transitions (entity,column_name,from_status,to_status,gated_by)
VALUES
  ('enquiries','status',NULL,'OPEN',NULL),
  ('enquiries','status','OPEN','ASSIGNED',NULL),
  ('enquiries','status','ASSIGNED','OPEN',NULL),
  ('enquiries','status','OPEN','CONVERTED',ARRAY['OPPORTUNITY_CONVERT']),
  ('enquiries','status','ASSIGNED','CONVERTED',ARRAY['OPPORTUNITY_CONVERT']),
  ('enquiries','status','OPEN','ARCHIVED',ARRAY['ENQUIRY_ARCHIVE']),
  ('enquiries','status','ASSIGNED','ARCHIVED',ARRAY['ENQUIRY_ARCHIVE']),
  ('enquiries','status','OPEN','NOT_AN_ENQUIRY',ARRAY['ENQUIRY_ARCHIVE']),
  ('enquiries','status','ARCHIVED','OPEN',NULL),
  ('opportunities','stage',NULL,'NEW',NULL),
  ('opportunities','stage',NULL,'QUALIFYING',ARRAY['OPPORTUNITY_CONVERT']),
  ('opportunities','stage','NEW','QUALIFYING',NULL),
  ('opportunities','stage','QUALIFYING','TNA_SENT',NULL),
  ('opportunities','stage','TNA_SENT','QUALIFYING',NULL),
  ('opportunities','stage','QUALIFYING','PROPOSAL_SENT',ARRAY['PROPOSAL_SEND']),
  ('opportunities','stage','TNA_SENT','PROPOSAL_SENT',ARRAY['PROPOSAL_SEND']),
  ('opportunities','stage','PROPOSAL_SENT','NEGOTIATION',NULL),
  ('opportunities','stage','NEGOTIATION','PROPOSAL_SENT',ARRAY['PROPOSAL_SEND']),
  ('opportunities','stage','PROPOSAL_SENT','WON',NULL),
  ('opportunities','stage','NEGOTIATION','WON',NULL),
  ('opportunities','stage','NEW','LOST',NULL),
  ('opportunities','stage','QUALIFYING','LOST',NULL),
  ('opportunities','stage','TNA_SENT','LOST',NULL),
  ('opportunities','stage','PROPOSAL_SENT','LOST',NULL),
  ('opportunities','stage','NEGOTIATION','LOST',NULL),
  ('tnas','status',NULL,'DRAFT',NULL),
  ('tnas','status','DRAFT','SENT',NULL),
  ('tnas','status','SENT','DRAFT',NULL),
  ('tnas','status','SENT','COMPLETE',NULL),
  ('tnas','status','COMPLETE','REOPENED',NULL),
  ('tnas','status','REOPENED','COMPLETE',NULL),
  ('proposals','status',NULL,'DRAFT',NULL),
  ('proposals','status','DRAFT','AWAITING_APPROVAL',ARRAY['PROPOSAL_SEND']),
  ('proposals','status','AWAITING_APPROVAL','DRAFT',NULL),
  ('proposals','status','AWAITING_APPROVAL','SENT',ARRAY['PROPOSAL_SEND']),
  ('proposals','status','DRAFT','SENT',ARRAY['PROPOSAL_SEND']),
  ('proposals','status','SENT','VIEWED',NULL),
  ('proposals','status','SENT','ACCEPTED',NULL),
  ('proposals','status','VIEWED','ACCEPTED',NULL),
  ('proposals','status','SENT','LOST',NULL),
  ('proposals','status','VIEWED','LOST',NULL),
  ('quotations','status',NULL,'DRAFT',NULL),
  ('quotations','status','DRAFT','APPLIED',ARRAY['QUOTATION_APPLY']),
  ('quotations','status','DRAFT','SUPERSEDED',NULL),
  ('quotations','status','APPLIED','SUPERSEDED',ARRAY['QUOTATION_APPLY']),
  ('engagements','status',NULL,'PROPOSED',NULL),
  ('engagements','status','PROPOSED','CONFIRMED',NULL),
  ('engagements','status','CONFIRMED','SCHEDULED',NULL),
  ('engagements','status','SCHEDULED','IN_DELIVERY',NULL),
  ('engagements','status','IN_DELIVERY','DELIVERED',NULL),
  ('engagements','status','DELIVERED','CLOSED',ARRAY['ENGAGEMENT_CLOSE_OUT']),
  ('engagements','status','PROPOSED','CANCELLED',NULL),
  ('engagements','status','CONFIRMED','CANCELLED',NULL),
  ('engagements','status','SCHEDULED','CANCELLED',NULL),
  ('attendance_days','status',NULL,'OPEN',NULL),
  ('attendance_days','status','OPEN','PENDING_APPROVAL',NULL),
  ('attendance_days','status','PENDING_APPROVAL','OPEN',NULL),
  ('attendance_days','status','OPEN','LOCKED',ARRAY['ATTENDANCE_APPROVE']),
  ('attendance_days','status','PENDING_APPROVAL','LOCKED',ARRAY['ATTENDANCE_APPROVE']),
  ('attendance_days','status','LOCKED','OPEN',ARRAY['ATTENDANCE_UNLOCK']),
  ('hrdc_packets','status',NULL,'DRAFT',NULL),
  ('hrdc_packets','status','DRAFT','READY',NULL),
  ('hrdc_packets','status','READY','DRAFT',NULL),
  ('hrdc_packets','status','READY','SUBMITTED',ARRAY['HRDC_PACKET_MARK_SUBMITTED']),
  ('hrdc_packets','status','SUBMITTED','PAID',NULL),
  ('hrdc_packets','status','SUBMITTED','REJECTED',NULL),
  ('hrdc_packets','status','REJECTED','DRAFT',NULL),
  ('invoices','status',NULL,'DRAFT',ARRAY['INVOICE_CREATE']),
  ('invoices','status','DRAFT','SENT',ARRAY['INVOICE_PUSH']),
  ('invoices','status','SENT','PARTIALLY_PAID',ARRAY['PAYMENT_RECORD']),
  ('invoices','status','SENT','PAID',ARRAY['PAYMENT_RECORD']),
  ('invoices','status','PARTIALLY_PAID','PAID',ARRAY['PAYMENT_RECORD']),
  ('invoices','status','SENT','OVERDUE',NULL),
  ('invoices','status','PARTIALLY_PAID','OVERDUE',NULL),
  ('invoices','status','OVERDUE','PARTIALLY_PAID',ARRAY['PAYMENT_RECORD']),
  ('invoices','status','OVERDUE','PAID',ARRAY['PAYMENT_RECORD']),
  -- ⚠ THREE EDGES ADDED TO DOC 01 §5.3, found by EXECUTION, not by reading.
  -- 010 makes a payment correction a REVERSAL row rather than a signed amount,
  -- and core.payment_apply recomputes the invoice's status from the payments
  -- that remain. Reversing the only payment on a PARTIALLY_PAID invoice
  -- therefore drives it back to SENT, and reversing a payment on a PAID or
  -- OVERDUE invoice does the same -- but doc 01 §5.3 enumerates only the
  -- forward direction, so with the registry as written every reversal in the
  -- product raises ILLEGAL_STATE_TRANSITION and the money silently cannot be
  -- put back. test_010 T4b is the assertion that found it: "a reversal that does
  -- not put the money back is money the business thinks it has."
  --
  -- These are gated by PAYMENT_RECORD, the action that causes them, so a
  -- reversal is as accountable as the payment it reverses. Registered against
  -- doc 01 §5.3 as an enumeration gap for the domain owner to ratify; the
  -- alternative -- leaving them out and letting 010's reversal path be dead --
  -- is not a choice this migration is allowed to make silently.
  ('invoices','status','PARTIALLY_PAID','SENT',ARRAY['PAYMENT_RECORD']),
  ('invoices','status','PAID','PARTIALLY_PAID',ARRAY['PAYMENT_RECORD']),
  ('invoices','status','PAID','SENT',ARRAY['PAYMENT_RECORD']),
  ('invoices','status','DRAFT','VOID',NULL),
  ('invoices','status','SENT','VOID',NULL),
  ('invoices','status','OVERDUE','VOID',NULL),
  ('invoices','sync_state',NULL,'NOT_SENT',NULL),
  ('invoices','sync_state','NOT_SENT','SENT',ARRAY['INVOICE_PUSH']),
  ('invoices','sync_state','NOT_SENT','ERROR',NULL),
  ('invoices','sync_state','SENT','VALIDATED',NULL),
  ('invoices','sync_state','SENT','ERROR',NULL),
  ('invoices','sync_state','ERROR','SENT',ARRAY['INVOICE_PUSH']),
  ('collections_cases','stage',NULL,'REMINDER_1',NULL),
  ('collections_cases','stage','REMINDER_1','REMINDER_2',ARRAY['REMINDER_SEND']),
  ('collections_cases','stage','REMINDER_2','REMINDER_3',ARRAY['REMINDER_SEND']),
  ('collections_cases','stage','REMINDER_3','HUMAN_CALL',NULL),
  ('collections_cases','stage','HUMAN_CALL','TRADING_HOLD',ARRAY['ACCOUNT_TRADING_HOLD']),
  ('trainer_bookings','state',NULL,'SOFT_HOLD',NULL),
  ('trainer_bookings','state','SOFT_HOLD','CONFIRMED',ARRAY['TRAINER_BOOK']),
  ('trainer_bookings','state','SOFT_HOLD','RELEASED',NULL),
  ('trainer_bookings','state','SOFT_HOLD','CANCELLED',NULL),
  ('trainer_bookings','state','CONFIRMED','CANCELLED',ARRAY['TRAINER_BOOK']),
  ('compliance_rules','status',NULL,'PROPOSED',NULL),
  ('compliance_rules','status','PROPOSED','ACTIVE',ARRAY['RULE_CHANGE_APPROVE']),
  ('compliance_rules','status','PROPOSED','SUPERSEDED',NULL),
  ('compliance_rules','status','ACTIVE','SUPERSEDED',ARRAY['RULE_CHANGE_APPROVE']),
  ('rule_changes','status',NULL,'PROPOSED',NULL),
  ('rule_changes','status',NULL,'WITHHELD',NULL),
  ('rule_changes','status','WITHHELD','PROPOSED',NULL),
  ('rule_changes','status','PROPOSED','APPROVED',ARRAY['RULE_CHANGE_APPROVE']),
  ('rule_changes','status','PROPOSED','REJECTED',NULL),
  ('agents','status',NULL,'ACTIVE',NULL),
  ('agents','status','ACTIVE','PAUSED',ARRAY['AGENT_PAUSE']),
  ('agents','status','PAUSED','ACTIVE',ARRAY['AGENT_PAUSE']),
  ('agents','status','ACTIVE','RETIRED',NULL),
  ('agents','status','PAUSED','RETIRED',NULL),
  ('ai_budgets','state',NULL,'WITHIN',NULL),
  ('ai_budgets','state','WITHIN','NEAR',NULL),
  ('ai_budgets','state','NEAR','PAUSED',NULL),
  ('ai_budgets','state','NEAR','WITHIN',NULL),
  ('ai_budgets','state','PAUSED','WITHIN',ARRAY['BUDGET_CAP_RAISE']),
  ('outbound_messages','status',NULL,'DRAFT',NULL),
  ('outbound_messages','status','DRAFT','QUEUED',
   ARRAY['FOLLOWUP_SEND','REMINDER_SEND','BROADCAST_SEND']),
  ('outbound_messages','status','QUEUED','SENT',NULL),
  ('outbound_messages','status','SENT','DELIVERED',NULL),
  ('outbound_messages','status','DELIVERED','READ',NULL),
  ('outbound_messages','status','QUEUED','FAILED',NULL),
  ('outbound_messages','status','SENT','FAILED',NULL);

-- ═══ 4 · Autonomy and state-transition guards ══════════════════════════════

CREATE OR REPLACE FUNCTION app.enforce_autonomy_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_ceiling text;
  v_reason  text;
BEGIN
  SELECT t.ceiling_autonomy, t.ceiling_reason
    INTO v_ceiling, v_reason
    FROM app.action_types AS t
   WHERE t.key = NEW.action_type AND t.active;

  IF NOT FOUND OR v_ceiling IS NULL THEN
    RAISE EXCEPTION 'no readable autonomy ceiling for action type %L', NEW.action_type
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','reason','AUTONOMY_CEILING_MISSING')::text;
  END IF;

  IF app.autonomy_rank(NEW.level) > app.autonomy_rank(v_ceiling) THEN
    RAISE EXCEPTION '% may not exceed % for %', NEW.level, v_ceiling, NEW.action_type
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED',
              'reason',COALESCE(v_reason,'UNKNOWN') || '_CEILING',
              'ceiling',v_ceiling)::text;
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS autonomy_grants_ceiling ON core.autonomy_grants;
CREATE TRIGGER autonomy_grants_ceiling
  BEFORE INSERT OR UPDATE ON core.autonomy_grants
  FOR EACH ROW EXECUTE FUNCTION app.enforce_autonomy_ceiling();

CREATE OR REPLACE FUNCTION app.assert_gates_exist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE v_bad text;
BEGIN
  SELECT gate.action_type
    INTO v_bad
    FROM pg_catalog.unnest(COALESCE(NEW.gated_by, ARRAY[]::text[])) AS gate(action_type)
   WHERE NOT EXISTS (
     SELECT 1 FROM app.action_types AS t
      WHERE t.key = gate.action_type AND t.active)
   LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'unknown action type %L in gated_by', v_bad
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS state_transitions_gates_exist ON core.state_transitions;
CREATE TRIGGER state_transitions_gates_exist
  BEFORE INSERT OR UPDATE ON core.state_transitions
  FOR EACH ROW EXECUTE FUNCTION app.assert_gates_exist();

CREATE OR REPLACE FUNCTION app.enforce_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_from      text := NULL;
  v_to        text;
  v_gated_by  text[];
  v_applier   uuid;
  v_request   core.action_requests%ROWTYPE;
  v_column    text := COALESCE(TG_ARGV[0], 'status');
BEGIN
  EXECUTE pg_catalog.format('SELECT ($1).%I::text', v_column)
     INTO v_to USING NEW;

  IF TG_OP = 'UPDATE' THEN
    EXECUTE pg_catalog.format('SELECT ($1).%I::text', v_column)
       INTO v_from USING OLD;
    IF v_from IS NOT DISTINCT FROM v_to THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT transition.gated_by
    INTO v_gated_by
    FROM core.state_transitions AS transition
   WHERE transition.entity = TG_TABLE_NAME
     AND transition.column_name = v_column
     AND transition.from_status IS NOT DISTINCT FROM v_from
     AND transition.to_status = v_to;

  IF NOT FOUND THEN
    RAISE EXCEPTION '% . %: % -> % is not a legal transition',
      TG_TABLE_NAME, v_column, COALESCE(v_from,'(new)'), v_to
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','ILLEGAL_STATE_TRANSITION')::text;
  END IF;

  IF v_gated_by IS NULL OR pg_catalog.cardinality(v_gated_by) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_applier := NULLIF(
      pg_catalog.current_setting('app.effect_applier', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_applier := NULL;
  END;

  IF v_applier IS NULL THEN
    RAISE EXCEPTION '% -> % requires one of %', v_from, v_to,
      pg_catalog.array_to_string(v_gated_by, ', ')
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','policyId','GOV-07',
              'requiredActions',pg_catalog.to_jsonb(v_gated_by))::text;
  END IF;

  SELECT request.*
    INTO v_request
    FROM core.action_requests AS request
   WHERE request.id = v_applier;

  -- H-07: every predicate is independently required. A queued/rejected request,
  -- an action for a sibling row, or an action from another tenant authorises
  -- nothing even when its action_type happens to match the edge.
  --
  -- The tenant predicate is guarded on `NEW.tenant_id IS NOT NULL`, and that is
  -- not a softening of H-07 -- it is what makes the finding's fix APPLICABLE at
  -- all. `core.compliance_rules` is the national HRD Corp registry: 009 models a
  -- rule as national by default with `tenant_id NULL` and optional tenant
  -- overrides, while `core.action_requests.tenant_id` is NOT NULL, because an
  -- action is always performed by somebody inside a tenant. An unguarded
  -- `IS DISTINCT FROM` therefore compares a uuid to NULL, is always true, and
  -- makes `PROPOSED -> ACTIVE` on a national rule unreachable by ANY caller --
  -- measured, not reasoned: it is what made test_009 fail against the full
  -- applied set. Doc 03's original wrote `<>` here, which returned NULL for the
  -- same rows and let every one of them through silently; neither shape is
  -- right, because the question "which tenant owns this row" has no answer for a
  -- national rule.
  --
  -- So the predicate asks the question only where it has one. For a
  -- tenant-scoped row -- every row H-07 is actually about -- the request's
  -- tenant must match exactly. For a national row the authorisation is carried
  -- by the other three predicates: a real request, of a gating action type,
  -- running, targeting THIS rule. That a national rule is then reachable from
  -- any tenant's correctly-targeted action is 009's own model showing through
  -- (it states plainly that there is deliberately no platform-admin role, which
  -- makes writing a national rule a provisioning act), not something 011 adds.
  IF NOT FOUND
     OR NOT (v_request.action_type = ANY (v_gated_by))
     OR v_request.status NOT IN ('EXECUTING','EXECUTED')
     OR v_request.target_id IS DISTINCT FROM NEW.id
     OR (NEW.tenant_id IS NOT NULL
         AND v_request.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'running action does not authorise % -> %', v_from, v_to
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','policyId','GOV-07',
              'requiredActions',pg_catalog.to_jsonb(v_gated_by),
              'runningAction',v_request.action_type)::text;
  END IF;

  RETURN NEW;
END;
$fn$;

-- Layer 1: no direct UPDATE privilege on a gated column. No positive client
-- grant lands here; 014 must grant only the editable columns beside its RLS.
REVOKE UPDATE (status)     ON core.enquiries         FROM anon, authenticated, service_role;
REVOKE UPDATE (stage)      ON core.opportunities     FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.tnas              FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.proposals         FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.quotations        FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.engagements       FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.attendance_days   FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.hrdc_packets      FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.invoices          FROM anon, authenticated, service_role;
REVOKE UPDATE (sync_state) ON core.invoices          FROM anon, authenticated, service_role;
REVOKE UPDATE (stage)      ON core.collections_cases FROM anon, authenticated, service_role;
REVOKE UPDATE (state)      ON core.trainer_bookings  FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.compliance_rules  FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.rule_changes      FROM anon, authenticated, service_role;
REVOKE UPDATE (status)     ON core.outbound_messages FROM anon, authenticated, service_role;

-- Layers 2 and 3: INSERT bypass and legal-edge validation on every extant
-- doc-01 s5.3 column. Invoices intentionally have two attachments.
CREATE TRIGGER enquiries_state_gate BEFORE INSERT OR UPDATE OF status ON core.enquiries
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER opportunities_state_gate BEFORE INSERT OR UPDATE OF stage ON core.opportunities
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('stage');
CREATE TRIGGER tnas_state_gate BEFORE INSERT OR UPDATE OF status ON core.tnas
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER proposals_state_gate BEFORE INSERT OR UPDATE OF status ON core.proposals
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER quotations_state_gate BEFORE INSERT OR UPDATE OF status ON core.quotations
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER engagements_state_gate BEFORE INSERT OR UPDATE OF status ON core.engagements
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER attendance_days_state_gate BEFORE INSERT OR UPDATE OF status ON core.attendance_days
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER hrdc_packets_state_gate BEFORE INSERT OR UPDATE OF status ON core.hrdc_packets
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER invoices_state_gate BEFORE INSERT OR UPDATE OF status ON core.invoices
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER invoices_sync_gate BEFORE INSERT OR UPDATE OF sync_state ON core.invoices
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('sync_state');
CREATE TRIGGER collections_cases_state_gate BEFORE INSERT OR UPDATE OF stage ON core.collections_cases
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('stage');
CREATE TRIGGER trainer_bookings_state_gate BEFORE INSERT OR UPDATE OF state ON core.trainer_bookings
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('state');
CREATE TRIGGER compliance_rules_state_gate BEFORE INSERT OR UPDATE OF status ON core.compliance_rules
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER rule_changes_state_gate BEFORE INSERT OR UPDATE OF status ON core.rule_changes
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');
CREATE TRIGGER outbound_messages_state_gate BEFORE INSERT OR UPDATE OF status ON core.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION app.enforce_state_transition('status');

-- ═══ 5 · Approval read projection ═══════════════════════════════════════════

CREATE VIEW core.v_approval_requests WITH (security_invoker = true) AS
SELECT approval.*,
       (approval.status = 'PENDING' AND pg_catalog.now() > approval.sla_due_at)
         AS sla_breached,
       GREATEST(0,
         pg_catalog.floor(pg_catalog.date_part(
           'epoch', approval.sla_due_at - pg_catalog.now()) / 60))::integer
         AS sla_remaining_minutes,
       CASE
         WHEN approval.status <> 'PENDING' THEN NULL
         WHEN pg_catalog.now() > approval.sla_due_at THEN 'BREACHING'
         WHEN approval.sla_due_at <
              ((pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE tenant.timezone)
                AT TIME ZONE tenant.timezone) + interval '1 day') THEN 'TODAY'
         WHEN approval.sla_due_at < pg_catalog.now() + interval '7 days' THEN 'THIS_WEEK'
         ELSE 'LATER'
       END AS urgency_group
  FROM core.approval_requests AS approval
  JOIN public.tenants AS tenant ON tenant.id = approval.tenant_id;

REVOKE ALL ON TABLE core.v_approval_requests FROM PUBLIC, anon, authenticated;

-- ═══ 6 · Value and target resolution ════════════════════════════════════════

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

CREATE OR REPLACE FUNCTION app.action_value(
  p_type text,
  p_tenant_id uuid,
  p_target_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  v_source   text;
  v_amount   bigint;
  v_currency char(3) := 'MYR';
BEGIN
  -- 004 cannot store value_source=PROPOSAL; resolve the one affected action
  -- explicitly from the real proposals.value_sen column.
  IF p_type = 'PROPOSAL_SEND' THEN
    SELECT proposal.value_sen, proposal.currency
      INTO v_amount, v_currency
      FROM core.proposals AS proposal
     WHERE proposal.tenant_id = p_tenant_id AND proposal.id = p_target_id;
  ELSE
    SELECT action_type.value_source
      INTO v_source
      FROM app.action_types AS action_type
     WHERE action_type.key = p_type;

    IF NOT FOUND OR v_source IS NULL THEN
      RAISE EXCEPTION 'no readable value source for action type %L', p_type
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    CASE v_source
      WHEN 'QUOTATION' THEN
        SELECT quotation.sell_price_sen, quotation.currency
          INTO v_amount, v_currency
          FROM core.quotations AS quotation
         WHERE quotation.tenant_id = p_tenant_id AND quotation.id = p_target_id;
      WHEN 'INVOICE' THEN
        SELECT invoice.total_sen, invoice.currency
          INTO v_amount, v_currency
          FROM core.invoices AS invoice
         WHERE invoice.tenant_id = p_tenant_id AND invoice.id = p_target_id;
      WHEN 'HRDC_CLAIM' THEN
        SELECT packet.claim_value_sen, packet.currency
          INTO v_amount, v_currency
          FROM core.hrdc_packets AS packet
         WHERE packet.tenant_id = p_tenant_id
           AND (packet.id = p_target_id OR packet.engagement_id = p_target_id)
         ORDER BY (packet.id = p_target_id) DESC
         LIMIT 1;
      WHEN 'PAYMENT' THEN
        v_amount := (p_payload #>> '{amount,amount}')::bigint;
        v_currency := COALESCE(p_payload #>> '{amount,currency}', 'MYR')::char(3);
      WHEN 'BUDGET_CAP' THEN
        v_amount := (p_payload #>> '{requestedCap,amount}')::bigint;
        v_currency := COALESCE(p_payload #>> '{requestedCap,currency}', 'MYR')::char(3);
      WHEN 'NONE' THEN
        RETURN NULL;
      ELSE
        RAISE EXCEPTION 'unknown value source %L for action type %L', v_source, p_type
          USING ERRCODE = 'invalid_parameter_value';
    END CASE;
  END IF;

  IF v_amount IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.jsonb_build_object('amount',v_amount,'currency',v_currency);
END;
$fn$;

-- ═══ 7 · Deterministic planning and in-database execution ══════════════════

CREATE OR REPLACE FUNCTION app.open_approval_count(p_user_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.count(*)::integer
    FROM core.approval_requests AS approval
   WHERE approval.tenant_id = app.require_tenant_id()
     AND approval.assigned_to_id = p_user_id
     AND approval.status = 'PENDING';
$fn$;

CREATE OR REPLACE FUNCTION app.pick_role_holder(
  p_tenant_id uuid,
  p_role text,
  p_exclude_actor_id text
)
RETURNS TABLE (actor_id text, actor_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT membership.user_id::text,
         COALESCE(profile.display_name, membership.user_id::text)
    FROM public.memberships AS membership
    LEFT JOIN public.user_profiles AS profile
      ON profile.tenant_id = membership.tenant_id
     AND profile.user_id = membership.user_id
   WHERE membership.tenant_id = p_tenant_id
     AND membership.role::text = p_role
     AND membership.actor_kind = 'HUMAN'
     AND membership.status = 'ACTIVE'
     -- H-03: NULL is ineligible, not conveniently “different”.
     AND p_exclude_actor_id IS NOT NULL
     AND membership.user_id::text <> p_exclude_actor_id
     AND EXISTS (
       SELECT 1 FROM app.role_permissions AS permission
        WHERE permission.role = membership.role
          AND permission.permission = 'approval:decide')
   ORDER BY (
     SELECT pg_catalog.count(*)
       FROM core.approval_requests AS approval
      WHERE approval.tenant_id = membership.tenant_id
        AND approval.assigned_to_id = membership.user_id::text
        AND approval.status = 'PENDING'),
     membership.user_id
   LIMIT 1;
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

CREATE OR REPLACE FUNCTION app.apply_effects(p_action_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_request  core.action_requests%ROWTYPE;
  v_effect   jsonb;
  v_sequence integer := 0;
  v_kind     text;
BEGIN
  SELECT request.* INTO v_request
    FROM core.action_requests AS request
   WHERE request.id = p_action_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'action request % does not exist', p_action_request_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_request.status NOT IN ('EXECUTING','EXECUTED') THEN
    RAISE EXCEPTION 'action request % is %, not executable', p_action_request_id, v_request.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  PERFORM pg_catalog.set_config('app.effect_applier',v_request.id::text,true);

  FOR v_effect IN
    SELECT effect.value FROM pg_catalog.jsonb_array_elements(v_request.effects) AS effect(value)
  LOOP
    v_sequence := v_sequence + 1;
    v_kind := CASE
      WHEN v_effect ->> 'entity' IN
        ('Email','Notification','EvaluationLink','AccountingPackage','Message','ComplianceRecheck')
      THEN 'EXTERNAL' ELSE 'IN_DATABASE' END;

    INSERT INTO app.action_effects
      (tenant_id,action_request_id,seq,op,entity,ref,description,kind,status,job_key)
    VALUES
      (v_request.tenant_id,v_request.id,v_sequence,v_effect ->> 'op',
       v_effect ->> 'entity',v_effect ->> 'ref',v_effect ->> 'description',v_kind,
       CASE WHEN v_kind = 'EXTERNAL' THEN 'DISPATCHED'::app.effect_status
            ELSE 'PLANNED'::app.effect_status END,
       CASE WHEN v_kind = 'EXTERNAL' THEN v_request.id::text || ':' || v_sequence ELSE NULL END)
    ON CONFLICT (action_request_id,seq) DO NOTHING;
  END LOOP;

  PERFORM app.execute_in_database_action(v_request.id);

  UPDATE app.action_effects
     SET status = 'APPLIED', applied_at = pg_catalog.now()
   WHERE action_request_id = v_request.id AND kind = 'IN_DATABASE'
     AND status = 'PLANNED';

  IF EXISTS (
    SELECT 1 FROM app.action_effects AS effect
     WHERE effect.action_request_id = v_request.id
       AND effect.kind = 'EXTERNAL'
       AND effect.status = 'DISPATCHED'
  ) THEN
    -- ⚠ AND NOW ACTUALLY HAND THEM TO THE WORKER. This call is the seam between
    -- the envelope and the queue, and until it was added NOTHING CROSSED IT.
    --
    -- `apply_effects` marked every EXTERNAL effect `DISPATCHED` and stopped there.
    -- `app.enqueue_effect_jobs` (012) is what turns a dispatched effect into a row
    -- in `app.outbox` for the Node worker to claim, and a repo-wide grep found its
    -- only caller anywhere — `apps/`, `packages/`, every migration and rollback —
    -- was `test_012`. So every PROPOSAL_SEND, INVOICE_PUSH, REMINDER_SEND and
    -- BROADCAST_SEND reported success, moved the action to EXECUTING, and then
    -- waited forever for a job nobody had created. Silently: `DISPATCHED` is a
    -- perfectly healthy-looking status and no timeout watches it.
    --
    -- WHY A FORWARD REFERENCE IS SAFE HERE, stated because it looks wrong. 011 is
    -- applied before 012, so `app.enqueue_effect_jobs` does not exist when this
    -- function is CREATEd. plpgsql resolves calls at EXECUTION time, not at
    -- creation, so that is legal — and the explicit existence check below turns
    -- the one case where it would matter, an 011-only database actually running an
    -- external action, into a sentence instead of `function does not exist`.
    -- The alternative — re-creating this function at the end of 012 — would put
    -- one function's real body in two files, which is the drift this pack's own
    -- rules are written against.
    IF pg_catalog.to_regprocedure('app.enqueue_effect_jobs(uuid,uuid)') IS NULL THEN
      RAISE EXCEPTION
        'app.enqueue_effect_jobs is absent, so % external effect(s) on action % '
        'would be marked DISPATCHED and never sent. 012 creates it; this database '
        'has 011 without 012.',
        (SELECT pg_catalog.count(*) FROM app.action_effects AS e
          WHERE e.action_request_id = v_request.id AND e.kind = 'EXTERNAL'),
        v_request.id
        USING ERRCODE = 'undefined_function';
    END IF;

    PERFORM app.enqueue_effect_jobs(v_request.id, v_request.tenant_id);

    UPDATE core.action_requests SET status = 'EXECUTING'
     WHERE id = v_request.id;
  ELSE
    UPDATE core.action_requests
       SET status = 'EXECUTED', completed_at = pg_catalog.now()
     WHERE id = v_request.id;
  END IF;

  -- T8 · CLEAR THE APPLIER GUC. `app.effect_applier` names the in-flight action
  -- request and is what `enforce_state_transition` reads to authorize a gated
  -- write. It was set once and never cleared — harmless under PostgREST's
  -- one-RPC-per-transaction model, and a real residue inside `app.bulk_decide`'s
  -- loop, where the SECOND approval's effects would run with the FIRST one's
  -- applier still named. Transaction-local, so this costs nothing and removes the
  -- whole class.
  PERFORM pg_catalog.set_config('app.effect_applier', '', true);
END;
$fn$;

-- ═══ 7b · WHO MAY PERFORM AN ACTION AT ALL ═════════════════════════════════
--
-- THE DEFECT THIS CLOSES. `app.has_permission` was called exactly ONCE in all of
-- 011, inside `decide_approval`. On the HUMAN path, if no `core.action_policies`
-- row matched, dispatch fell through to a bare `EXECUTING` with NO PERMISSION
-- CHECK OF ANY KIND. A SALES principal could execute `PAYMENT_RECORD` against an
-- invoice whose outstanding amount happened to satisfy no policy condition, and
-- the payment posted. Three action types have no policy row at all for a freshly
-- provisioned tenant — measured, not assumed: `ENQUIRY_ARCHIVE`,
-- `OPPORTUNITY_CONVERT` and `TNA_RECOMMENDATION_ACCEPT` — so for those the
-- fall-through was not an edge case, it was the only path. 014's wrapper
-- re-validates nothing, so nothing downstream closed it either.
--
-- WHY A COLUMN AND NOT A HARDCODED CASE. 002 already wrote the whole permission
-- catalogue and 014's gates already read it through `app.has_permission`. A CASE
-- here would be a second copy of an authorization model that exists, which is the
-- drift this repo's rules are written against. The column makes the answer data,
-- visible in one query, and seeded beside the action types it describes.
--
-- EVERY ACTIVE TYPE MUST CARRY ONE. The verify block below refuses a NULL, so a
-- 23rd action type cannot be added without somebody deciding who may perform it —
-- which is the question that went unasked for all 22 of these.
ALTER TABLE app.action_types
  ADD COLUMN IF NOT EXISTS required_permission text;

UPDATE app.action_types AS t SET required_permission = m.perm
  FROM (VALUES
    ('PROPOSAL_SEND',              'proposal:send'),
    ('QUOTATION_APPLY',            'quotation:apply'),
    ('DISCOUNT_APPROVE',           'discount:approve'),
    ('INVOICE_CREATE',             'invoice:create'),
    ('INVOICE_PUSH',               'invoice:push'),
    ('PAYMENT_RECORD',             'payment:record'),
    ('ENQUIRY_ARCHIVE',            'enquiry:archive'),
    ('OPPORTUNITY_CONVERT',        'enquiry:convert'),
    ('TNA_RECOMMENDATION_ACCEPT',  'tna:recommendation:accept'),
    ('TRAINER_BOOK',               'trainer:book'),
    ('ATTENDANCE_APPROVE',         'attendance:approve'),
    ('ATTENDANCE_UNLOCK',          'attendance:unlock'),
    ('ENGAGEMENT_CLOSE_OUT',       'engagement:close_out'),
    ('HRDC_PACKET_MARK_SUBMITTED', 'hrdc:mark_submitted'),
    ('RULE_CHANGE_APPROVE',        'compliance:rule:approve'),
    ('FOLLOWUP_SEND',              'followup:send'),
    ('REMINDER_SEND',              'collection:remind'),
    ('BROADCAST_SEND',             'broadcast:send'),
    ('AGENT_PAUSE',                'agent:pause'),
    ('AGENT_AUTONOMY_CHANGE',      'agent:autonomy'),
    ('BUDGET_CAP_RAISE',           'ai:budget:raise'),
    ('ACCOUNT_TRADING_HOLD',       'organisation:write')
  ) AS m(key, perm)
 WHERE t.key = m.key
   AND t.required_permission IS DISTINCT FROM m.perm;

DO $req_perm$
DECLARE v_bad text;
BEGIN
  -- Every active type has one.
  SELECT pg_catalog.string_agg(t.key, ', ' ORDER BY t.key) INTO v_bad
    FROM app.action_types AS t
   WHERE t.active AND t.required_permission IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '011: action type(s) with no required_permission: %. Every action a human '
      'can perform needs somebody to have decided who may perform it; a NULL here '
      'is that decision going unmade, and the HUMAN path used to treat it as '
      '"anyone".', v_bad;
  END IF;

  -- And every one names a permission 002 actually issued. A typo would produce an
  -- action nobody can perform, which reads as very secure and is an outage.
  SELECT pg_catalog.string_agg(
           pg_catalog.format('%s -> %s', t.key, t.required_permission), ', ' ORDER BY t.key)
    INTO v_bad
    FROM app.action_types AS t
   WHERE t.required_permission IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM app.role_permissions AS rp
                      WHERE rp.permission = t.required_permission);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '011: action type(s) naming a permission no role holds: %. That is an action '
      'nobody can perform, which is an outage wearing security''s clothes.', v_bad;
  END IF;
END;
$req_perm$;

COMMENT ON COLUMN app.action_types.required_permission IS
  'The app.role_permissions key a HUMAN or CLIENT actor must hold to perform this '
  'action. Checked by app.perform_action BEFORE dispatch, independently of whether '
  'any core.action_policies row matches — the policy gate decides whether an action '
  'needs APPROVAL, never whether this caller may ask for it at all. 011.';

-- ═══ 8 · The action envelope ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app.perform_action(
  p_type text,
  p_target_ref text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_requested_by jsonb DEFAULT NULL,
  p_confidence numeric DEFAULT NULL,
  p_reasoning text DEFAULT NULL,
  p_evidence jsonb DEFAULT '[]'::jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant                 uuid := app.require_tenant_id();
  v_actor                  record;
  v_actor_kind             text;
  v_actor_id               text;
  v_actor_role             text;
  v_type                   app.action_types%ROWTYPE;
  v_hash                   text;
  v_idempotency            app.idempotency_keys%ROWTYPE;
  v_grant                  core.autonomy_grants%ROWTYPE;
  v_policy                 core.action_policies%ROWTYPE;
  v_policy_found           boolean := false;
  v_level                  text;
  v_granted                text;
  v_value                  jsonb;
  v_context                jsonb;
  v_document               jsonb;
  v_effects                jsonb;
  v_effects_hash           text;
  v_trace                  jsonb := '[]'::jsonb;
  v_request                core.action_requests%ROWTYPE;
  v_approval               core.approval_requests%ROWTYPE;
  v_draft                  core.suggested_drafts%ROWTYPE;
  v_result                 jsonb;
  v_target_id              uuid;
  v_dispatch               text;
  v_missing                jsonb;
  v_tenant_timezone        text;
  v_organisation_id        uuid;
  v_engagement_id          uuid;
  v_proposal_id            uuid;
  v_invoice_id             uuid;
  v_first_proposal         boolean := false;
  v_below_floor            boolean := false;
  v_overdue                boolean := false;
  v_attendance_locked      boolean := false;
  v_deadline_days          integer;
  v_consent_withdrawn      boolean := false;
  v_packet_incomplete      boolean := false;
  v_claim_reference_exists boolean := false;
  v_first_of_kind          boolean := false;
  v_payment_matches        boolean := true;
  v_discount_exceeded      boolean := false;
  v_resulting_margin       numeric;
  v_low_confidence         boolean := false;
  v_jury_triggered         boolean := false;
  v_jury_reason            text;
  v_jury                   core.jury_configs%ROWTYPE;
  v_assignee_id            text;
  v_assignee_name          text;
  v_approver_role          text;
  v_policy_id              text;
  v_sla_minutes            integer;
  v_escalate_role          text;
  v_escalate_minutes       integer;
  v_expire_minutes         integer;
BEGIN
  p_payload := COALESCE(p_payload, '{}'::jsonb);
  p_evidence := COALESCE(p_evidence, '[]'::jsonb);
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  v_actor_kind := COALESCE(p_requested_by ->> 'kind', v_actor.actor_kind);
  v_actor_id := COALESCE(p_requested_by ->> 'id', v_actor.actor_id);
  v_actor_role := v_actor.role;

  -- Guard a: a caller may identify only itself. Service-role adapters may pass
  -- AGENT/SYSTEM identity, but never manufacture a HUMAN or CLIENT principal.
  IF p_requested_by IS NOT NULL AND
     (pg_catalog.jsonb_typeof(p_requested_by) <> 'object'
      OR NOT (p_requested_by ? 'kind') OR NOT (p_requested_by ? 'id')) THEN
    RAISE EXCEPTION 'requestedBy must contain kind and id'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','requestedBy','reason','INVALID')))::text;
  END IF;

  IF (v_actor_kind IS DISTINCT FROM v_actor.actor_kind
      OR v_actor_id IS DISTINCT FROM v_actor.actor_id)
     AND NOT (COALESCE(app.jwt() ->> 'role','') = 'service_role'
              AND v_actor_kind IN ('AGENT','SYSTEM')) THEN
    RAISE EXCEPTION 'requestedBy does not match the authenticated principal'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','requiredRole','AGENT')::text;
  END IF;
  IF v_actor_kind NOT IN ('HUMAN','AGENT','SYSTEM','CLIENT') OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'unrecognised or incomplete requester'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;
  IF v_actor_kind IN ('HUMAN','CLIENT') AND v_actor_role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  -- Guard b: lock before claim. Identical replay always returns 200 (M-21).
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_tenant::text || ':' || v_actor_id || ':' || p_idempotency_key)::bigint);
    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'type',p_type,'targetRef',p_target_ref,'payload',p_payload,
        'requestedBy',p_requested_by)::text,'UTF8')),'hex');

    INSERT INTO app.idempotency_keys
      (tenant_id,actor_id,endpoint,key,request_hash)
    VALUES
      (v_tenant,v_actor_id,'POST /v1/actions',p_idempotency_key,v_hash)
    ON CONFLICT (tenant_id,actor_id,endpoint,key) DO NOTHING
    RETURNING * INTO v_idempotency;

    IF v_idempotency.id IS NULL THEN
      SELECT keyrow.* INTO v_idempotency
        FROM app.idempotency_keys AS keyrow
       WHERE keyrow.tenant_id = v_tenant AND keyrow.actor_id = v_actor_id
         AND keyrow.endpoint = 'POST /v1/actions' AND keyrow.key = p_idempotency_key;
      IF v_idempotency.request_hash IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'idempotency key reused with a different body'
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object('code','IDEMPOTENT_REPLAY')::text;
      END IF;
      PERFORM pg_catalog.set_config(
        'response.headers','[{"Idempotent-Replay":"true"}]',true);
      PERFORM pg_catalog.set_config('response.status','200',true);
      RETURN v_idempotency.response;
    END IF;
  END IF;

  -- Guard c: active action type.
  SELECT action_type.* INTO v_type
    FROM app.action_types AS action_type
   WHERE action_type.key = p_type AND action_type.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown action type %L', p_type
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','type','reason','UNKNOWN_ACTION_TYPE')))::text;
  END IF;

  -- ⚠ GUARD c2 · MAY THIS ACTOR PERFORM THIS ACTION AT ALL. Checked HERE —
  -- immediately after the action type is known and BEFORE the payload is
  -- validated — because the two questions are different, only one of them was
  -- being asked, and answering the other one first tells an unauthorized caller
  -- which fields the action takes. An earlier draft of this block sat after guard
  -- d and the pin caught it: a SALES principal probing PAYMENT_RECORD got back
  -- `{"field":"amount","reason":"REQUIRED"}`, which is the payload schema, from a
  -- call they were never allowed to make.
  --
  -- `core.action_policies` decides whether an action needs APPROVAL. It was also,
  -- accidentally, the only thing standing between a caller and execution: if no
  -- policy row MATCHED — either because the type has none (three of the 22 have
  -- none for a freshly provisioned tenant, measured) or because its conditions
  -- excluded this case — dispatch fell through to a bare EXECUTING with no
  -- permission check anywhere in 011. A SALES principal could run PAYMENT_RECORD
  -- against an invoice whose amount satisfied no condition, and the payment
  -- posted. `app.has_permission` was called exactly once in this entire file, in
  -- `decide_approval`, and 014's wrapper re-validates nothing.
  --
  -- HUMAN and CLIENT only. An AGENT's authority is the autonomy grant and the
  -- policy ceiling, which the sections below evaluate in full and which is a
  -- different model — agents hold no role in `app.role_permissions`. A SYSTEM
  -- actor is the database acting on its own behalf and has no principal to check.
  IF v_actor_kind IN ('HUMAN','CLIENT') THEN
    IF v_type.required_permission IS NULL THEN
      RAISE EXCEPTION
        'action type % has no required_permission, so who may perform it has '
        'never been decided', v_type.key
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','FORBIDDEN','reason','NO_REQUIRED_PERMISSION')::text;
    END IF;

    IF NOT app.has_permission(v_type.required_permission) THEN
      RAISE EXCEPTION
        'this principal may not perform %', v_type.key
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','FORBIDDEN',
                'requiredPermission', v_type.required_permission)::text;
    END IF;
  END IF;

  -- Guard d: validate the schema before using it. The explicit assertion is
  -- what makes the receiver fail closed even if 004's CHECK is ever removed.
  IF NOT (v_type.payload_schema ? 'required')
     OR pg_catalog.jsonb_typeof(v_type.payload_schema -> 'required') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'unreadable payload schema for action type %L', p_type
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','reason','MALFORMED_PAYLOAD_SCHEMA')::text;
  END IF;

  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'field',required.key,'reason','REQUIRED'))
    INTO v_missing
    FROM pg_catalog.jsonb_array_elements_text(
           v_type.payload_schema -> 'required') AS required(key)
   WHERE NOT (p_payload ? required.key) OR p_payload ->> required.key IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'payload validation failed'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',v_missing)::text;
  END IF;

  -- H-05: assurance is checked inside the definer envelope. Agents and system
  -- facts do not have GoTrue MFA sessions; human money commitments do.
  IF v_type.money_moving AND v_actor_kind = 'HUMAN'
     AND NOT app.aal2_verified() THEN
    RAISE EXCEPTION 'AAL2 is required for money-moving actions'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','reason','AAL2_REQUIRED')::text;
  END IF;

  -- Guard e: the real 001-010 kill switches. AGENT_PAUSE is always exempt.
  IF v_actor_kind = 'AGENT' AND p_type <> 'AGENT_PAUSE' THEN
    IF EXISTS (SELECT 1 FROM public.tenants AS tenant
                WHERE tenant.id = v_tenant AND tenant.status <> 'ACTIVE') THEN
      RAISE EXCEPTION 'all agent actions are suspended for this tenant'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','AGENT_PAUSED','reason','TENANT_KILL_SWITCH')::text;
    END IF;
    IF EXISTS (SELECT 1 FROM public.memberships AS membership
                WHERE membership.tenant_id = v_tenant
                  AND membership.agent_id = v_actor_id
                  AND membership.status <> 'ACTIVE') THEN
      RAISE EXCEPTION 'action routed to a paused agent'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','AGENT_PAUSED','reason','AGENT_PAUSED','agentId',v_actor_id)::text;
    END IF;
  END IF;

  -- Step 1: autonomy. AGENT_PAUSE is the one action an agent may always invoke.
  IF v_actor_kind = 'AGENT' THEN
    IF p_type = 'AGENT_PAUSE' THEN
      v_granted := 'AUTONOMOUS';
      v_level := 'AUTONOMOUS';
    ELSE
      SELECT grantrow.* INTO v_grant
        FROM core.autonomy_grants AS grantrow
       WHERE grantrow.tenant_id = v_tenant
         AND grantrow.agent_id = v_actor_id
         AND grantrow.action_type = p_type;
      IF NOT FOUND THEN
        v_granted := 'OBSERVE';
      ELSE
        v_granted := v_grant.level;
        IF v_grant.paused THEN
          RAISE EXCEPTION '% is paused for %', p_type, v_actor_id
            USING ERRCODE = 'TRNOS',
                  DETAIL = pg_catalog.jsonb_build_object(
                    'code','AGENT_PAUSED','reason',COALESCE(v_grant.paused_reason,'ACTION_TYPE_PAUSED'),
                    'actionType',p_type)::text;
        END IF;
      END IF;
      v_level := CASE
        WHEN app.autonomy_rank(v_granted) > app.autonomy_rank(v_type.ceiling_autonomy)
        THEN v_type.ceiling_autonomy ELSE v_granted END;
      IF v_level = 'OBSERVE' THEN
        RAISE EXCEPTION '% is not permitted to perform %', v_actor_id, p_type
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object(
                  'code','FORBIDDEN','requiredRole','AGENT','grantedLevel','OBSERVE')::text;
      END IF;
    END IF;
  ELSE
    v_level := NULL;
    v_granted := NULL;
  END IF;
  v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'step',1,'input','autonomy','granted',v_granted,
    'ceiling',v_type.ceiling_autonomy,'effective',v_level));

  v_target_id := app.resolve_action_target_id(p_type,v_tenant,p_target_ref,p_payload);
  IF v_target_id IS NULL AND p_type NOT IN
       ('AGENT_PAUSE','BUDGET_CAP_RAISE','BROADCAST_SEND','FOLLOWUP_SEND') THEN
    RAISE EXCEPTION 'target % was not found for %', p_target_ref, p_type
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- Step 2: value from the record (or the documented payment/cap payload).
  v_value := app.action_value(p_type,v_tenant,v_target_id,p_payload);
  IF v_actor_kind = 'AGENT' AND v_level = 'AUTONOMOUS'
     AND v_grant.value_threshold_sen IS NOT NULL
     AND COALESCE((v_value ->> 'amount')::bigint,0) > v_grant.value_threshold_sen THEN
    v_level := 'ACT_WITH_APPROVAL';
    v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'step',2,'input','value','valueSen',(v_value ->> 'amount')::bigint,
      'thresholdSen',v_grant.value_threshold_sen,'outcome','DOWNGRADED_THRESHOLD_EXCEEDED'));
  ELSE
    v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'step',2,'input','value','valueSen',(v_value ->> 'amount')::bigint,
      'thresholdSen',v_grant.value_threshold_sen,'outcome','WITHIN_BAND'));
  END IF;

  -- Step 3: server-derived context. Resolve the smallest set of identities each
  -- index probe needs; no stage name or order is hard-coded here.
  SELECT tenant.timezone INTO v_tenant_timezone
    FROM public.tenants AS tenant WHERE tenant.id = v_tenant;
  v_tenant_timezone := COALESCE(v_tenant_timezone,'Asia/Kuala_Lumpur');

  IF p_type = 'PROPOSAL_SEND' THEN
    SELECT proposal.id,proposal.organisation_id
      INTO v_proposal_id,v_organisation_id
      FROM core.proposals AS proposal
     WHERE proposal.tenant_id = v_tenant AND proposal.id = v_target_id;
    SELECT NOT EXISTS (
      SELECT 1 FROM core.proposals AS previous
       WHERE previous.tenant_id = v_tenant
         AND previous.organisation_id = v_organisation_id
         AND previous.status IN ('SENT','VIEWED','ACCEPTED','LOST')
         AND previous.id <> v_proposal_id)
      INTO v_first_proposal;
  ELSIF p_type IN ('QUOTATION_APPLY','DISCOUNT_APPROVE') THEN
    SELECT proposal.organisation_id,quotation.below_floor,quotation.margin_rate
      INTO v_organisation_id,v_below_floor,v_resulting_margin
      FROM core.quotations AS quotation
      JOIN core.proposals AS proposal
        ON proposal.tenant_id = quotation.tenant_id AND proposal.id = quotation.proposal_id
     WHERE quotation.tenant_id = v_tenant AND quotation.id = v_target_id;
    v_discount_exceeded := COALESCE((p_payload ->> 'discountAuthorityExceeded')::boolean,false);
    v_resulting_margin := COALESCE((p_payload ->> 'resultingMarginRate')::numeric,v_resulting_margin);
  ELSIF p_type IN ('INVOICE_PUSH','PAYMENT_RECORD') THEN
    SELECT invoice.id,invoice.organisation_id,invoice.engagement_id
      INTO v_invoice_id,v_organisation_id,v_engagement_id
      FROM core.invoices AS invoice
     WHERE invoice.tenant_id = v_tenant AND invoice.id = v_target_id;
  ELSIF p_type = 'HRDC_PACKET_MARK_SUBMITTED' THEN
    SELECT packet.organisation_id,packet.engagement_id
      INTO v_organisation_id,v_engagement_id
      FROM core.hrdc_packets AS packet
     WHERE packet.tenant_id = v_tenant AND packet.id = v_target_id;
  ELSIF p_type IN ('ENGAGEMENT_CLOSE_OUT') THEN
    SELECT engagement.organisation_id,engagement.id
      INTO v_organisation_id,v_engagement_id
      FROM core.engagements AS engagement
     WHERE engagement.tenant_id = v_tenant AND engagement.id = v_target_id;
  ELSIF p_type IN ('ATTENDANCE_APPROVE','ATTENDANCE_UNLOCK') THEN
    SELECT day.engagement_id INTO v_engagement_id
      FROM core.attendance_days AS day
     WHERE day.tenant_id = v_tenant AND day.id = v_target_id;
  END IF;

  IF v_organisation_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM core.invoices AS invoice
       WHERE invoice.tenant_id = v_tenant
         AND invoice.organisation_id = v_organisation_id
         AND invoice.status IN ('SENT','PARTIALLY_PAID','OVERDUE')
         AND invoice.due_at < (pg_catalog.now() AT TIME ZONE v_tenant_timezone)::date
         AND invoice.outstanding_sen > 0)
      INTO v_overdue;
  END IF;

  IF v_engagement_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM core.attendance_days AS day
       WHERE day.tenant_id = v_tenant AND day.engagement_id = v_engagement_id
         AND day.status = 'LOCKED')
      INTO v_attendance_locked;
    SELECT COALESCE(packet.completeness < 1,false),packet.claim_reference IS NOT NULL
      INTO v_packet_incomplete,v_claim_reference_exists
      FROM core.hrdc_packets AS packet
     WHERE packet.tenant_id = v_tenant AND packet.engagement_id = v_engagement_id;
  END IF;

  SELECT pg_catalog.min(deadline.day_count)::integer INTO v_deadline_days
    FROM (
      SELECT (packet.deadline_at AT TIME ZONE v_tenant_timezone)::date
             - (pg_catalog.now() AT TIME ZONE v_tenant_timezone)::date AS day_count
        FROM core.hrdc_packets AS packet
       WHERE packet.tenant_id = v_tenant AND packet.engagement_id = v_engagement_id
      UNION ALL
      SELECT invoice.due_at
             - (pg_catalog.now() AT TIME ZONE v_tenant_timezone)::date
        FROM core.invoices AS invoice
       WHERE invoice.tenant_id = v_tenant AND invoice.id = v_invoice_id
      UNION ALL
      SELECT engagement.starts_on
             - (pg_catalog.now() AT TIME ZONE v_tenant_timezone)::date
        FROM core.engagements AS engagement
       WHERE engagement.tenant_id = v_tenant AND engagement.id = v_engagement_id
    ) AS deadline
   WHERE deadline.day_count IS NOT NULL;

  IF p_payload ? 'contactId' AND p_payload ? 'channel' THEN
    SELECT EXISTS (
      SELECT 1 FROM core.contact_consents AS consent
       WHERE consent.tenant_id = v_tenant
         AND consent.contact_id = (p_payload ->> 'contactId')::uuid
         AND consent.channel::text = p_payload ->> 'channel'
         AND consent.withdrawn_at IS NOT NULL)
      INTO v_consent_withdrawn;
  END IF;

  IF v_organisation_id IS NOT NULL THEN
    SELECT
      NOT EXISTS (SELECT 1 FROM core.engagements AS engagement
                   WHERE engagement.tenant_id = v_tenant
                     AND engagement.organisation_id = v_organisation_id
                     AND engagement.status IN ('DELIVERED','CLOSED'))
      INTO v_first_of_kind;
  END IF;

  IF p_type = 'PAYMENT_RECORD' AND v_invoice_id IS NOT NULL AND v_value IS NOT NULL THEN
    SELECT invoice.outstanding_sen = (v_value ->> 'amount')::bigint
      INTO v_payment_matches
      FROM core.invoices AS invoice
     WHERE invoice.tenant_id = v_tenant AND invoice.id = v_invoice_id;
  END IF;

  v_context := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'firstProposalToOrg',v_first_proposal,
    'belowFloorPrice',v_below_floor,
    'overdueBalanceOnAccount',v_overdue,
    'attendanceLocked',v_attendance_locked,
    'deadlineWithinDays',v_deadline_days,
    'consentWithdrawn',v_consent_withdrawn,
    'packetIncomplete',v_packet_incomplete,
    'claimReferenceExists',v_claim_reference_exists,
    'firstOfKind',v_first_of_kind,
    'paymentAmountMatchesOutstanding',v_payment_matches,
    'discountAuthorityExceeded',v_discount_exceeded,
    'resultingMarginRate',v_resulting_margin));
  v_document := pg_catalog.jsonb_build_object(
    'payload',p_payload,'value',v_value,'context',v_context,'confidence',p_confidence,
    'requester',pg_catalog.jsonb_build_object(
      'kind',v_actor_kind,'id',v_actor_id,'role',v_actor_role),
    'target',pg_catalog.jsonb_build_object(
      'ref',p_target_ref,'entity',v_type.target_entity));
  v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'step',3,'input','context','flags',v_context));

  IF v_actor_kind <> 'SYSTEM' AND p_type <> 'AGENT_PAUSE' THEN
    SELECT policy.* INTO v_policy
      FROM core.action_policies AS policy
     WHERE policy.tenant_id = v_tenant AND policy.action_type = p_type
       AND policy.active AND policy.effective_from <= pg_catalog.now()
       AND (policy.effective_to IS NULL OR policy.effective_to > pg_catalog.now())
       AND app.policy_matches(policy.conditions,policy.combinator,v_document)
     ORDER BY policy.priority,policy.id
     LIMIT 1;
    v_policy_found := FOUND;
  END IF;
  v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'step',3,'input','policy','matched',CASE WHEN v_policy_found THEN v_policy.id ELSE NULL END));

  -- Step 4: confidence only downgrades. The jury uses the same inputs and also
  -- caps autonomy rather than waiting for a model inside this transaction.
  IF v_actor_kind = 'AGENT' THEN
    IF COALESCE(p_confidence,0) < COALESCE(v_grant.min_confidence,0.700) THEN
      IF v_level = 'AUTONOMOUS' THEN v_level := 'ACT_WITH_APPROVAL'; END IF;
      v_low_confidence := true;
      v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'step',4,'input','confidence','value',p_confidence,
        'minimum',COALESCE(v_grant.min_confidence,0.700),
        'policyId','GOV-05','outcome','DOWNGRADED'));
    ELSE
      v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'step',4,'input','confidence','value',p_confidence,
        'minimum',COALESCE(v_grant.min_confidence,0.700),'outcome','PASS'));
    END IF;

    SELECT config.* INTO v_jury FROM core.jury_configs AS config
     WHERE config.tenant_id = v_tenant AND config.action_type = p_type AND config.active;
    IF FOUND AND v_jury.mode = 'ESCALATE' AND v_level = 'AUTONOMOUS' THEN
      IF v_jury.trigger_min_confidence IS NOT NULL
         AND COALESCE(p_confidence,0) < v_jury.trigger_min_confidence THEN
        v_jury_reason := 'LOW_CONFIDENCE';
      ELSIF v_jury.trigger_max_value_sen IS NOT NULL
            AND COALESCE((v_value ->> 'amount')::bigint,0) > v_jury.trigger_max_value_sen THEN
        v_jury_reason := 'HIGH_VALUE';
      ELSIF v_jury.trigger_first_of_kind AND v_first_of_kind THEN
        v_jury_reason := 'FIRST_OF_KIND';
      END IF;
      IF v_jury_reason IS NOT NULL THEN
        v_level := 'ACT_WITH_APPROVAL';
        v_jury_triggered := true;
      END IF;
    END IF;
  END IF;

  -- Step 5 and dispatch. A matched policy always beats an autonomy grant.
  IF v_policy_found AND v_actor_kind = 'HUMAN'
     AND v_actor_role = v_policy.approver_role AND v_policy.self_authorise THEN
    v_level := 'SELF_AUTHORISED';
    v_dispatch := 'EXECUTING';
    v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'step',5,'input','approver','role',v_policy.approver_role,
      'selfAuthorised',true,'policyId','GOV-03'));
  ELSIF v_actor_kind = 'SYSTEM' THEN
    v_dispatch := 'EXECUTING';
  ELSIF v_actor_kind = 'AGENT' AND v_level = 'SUGGEST' THEN
    v_dispatch := 'SUGGESTED';
  ELSIF v_policy_found OR (v_actor_kind = 'AGENT' AND v_level = 'ACT_WITH_APPROVAL') THEN
    v_dispatch := 'QUEUED_FOR_APPROVAL';
    v_approver_role := COALESCE(v_policy.approver_role,v_grant.approver_role,'MD');
    v_policy_id := COALESCE(v_policy.id,'GOV-05');
    v_sla_minutes := COALESCE(v_policy.sla_minutes,240);
    v_escalate_role := v_policy.escalate_to_role;
    v_escalate_minutes := v_policy.escalate_after_minutes;
    v_expire_minutes := COALESCE(v_policy.expire_after_minutes,1440);
    SELECT holder.actor_id,holder.actor_name
      INTO v_assignee_id,v_assignee_name
      FROM app.pick_role_holder(v_tenant,v_approver_role,v_actor_id) AS holder;
    IF v_assignee_id IS NULL AND v_escalate_role IS NOT NULL THEN
      SELECT holder.actor_id,holder.actor_name
        INTO v_assignee_id,v_assignee_name
        FROM app.pick_role_holder(v_tenant,v_escalate_role,v_actor_id) AS holder;
    END IF;
    IF v_assignee_id IS NULL THEN
      RAISE EXCEPTION 'no eligible % approver other than the requester', v_approver_role
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','VALIDATION_FAILED','reason','NO_ELIGIBLE_APPROVER',
                'requiredRole',v_approver_role)::text;
    END IF;
    v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'step',5,'input','approver','role',v_approver_role,
      'assignedTo',v_assignee_id,'selfApproval',false));
  ELSE
    v_dispatch := 'EXECUTING';
  END IF;

  v_effects := app.plan_effects(p_type,p_target_ref,p_payload);
  v_effects_hash := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(v_effects::text,'UTF8')),'hex');
  v_trace := v_trace || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'step',6,'input','dispatch','outcome',
    CASE v_dispatch WHEN 'EXECUTING' THEN 'EXECUTED' ELSE v_dispatch END));

  INSERT INTO core.action_requests
    (tenant_id,action_type,target_ref,target_entity,target_id,payload,value_sen,currency,
     requested_by_kind,requested_by_id,requested_by_role,agent_run_id,confidence,
     reasoning,evidence,context_flags,autonomy_level,granted_level,matched_policy_id,
     evaluation_trace,status,effects,effects_hash,idempotency_key_id)
  VALUES
    (v_tenant,p_type,p_target_ref,v_type.target_entity,v_target_id,p_payload,
     (v_value ->> 'amount')::bigint,(v_value ->> 'currency')::char(3),
     v_actor_kind,v_actor_id,v_actor_role,p_payload ->> 'runId',p_confidence,
     p_reasoning,p_evidence,v_context,v_level,v_granted,
     CASE WHEN v_policy_found THEN v_policy.id ELSE NULL END,
     v_trace,v_dispatch,v_effects,v_effects_hash,v_idempotency.id)
  RETURNING * INTO v_request;

  CASE v_dispatch
    WHEN 'EXECUTING' THEN
      PERFORM app.apply_effects(v_request.id);
      PERFORM pg_catalog.set_config('response.status','202',true);
      v_result := pg_catalog.jsonb_build_object(
        'status','EXECUTED','result',pg_catalog.jsonb_build_object('effects',v_effects));
    WHEN 'QUEUED_FOR_APPROVAL' THEN
      INSERT INTO core.approval_requests
        (tenant_id,action_request_id,policy_id,action_type,subject,target_ref,value_sen,
         currency,margin_rate,requested_by_kind,requested_by_id,requested_by_name,agent_run_id,
         confidence,autonomy,reason,recommendation,evidence,deviations,risk,diff,
         diff_hash,approver_role,assigned_to_id,assigned_to_name,sla_due_at,
         escalate_at,expires_at,bulk_approvable)
      VALUES
        (v_tenant,v_request.id,v_policy_id,p_type,
         p_type || CASE WHEN p_target_ref IS NULL THEN '' ELSE ' · ' || p_target_ref END,
         p_target_ref,(v_value ->> 'amount')::bigint,(v_value ->> 'currency')::char(3),
         v_resulting_margin,v_actor_kind,v_actor_id,v_actor_id,
         p_payload ->> 'runId',p_confidence,v_level,
         CASE WHEN v_low_confidence THEN 'GOV-05: confidence below minimum'
              WHEN v_policy_found THEN v_policy.description
              ELSE 'Autonomy level requires approval' END,
         CASE WHEN p_reasoning IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
           'verdict','RECOMMEND','rationale',p_reasoning) END,
         p_evidence,'[]'::jsonb,
         pg_catalog.jsonb_build_object(
           'level',CASE WHEN v_low_confidence OR v_jury_triggered THEN 'HIGH' ELSE 'MEDIUM' END,
           'note',CASE WHEN v_jury_triggered THEN 'Jury escalation requested'
                       WHEN v_low_confidence THEN 'Agent confidence is below its minimum'
                       ELSE 'Policy approval required' END),
         v_effects,v_effects_hash,v_approver_role,v_assignee_id,v_assignee_name,
         pg_catalog.now() + pg_catalog.make_interval(mins => v_sla_minutes),
         CASE WHEN v_escalate_minutes IS NULL THEN NULL ELSE
           pg_catalog.now() + pg_catalog.make_interval(mins => v_escalate_minutes) END,
         pg_catalog.now() + pg_catalog.make_interval(mins => v_expire_minutes),
         (v_value IS NULL AND NOT v_type.money_moving))
      RETURNING * INTO v_approval;

      UPDATE core.action_requests
         SET approval_request_id = v_approval.id,completed_at = pg_catalog.now()
       WHERE id = v_request.id;
      IF v_jury_triggered THEN
        PERFORM app.enqueue_jury(v_request.id,v_approval.id,'ESCALATE',v_jury_reason);
      END IF;
      PERFORM pg_catalog.set_config('response.status','202',true);
      v_result := pg_catalog.jsonb_build_object(
        'status','QUEUED_FOR_APPROVAL',
        'approvalRequest',pg_catalog.jsonb_build_object(
          'id',v_approval.id,'ref',v_approval.ref,'policyId',v_approval.policy_id,
          'approverRole',v_approval.approver_role,
          'assignedTo',pg_catalog.jsonb_build_object(
            'id',v_approval.assigned_to_id,'name',v_approval.assigned_to_name),
          'slaDueAt',v_approval.sla_due_at,'createdAt',v_approval.created_at));
    WHEN 'SUGGESTED' THEN
      INSERT INTO core.suggested_drafts
        (tenant_id,action_request_id,action_type,target_ref,body,payload,
         planned_effects,provenance,expires_at)
      VALUES
        (v_tenant,v_request.id,p_type,p_target_ref,
         COALESCE(p_payload ->> 'body',p_reasoning,''),p_payload,v_effects,
         pg_catalog.jsonb_build_object(
           'origin','AI_SUGGESTED','confidence',p_confidence,'agentId',v_actor_id,
           'runId',p_payload ->> 'runId','sources',p_evidence,
           'generatedAt',pg_catalog.now()),
         pg_catalog.now() + interval '7 days')
      RETURNING * INTO v_draft;
      UPDATE core.action_requests
         SET suggested_draft_id = v_draft.id,completed_at = pg_catalog.now()
       WHERE id = v_request.id;
      PERFORM pg_catalog.set_config('response.status','200',true);
      v_result := pg_catalog.jsonb_build_object(
        'status','SUGGESTED','draft',pg_catalog.jsonb_build_object(
          'id',v_draft.ref,'type',p_type,'body',v_draft.body,'expiresAt',v_draft.expires_at));
    ELSE
      RAISE EXCEPTION 'unknown dispatch result %L', v_dispatch
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;

  IF v_idempotency.id IS NOT NULL THEN
    UPDATE app.idempotency_keys
       SET state = 'COMPLETED',response = v_result,
           status_code = pg_catalog.current_setting('response.status',true)::integer,
           action_request_id = v_request.id,completed_at = pg_catalog.now(),
           expires_at = pg_catalog.now() + interval '24 hours'
     WHERE id = v_idempotency.id;
  END IF;
  RETURN v_result;
END;
$fn$;

-- ═══ 9 · Approval decisions ════════════════════════════════════════════════

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

  -- H-05: the decision endpoint is its own money-commitment boundary.
  IF v_type.money_moving AND v_actor.actor_kind = 'HUMAN'
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
      pg_catalog.convert_to(v_fresh::text,'UTF8')),'hex');
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

-- ═══ 11 · Bounded sweep functions (schedules land in 015) ═════════════════

CREATE OR REPLACE FUNCTION app.escalate_approvals(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'invalid escalation limit %', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH due AS (
    SELECT approval.id,approval.tenant_id,approval.requested_by_id,
           policy.escalate_to_role
      FROM core.approval_requests AS approval
      JOIN core.action_policies AS policy
        ON policy.tenant_id = approval.tenant_id AND policy.id = approval.policy_id
     WHERE approval.status = 'PENDING'
       AND approval.escalated_at IS NULL
       AND approval.escalate_at IS NOT NULL
       AND approval.escalate_at <= pg_catalog.now()
     ORDER BY approval.escalate_at,approval.id
     LIMIT p_limit
     FOR UPDATE OF approval SKIP LOCKED
  ), assigned AS (
    SELECT due.*,holder.actor_id,holder.actor_name
      FROM due
      LEFT JOIN LATERAL app.pick_role_holder(
        due.tenant_id,due.escalate_to_role,due.requested_by_id) AS holder ON true
  ), changed AS (
    UPDATE core.approval_requests AS approval
       SET escalated_at = pg_catalog.now(),
           escalated_to_role = assigned.escalate_to_role,
           assigned_to_id = assigned.actor_id,
           assigned_to_name = assigned.actor_name
      FROM assigned
     WHERE approval.id = assigned.id
       AND approval.status = 'PENDING'
       AND approval.escalated_at IS NULL
    RETURNING approval.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_count FROM changed;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.notify_approval_breaches(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'invalid breach limit %', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH due AS (
    SELECT approval.id
      FROM core.approval_requests AS approval
     WHERE approval.status = 'PENDING'
       AND approval.breach_notified_at IS NULL
       AND approval.sla_due_at < pg_catalog.now()
     ORDER BY approval.sla_due_at,approval.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), changed AS (
    UPDATE core.approval_requests AS approval
       SET breach_notified_at = pg_catalog.now()
      FROM due
     WHERE approval.id = due.id
       AND approval.status = 'PENDING'
       AND approval.breach_notified_at IS NULL
    RETURNING approval.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_count FROM changed;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.expire_approvals(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'invalid expiry limit %', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH due AS (
    SELECT approval.id,approval.action_request_id
      FROM core.approval_requests AS approval
     WHERE approval.status = 'PENDING' AND approval.expires_at < pg_catalog.now()
     ORDER BY approval.expires_at,approval.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), closed AS (
    UPDATE core.approval_requests AS approval
       SET status = 'EXPIRED'
      FROM due
     WHERE approval.id = due.id AND approval.status = 'PENDING'
    RETURNING approval.id,approval.action_request_id
  ), rejected AS (
    UPDATE core.action_requests AS request
       SET status = 'REJECTED',error_code = 'APPROVAL_EXPIRED',
           error_details = pg_catalog.jsonb_build_object(
             'code','APPROVAL_EXPIRED','retryable',true),
           completed_at = pg_catalog.now()
      FROM closed
     WHERE request.id = closed.action_request_id
       AND request.status = 'QUEUED_FOR_APPROVAL'
    RETURNING request.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_count FROM closed;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.cleanup_idempotency_keys(p_limit integer DEFAULT 10000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50000 THEN
    RAISE EXCEPTION 'invalid cleanup limit %', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH due AS (
    SELECT keyrow.ctid
      FROM app.idempotency_keys AS keyrow
     WHERE keyrow.expires_at < pg_catalog.now()
     ORDER BY keyrow.expires_at,keyrow.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), removed AS (
    DELETE FROM app.idempotency_keys AS keyrow
     USING due
     WHERE keyrow.ctid = due.ctid
       AND keyrow.expires_at < pg_catalog.now()
    RETURNING keyrow.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_count FROM removed;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.expire_suggested_drafts(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'invalid draft limit %', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH due AS (
    SELECT draft.id
      FROM core.suggested_drafts AS draft
     WHERE draft.status = 'OPEN' AND draft.expires_at < pg_catalog.now()
     ORDER BY draft.expires_at,draft.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), changed AS (
    UPDATE core.suggested_drafts AS draft
       SET status = 'EXPIRED'
      FROM due
     WHERE draft.id = due.id AND draft.status = 'OPEN'
    RETURNING draft.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_count FROM changed;
  RETURN v_count;
END;
$fn$;

-- ═══ 12 · Jury enqueue functions ═══════════════════════════════════════════

-- The supporting unique index is created beside the table in section 2. The
-- quoted PL/pgSQL body binds table plans on first execution, after the 011
-- relations have been created.

CREATE OR REPLACE FUNCTION app.enqueue_jury(
  p_action_request_id uuid,
  p_approval_id uuid,
  p_mode text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id      uuid;
  v_tenant  uuid;
  v_type    text;
  v_config  core.jury_configs%ROWTYPE;
BEGIN
  CASE p_mode
    WHEN 'GATE' THEN NULL;
    WHEN 'SAMPLE' THEN NULL;
    WHEN 'ESCALATE' THEN NULL;
    ELSE
      RAISE EXCEPTION 'unknown jury mode %L', p_mode
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
  IF p_reason IS NOT NULL AND p_reason NOT IN
       ('LOW_CONFIDENCE','HIGH_VALUE','FIRST_OF_KIND','SAMPLED','PROMOTION') THEN
    RAISE EXCEPTION 'unknown jury trigger reason %L', p_reason
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT request.tenant_id,request.action_type
    INTO v_tenant,v_type
    FROM core.action_requests AS request
   WHERE request.id = p_action_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'jury action request % does not exist', p_action_request_id
      USING ERRCODE = 'no_data_found';
  END IF;
  SELECT config.* INTO v_config
    FROM core.jury_configs AS config
   WHERE config.tenant_id = v_tenant
     AND config.action_type = v_type AND config.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active jury configuration for %', v_type
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO core.jury_verdicts
    (tenant_id,action_request_id,approval_request_id,mode,trigger_reason,
     quorum,"of",tiers)
  VALUES
    (v_tenant,p_action_request_id,p_approval_id,p_mode,p_reason,
     v_config.quorum,v_config."of",v_config.tiers)
  ON CONFLICT (approval_request_id,mode) WHERE approval_request_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT jury.id INTO v_id
      FROM core.jury_verdicts AS jury
     WHERE jury.approval_request_id = p_approval_id
       AND jury.mode = p_mode;
  END IF;

  -- No model call or job table write occurs in this transaction. 012 consumes
  -- the PENDING row through its own outbox and writes job_id later.
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.enqueue_jury_samples(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'invalid jury sample limit %', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH candidates AS (
    SELECT approval.id AS approval_id,approval.action_request_id,approval.tenant_id,
           config.quorum,config."of",config.tiers
      FROM core.approval_requests AS approval
      JOIN core.jury_configs AS config
        ON config.tenant_id = approval.tenant_id
       AND config.action_type = approval.action_type
     WHERE approval.status IN ('APPROVED','REJECTED')
       AND approval.decided_at BETWEEN pg_catalog.now() - interval '1 hour'
                                   AND pg_catalog.now() - interval '5 minutes'
       AND config.mode = 'SAMPLE' AND config.active
       AND NOT EXISTS (
         SELECT 1 FROM core.jury_verdicts AS jury
          WHERE jury.approval_request_id = approval.id AND jury.mode = 'SAMPLE')
       AND (pg_catalog.hashtext(approval.ref) & 2147483647) % 1000
           < (config.sample_rate * 1000)::integer
     ORDER BY approval.decided_at,approval.id
     LIMIT p_limit
     FOR UPDATE OF approval SKIP LOCKED
  ), inserted AS (
    INSERT INTO core.jury_verdicts
      (tenant_id,action_request_id,approval_request_id,mode,trigger_reason,
       quorum,"of",tiers)
    SELECT candidate.tenant_id,candidate.action_request_id,candidate.approval_id,
           'SAMPLE','SAMPLED',candidate.quorum,candidate."of",candidate.tiers
      FROM candidates AS candidate
    ON CONFLICT (approval_request_id,mode) WHERE approval_request_id IS NOT NULL
    DO NOTHING
    RETURNING id
  )
  SELECT pg_catalog.count(*)::integer INTO v_count FROM inserted;
  RETURN v_count;
END;
$fn$;


CREATE OR REPLACE FUNCTION app.bulk_decide(
  p_ids uuid[],
  p_decision text,
  p_note text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_tenant       uuid := app.require_tenant_id();
  v_actor        record;
  v_id           uuid;
  v_blocked      jsonb;
  v_results      jsonb := '[]'::jsonb;
  v_idempotency  app.idempotency_keys%ROWTYPE;
  v_request_hash text;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF p_ids IS NULL OR pg_catalog.cardinality(p_ids) = 0
     OR pg_catalog.cardinality(p_ids) <> (
       SELECT pg_catalog.count(DISTINCT item)::integer
         FROM pg_catalog.unnest(p_ids) AS item) THEN
    RAISE EXCEPTION 'ids must be a non-empty set'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','reason','INVALID_APPROVAL_IDS')::text;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    IF v_actor.actor_id IS NULL THEN
      RAISE EXCEPTION 'a principal is required for idempotency'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
    v_request_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'ids',p_ids,'decision',p_decision,'note',p_note)::text,'UTF8')),'hex');
    INSERT INTO app.idempotency_keys
      (tenant_id,actor_id,endpoint,key,request_hash)
    VALUES
      (v_tenant,v_actor.actor_id,'POST /v1/approvals/bulk-decide',
       p_idempotency_key,v_request_hash)
    ON CONFLICT (tenant_id,actor_id,endpoint,key) DO NOTHING
    RETURNING * INTO v_idempotency;
    IF v_idempotency.id IS NULL THEN
      SELECT keyrow.* INTO v_idempotency
        FROM app.idempotency_keys AS keyrow
       WHERE keyrow.tenant_id = v_tenant
         AND keyrow.actor_id = v_actor.actor_id
         AND keyrow.endpoint = 'POST /v1/approvals/bulk-decide'
         AND keyrow.key = p_idempotency_key;
      IF v_idempotency.request_hash IS DISTINCT FROM v_request_hash THEN
        RAISE EXCEPTION 'idempotency key reused with a different bulk decision'
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object('code','IDEMPOTENT_REPLAY')::text;
      END IF;
      PERFORM pg_catalog.set_config(
        'response.headers','[{"Idempotent-Replay":"true"}]',true);
      PERFORM pg_catalog.set_config('response.status','200',true);
      RETURN v_idempotency.response;
    END IF;
  END IF;

  IF (SELECT pg_catalog.count(*) FROM core.approval_requests AS approval
       WHERE approval.tenant_id = v_tenant AND approval.id = ANY (p_ids))
     <> pg_catalog.cardinality(p_ids) THEN
    RAISE EXCEPTION 'one or more approvals were not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id',approval.id,'ref',approval.ref,'reason',
           CASE WHEN approval.value_sen IS NOT NULL THEN 'MONETARY_VALUE'
                ELSE 'MONEY_MOVING_TYPE' END))
    INTO v_blocked
    FROM core.approval_requests AS approval
   WHERE approval.tenant_id = v_tenant AND approval.id = ANY (p_ids)
     AND NOT approval.bulk_approvable;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'one or more approvals may not be decided in bulk'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','BULK_NOT_PERMITTED','notBulkApprovable',v_blocked)::text;
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    v_results := v_results || pg_catalog.jsonb_build_array(
      app.decide_approval(v_id,p_decision,p_note,NULL,NULL));
  END LOOP;
  v_results := pg_catalog.jsonb_build_object(
    'data',v_results,'count',pg_catalog.jsonb_array_length(v_results));

  IF v_idempotency.id IS NOT NULL THEN
    UPDATE app.idempotency_keys
       SET state = 'COMPLETED',response = v_results,status_code = 200,
           completed_at = pg_catalog.now(),expires_at = pg_catalog.now() + interval '24 hours'
     WHERE id = v_idempotency.id;
  END IF;
  PERFORM pg_catalog.set_config('response.status','200',true);
  RETURN v_results;
END;
$fn$;

-- ═══ 10 · Typed external-effect write-back ═════════════════════════════════

CREATE OR REPLACE FUNCTION app.report_effect_result(
  p_effect_id bigint,
  p_status app.effect_status,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_error jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_effect     app.action_effects%ROWTYPE;
  v_new_status app.effect_status;
  v_open       integer;
  v_failed     integer;
BEGIN
  IF p_status IS NULL THEN
    RAISE EXCEPTION 'unrecognised worker effect status NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF pg_catalog.jsonb_typeof(COALESCE(p_result,'{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'effect result must be an object'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT effect.* INTO v_effect
    FROM app.action_effects AS effect
   WHERE effect.id = p_effect_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no effect %', p_effect_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_effect.kind <> 'EXTERNAL' THEN
    RAISE EXCEPTION 'effect % is not external', p_effect_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_effect.status IN ('SETTLED','DEAD_LETTERED') THEN
    RETURN;
  END IF;

  -- R14: no ELSE that silently turns a foreign word into failure. The enum is
  -- the seam; every in-enum but non-reporting state also raises explicitly.
  CASE p_status
    WHEN 'SUCCEEDED' THEN v_new_status := 'SETTLED';
    WHEN 'FAILED' THEN v_new_status := 'DEAD_LETTERED';
    WHEN 'PLANNED' THEN
      RAISE EXCEPTION 'unrecognised worker effect status %L', p_status;
    WHEN 'APPLIED' THEN
      RAISE EXCEPTION 'unrecognised worker effect status %L', p_status;
    WHEN 'DISPATCHED' THEN
      RAISE EXCEPTION 'unrecognised worker effect status %L', p_status;
    WHEN 'SETTLED' THEN
      RAISE EXCEPTION 'unrecognised worker effect status %L', p_status;
    WHEN 'DEAD_LETTERED' THEN
      RAISE EXCEPTION 'unrecognised worker effect status %L', p_status;
    ELSE
      RAISE EXCEPTION 'unrecognised worker effect status %L', p_status;
  END CASE;

  IF p_status = 'FAILED' AND NOT (
       p_error IS NOT NULL AND pg_catalog.jsonb_typeof(p_error) = 'object'
       AND p_error ? 'code' AND p_error ? 'message' AND p_error ? 'retryable') THEN
    RAISE EXCEPTION 'terminal failure requires code, message and retryable'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE app.action_effects
     SET status = v_new_status,attempts = attempts + 1,
         last_error = CASE WHEN p_status = 'FAILED' THEN p_error ELSE NULL END,
         retryable = CASE WHEN p_status = 'FAILED'
                          THEN (p_error ->> 'retryable')::boolean ELSE false END,
         applied_at = CASE WHEN p_status = 'SUCCEEDED'
                           THEN pg_catalog.now() ELSE applied_at END
   WHERE id = v_effect.id;

  SELECT pg_catalog.count(*) FILTER (
           WHERE effect.status NOT IN ('SETTLED','DEAD_LETTERED','APPLIED')),
         pg_catalog.count(*) FILTER (WHERE effect.status = 'DEAD_LETTERED')
    INTO v_open,v_failed
    FROM app.action_effects AS effect
   WHERE effect.action_request_id = v_effect.action_request_id;
  IF v_open = 0 THEN
    UPDATE core.action_requests
       SET status = CASE WHEN v_failed > 0 THEN 'PARTIALLY_FAILED' ELSE 'EXECUTED' END,
           completed_at = pg_catalog.now()
     WHERE id = v_effect.action_request_id AND status = 'EXECUTING';
  END IF;
END;
$fn$;

-- ═══ 13 · Privilege boundary ═══════════════════════════════════════════════

-- Functions default to PUBLIC EXECUTE. Remove that default from precisely the
-- 011 set; no blanket schema revoke may damage 001-010's RLS helpers (M-04).
DO $revoke$
DECLARE v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT procedure.oid::regprocedure
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'app'
       AND procedure.proname = ANY (ARRAY[
         'is_valid_condition_set','autonomy_rank','jnum','policy_matches','aal2_verified',
         'seed_action_policies','seed_action_policies_on_tenant',
         'enforce_autonomy_ceiling','assert_gates_exist','enforce_state_transition',
         'resolve_action_target_id','action_value','open_approval_count',
         'pick_role_holder','plan_effects',
         'execute_in_database_action','apply_effects','perform_action','decide_approval',
         'bulk_decide','report_effect_result','escalate_approvals',
         'notify_approval_breaches','expire_approvals','cleanup_idempotency_keys',
         'expire_suggested_drafts','enqueue_jury','enqueue_jury_samples'])
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',v_function);
  END LOOP;
END;
$revoke$;

GRANT EXECUTE ON FUNCTION app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.decide_approval(uuid,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.bulk_decide(uuid[],text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION app.report_effect_result(bigint,app.effect_status,jsonb,jsonb)
  TO service_role;

-- ═══ 14 · Structural verification ══════════════════════════════════════════

DO $verify$
DECLARE
  v_count       integer;
  v_role        text;
  v_relation    regclass;
  v_function    regprocedure;
  v_definition  text;
  v_column      record;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM (VALUES
      ('core.autonomy_grants'),('core.action_policies'),('core.action_requests'),
      ('app.action_effects'),('core.approval_requests'),('core.approval_decisions'),
      ('app.idempotency_keys'),('core.suggested_drafts'),('core.jury_configs'),
      ('core.jury_verdicts'),('core.state_transitions')
    ) AS expected(name)
   WHERE pg_catalog.to_regclass(expected.name) IS NOT NULL;
  IF v_count <> 11 THEN
    RAISE EXCEPTION '011 verify: expected 11 tables, found %', v_count;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE (namespace.nspname,class.relname) IN (
     ('core','autonomy_grants'),('core','action_policies'),('core','action_requests'),
     ('app','action_effects'),('core','approval_requests'),
     ('core','approval_decisions'),('app','idempotency_keys'),
     ('core','suggested_drafts'),('core','jury_configs'),('core','jury_verdicts'),
     ('core','state_transitions'))
     AND class.relrowsecurity AND class.relforcerowsecurity;
  IF v_count <> 11 THEN
    RAISE EXCEPTION '011 verify: only % of 11 tables have RLS enabled and forced',v_count;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'app'
     AND procedure.proname = ANY (ARRAY[
       'is_valid_condition_set','autonomy_rank','jnum','policy_matches','aal2_verified',
       'seed_action_policies','seed_action_policies_on_tenant',
       'enforce_autonomy_ceiling','assert_gates_exist','enforce_state_transition',
       'resolve_action_target_id','action_value','open_approval_count',
       'pick_role_holder','plan_effects',
       'execute_in_database_action','apply_effects','perform_action','decide_approval',
       'bulk_decide','report_effect_result','escalate_approvals',
       'notify_approval_breaches','expire_approvals','cleanup_idempotency_keys',
       'expire_suggested_drafts','enqueue_jury','enqueue_jury_samples'])
     AND procedure.proconfig @> ARRAY['search_path=""'];
  IF v_count <> 28 THEN
    RAISE EXCEPTION '011 verify: expected 28 functions with search_path="", found %', v_count;
  END IF;

  IF (SELECT pg_catalog.count(*) FROM app.action_types) <> 22 THEN
    RAISE EXCEPTION '011 verify: expected exactly 22 action types';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.state_transitions) <> 124 THEN
    RAISE EXCEPTION '011 verify: expected exactly 124 state transitions '
      '(121 from doc 01 s5.3 + 3 payment-reversal edges it omits)';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.action_policies)
     <> 22 * (SELECT pg_catalog.count(*) FROM public.tenants) THEN
    RAISE EXCEPTION '011 verify: expected exactly 22 policies per tenant';
  END IF;
  IF EXISTS (
    SELECT tenant.id
      FROM public.tenants AS tenant
      LEFT JOIN core.action_policies AS policy ON policy.tenant_id = tenant.id
     GROUP BY tenant.id
    HAVING pg_catalog.count(policy.id) <> 22
       OR pg_catalog.array_agg(policy.id ORDER BY policy.id) <> ARRAY[
         'APV-01','APV-02','APV-03','APV-04','APV-05','APV-06','APV-07','APV-08',
         'CMP-01','CMP-02','CMP-03','CMP-04','CMP-05',
         'FIN-01','FIN-02','FIN-03','FIN-04','FIN-05','FIN-06','FIN-07',
         'GOV-01','GOV-02']) THEN
    RAISE EXCEPTION '011 verify: a tenant policy catalogue is incomplete';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_trigger AS trigger
   WHERE NOT trigger.tgisinternal
     AND trigger.tgfoid = 'app.enforce_state_transition()'::regprocedure;
  IF v_count <> 15 THEN
    RAISE EXCEPTION '011 verify: expected 15 extant state-gate attachments, found %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'core' AND class.relname = 'autonomy_grants'
       AND policy.polname = 'autonomy_grants_agents_cannot_write'
       AND NOT policy.polpermissive AND policy.polcmd = '*'
       AND pg_catalog.strpos(pg_catalog.pg_get_expr(policy.polqual,policy.polrelid), 'is_agent()') > 0
       AND pg_catalog.strpos(pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid), 'is_agent()') > 0) THEN
    RAISE EXCEPTION '011 verify: H-02 restrictive policy is missing or changed';
  END IF;
  IF (SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid IN (
         'core.autonomy_grants'::regclass,'core.action_policies'::regclass,
         'core.action_requests'::regclass,'app.action_effects'::regclass,
         'core.approval_requests'::regclass,'core.approval_decisions'::regclass,
         'app.idempotency_keys'::regclass,'core.suggested_drafts'::regclass,
         'core.jury_configs'::regclass,'core.jury_verdicts'::regclass,
         'core.state_transitions'::regclass)) <> 1 THEN
    RAISE EXCEPTION '011 verify: expected only the H-02 pre-014 policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'core.v_approval_requests'::regclass
       AND class.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '011 verify: approval view is not security invoker';
  END IF;

  IF (SELECT pg_catalog.array_agg(enum.enumlabel::text ORDER BY enum.enumsortorder)
        FROM pg_catalog.pg_enum AS enum
       WHERE enum.enumtypid = 'app.effect_status'::regtype) <> ARRAY[
         'PLANNED','APPLIED','DISPATCHED','SUCCEEDED','FAILED','SETTLED','DEAD_LETTERED'] THEN
    RAISE EXCEPTION '011 verify: effect_status vocabulary drifted';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_type AS type
       WHERE type.typname = 'effect_status') <> 1 THEN
    RAISE EXCEPTION '011 verify: effect_status was duplicated';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR v_relation IN
      SELECT pg_catalog.to_regclass(name) FROM (VALUES
        ('core.autonomy_grants'),('core.action_policies'),('core.action_requests'),
        ('app.action_effects'),('core.approval_requests'),('core.approval_decisions'),
        ('app.idempotency_keys'),('core.suggested_drafts'),('core.jury_configs'),
        ('core.jury_verdicts'),('core.state_transitions'),('core.v_approval_requests')
      ) AS relation(name)
    LOOP
      IF pg_catalog.has_table_privilege(v_role,v_relation,'SELECT') THEN
        RAISE EXCEPTION '011 verify: % has SELECT on %', v_role,v_relation;
      END IF;
    END LOOP;
    FOR v_function IN
      SELECT procedure.oid::regprocedure
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app'
         AND procedure.proname = ANY (ARRAY[
           'is_valid_condition_set','autonomy_rank','jnum','policy_matches','aal2_verified',
           'seed_action_policies','seed_action_policies_on_tenant',
           'enforce_autonomy_ceiling','assert_gates_exist','enforce_state_transition',
           'resolve_action_target_id','action_value','open_approval_count',
           'pick_role_holder','plan_effects',
           'execute_in_database_action','apply_effects','perform_action','decide_approval',
           'bulk_decide','report_effect_result','escalate_approvals',
           'notify_approval_breaches','expire_approvals','cleanup_idempotency_keys',
           'expire_suggested_drafts','enqueue_jury','enqueue_jury_samples'])
    LOOP
      IF pg_catalog.has_function_privilege(v_role,v_function,'EXECUTE') THEN
        RAISE EXCEPTION '011 verify: % has EXECUTE on %', v_role,v_function;
      END IF;
    END LOOP;
  END LOOP;

  IF pg_catalog.has_table_privilege('anon','app.action_types','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','app.action_types','SELECT') THEN
    RAISE EXCEPTION '011 verify: action_types catalogue became client-readable';
  END IF;

  FOR v_column IN
    SELECT * FROM (VALUES
      ('core.enquiries','status'),('core.opportunities','stage'),
      ('core.tnas','status'),('core.proposals','status'),
      ('core.quotations','status'),('core.engagements','status'),
      ('core.attendance_days','status'),('core.hrdc_packets','status'),
      ('core.invoices','status'),('core.invoices','sync_state'),
      ('core.collections_cases','stage'),('core.trainer_bookings','state'),
      ('core.compliance_rules','status'),('core.rule_changes','status'),
      ('core.outbound_messages','status'))
      AS gated(relation_name,column_name)
  LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF pg_catalog.has_column_privilege(
           v_role,v_column.relation_name,v_column.column_name,'UPDATE') THEN
        RAISE EXCEPTION '011 verify: % can UPDATE %.%',
          v_role,v_column.relation_name,v_column.column_name;
      END IF;
    END LOOP;
  END LOOP;

  -- H-07 regression tripwire. Whitespace is normalised out of BOTH sides before
  -- the comparison: the version this replaces searched for
  -- `status IN ('EXECUTING', 'EXECUTED')` with a space after the comma and the
  -- body writes it without one, so the guard failed on its own formatting
  -- rather than on a missing predicate. A text assertion that can fail for a
  -- reason unrelated to its subject is worse than none, because the next author
  -- deletes it. This one is a tripwire only; the BEHAVIOUR is proved by
  -- test_011, which drives a QUEUED_FOR_APPROVAL request and a wrong target_id
  -- through the trigger and reads the refusal.
  SELECT pg_catalog.regexp_replace(
           pg_catalog.pg_get_functiondef(
             'app.enforce_state_transition()'::regprocedure),
           '\s+', '', 'g')
    INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'statusNOTIN(''EXECUTING'',''EXECUTED'')') = 0
     OR pg_catalog.strpos(v_definition, 'target_idISDISTINCTFROMNEW.id') = 0
     OR pg_catalog.strpos(v_definition, 'NEW.tenant_idISNOTNULLANDv_request.tenant_idISDISTINCTFROMNEW.tenant_id') = 0 THEN
    RAISE EXCEPTION '011 verify: H-07 predicates are incomplete';
  END IF;

  SELECT pg_catalog.regexp_replace(
           pg_catalog.pg_get_functiondef(
             'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure),
           '\s+', '', 'g')
    INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'jsonb_array_elements_text') = 0
     OR pg_catalog.strpos(v_definition, 'COALESCE(v_type.payload_schema') > 0 THEN
    RAISE EXCEPTION '011 verify: N-03 payload validator is not fail closed';
  END IF;
END;
$verify$;

COMMIT;
