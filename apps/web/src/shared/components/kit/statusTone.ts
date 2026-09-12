import type {
  ApprovalStatus,
  CheckState,
  EngagementStatus,
  InvoiceStatus,
  LifecycleState,
  OpportunityStage,
  PacketStatus,
  ProposalStatus,
  RunStatus,
  SyncState,
  TierStatus,
} from "@trainos/contract";
import type { StatusTone } from "./StatusChip";

/**
 * Contract enum → chip tone.
 *
 * This is the single decision about which states are worth a colour. Putting it
 * in one file means a screen never argues with another screen about whether
 * `SENT` is green: it is `neutral` here, so it is neutral everywhere.
 *
 * The bias throughout is to spend nothing. A state a user cannot act on gets
 * `neutral` even when it is nominally good news — colour is for the rows that
 * need a hand, and a screen where everything is coloured says nothing at all.
 * This is what keeps the blue budget and the status budget inside the 5–15%
 * the design pack measured.
 *
 * Each map is total over its enum, so adding an enum value to the contract
 * breaks the build here rather than rendering an uncoloured surprise.
 */

export const PROPOSAL_TONE: Record<ProposalStatus, StatusTone> = {
  DRAFT: "neutral",
  AWAITING_APPROVAL: "warning",
  SENT: "neutral",
  VIEWED: "info",
  ACCEPTED: "success",
  LOST: "danger",
};

export const APPROVAL_TONE: Record<ApprovalStatus, StatusTone> = {
  PENDING: "warning",
  APPROVED: "success",
  CHANGES_REQUESTED: "warning",
  REJECTED: "danger",
  EXPIRED: "danger",
};

/** §9: sync state is reported by the accounting package, never asserted by us. */
export const SYNC_TONE: Record<SyncState, StatusTone> = {
  NOT_SENT: "neutral",
  SENT: "info",
  VALIDATED: "success",
  ERROR: "danger",
};

export const INVOICE_TONE: Record<InvoiceStatus, StatusTone> = {
  DRAFT: "neutral",
  SENT: "neutral",
  PARTIALLY_PAID: "info",
  PAID: "success",
  OVERDUE: "danger",
  VOID: "neutral",
};

export const ENGAGEMENT_TONE: Record<EngagementStatus, StatusTone> = {
  PROPOSED: "neutral",
  CONFIRMED: "neutral",
  SCHEDULED: "neutral",
  IN_DELIVERY: "info",
  DELIVERED: "success",
  CLOSED: "neutral",
  CANCELLED: "danger",
};

export const OPPORTUNITY_TONE: Record<OpportunityStage, StatusTone> = {
  NEW: "neutral",
  QUALIFYING: "neutral",
  TNA_SENT: "neutral",
  PROPOSAL_SENT: "neutral",
  NEGOTIATION: "info",
  WON: "success",
  LOST: "danger",
};

export const PACKET_TONE: Record<PacketStatus, StatusTone> = {
  DRAFT: "neutral",
  READY: "info",
  SUBMITTED: "success",
  PAID: "success",
  REJECTED: "danger",
};

export const RUN_TONE: Record<RunStatus, StatusTone> = {
  RUNNING: "info",
  SUCCEEDED: "success",
  FAILED: "danger",
  /** Halted is not a failure — a policy stopped it on purpose. */
  HALTED: "warning",
};

export const CHECK_TONE: Record<CheckState, StatusTone> = {
  PASS: "success",
  WARN: "warning",
  FAIL: "danger",
  NOT_APPLICABLE: "neutral",
};

export const LIFECYCLE_TONE: Record<LifecycleState, StatusTone> = {
  DONE: "success",
  CURRENT: "info",
  PENDING: "neutral",
  BLOCKED: "warning",
  SKIPPED: "neutral",
  FAILED: "danger",
};

/**
 * A tier's health IS a status — unlike the tier key itself, which is a routing
 * fact and stays neutral. See `TierChip`.
 */
export const TIER_STATUS_TONE: Record<TierStatus, StatusTone> = {
  HEALTHY: "success",
  DEGRADED: "warning",
  PAUSED_BY_CAP: "danger",
  DISABLED: "neutral",
};
