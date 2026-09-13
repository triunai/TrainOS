/**
 * Enum catalogue.
 *
 * §12 is the canonical catalogue; §17 "New enums" adds the AI-operations set.
 * Every enum is published twice: as a frozen `as const` array (so fixtures,
 * dropdowns and Supabase check constraints can iterate the values) and as the
 * derived union type.
 *
 * Convention (§1): enum values are `UPPER_SNAKE` strings.
 */

/* ------------------------------------------------------------------ *
 * §1 · Identity and roles
 * ------------------------------------------------------------------ */

/** §12 `ActorKind`. Note §1 restricts `createdBy.kind` to the first three. */
export const ACTOR_KINDS = ['HUMAN', 'AGENT', 'SYSTEM', 'CLIENT'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * §1 Roles / §12 `Role`.
 * `AGENT` is a service principal scoped per agent; its grants are the
 * autonomy matrix in §10.
 */
export const ROLES = [
  'SALES',
  'SALES_MANAGER',
  'OPS',
  'FINANCE',
  'MD',
  'ADMIN',
  'TRAINER',
  'CLIENT',
  'AGENT',
] as const;
export type Role = (typeof ROLES)[number];

/** §12 `ProvenanceOrigin`. Absent provenance means human-authored (§1). */
export const PROVENANCE_ORIGINS = [
  'HUMAN',
  'SYSTEM',
  'AI_SUGGESTED',
  'AI_GENERATED',
  'AI_EXECUTED',
] as const;
export type ProvenanceOrigin = (typeof PROVENANCE_ORIGINS)[number];

/** §12 `AutonomyLevel`. Ladder used by §10 grants and §17 routing. */
export const AUTONOMY_LEVELS = [
  'OBSERVE',
  'SUGGEST',
  'ACT_WITH_APPROVAL',
  'AUTONOMOUS',
] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/* ------------------------------------------------------------------ *
 * §12 · Pipeline enums
 * ------------------------------------------------------------------ */

/** §12 `EnquiryChannel` */
export const ENQUIRY_CHANNELS = ['EMAIL', 'WHATSAPP', 'WEB_FORM', 'PHONE'] as const;
export type EnquiryChannel = (typeof ENQUIRY_CHANNELS)[number];

/** §12 `EnquiryStatus` */
export const ENQUIRY_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'CONVERTED',
  'ARCHIVED',
  'NOT_AN_ENQUIRY',
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** §12 `OpportunityStage` */
export const OPPORTUNITY_STAGES = [
  'NEW',
  'QUALIFYING',
  'TNA_SENT',
  'PROPOSAL_SENT',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** §12 `TNAStatus` */
export const TNA_STATUSES = ['DRAFT', 'SENT', 'COMPLETE', 'REOPENED'] as const;
export type TNAStatus = (typeof TNA_STATUSES)[number];

/** §12 `GapPriority` */
export const GAP_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type GapPriority = (typeof GAP_PRIORITIES)[number];

/** §12 `ProposalStatus` */
export const PROPOSAL_STATUSES = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'LOST',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** §12 `ApprovalDecision`. `note` required for the latter two (§7). */
export const APPROVAL_DECISIONS = ['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** §12 `ApprovalStatus` */
export const APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'EXPIRED',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** §12 `UrgencyGroup` — the `group=URGENCY` buckets on M02-S01. */
export const URGENCY_GROUPS = ['BREACHING', 'TODAY', 'THIS_WEEK', 'LATER'] as const;
export type UrgencyGroup = (typeof URGENCY_GROUPS)[number];

/** §12 `RiskLevel` */
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** §12 `LifecycleState` — rendered by LifecycleStepper, never computed client-side. */
export const LIFECYCLE_STATES = [
  'DONE',
  'CURRENT',
  'PENDING',
  'BLOCKED',
  'SKIPPED',
  'FAILED',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** §12 `EngagementStatus` */
export const ENGAGEMENT_STATUSES = [
  'PROPOSED',
  'CONFIRMED',
  'SCHEDULED',
  'IN_DELIVERY',
  'DELIVERED',
  'CLOSED',
  'CANCELLED',
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

/** §12 `AttendanceStatus` */
export const ATTENDANCE_STATUSES = ['OPEN', 'PENDING_APPROVAL', 'LOCKED'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** §12 `CaptureMethod` */
export const CAPTURE_METHODS = ['QR', 'SIGNATURE', 'MANUAL'] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/** §12 `AbsenceReason` */
export const ABSENCE_REASONS = [
  'MEDICAL_LEAVE',
  'WORK_CONFLICT',
  'NO_SHOW',
  'OTHER',
] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];

/** §12 `HRDCScheme` */
export const HRDC_SCHEMES = ['SBL_KHAS', 'SBL', 'HRDC_PLACEMENT'] as const;
export type HRDCScheme = (typeof HRDC_SCHEMES)[number];

/** §12 `HRDCDocumentType` */
export const HRDC_DOCUMENT_TYPES = [
  'ATTENDANCE_SHEET',
  'TRAINER_TTT_CERT',
  'TAX_INVOICE',
  'EVALUATION_SUMMARY',
  'TRAINING_SCHEDULE',
] as const;
export type HRDCDocumentType = (typeof HRDC_DOCUMENT_TYPES)[number];

/** §12 `PacketStatus` */
export const PACKET_STATUSES = [
  'DRAFT',
  'READY',
  'SUBMITTED',
  'PAID',
  'REJECTED',
] as const;
export type PacketStatus = (typeof PACKET_STATUSES)[number];

/** §12 `InvoiceStatus` */
export const INVOICE_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** §12 `SyncState` — reported by the accounting package, never asserted (§9). */
export const SYNC_STATES = ['NOT_SENT', 'SENT', 'VALIDATED', 'ERROR'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

/** §12 `CollectionStage` — ladder at 7 / 30 / 45 / 60 / 75 days (§9). */
export const COLLECTION_STAGES = [
  'REMINDER_1',
  'REMINDER_2',
  'REMINDER_3',
  'HUMAN_CALL',
  'TRADING_HOLD',
] as const;
export type CollectionStage = (typeof COLLECTION_STAGES)[number];

/** §12 `MessageCategory` — drives the WhatsApp per-message rate (§4). */
export const MESSAGE_CATEGORIES = ['MARKETING', 'UTILITY', 'SERVICE'] as const;
export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

/** §12 `AgentStatus` */
export const AGENT_STATUSES = ['ACTIVE', 'PAUSED', 'RETIRED'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * §12 `RunStatus`.
 *
 * Ruling R5: `RESUMABLE` added. A run that yields at the
 * 300s worker wall clock with a checkpoint (architecture doc 05 §8.5) is still
 * running, just not in this worker; before this ruling the agent runtime had
 * to report `status: RUNNING, outcome: RESUMABLE` because the union had no
 * member for it.
 */
export const RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'HALTED', 'RESUMABLE'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** §12 `RunStepStatus` */
export const RUN_STEP_STATUSES = ['OK', 'RETRIED', 'FAILED', 'HALTED'] as const;
export type RunStepStatus = (typeof RUN_STEP_STATUSES)[number];

/**
 * §12 `ActionStatus`.
 *
 * The §3 response union only documents the first three. `REJECTED` is
 * catalogued but has no documented response body.
 * TODO(contract §16 Q1): does a rejected/expired action surface through
 * `POST /v1/actions` at all, or only through `ApprovalDecided`?
 */
export const ACTION_STATUSES = [
  'EXECUTED',
  'QUEUED_FOR_APPROVAL',
  'SUGGESTED',
  'REJECTED',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * §12 `DiffOp` — the ops an approval `diff[]` and an action `effects[]` may
 * carry. One union serves both.
 *
 * Ruling R1: the `CREATE` in the §4 `OPPORTUNITY_CONVERT` example normalises
 * to `ADD`, because §7 requires `effects[]` to equal `diff[]` and §12
 * catalogues only these three. Servers emit `ADD`; clients never see `CREATE`.
 */
export const DIFF_OPS = ['ADD', 'UPDATE', 'REMOVE'] as const;
export type DiffOp = (typeof DIFF_OPS)[number];

/* ------------------------------------------------------------------ *
 * §17 · New enums (AI operations)
 * ------------------------------------------------------------------ */

/** §17 `TierKey` */
export const TIER_KEYS = [
  'FAST',
  'FAST_UI',
  'MID',
  'CHEAP',
  'STRONG_1',
  'STRONG_2',
  'STRONG_3',
  'DEEP_THINK',
  'SPECIAL',
] as const;
export type TierKey = (typeof TIER_KEYS)[number];

/** §17 `TierStatus` */
export const TIER_STATUSES = [
  'HEALTHY',
  'DEGRADED',
  'PAUSED_BY_CAP',
  'DISABLED',
] as const;
export type TierStatus = (typeof TIER_STATUSES)[number];

/** §17 `RoutingStrategy` */
export const ROUTING_STRATEGIES = ['THROUGHPUT', 'PRICE', 'FIXED'] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

/** §17 `CacheStrategy` */
export const CACHE_STRATEGIES = [
  'NONE',
  'PROMPT_15M',
  'PROMPT_1H',
  'PROMPT_24H',
  'CONTEXT_1H',
] as const;
export type CacheStrategy = (typeof CACHE_STRATEGIES)[number];

/** §17 `ProviderKeyStatus` */
export const PROVIDER_KEY_STATUSES = [
  'NOT_SET',
  'VALID',
  'INVALID',
  'EXPIRING',
] as const;
export type ProviderKeyStatus = (typeof PROVIDER_KEY_STATUSES)[number];

/** §17 `BillingOwner` */
export const BILLING_OWNERS = ['CLIENT_ACCOUNT', 'PASS_THROUGH'] as const;
export type BillingOwner = (typeof BILLING_OWNERS)[number];

/** §17 `BudgetState` */
export const BUDGET_STATES = ['WITHIN', 'NEAR', 'PAUSED'] as const;
export type BudgetState = (typeof BUDGET_STATES)[number];

/** §17 `RuleStatus`. DECISIONS §3 loads every HRD Corp rule as `PROPOSED`. */
export const RULE_STATUSES = ['PROPOSED', 'ACTIVE', 'SUPERSEDED'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** §17 `RuleChangeOp` */
export const RULE_CHANGE_OPS = ['ADD', 'MODIFY', 'SUPERSEDE'] as const;
export type RuleChangeOp = (typeof RULE_CHANGE_OPS)[number];

/** §17 `CheckState`. Any `FAIL` sets the `HRDC_CLAIM` lifecycle step to BLOCKED. */
export const CHECK_STATES = ['PASS', 'WARN', 'FAIL', 'NOT_APPLICABLE'] as const;
export type CheckState = (typeof CHECK_STATES)[number];

/** §17 `MonitorStatus` */
export const MONITOR_STATUSES = [
  'WATCHING',
  'CHANGED_REVIEW_PENDING',
  'FAILED',
  'MANUAL',
] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

/** §17 `EmbeddingStatus` */
export const EMBEDDING_STATUSES = ['INDEXED', 'PENDING', 'FAILED'] as const;
export type EmbeddingStatus = (typeof EMBEDDING_STATUSES)[number];

/** §17 `TraceNodeKind` */
export const TRACE_NODE_KINDS = ['ORCHESTRATOR', 'SUB_AGENT', 'TOOL'] as const;
export type TraceNodeKind = (typeof TRACE_NODE_KINDS)[number];

/** §17 `RunEventType` */
export const RUN_EVENT_TYPES = [
  'ESCALATION',
  'JURY',
  'TRUNCATION',
  'HANDOFF',
  'CHECKPOINT',
  'POLICY_HALT',
  'CACHE_HIT',
  'BUDGET_EXCEEDED',
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/* ------------------------------------------------------------------ *
 * Enums used by the JSON examples but absent from the §12 / §17 tables.
 * Each is derived from observed values only; see README "Fields with no
 * source" for the list handed back to the contract owner.
 * ------------------------------------------------------------------ */

/** §2 `badge.severity`. ALERT only when the queue has breached an SLA or deadline. */
export const BADGE_SEVERITIES = ['DEFAULT', 'ALERT'] as const;
export type BadgeSeverity = (typeof BADGE_SEVERITIES)[number];

/**
 * §2 `GET /v1/templates?type=` — the documented template types.
 * WhatsApp templates additionally carry `category` and `ratePerMessage` (§7 note, §4).
 */
export const TEMPLATE_TYPES = [
  'PROPOSAL',
  'QUOTATION',
  'CERTIFICATE',
  'EMAIL',
  'WHATSAPP',
  'INVOICE',
  'TNA_QUESTIONNAIRE',
  'EVALUATION',
  'HRDC_PACKET',
] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

/**
 * Reference types used by `provenance.sources[]`, action `evidence[]`,
 * approval `evidence[]` and `related[]`. No §12 entry; these are every value
 * that appears in a §2–§17 JSON example.
 */
export const EVIDENCE_TYPES = [
  'EMAIL',
  'TNA',
  'PROGRAMME',
  'TRAINER',
  'TRAINER_AVAILABILITY',
  'QUOTATION',
  'QUESTIONNAIRE',
  'HISTORY',
  'CATALOGUE',
  'HRDC_STATEMENT',
  'PARTICIPANT_QUERY',
  'ORGANISATION',
  'CONTACT',
  'INVOICE',
  'PROPOSAL',
  'ACTION',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** §1 list operators. */
export const FILTER_OPS = ['eq', 'in', 'gte', 'lte', 'contains', 'between'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/**
 * §1 `appliedFilters[].source`. Only `REQUEST` appears in the example; `VIEW`
 * is implied by "saved view; merges its filters, request filters win".
 */
export const FILTER_SOURCES = ['REQUEST', 'VIEW'] as const;
export type FilterSource = (typeof FILTER_SOURCES)[number];

/** §2 `GET /v1/views?object=` — objects that own saved views in the matrix. */
export const SAVED_VIEW_OBJECTS = ['LEAD', 'ENQUIRY', 'APPROVAL'] as const;
export type SavedViewObject = (typeof SAVED_VIEW_OBJECTS)[number];

/** §2 `/me.theme`. §1 casing applied to API.md's `light | dark | system`. */
export const THEMES = ['LIGHT', 'DARK', 'SYSTEM'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Severity used by metric deltas, TNA constraints, deadline chips and
 * `related[]` rows. Observed values only: WARN, DANGER, ALERT.
 */
export const SEVERITIES = ['INFO', 'WARN', 'DANGER', 'ALERT'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** §9 required-document presence. */
export const DOCUMENT_PRESENCE = ['PRESENT', 'MISSING'] as const;
export type DocumentPresence = (typeof DOCUMENT_PRESENCE)[number];

/** §10 delta direction on a dashboard metric. */
export const DELTA_DIRECTIONS = ['UP', 'DOWN', 'FLAT'] as const;
export type DeltaDirection = (typeof DELTA_DIRECTIONS)[number];

/** §17 / DECISIONS §2 jury mode. Gate, sample, escalate — never a boolean. */
export const JURY_MODES = ['GATE', 'SAMPLE', 'ESCALATE'] as const;
export type JuryMode = (typeof JURY_MODES)[number];

/** §18 rule-resolution basis. */
export const RULE_RESOLUTION_BASES = ['GRANT_SUBMITTED', 'CLAIM_SUBMITTED'] as const;
export type RuleResolutionBasis = (typeof RULE_RESOLUTION_BASES)[number];

/** §18 hours-saved basis. The tile must render this, never a bare number. */
export const HOURS_SAVED_BASES = ['MEASURED', 'ILLUSTRATIVE'] as const;
export type HoursSavedBasis = (typeof HOURS_SAVED_BASES)[number];

/**
 * §17 model providers named in the tier, provider and trace examples.
 *
 * Ruling R4: `OPENROUTER` and `OTHER` added. BYOK (bring your own key) is a
 * selling point — the agent runtime accepts an OpenRouter key and any
 * OpenAI-compatible endpoint — but until this ruling the runtime had to map
 * an OpenRouter call onto `OPENAI` to fit the union, which lies on the
 * provenance badge about which vendor actually served the call. `OTHER`
 * covers the OpenAI-compatible catch-all (DeepSeek keeps its own value).
 */
export const AI_PROVIDERS = [
  'ANTHROPIC',
  'GOOGLE',
  'OPENAI',
  'DEEPSEEK',
  'OPENROUTER',
  'OTHER',
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** §17 knowledge-source types. Only `HRDC_CIRCULAR` appears in the example. */
export const KNOWLEDGE_SOURCE_TYPES = ['HRDC_CIRCULAR'] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

/**
 * Ruling R6: which of a quotation's two independent price floors is binding.
 * `Quotation` carried `floorPrice` and `floorMarginRate` but nothing that said
 * which constraint actually produced that number, so the fixture package
 * derived it locally as `QuotationWithFloors`. `MARGIN` means the
 * margin-derived floor (from direct cost) is higher and binds; `ABSOLUTE`
 * means the programme's tier floor is higher and binds. DECISIONS §5 +
 * architecture doc 04.
 */
export const BINDING_FLOOR_BASES = ['MARGIN', 'ABSOLUTE'] as const;
export type BindingFloorBasis = (typeof BINDING_FLOOR_BASES)[number];

/** §17 retrieval scopes on a knowledge source. */
export const RETRIEVAL_SCOPES = ['COMPLIANCE', 'CLIENT_FACING'] as const;
export type RetrievalScope = (typeof RETRIEVAL_SCOPES)[number];

/** §17 budget scopes. `PUT /v1/ai/budgets/{scope}/{key}`. */
export const BUDGET_SCOPES = ['TIER', 'AGENT', 'ACTION_TYPE'] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/** §17 `GET /v1/ai/usage?groupBy=`. */
export const USAGE_GROUP_BY = ['TIER', 'AGENT', 'ACTION_TYPE'] as const;
export type UsageGroupBy = (typeof USAGE_GROUP_BY)[number];

/** §5 organisation lifecycle status. Only `ACTIVE_CLIENT` appears in §5. */
export const ORGANISATION_STATUSES = [
  'PROSPECT',
  'ACTIVE_CLIENT',
  'DORMANT',
] as const;
export type OrganisationStatus = (typeof ORGANISATION_STATUSES)[number];

/** §5 why an enquiry matched an organisation. */
export const ORGANISATION_MATCH_REASONS = [
  'EXACT_DOMAIN',
  'FUZZY_NAME',
  'MANUAL',
] as const;
export type OrganisationMatchReason = (typeof ORGANISATION_MATCH_REASONS)[number];

/** §9 HRDC packet deadline / lifecycle state used on the org relations panel. */
export const HRDC_PACKET_PANEL_STATES = [
  'ON_TRACK',
  'DEADLINE_AT_RISK',
  'BLOCKED',
  'SUBMITTED',
] as const;
export type HrdcPacketPanelState = (typeof HRDC_PACKET_PANEL_STATES)[number];
