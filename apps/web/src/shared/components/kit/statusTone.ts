import type {
  ApprovalStatus,
  BindingFloorBasis,
  BudgetState,
  EnquiryStatus,
  CheckState,
  EmbeddingStatus,
  EngagementStatus,
  HrdcPacketPanelState,
  InvoiceStatus,
  LifecycleState,
  MonitorStatus,
  OpportunityStage,
  OrganisationStatus,
  PacketStatus,
  ProgrammeStatus,
  ProposalStatus,
  ProviderKeyStatus,
  QuotationStatus,
  RuleChangeOp,
  RuleStatus,
  RunStatus,
  SyncState,
  TierStatus,
  TNAStatus,
} from "@trainos/contract";
import type { FollowUpStatus } from "@trainos/contract";
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

/**
 * §6 a catalogue programme's state (ruling R9).
 *
 * `ACTIVE` is the one that earns a colour, and it earns it here where nine
 * other maps would have stayed neutral: the catalogue is the thing a
 * consultant prices from, and a programme that is a draft or has been retired
 * is one they must not quote. The colour marks the row that is safe to use.
 */
export const PROGRAMME_TONE: Record<ProgrammeStatus, StatusTone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  RETIRED: "neutral",
};

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
  /**
   * Nor is RESUMABLE (contract R5). The run yielded at a checkpoint and is
   * waiting to be picked up, so it reads as in-flight rather than as something
   * a reader has to act on.
   */
  RESUMABLE: "info",
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

/**
 * §12 `EnquiryStatus`.
 *
 * `OPEN` is the one that earns a colour, and it is the only "nothing has
 * happened yet" state in the kit that does. An unworked enquiry is an SLA
 * running down, which is why the pack draws it as "Unworked" rather than
 * "Open": the word and the amber together say a person is waiting. Everything
 * after it is either someone's job now or already finished.
 */
export const ENQUIRY_TONE: Record<EnquiryStatus, StatusTone> = {
  OPEN: "warning",
  ASSIGNED: "neutral",
  CONVERTED: "success",
  ARCHIVED: "neutral",
  NOT_AN_ENQUIRY: "neutral",
};

/**
 * §4 `FollowUpStatus`.
 *
 * Only `OVERDUE` is coloured on the way in. `DUE` is neutral on purpose: a
 * queue where every row is amber the moment it arrives has no way left to say
 * that one of them has actually slipped.
 */
export const FOLLOW_UP_TONE: Record<FollowUpStatus, StatusTone> = {
  DUE: "neutral",
  OVERDUE: "danger",
  SENT: "success",
  DISMISSED: "neutral",
};

/* ------------------------------------------------------------------ *
 * Maps that lived in screens
 *
 * Nine of these were written as feature-local constants or as inline
 * ternaries, two of them with a comment saying they belonged here. A tone map
 * in a screen is the same defect as a colour in a screen: it is a decision
 * about the design system made where nothing else can see it, which is how
 * `SENT` ends up green on one page and grey on the next.
 * ------------------------------------------------------------------ */

/** §17 HRD Corp rule status. Nothing added by extraction is ACTIVE on arrival. */
export const RULE_TONE: Record<RuleStatus, StatusTone> = {
  ACTIVE: "success",
  PROPOSED: "warning",
  SUPERSEDED: "neutral",
};

/** §17 what a proposed rule change does to the registry. */
export const DIFF_OP_TONE: Record<RuleChangeOp, StatusTone> = {
  ADD: "success",
  MODIFY: "info",
  SUPERSEDE: "warning",
};

/** §17 whether a knowledge source is still being watched, and what it did. */
export const MONITOR_TONE: Record<MonitorStatus, StatusTone> = {
  WATCHING: "neutral",
  CHANGED_REVIEW_PENDING: "warning",
  FAILED: "danger",
  MANUAL: "neutral",
};

/**
 * §17 whether a source's text has been indexed.
 *
 * `INDEXED` is neutral, not success: it is the resting state of every healthy
 * source, and a list where every row is green says nothing.
 */
export const EMBEDDING_TONE: Record<EmbeddingStatus, StatusTone> = {
  INDEXED: "neutral",
  PENDING: "info",
  FAILED: "danger",
};

/** §17 a bring-your-own-key's health. */
export const PROVIDER_KEY_TONE: Record<ProviderKeyStatus, StatusTone> = {
  VALID: "success",
  INVALID: "danger",
  EXPIRING: "warning",
  NOT_SET: "neutral",
};

/** §17 a spend cap's state. `PAUSED` stops runs, which is why it is danger. */
export const BUDGET_TONE: Record<BudgetState, StatusTone> = {
  WITHIN: "neutral",
  NEAR: "warning",
  PAUSED: "danger",
};

/**
 * §12 a TNA questionnaire's status.
 *
 * Only `COMPLETE` is coloured. `SENT` and `REOPENED` are both "waiting on the
 * client", and drawing the difference in colour would spend the budget on
 * something the reader cannot act on either way.
 */
export const TNA_TONE: Record<TNAStatus, StatusTone> = {
  DRAFT: "neutral",
  SENT: "neutral",
  COMPLETE: "success",
  REOPENED: "neutral",
};

/**
 * §6 a quotation's own state (ruling R8).
 *
 * `PENDING_DISCOUNT_APPROVAL` is the only one a pricer has to act on: the
 * price is below the floor and APV-02 is holding it. `APPLIED` stays neutral
 * rather than green — it is the resting state of every quotation that did its
 * job, and a worksheet that is green whenever nothing is wrong says nothing.
 */
export const QUOTATION_TONE: Record<QuotationStatus, StatusTone> = {
  DRAFT: "neutral",
  PENDING_DISCOUNT_APPROVAL: "warning",
  APPLIED: "neutral",
  SUPERSEDED: "neutral",
};

/**
 * §6 which floor binds on a quotation.
 *
 * `MARGIN` means the margin-derived floor is the higher one, so the price is
 * held up by cost rather than by the tier — the case a pricer has to look at.
 * `ABSOLUTE` is the ordinary one.
 */
export const BINDING_FLOOR_TONE: Record<BindingFloorBasis, StatusTone> = {
  MARGIN: "warning",
  ABSOLUTE: "info",
};

/** §5 an organisation's lifecycle. */
export const ORGANISATION_TONE: Record<OrganisationStatus, StatusTone> = {
  PROSPECT: "neutral",
  ACTIVE_CLIENT: "success",
  DORMANT: "neutral",
};

/**
 * §9 the HRD Corp packet state as the organisation relations panel reports it.
 *
 * Distinct from `PACKET_TONE`, which is over `PacketStatus` — the claim's own
 * lifecycle. This enum is about the DEADLINE, and `Organisation360Page` was
 * colouring it with a ternary that tested `BLOCKED` against the wrong enum and
 * then derived urgency from `daysRemaining` rather than reading
 * `DEADLINE_AT_RISK`, which is the state the server sends for exactly that.
 */
export const HRDC_PACKET_PANEL_TONE: Record<HrdcPacketPanelState, StatusTone> = {
  ON_TRACK: "neutral",
  DEADLINE_AT_RISK: "warning",
  BLOCKED: "warning",
  SUBMITTED: "success",
};
