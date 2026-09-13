/**
 * §9 · HRD Corp and finance, with the §17 compliance rules registry and the
 * §18 rule-resolution supersede.
 *
 * Screens M12-S02 (packet), M12-S07 (rules registry), M12-S08 (rule changes),
 * M13-S02 (invoice), M13-S05 (collections).
 */

import type {
  AnyActor,
  DateOnly,
  EntityEnvelope,
  Money,
  Provenance,
  Rate,
  Ref,
  Timestamp,
} from '../envelope';
import type {
  AutonomyLevel,
  CheckState,
  CollectionNextActionStatus,
  CollectionStage,
  DocumentPresence,
  HRDCDocumentType,
  HRDCScheme,
  HrdcDeadlineStatus,
  InvoiceStatus,
  PacketStatus,
  RuleChangeOp,
  RuleResolutionBasis,
  RuleStatus,
  Severity,
  SyncState,
} from '../enums';
import type { AnyActionType } from '../actions';

/* ------------------------------------------------------------------ *
 * §9 · HRD Corp claim packet — M12-S02
 * ------------------------------------------------------------------ */

/** §9 one required document in the packet checklist. */
export interface RequiredDocument {
  type: HRDCDocumentType;
  label?: string;
  status: DocumentPresence;
  ref?: Ref;
  /** One-line context the row renders, e.g. `Locked 14 Nov · 28/30 present`. */
  meta?: string;
}

/** §9 the grant side of the claim. */
export interface HrdcGrant {
  reference: string;
  submittedAt: Timestamp;
  approvedAt: Timestamp | null;
}

/** §9 the eTRIS filing a human recorded. */
export interface HrdcSubmission {
  reference: string;
  submittedAt: Timestamp;
  submittedBy?: AnyActor;
}

/** §9 one row of the packet's submission history. */
export interface HrdcSubmissionLogEntry {
  at: Timestamp;
  actor: AnyActor;
  event: string;
  reference?: string;
  completeness?: Rate;
}

/**
 * §9 the claim packet.
 *
 * There is deliberately **no** submit-to-HRDC endpoint: HRD Corp has no API.
 * The packet is assembled here, a human files it on eTRIS, and the reference
 * comes back through `POST /v1/actions`
 * `type: HRDC_PACKET_MARK_SUBMITTED`, which returns
 * `422 VALIDATION_FAILED` while `completeness < 1`.
 */
export interface ClaimPacket {
  id: string;
  engagementRef: Ref;
  organisationRef: Ref;
  scheme: HRDCScheme;
  employerCode: string;
  claimValue: Money;
  levyAvailable: Money;
  /** Decimal fraction, 0–1. */
  completeness: Rate;
  status: PacketStatus;
  deadlineAt: Timestamp;
  daysRemaining: number;
  deadlineSeverity: Severity;
  requiredDocuments: RequiredDocument[];
  grant: HrdcGrant | null;
  submission: HrdcSubmission | null;
  submissionLog: HrdcSubmissionLogEntry[];
}

/** §9 `POST /v1/actions` `type: HRDC_PACKET_MARK_SUBMITTED`. Emits `HRDCPacketSubmitted`. */
export interface HrdcPacketMarkSubmittedPayload {
  reference: string;
  submittedAt: Timestamp;
}

/** §9 `POST /v1/hrdc/packets/{id}/documents`. */
export interface HrdcDocumentAttachRequest {
  type: HRDCDocumentType;
  ref?: Ref;
  url?: string;
}

/** §9 `GET /v1/hrdc/packets/{id}/export` — the eTRIS upload bundle. */
export interface HrdcPacketExport {
  url: string;
  expiresAt: Timestamp;
}

/** §9 `GET /v1/hrdc/deadlines` — powers the compliance badge. */
export interface HrdcDeadline {
  engagementRef: Ref;
  organisationRef: Ref;
  deadlineAt: Timestamp;
  daysRemaining: number;
  /**
   * Ruling R10: an enum. §9 filters this field by value, so the client and the
   * query string have to agree on the spelling.
   */
  status: HrdcDeadlineStatus;
  severity: Severity;
}

/* ------------------------------------------------------------------ *
 * §17 · Compliance rules registry — M12-S07
 * ------------------------------------------------------------------ */

/** §17 a rule expressed as a comparison against a reference date. */
export interface ComplianceRuleExpression {
  field: string;
  op: string;
  reference: string;
  offsetDays?: number;
  /** DECISIONS §3: calendar days, not working days, until circular text says otherwise. */
  dayBasis?: 'CALENDAR' | 'WORKING';
}

/** §17 the circular text a rule was read from. */
export interface ComplianceRuleSource {
  documentId: string;
  title: string;
  section: string;
  page: number;
  excerpt: string;
}

/**
 * §17 one HRD Corp rule.
 *
 * DECISIONS §3 loads every rule as `PROPOSED` until compliance verifies it
 * against the circular PDF, which is why `verifiedBy` and `verifiedAt` are
 * nullable rather than absent.
 */
export interface ComplianceRule {
  id: string;
  scheme: HRDCScheme;
  subject: string;
  expression: ComplianceRuleExpression;
  effectiveFrom: DateOnly;
  effectiveTo: DateOnly | null;
  status: RuleStatus;
  source: ComplianceRuleSource;
  supersedesId: string | null;
  supersededById: string | null;
  usedByChecks: string[];
  affectedOpenEngagements: number;
  verifiedBy: AnyActor | null;
  verifiedAt: Timestamp | null;
  provenance?: Provenance;
}

/* ------------------------------------------------------------------ *
 * §17 · Rule-change review — M12-S08
 * ------------------------------------------------------------------ */

/** §17 where in the circular a proposed change came from. */
export interface RuleChangeSourceSpan {
  page: number;
  section: string;
  excerpt: string;
}

/**
 * §17 one proposed change.
 *
 * Changes below `0.80` confidence are withheld from the diff view and flagged
 * for manual transcription.
 */
export interface RuleChange {
  id: string;
  op: RuleChangeOp;
  targetRuleId: string | null;
  newRuleId: string | null;
  before: string | null;
  after: string;
  sourceSpan: RuleChangeSourceSpan;
  confidence: number;
  affectedEngagements: { ref: Ref }[];
  status: RuleStatus;
}

/**
 * §17 an ingested circular and the changes read out of it.
 *
 * Approval writes the rule with the **circular's** effective date, not the
 * approval timestamp. Emits `RuleChangeApproved`.
 */
export interface RuleChangeSet {
  documentId: string;
  title: string;
  publishedAt: DateOnly;
  ingestedAt: Timestamp;
  extractedBy: { model: string; confidence: number; runId: string };
  effectiveFrom: DateOnly;
  changes: RuleChange[];
}

/** §17 `POST /v1/actions` `type: RULE_CHANGE_APPROVE`. Act-with-approval. */
export interface RuleChangeApprovePayload {
  documentId: string;
  changeIds: string[];
}

/** §17 the confidence floor below which a change is withheld from the diff view. */
export const RULE_CHANGE_MIN_CONFIDENCE = 0.8;

/* ------------------------------------------------------------------ *
 * §17 + §18 · Compliance checks — M12-S02, M09-S02
 * ------------------------------------------------------------------ */

/** §17 one evaluated check. */
export interface ComplianceCheck {
  key: string;
  state: CheckState;
  label: string;
  /** The inputs and thresholds, so the UI can show the working. */
  computed: Record<string, unknown>;
  /** Pre-rendered sentence, e.g. `grant approved 28 Oct → earliest start 11 Nov`. */
  display?: string;
  ruleId: string;
  provenance: Provenance;
}

/**
 * §18 supersede — replaces the §17 `asOf = training_start` assumption.
 *
 * Grant-side rules resolve as at the grant application submission date;
 * claim-side rules as at the claim submission date. HRD Corp evaluates
 * against the rules in force when they receive the thing. Both sides are
 * present on every response; a side that has not happened yet carries nulls.
 */
export interface RuleResolutionSide {
  asOf: DateOnly | null;
  basis: RuleResolutionBasis;
  ruleSetVersion: string | null;
}

/** §18 the two-sided rule resolution block. */
export interface RuleResolution {
  grantSide: RuleResolutionSide;
  claimSide: RuleResolutionSide;
}

/**
 * §18 a version change between stages.
 *
 * Checks re-evaluate at every stage transition. If the applicable version
 * changed between stages, the response raises a warning citing **both**
 * versions rather than silently switching.
 */
export interface VersionDrift {
  checkKey: string;
  appliedVersion: string;
  currentVersion: string;
  severity: Severity;
  message: string;
}

/** §17 + §18 `GET /v1/compliance/checks?engagementRef=`. */
export interface ComplianceChecksResponse {
  engagementRef: Ref;
  evaluatedAt: Timestamp;
  /** §17 original field; §18 replaces the single date with `ruleResolution`. */
  rulesAsOf?: DateOnly;
  ruleResolution: RuleResolution;
  versionDrift: VersionDrift[];
  summary: { pass: number; warn: number; fail: number };
  /** Any `FAIL` sets the engagement's `HRDC_CLAIM` lifecycle step to BLOCKED. */
  checks: ComplianceCheck[];
}

/* ------------------------------------------------------------------ *
 * §9 · Invoices — M13-S02
 * ------------------------------------------------------------------ */

/**
 * §9 one invoice line.
 *
 * §18 rounding rule: each line is `unit × qty` rounded half-up to the sen. A
 * package price is **one line at `qty: 1`**; a per-pax figure that does not
 * multiply cleanly is `display.perPax`, never a line.
 */
export interface InvoiceLine {
  description: string;
  detail?: string;
  qty: number;
  unit: Money;
  amount: Money;
}

/** §9 one row of the accounting sync log. */
export interface SyncEvent {
  at: Timestamp;
  state: SyncState;
  detail?: string;
  providerCode?: string;
  resolution?: string;
  uin?: string;
}

/** §9 the current accounting-package position. Reported, never asserted. */
export interface InvoiceSync {
  state: SyncState;
  provider: string;
  uin: string | null;
  lastAttemptAt: Timestamp | null;
}

/** §9 a recorded payment. */
export interface Payment {
  id: string;
  at: Timestamp;
  amount: Money;
  method?: string;
  reference?: string;
}

/**
 * §9 the invoice.
 *
 * §18 total-from-lines, always: money is integer sen, each line is rounded
 * half-up before summing, `subtotal` sums the **rounded** lines, and SST is
 * computed on the summed net so `total = subtotal + sst`. MyInvois validation
 * expects line totals to reconcile to the invoice total, so lines-from-total
 * is not an option — `POST /v1/invoices` rejects a payload whose `total` does
 * not equal the sum of its rounded lines with `422 VALIDATION_FAILED`,
 * `details.reason: "TOTAL_NOT_RECONCILED"`.
 *
 * Creation is `POST /v1/actions` `type: INVOICE_CREATE` (policy FIN-01) and
 * **means push to the accounting package** — TrainOS does not e-invoice;
 * MyInvois validation happens downstream and is mirrored into `sync`.
 */
export interface Invoice extends EntityEnvelope {
  organisationRef: Ref;
  engagementRef: Ref;
  status: InvoiceStatus;
  issuedAt: Timestamp;
  dueAt: DateOnly;
  termsDays: number;
  lines: InvoiceLine[];
  subtotal: Money;
  sst: Money;
  /** e.g. `TRAINING_EXEMPT`. */
  sstReason?: string;
  total: Money;
  outstanding: Money;
  sync: InvoiceSync;
  syncLog: SyncEvent[];
  payments: Payment[];
  /** §18 — informational only, never a line. */
  display?: { perPax?: Money };
}

/** §9 `POST /v1/invoices/{id}/payments`. */
export interface PaymentRecordRequest {
  amount: Money;
  at: Timestamp;
  method?: string;
  reference?: string;
}

/* ------------------------------------------------------------------ *
 * §9 · Receivables and collections — M13-S05
 * ------------------------------------------------------------------ */

/** §9 the aging strip. */
export interface ReceivablesAging {
  current: Money;
  d1_30: Money;
  d31_60: Money;
  d60_plus: Money;
  dsoDays: number;
}

/**
 * §9 the next step the ladder proposes for an overdue invoice.
 *
 * Ruling R7: `type` widened from `ActionType` (the §3 nineteen only) to
 * `AnyActionType` (§3 + the §17 AI-ops pair + the ruled types). The ladder's
 * final step is `ACCOUNT_TRADING_HOLD` (ruling R3), a `RULED_ACTION_TYPES`
 * member, which `ActionType` cannot hold; before this ruling the fixture
 * package had to widen the row locally as `FixtureReceivable`.
 */
export interface CollectionNextAction {
  type: AnyActionType;
  /**
   * Ruling R10: an enum. What the rung is waiting on, not what an action
   * request returned — see `COLLECTION_NEXT_ACTION_STATUSES`.
   */
  status: CollectionNextActionStatus;
  autonomy: AutonomyLevel;
}

/** §9 / REPORT one overdue invoice in the collections queue. */
export interface Receivable {
  invoiceRef: Ref;
  organisation: { ref: Ref; name: string };
  daysOverdue: number;
  amount: Money;
  stage: CollectionStage;
  nextAction: CollectionNextAction;
  nextActionAt?: Timestamp;
}

/** §9 `GET /v1/collections/queue`. */
export interface CollectionsQueueResponse {
  data: Receivable[];
  aging: ReceivablesAging;
  page?: { next: string | null; total: number };
}

/**
 * §9 `GET /v1/collections/rules` — the escalation ladder: 7 / 30 / 45 days,
 * human call at 60, trading hold at 75 with MD approval.
 */
export interface CollectionRule {
  stage: CollectionStage;
  afterDays: number;
  channel?: 'EMAIL' | 'WHATSAPP' | 'PHONE';
  autonomy: AutonomyLevel;
  requiresApprovalFromRole?: string;
}

/** §9 `POST /v1/actions` `type: REMINDER_SEND` (policy FIN-03). */
export interface ReminderSendPayload {
  invoiceRef?: Ref;
  channel: 'EMAIL' | 'WHATSAPP';
  templateId: string;
  stage?: CollectionStage;
  body?: string;
}

/**
 * Ruling R3 `POST /v1/actions` `type: ACCOUNT_TRADING_HOLD`.
 *
 * The last rung of the §9 collections ladder: at 75 days overdue the account
 * is put on trading hold, which §9 says requires MD approval. Routed through
 * the action envelope like every other gated step, so the response is a
 * `QUEUED_FOR_APPROVAL` with `approverRole: MD` rather than an effect.
 * Emits `AccountTradingHoldApplied` once approved.
 */
export interface AccountTradingHoldPayload {
  organisationRef: Ref;
  /** The overdue invoices the hold is being raised on. */
  invoiceRefs: Ref[];
  reason: string;
}

/** §9 `POST /v1/actions` `type: INVOICE_CREATE` / `INVOICE_PUSH`. */
export interface InvoicePushPayload {
  engagementRef?: Ref;
  provider?: string;
}
