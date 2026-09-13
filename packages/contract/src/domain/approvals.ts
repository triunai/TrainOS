/**
 * §7 · Approvals.
 *
 * Screens M02-S01 (inbox) and M02-S02 (detail).
 * The core `ApprovalRequest` lives in actions.ts because §3 returns it; this
 * file adds the list, detail and decision shapes.
 */

import type { Actor, Money, Rate, Ref, Timestamp } from '../envelope';
import type {
  ApprovalEvidence,
  ApprovalRecommendation,
  ApprovalRequest,
  ApprovalRisk,
  DiffLine,
  Effect,
} from '../actions';
import type { ApprovalDecision, ApprovalStatus, UrgencyGroup } from '../enums';

/* ------------------------------------------------------------------ *
 * §7 · GET /v1/approvals?group=URGENCY — M02-S01
 * ------------------------------------------------------------------ */

/** §7 a bucket header on the grouped inbox. */
export interface ApprovalGroup {
  key: UrgencyGroup;
  count: number;
}

/**
 * §7 the approval inbox.
 *
 * §15 item 1: `medianDecisionTime` is rendered on M02-S01 but has no
 * first-class source. The contract's own proposal is to add it here as
 * `summary.medianDecisionSeconds`, so it is typed optional until confirmed.
 * TODO(contract §15.1): confirm `summary.medianDecisionSeconds`.
 */
export interface ApprovalListResponse {
  data: ApprovalRequest[];
  page: { next: string | null; total: number };
  groups: ApprovalGroup[];
  summary?: ApprovalListSummary;
}

/** §15 item 1 — proposed, not yet in a documented response. */
export interface ApprovalListSummary {
  medianDecisionSeconds?: number;
}

/* ------------------------------------------------------------------ *
 * §7 · GET /v1/approvals/{id} — M02-S02
 * ------------------------------------------------------------------ */

/**
 * §7 the whole decision payload.
 *
 * The screen answers four questions in order: why this needs you (`reason`),
 * what the agent recommends (`recommendation`), what it is standing on
 * (`evidence`, `deviations`, `risk`), and what happens if you approve (`diff`).
 */
export interface ApprovalDetail
  extends Omit<ApprovalRequest, 'bulkApprovable' | 'urgencyGroup'> {
  marginRate?: Rate;
  reason: string;
  recommendation: ApprovalRecommendation;
  evidence: ApprovalEvidence[];
  /** Plain sentences: how this differs from the normal case. */
  deviations: string[];
  risk: ApprovalRisk;
  /** What `POST /decide` promises to do. */
  diff: DiffLine[];
  previewUrl?: string;
  /** §17 — present when a jury ran; rendered under the evidence list on M02-S02. */
  modelAgreement?: ModelAgreement;
  bulkApprovable?: boolean;
  urgencyGroup?: UrgencyGroup;
}

/** §17 the jury summary an approval renders when one ran. */
export interface ModelAgreement {
  quorum: number;
  of: number;
  agreed: string[];
  dissented: { model: string; note: string }[];
}

/* ------------------------------------------------------------------ *
 * §7 · POST /v1/approvals/{id}/decide
 * ------------------------------------------------------------------ */

/** §7 the decision body. `note` is required for REQUEST_CHANGES and REJECT. */
export interface ApprovalDecideRequest {
  decision: ApprovalDecision;
  note: string | null;
  /**
   * The `diffHash` off the `ApprovalRequest`/`ApprovalDetail` the screen is
   * currently rendering, echoed back as `p_expected_diff_hash` so
   * `core.decide_approval`'s optimistic-concurrency check
   * (`011:2781-2787`) can refuse a decision made against a stale diff.
   *
   * Required, not optional: the only caller (M02-S02) always has one, having
   * just read it off the same approval it is now deciding.
   */
  diffHash: string;
}

/**
 * §7 the decision result.
 *
 * `effects[]` **must match** the `diff[]` shown on the detail screen. If the
 * world changed since the diff was computed, the endpoint returns `409` with
 * `details.diffChanged: true` and the recomputed diff.
 * Idempotent: yes. Emits `ApprovalDecided`, then the action's own event.
 * TODO(contract §16 Q2): is a 409 with a recomputed diff acceptable UX, or
 * should approvals hold a soft lock on the target?
 */
export interface ApprovalDecideResponse {
  status: ApprovalStatus;
  decidedBy: Actor;
  decidedAt: Timestamp;
  effects: Effect[];
}

/** §7 the `409` body when the world moved under a rendered diff. */
export interface ApprovalDiffChangedDetails {
  diffChanged: true;
  diff: DiffLine[];
  /** The fresh diff's hash — what a retried decide should echo back. */
  diffHash: string;
}

/**
 * §7 `POST /v1/approvals/bulk-decide` — `409` if any id has
 * `bulkApprovable: false`. `bulkApprovable` is server-decided: false for any
 * action carrying a monetary value.
 */
export interface ApprovalBulkDecideRequest {
  ids: string[];
  decision: ApprovalDecision;
  note?: string | null;
}

/** §7 the bulk result, one row per id. */
export interface ApprovalBulkDecideResponse {
  results: {
    id: string;
    ref: Ref;
    status: ApprovalStatus;
    effects?: Effect[];
  }[];
}

/**
 * §7 the approval summary the executive dashboard embeds (§10
 * `approvalsPending[]`).
 */
export interface ApprovalSummary {
  ref: Ref;
  subject: string;
  value?: Money;
  slaDueAt: Timestamp;
  slaBreached: boolean;
  urgencyGroup: UrgencyGroup;
}

/**
 * TODO(contract §16 Q1): does an approval expire? The SLA escalates to the MD
 * at 6h but nothing defines what happens at 24h. `ApprovalStatus` carries
 * `EXPIRED`, so the state exists without a documented trigger.
 */
export type ApprovalExpiryPolicy = never;
