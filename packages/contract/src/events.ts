/**
 * §14 · Event catalogue, plus the §17 additions and the §11 realtime channels.
 *
 * All events carry `{ eventId, occurredAt, tenantId, actor }` and are written
 * to the outbox in the same transaction as the state change.
 */

import type {
  AnyActor,
  Confidence,
  DateOnly,
  Money,
  Rate,
  Ref,
  Timestamp,
} from './envelope';
import type {
  ApprovalDecision,
  BudgetScope,
  CollectionStage,
  EnquiryChannel,
  HRDCScheme,
  MessageCategory,
  RunStatus,
  Role,
  SyncState,
  TierKey,
} from './enums';
import type { Effect, GovernedActionType } from './actions';

/* ------------------------------------------------------------------ *
 * §14 · Envelope
 * ------------------------------------------------------------------ */

/** §14 the four fields every event carries. */
export interface EventEnvelope {
  eventId: string;
  occurredAt: Timestamp;
  tenantId: string;
  actor: AnyActor;
}

/** §14 the shape of one catalogued event. */
export interface DomainEventOf<T extends string, P> extends EventEnvelope {
  type: T;
  payload: P;
}

/* ------------------------------------------------------------------ *
 * §14 · Payloads
 * ------------------------------------------------------------------ */

/** §14 `POST /webhooks/email`, `/webhooks/whatsapp`. */
export interface EnquiryReceivedPayload {
  enquiryRef: Ref;
  channel: EnquiryChannel;
  from: { name: string; email: string | null; phone: string | null };
  receivedAt: Timestamp;
}

/** §14 agent run completion. */
export interface EnquiryClassifiedPayload {
  enquiryRef: Ref;
  label: string;
  confidence: Confidence;
  agentId: string;
  runId: string;
}

/** §14 `POST /actions` `OPPORTUNITY_CONVERT`. */
export interface OpportunityCreatedPayload {
  opportunityRef: Ref;
  organisationRef: Ref;
  value: Money;
  sourceEnquiryRef: Ref;
}

/**
 * §5 emitted by `PATCH /v1/opportunities/{id}`.
 * Named in §5 but absent from the §14 table; payload inferred from the others.
 * TODO(contract §14): catalogue `OpportunityStageChanged`.
 */
export interface OpportunityStageChangedPayload {
  opportunityRef: Ref;
  fromStage: string;
  toStage: string;
}

/** §14 `POST /public/tnas/{token}/submit`. */
export interface TNACompletedPayload {
  tnaRef: Ref;
  opportunityRef: Ref;
  completedBy: AnyActor;
  completedAt: Timestamp;
}

/** §14 `POST /proposals`, section regenerate. */
export interface ProposalDraftedPayload {
  proposalRef: Ref;
  templateId: string;
  agentId: string;
  runId: string;
  value: Money;
}

/**
 * §3 emitted by `POST /v1/actions` before the policy decision.
 * Named in §3 but absent from the §14 table.
 * TODO(contract §14): catalogue `ActionRequested`.
 */
export interface ActionRequestedPayload {
  actionType: GovernedActionType;
  targetRef: Ref;
  requestedBy: AnyActor;
  confidence?: Confidence;
}

/** §14 `POST /actions` when a policy routes the action. */
export interface ApprovalRequestedPayload {
  approvalRef: Ref;
  policyId: string;
  actionType: GovernedActionType;
  targetRef: Ref;
  value?: Money;
  approverRole: Role;
  slaDueAt: Timestamp;
}

/** §14 `POST /approvals/{id}/decide`. */
export interface ApprovalDecidedPayload {
  approvalRef: Ref;
  decision: ApprovalDecision;
  decidedBy: AnyActor;
  decidedAt: Timestamp;
  effects: Effect[];
}

/** §14 approval effect, or a direct execute. */
export interface ProposalSentPayload {
  proposalRef: Ref;
  channel: string;
  to: string[];
  sentAt: Timestamp;
}

/** §14 `POST /public/proposals/{token}/accept`. */
export interface ProposalAcceptedPayload {
  proposalRef: Ref;
  acceptedBy: string;
  acceptedAt: Timestamp;
  engagementRef: Ref;
}

/** §14 proposal acceptance. */
export interface EngagementCreatedPayload {
  engagementRef: Ref;
  organisationRef: Ref;
  programmeRef: Ref;
  dates: DateOnly[];
}

/** §14 `POST /actions` `ATTENDANCE_APPROVE`. */
export interface AttendanceLockedPayload {
  engagementRef: Ref;
  day: number;
  approvedBy: AnyActor;
  approvedAt: Timestamp;
  present: number;
  total: number;
}

/** §14 packet completeness hits 1.0. */
export interface HRDCPacketReadyPayload {
  engagementRef: Ref;
  scheme: HRDCScheme;
  claimValue: Money;
  deadlineAt: Timestamp;
}

/** §14 `POST /actions` `HRDC_PACKET_MARK_SUBMITTED`. */
export interface HRDCPacketSubmittedPayload {
  engagementRef: Ref;
  reference: string;
  submittedBy: AnyActor;
  submittedAt: Timestamp;
}

/** §14 `POST /actions` `INVOICE_CREATE` / `INVOICE_PUSH`. */
export interface InvoicePushedPayload {
  invoiceRef: Ref;
  provider: string;
  documentId: string;
  at: Timestamp;
}

/** §14 `POST /webhooks/accounting`. */
export interface InvoiceValidatedPayload {
  invoiceRef: Ref;
  uin: string;
  at: Timestamp;
}

/** §14 agent run completion. */
export interface ReminderDraftedPayload {
  invoiceRef: Ref;
  stage: CollectionStage;
  channel: string;
  estimatedCost: Money;
  agentId: string;
  runId: string;
}

/** §14 run finaliser. */
export interface AgentRunCompletedPayload {
  runId: string;
  agentId: string;
  status: RunStatus;
  durationMs: number;
  cost: Money;
  outcome: string;
}

/** §14 run finaliser. */
export interface AgentRunFailedPayload {
  runId: string;
  agentId: string;
  failureCode: string;
  attempts: number;
  deadLettered: boolean;
}

/* §17 · New events -------------------------------------------------- */

/** §17 provider health monitor. Shared by `TierDegraded` and `TierRecovered`. */
export interface TierHealthPayload {
  tier: TierKey;
  reason: string;
  activeFallback: TierKey | null;
  at: Timestamp;
}

/** §17 usage accounting. */
export interface BudgetCapTrippedPayload {
  scope: BudgetScope;
  key: string;
  cap: Money;
  spend: Money;
  pausedActionTypes: GovernedActionType[];
}

/** §17 key probe. */
export interface ProviderKeyInvalidPayload {
  providerId: string;
  since: Timestamp;
  affectedTiers: TierKey[];
  activeFallback: TierKey | null;
}

/** §17 reveal endpoint. */
export interface ProviderKeyRevealedPayload {
  providerId: string;
  actor: AnyActor;
  at: Timestamp;
}

/** §17 corpus monitor. */
export interface SourceChangedPayload {
  sourceId: string;
  oldHash: string;
  newHash: string;
  detectedAt: Timestamp;
}

/** §17 ingestion. */
export interface RuleChangeProposedPayload {
  documentId: string;
  changeCount: number;
  extractedBy: { model: string; confidence: number; runId?: string };
  affectedEngagementCount: number;
}

/** §17 `RULE_CHANGE_APPROVE`. Written with the circular's effective date. */
export interface RuleChangeApprovedPayload {
  ruleId: string;
  op: string;
  effectiveFrom: DateOnly;
  approvedBy: AnyActor;
}

/** §17 check evaluation. Any FAIL blocks the HRDC lifecycle step. */
export interface ComplianceCheckFailedPayload {
  engagementRef: Ref;
  checkKey: string;
  ruleId: string;
  computed: Record<string, unknown>;
}

/** §17 run engine. */
export interface AgentEscalatedPayload {
  runId: string;
  node: string;
  fromTier: TierKey;
  toTier: TierKey;
  confidence: Confidence;
}

/** §17 run engine. Also emitted by a SAMPLE jury, without touching the decision. */
export interface JuryDisagreedPayload {
  runId: string;
  quorum: number;
  of: number;
  dissenters: { model: string; note?: string }[];
}

/* ------------------------------------------------------------------ *
 * §14 · The discriminated union
 * ------------------------------------------------------------------ */

export type EnquiryReceivedEvent = DomainEventOf<'EnquiryReceived', EnquiryReceivedPayload>;
export type EnquiryClassifiedEvent = DomainEventOf<'EnquiryClassified', EnquiryClassifiedPayload>;
export type OpportunityCreatedEvent = DomainEventOf<'OpportunityCreated', OpportunityCreatedPayload>;
export type OpportunityStageChangedEvent = DomainEventOf<'OpportunityStageChanged', OpportunityStageChangedPayload>;
export type TNACompletedEvent = DomainEventOf<'TNACompleted', TNACompletedPayload>;
export type ProposalDraftedEvent = DomainEventOf<'ProposalDrafted', ProposalDraftedPayload>;
export type ActionRequestedEvent = DomainEventOf<'ActionRequested', ActionRequestedPayload>;
export type ApprovalRequestedEvent = DomainEventOf<'ApprovalRequested', ApprovalRequestedPayload>;
export type ApprovalDecidedEvent = DomainEventOf<'ApprovalDecided', ApprovalDecidedPayload>;
export type ProposalSentEvent = DomainEventOf<'ProposalSent', ProposalSentPayload>;
export type ProposalAcceptedEvent = DomainEventOf<'ProposalAccepted', ProposalAcceptedPayload>;
export type EngagementCreatedEvent = DomainEventOf<'EngagementCreated', EngagementCreatedPayload>;
export type AttendanceLockedEvent = DomainEventOf<'AttendanceLocked', AttendanceLockedPayload>;
export type HRDCPacketReadyEvent = DomainEventOf<'HRDCPacketReady', HRDCPacketReadyPayload>;
export type HRDCPacketSubmittedEvent = DomainEventOf<'HRDCPacketSubmitted', HRDCPacketSubmittedPayload>;
export type InvoicePushedEvent = DomainEventOf<'InvoicePushed', InvoicePushedPayload>;
export type InvoiceValidatedEvent = DomainEventOf<'InvoiceValidated', InvoiceValidatedPayload>;
export type ReminderDraftedEvent = DomainEventOf<'ReminderDrafted', ReminderDraftedPayload>;
export type AgentRunCompletedEvent = DomainEventOf<'AgentRunCompleted', AgentRunCompletedPayload>;
export type AgentRunFailedEvent = DomainEventOf<'AgentRunFailed', AgentRunFailedPayload>;
export type TierDegradedEvent = DomainEventOf<'TierDegraded', TierHealthPayload>;
export type TierRecoveredEvent = DomainEventOf<'TierRecovered', TierHealthPayload>;
export type BudgetCapTrippedEvent = DomainEventOf<'BudgetCapTripped', BudgetCapTrippedPayload>;
export type ProviderKeyInvalidEvent = DomainEventOf<'ProviderKeyInvalid', ProviderKeyInvalidPayload>;
export type ProviderKeyRevealedEvent = DomainEventOf<'ProviderKeyRevealed', ProviderKeyRevealedPayload>;
export type SourceChangedEvent = DomainEventOf<'SourceChanged', SourceChangedPayload>;
export type RuleChangeProposedEvent = DomainEventOf<'RuleChangeProposed', RuleChangeProposedPayload>;
export type RuleChangeApprovedEvent = DomainEventOf<'RuleChangeApproved', RuleChangeApprovedPayload>;
export type ComplianceCheckFailedEvent = DomainEventOf<'ComplianceCheckFailed', ComplianceCheckFailedPayload>;
export type AgentEscalatedEvent = DomainEventOf<'AgentEscalated', AgentEscalatedPayload>;
export type JuryDisagreedEvent = DomainEventOf<'JuryDisagreed', JuryDisagreedPayload>;

/** §14 + §17 every event, discriminated on `type`. */
export type DomainEvent =
  | EnquiryReceivedEvent
  | EnquiryClassifiedEvent
  | OpportunityCreatedEvent
  | OpportunityStageChangedEvent
  | TNACompletedEvent
  | ProposalDraftedEvent
  | ActionRequestedEvent
  | ApprovalRequestedEvent
  | ApprovalDecidedEvent
  | ProposalSentEvent
  | ProposalAcceptedEvent
  | EngagementCreatedEvent
  | AttendanceLockedEvent
  | HRDCPacketReadyEvent
  | HRDCPacketSubmittedEvent
  | InvoicePushedEvent
  | InvoiceValidatedEvent
  | ReminderDraftedEvent
  | AgentRunCompletedEvent
  | AgentRunFailedEvent
  | TierDegradedEvent
  | TierRecoveredEvent
  | BudgetCapTrippedEvent
  | ProviderKeyInvalidEvent
  | ProviderKeyRevealedEvent
  | SourceChangedEvent
  | RuleChangeProposedEvent
  | RuleChangeApprovedEvent
  | ComplianceCheckFailedEvent
  | AgentEscalatedEvent
  | JuryDisagreedEvent;

/** §14 the `type` of any catalogued event. */
export type DomainEventType = DomainEvent['type'];

/** §14 the event names, iterable for outbox routing and fixtures. */
export const DOMAIN_EVENT_TYPES = [
  'EnquiryReceived',
  'EnquiryClassified',
  'OpportunityCreated',
  'OpportunityStageChanged',
  'TNACompleted',
  'ProposalDrafted',
  'ActionRequested',
  'ApprovalRequested',
  'ApprovalDecided',
  'ProposalSent',
  'ProposalAccepted',
  'EngagementCreated',
  'AttendanceLocked',
  'HRDCPacketReady',
  'HRDCPacketSubmitted',
  'InvoicePushed',
  'InvoiceValidated',
  'ReminderDrafted',
  'AgentRunCompleted',
  'AgentRunFailed',
  'TierDegraded',
  'TierRecovered',
  'BudgetCapTripped',
  'ProviderKeyInvalid',
  'ProviderKeyRevealed',
  'SourceChanged',
  'RuleChangeProposed',
  'RuleChangeApproved',
  'ComplianceCheckFailed',
  'AgentEscalated',
  'JuryDisagreed',
] as const satisfies readonly DomainEventType[];

/* ------------------------------------------------------------------ *
 * §11 · Realtime — SSE at GET /v1/events?channels=…, per-user filtered
 * ------------------------------------------------------------------ */

/**
 * §11 the five channels the UI needs. Everything else polls on navigation.
 * `runs:{runId}` is parameterised; see {@link runChannel}.
 */
export const REALTIME_CHANNELS = [
  'badges',
  'approvals',
  'enquiries',
  'runs',
  'invoices',
] as const;
export type RealtimeChannel = (typeof REALTIME_CHANNELS)[number];

/** §11 build the per-run channel name, e.g. `runs:run_4821`. */
export const runChannel = (runId: string): `runs:${string}` => `runs:${runId}`;

/** §11 `badges` — sidebar, every screen. */
export interface BadgesChannelPayload {
  approvals: number;
  hrdcDeadlines: number;
  agentFailures: number;
}

/** §11 `approvals` — M02-S01, M01-S01. */
export interface ApprovalsChannelPayload {
  event: 'CREATED' | 'DECIDED';
  approvalRef: Ref;
  urgencyGroup: string;
  slaBreached: boolean;
}

/** §11 `enquiries` — M03-S01. */
export interface EnquiriesChannelPayload {
  event: 'RECEIVED' | 'CLASSIFIED';
  enquiryRef: Ref;
  channel: EnquiryChannel;
  confidence?: Confidence;
}

/** §11 `runs:{runId}` — step-level progress on M18-S04. */
export interface RunChannelPayload {
  seq: number;
  tool: string;
  status: string;
  durationMs: number;
}

/** §11 `invoices` — M13-S02, M13-S05. */
export interface InvoicesChannelPayload {
  invoiceRef: Ref;
  syncState: SyncState;
  providerCode?: string;
}

/** §11 channel name → payload. */
export interface RealtimeChannelPayloads {
  badges: BadgesChannelPayload;
  approvals: ApprovalsChannelPayload;
  enquiries: EnquiriesChannelPayload;
  runs: RunChannelPayload;
  invoices: InvoicesChannelPayload;
}

/** §11 one SSE frame. */
export type RealtimeMessage<C extends RealtimeChannel = RealtimeChannel> = {
  channel: C;
  data: RealtimeChannelPayloads[C];
};

/** §4 message category carried on a drafted reminder, re-exported for consumers. */
export type ReminderCategory = MessageCategory;

/** §17 cache-hit share reported alongside run telemetry. */
export type CacheHitRate = Rate;
