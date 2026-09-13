/**
 * §3 · The action envelope.
 *
 * Everything a human can do and an agent can propose goes through
 * `POST /v1/actions`. This is the centre of the contract: the UI never decides
 * whether something executes, it renders the response.
 */

import type {
  Actor,
  Confidence,
  ErrorCode,
  Money,
  Provenance,
  Ref,
  Timestamp,
} from './envelope';
import type {
  ApprovalStatus,
  AutonomyLevel,
  DiffOp,
  EvidenceType,
  FilterOp,
  Role,
  RiskLevel,
  UrgencyGroup,
} from './enums';

/* ------------------------------------------------------------------ *
 * §3 · Action types
 * ------------------------------------------------------------------ */

/** §3 the canonical action-type list. */
export const ACTION_TYPES = [
  'ENQUIRY_ARCHIVE',
  'OPPORTUNITY_CONVERT',
  'TNA_RECOMMENDATION_ACCEPT',
  'PROPOSAL_SEND',
  'QUOTATION_APPLY',
  'DISCOUNT_APPROVE',
  'TRAINER_BOOK',
  'ENGAGEMENT_CLOSE_OUT',
  'ATTENDANCE_APPROVE',
  'ATTENDANCE_UNLOCK',
  'HRDC_PACKET_MARK_SUBMITTED',
  'INVOICE_CREATE',
  'INVOICE_PUSH',
  'PAYMENT_RECORD',
  'REMINDER_SEND',
  'FOLLOWUP_SEND',
  'BROADCAST_SEND',
  'AGENT_AUTONOMY_CHANGE',
  'AGENT_PAUSE',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** §17 action types added by the AI-operations pass. */
export const AI_OPS_ACTION_TYPES = ['BUDGET_CAP_RAISE', 'RULE_CHANGE_APPROVE'] as const;
export type AiOpsActionType = (typeof AI_OPS_ACTION_TYPES)[number];

/**
 * Action types the contract's cadence requires but its lists never name.
 *
 * Ruling R3: `ACCOUNT_TRADING_HOLD`. §9 says the collections ladder ends in a
 * "trading hold at 75 with MD approval" and §12 catalogues `TRADING_HOLD` as a
 * `CollectionStage`, but the §3 list has no action type that applies one — so
 * the step that needs the MD's approval cannot be expressed through the one
 * endpoint that gates approvals. This closes that gap.
 *
 * Ruling R18: `OPPORTUNITY_STAGE_CHANGE`. §12 catalogues `OpportunityStage`
 * with seven members and §5 serves the OPPORTUNITY pipeline's stages, so the
 * contract describes a board a deal moves across — and then names only
 * `OPPORTUNITY_CONVERT`, which CREATES an opportunity from an enquiry. There
 * is no type for moving one that already exists.
 *
 * That gap has teeth, because R1 sends every write through `POST /v1/actions`:
 * without a type, a pipeline board's drag either cannot be governed at all or
 * has to borrow a type that means something else. `WON` and `LOST` are the
 * terminal stages (ruling R16), so this is a write that ends deals — exactly
 * the shape §3 exists to put a policy in front of.
 *
 * Both of these are RULED rather than added to `ACTION_TYPES`, which stays the
 * §3 nineteen verbatim. A reader comparing this file to the contract should
 * find the §3 list unchanged and the additions marked.
 */
export const RULED_ACTION_TYPES = ['ACCOUNT_TRADING_HOLD', 'OPPORTUNITY_STAGE_CHANGE'] as const;
export type RuledActionType = (typeof RULED_ACTION_TYPES)[number];

/** §3 + §17 + rulings R3 and R18 — every type `POST /v1/actions` accepts. */
export const ALL_ACTION_TYPES = [
  ...ACTION_TYPES,
  ...AI_OPS_ACTION_TYPES,
  ...RULED_ACTION_TYPES,
] as const;
export type AnyActionType = ActionType | AiOpsActionType | RuledActionType;

/**
 * §10 / §17 action types that carry an autonomy grant or a routing entry but
 * are not themselves `POST /v1/actions` calls. `PROPOSAL_DRAFT` is the only
 * one in the examples (`GET /v1/agents`, `GET /v1/ai/routing`).
 */
export const GOVERNED_ACTION_TYPES = [...ALL_ACTION_TYPES, 'PROPOSAL_DRAFT'] as const;
export type GovernedActionType = AnyActionType | 'PROPOSAL_DRAFT';

/**
 * §2 / §5 action types offered by the command palette and the cross-sell
 * panel. These are UI intents that resolve to a route, not action-envelope
 * calls — none of them appears in the §3 list.
 */
export const UI_ACTION_TYPES = [
  'PROPOSAL_CREATE',
  'OPPORTUNITY_CREATE',
  'SUGGESTION_DISMISS',
] as const;
export type UiActionType = (typeof UI_ACTION_TYPES)[number];

/* ------------------------------------------------------------------ *
 * §3 · Request
 * ------------------------------------------------------------------ */

/** §3 one citation an agent offers for its proposal. */
export interface EvidenceRef {
  type: EvidenceType;
  ref: Ref;
  excerpt?: string;
}

/**
 * §3 `POST /v1/actions` request body.
 *
 * `payload` shape varies by `type`; the contract gives examples per section
 * rather than a closed schema, so it is left open and parameterised.
 * Accepts `Idempotency-Key` (§1).
 */
export interface ActionRequest<P = Record<string, unknown>> {
  type: AnyActionType;
  targetRef: Ref;
  payload?: P;
  requestedBy: Actor;
  /** Agent callers only; compared against the agent's minimum for the type. */
  confidence?: Confidence;
  reasoning?: string;
  evidence?: EvidenceRef[];
}

/* ------------------------------------------------------------------ *
 * §3 · Diff and effects
 * ------------------------------------------------------------------ */

/**
 * §7 one line of "if you approve, this happens".
 *
 * The diff is the contract that matters most: `effects[]` returned by
 * `POST /v1/approvals/{id}/decide` **must match** the `diff[]` rendered on the
 * detail screen.
 */
export interface DiffLine {
  op: DiffOp;
  entity: string;
  ref?: Ref;
  description: string;
}

/**
 * §3 / §7 one line of what actually happened.
 *
 * Same shape and same `op` union as {@link DiffLine}, so the two can be
 * compared field for field — §7 requires `effects[]` to equal the `diff[]`
 * rendered on the approval detail. Ruling R1: the `CREATE` in the §4
 * `OPPORTUNITY_CONVERT` example normalises to `ADD`.
 */
export interface Effect {
  op: DiffOp;
  entity: string;
  ref?: Ref;
  /**
   * Required, like `DiffLine.description`: the policy gate always produces a
   * sentence for every effect, so the two lists can be compared field for
   * field without a null case.
   */
  description: string;
}

/* ------------------------------------------------------------------ *
 * §3 · Policy evaluation
 * ------------------------------------------------------------------ */

/** §3 step 3 — context flags computed server-side, never sent by the client. */
export interface PolicyContextFlags {
  firstProposalToOrg: boolean;
  belowFloorPrice: boolean;
  overdueBalanceOnAccount: boolean;
  attendanceLocked: boolean;
  deadlineWithinDays: number;
}

/**
 * §3 the five inputs `POST /v1/actions` resolves, in order, to decide whether
 * an action executes, queues for approval, or comes back as a suggestion.
 *
 * 1. `type` → the autonomy level granted to `requestedBy` (§10). Human
 *    requesters skip to step 3.
 * 2. `payloadValue` compared against policy thresholds.
 * 3. `context` flags computed server-side.
 * 4. `confidence` against the agent's minimum for that action.
 * 5. `requesterRole` against the policy's `approverRole` — a user cannot
 *    approve their own request.
 */
export interface PolicyEvaluationInput {
  type: GovernedActionType;
  requestedBy: Actor;
  /** Step 1. Absent for human requesters. */
  grantedAutonomy?: AutonomyLevel;
  /** Step 2. Absent when the action moves no money. */
  payloadValue?: Money;
  /** Step 3. */
  context: PolicyContextFlags;
  /** Step 4. Agent requesters only. */
  confidence?: Confidence;
  /** Step 5. */
  requesterRole: Role;
}

/** §2 one condition on a policy. */
export interface PolicyCondition {
  /** Dotted path into the action request or the computed context. */
  field: string;
  op: FilterOp;
  value: unknown;
}

/** §2 `GET /v1/policies` — read-only for the demo. */
export interface Policy {
  id: string;
  actionType: GovernedActionType;
  description: string;
  conditions: PolicyCondition[];
  combinator: 'ANY' | 'ALL';
  approverRole: Role;
  slaMinutes: number;
  escalateToRole?: Role;
  escalateAfterMinutes?: number;
}

/* ------------------------------------------------------------------ *
 * §7 · Approval request
 * ------------------------------------------------------------------ */

/**
 * §3 the compact approval reference returned inside a
 * `QUEUED_FOR_APPROVAL` action response.
 */
export interface ApprovalRequestRef {
  id: string;
  ref: Ref;
  policyId: string;
  approverRole: Role;
  assignedTo?: Actor;
  slaDueAt: Timestamp;
  createdAt: Timestamp;
}

/**
 * §7 the approval record as listed on M02-S01.
 *
 * `bulkApprovable` is server-decided: `false` for any action carrying a
 * monetary value. `slaBreached` never blocks — it is the `SLA_BREACHED`
 * "200 + flag" row of the §1 error table.
 */
export interface ApprovalRequest {
  id: string;
  ref: Ref;
  policyId: string;
  actionType: GovernedActionType;
  subject: string;
  targetRef: Ref;
  value?: Money;
  requestedBy: ApprovalRequester;
  confidence?: Confidence;
  autonomy?: AutonomyLevel;
  slaDueAt: Timestamp;
  slaRemainingMinutes?: number;
  slaBreached: boolean;
  status: ApprovalStatus;
  /**
   * SHA-256 hex digest of the rendered `diff[]`, computed server-side
   * (`011:2635`) and stored on the approval row.
   *
   * `POST /decide` must echo this back so `core.decide_approval`'s
   * optimistic-concurrency check (`011:2781-2787`) can tell a decision made
   * against the diff still shown here from one made against a diff that has
   * since changed underneath it. See the retrofit review's finding #6
   * (`docs/reviews/2026-09-13-codex-retrofit-014-017.md`).
   */
  diffHash: string;
  bulkApprovable: boolean;
  urgencyGroup: UrgencyGroup;
}

/** §7 who raised the approval; an agent requester carries its run id. */
export interface ApprovalRequester {
  kind: 'HUMAN' | 'AGENT';
  id: string;
  name: string;
  runId?: string;
}

/** §7 the agent's own verdict, rendered above the evidence list. */
export interface ApprovalRecommendation {
  verdict: string;
  rationale: string;
  provenance?: Provenance;
}

/** §7 numbered evidence row on the approval detail. */
export interface ApprovalEvidence {
  n: number;
  type: EvidenceType;
  ref: Ref;
  label: string;
}

/** §7 the risk callout. */
export interface ApprovalRisk {
  level: RiskLevel;
  note: string;
}

/* ------------------------------------------------------------------ *
 * §3 · Responses
 * ------------------------------------------------------------------ */

/** §3 `202 EXECUTED` — the action ran. `effects[]` says what changed. */
export interface ActionExecutedResponse<R extends ActionResult = ActionResult> {
  status: 'EXECUTED';
  result: R;
}

/** §3 the common floor of every `EXECUTED` result. */
export interface ActionResult {
  effects: Effect[];
  [key: string]: unknown;
}

/** §3 `202 QUEUED_FOR_APPROVAL` — a policy intercepted the action. */
export interface ActionQueuedResponse {
  status: 'QUEUED_FOR_APPROVAL';
  approvalRequest: ApprovalRequestRef;
}

/** §3 the draft returned when an agent is at `SUGGEST` autonomy. */
export interface ActionDraft {
  id: string;
  type: GovernedActionType;
  body: string;
  expiresAt: Timestamp;
}

/** §3 `200 SUGGESTED` — the agent may not act, so it hands over a draft. */
export interface ActionSuggestedResponse {
  status: 'SUGGESTED';
  draft: ActionDraft;
}

/**
 * §3 the three documented outcomes of `POST /v1/actions`.
 *
 * §12 `ActionStatus` also catalogues `REJECTED`, which has no documented
 * response body — see the note on `ACTION_STATUSES` in enums.ts.
 */
export type ActionResponse<R extends ActionResult = ActionResult> =
  | ActionExecutedResponse<R>
  | ActionQueuedResponse
  | ActionSuggestedResponse;

/**
 * §4 the suggested action an agent attaches to a record, before anyone has
 * asked for it. Submitting it is a `POST /v1/actions` with the same payload.
 */
export interface SuggestedAction<P = Record<string, unknown>> {
  type: GovernedActionType;
  autonomy: AutonomyLevel;
  summary: string;
  payload?: P;
  provenance?: Provenance;
  /** §4 API.md carries the preview diff alongside the suggestion. */
  diff?: DiffLine[];
}

/** §3 `POLICY_APPROVAL_REQUIRED` is the §1 error code this endpoint raises. */
export const ACTION_POLICY_ERROR: ErrorCode = 'POLICY_APPROVAL_REQUIRED';
