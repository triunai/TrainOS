/**
 * Cross-cutting envelopes: identity, money, provenance, lists, errors.
 *
 * §1 Conventions, extended by §17 "Provenance envelope — extended" and the
 * §18 money supersede.
 */

import type {
  ActorKind,
  BadgeSeverity,
  BindingFloorBasis,
  EvidenceType,
  FilterOp,
  FilterSource,
  ProvenanceOrigin,
  Role,
  Severity,
  TierKey,
  AiProvider,
} from './enums';

/* ------------------------------------------------------------------ *
 * Scalars
 * ------------------------------------------------------------------ */

/** §1 ISO-8601 instant with offset, e.g. `2026-11-12T09:00:00+08:00`. */
export type Timestamp = string;

/** §1 date-only field, e.g. `2026-11-12`. */
export type DateOnly = string;

/** §1 percentages are decimal fractions, e.g. `marginRate: 0.41`. */
export type Rate = number;

/** §1 model confidence, 0–1. */
export type Confidence = number;

/** Opaque cursor from `page.next` (§1). */
export type Cursor = string;

/**
 * A human-readable business reference such as `ENQ-2026-0912` or `ORG-0114`.
 * Distinct from the opaque `id`; both appear on the entity envelope (§1).
 */
export type Ref = string;

/* ------------------------------------------------------------------ *
 * §1 · Actors
 * ------------------------------------------------------------------ */

/** §1 `createdBy.kind` ∈ HUMAN | AGENT | SYSTEM. */
export type EnvelopeActorKind = 'HUMAN' | 'AGENT' | 'SYSTEM';

/** §1 the actor on an entity envelope. */
export interface Actor {
  id: string;
  /** Omitted on some compact payloads, e.g. the §3 `requestedBy`. */
  name?: string;
  kind: EnvelopeActorKind;
}

/**
 * §12 `ActorKind` widened to include `CLIENT` — used by TNA `completedBy` (§6)
 * and the portal comment author (§11).
 */
export interface AnyActor {
  id: string;
  name?: string;
  kind: ActorKind;
}

/** §1 `provenance.editedBy` — who touched an AI-produced value, and when. */
export interface EditedBy {
  id: string;
  name: string;
  at: Timestamp;
}

/* ------------------------------------------------------------------ *
 * §1 · Money
 * ------------------------------------------------------------------ */

/** §1 the only currency in the contract. */
export type CurrencyCode = 'MYR';

/**
 * §1 Money — integer minor units (sen), never floats, never a bare number.
 *
 * §18 supersede: lines are truth and totals are sums. Each line is
 * `unitPrice × qty` rounded half-up to the sen; totals sum the **rounded**
 * lines; SST is computed on the summed net. A per-pax figure that does not
 * multiply cleanly is display-only and must never become a line.
 */
export interface Money {
  /** Integer sen. `1850000` is RM 18,500.00. */
  amount: number;
  currency: CurrencyCode;
}

/* ------------------------------------------------------------------ *
 * §1 · Entity envelope
 * ------------------------------------------------------------------ */

/**
 * §1 every resource carries this. Tenant is implicit from auth and never
 * appears in a path or body.
 */
export interface EntityEnvelope {
  id: string;
  ref: Ref;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: Actor;
}

/* ------------------------------------------------------------------ *
 * §1 + §17 · Provenance
 * ------------------------------------------------------------------ */

/** §1 one citation behind an AI-produced value. */
export interface ProvenanceSource {
  type: EvidenceType;
  ref: Ref;
  excerpt?: string;
}

/**
 * §17 + §18 jury outcome recorded on a value the jury voted on.
 * The mode/quorum policy itself lives on `/v1/ai/routing` (see ai-ops).
 */
export interface ProvenanceJury {
  quorum: number;
  of: number;
  /** Model names that agreed. */
  agreed: string[];
  dissented: ProvenanceDissent[];
}

/** §17 a dissenting juror. */
export interface ProvenanceDissent {
  model: string;
  note: string;
}

/**
 * §1 Provenance envelope, extended by §17.
 *
 * Present on any AI-touched field or record; **absent means human-authored**.
 * The AI badge popover renders exactly these fields, so no screen composes
 * that string itself.
 */
export interface Provenance {
  origin: ProvenanceOrigin;
  confidence?: Confidence;
  agentId?: string;
  runId?: string;
  sources?: ProvenanceSource[];
  generatedAt?: Timestamp;
  /** §1 — set when a human edited an AI value; flips origin to AI_SUGGESTED. */
  editedBy?: EditedBy;

  /* §17 additions — present wherever a model produced the value. */
  tier?: TierKey;
  model?: string;
  provider?: AiProvider;
  cacheHitRate?: Rate;
  jury?: ProvenanceJury;

  /**
   * §17 compliance checks: a deterministic check carries
   * `origin: "SYSTEM"`, `method: "DETERMINISTIC"` and no model. An
   * interpreted check carries the model, confidence and sources instead.
   */
  method?: 'DETERMINISTIC';
}

/** §1 a value paired with its provenance — the enquiry extraction shape (§4). */
export interface ProvenancedValue<T> {
  value: T;
  provenance?: Provenance;
}

/* ------------------------------------------------------------------ *
 * §1 · Lists
 * ------------------------------------------------------------------ */

/** §1 `filter[field][op]=value`. */
export interface AppliedFilter {
  field: string;
  op: FilterOp;
  value: unknown;
  source: FilterSource;
}

/** §1 cursor page marker. `next: null` means the last page. */
export interface PageInfo {
  next: Cursor | null;
  total: number;
}

/** §1 the envelope every collection endpoint returns. */
export interface ListResponse<T> {
  data: T[];
  page: PageInfo;
  /** Present on filterable collections; §1 shows it on `GET /v1/enquiries`. */
  appliedFilters?: AppliedFilter[];
}

/**
 * §1 the query a client sends to a collection endpoint.
 *
 * Serialises as `filter[field][op]=value`, `sort=-receivedAt`,
 * `page[size]=50`, `page[cursor]=…`, `view=…`. A `view` merges its saved
 * filters; request filters win.
 */
export interface PageRequest {
  filter?: FilterClause[];
  /** Field name, prefixed with `-` for descending. */
  sort?: string;
  page?: { size?: number; cursor?: Cursor };
  /** Saved view id (§2). */
  view?: string;
}

/** §1 one requested filter clause. */
export interface FilterClause {
  field: string;
  op: FilterOp;
  value: unknown;
}

/* ------------------------------------------------------------------ *
 * §1 · Errors
 * ------------------------------------------------------------------ */

/** §1 error codes. */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'POLICY_APPROVAL_REQUIRED'
  | 'ATTENDANCE_LOCKED'
  | 'FLOOR_PRICE_BREACH'
  | 'SYNC_FAILED'
  | 'AGENT_PAUSED'
  | 'SLA_BREACHED'
  | 'IDEMPOTENT_REPLAY'
  /**
   * §7 `POST /v1/approvals/{id}/decide` — the rendered diff, or the
   * `diffHash` the client sent for it, no longer matches the approval's
   * current one (`011:2774`, `011:2781-2787`).
   */
  | 'DIFF_CHANGED'
  /**
   * §7 `POST /v1/approvals/bulk-decide` — a row in the batch is not
   * `bulkApprovable`, so it must be decided on its own. `app.bulk_decide`
   * raises it with `details.notBulkApprovable` (011:3558-3571 at 11508ed).
   */
  | 'BULK_NOT_PERMITTED';

/**
 * §1 HTTP status each code maps to.
 *
 * Two are not error paths in practice: `POLICY_APPROVAL_REQUIRED` is a `202`
 * carrying `approvalRequestId` (§3), and `SLA_BREACHED` is a `200` surfaced as
 * `slaBreached: true` on the approval (§7) rather than a body of its own.
 */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  POLICY_APPROVAL_REQUIRED: 202,
  ATTENDANCE_LOCKED: 409,
  FLOOR_PRICE_BREACH: 422,
  SYNC_FAILED: 502,
  AGENT_PAUSED: 409,
  SLA_BREACHED: 200,
  IDEMPOTENT_REPLAY: 409,
  DIFF_CHANGED: 409,
  BULK_NOT_PERMITTED: 409,
} as const;

/** §1 `VALIDATION_FAILED` detail row. */
export interface FieldError {
  field: string;
  reason: string;
  code?: string;
}

/** §1 the details bag, keyed by code. All optional; shape varies by code. */
export interface ErrorDetails {
  /** VALIDATION_FAILED (§1). */
  fields?: FieldError[];
  /**
   * §18 `POST /v1/invoices` rejects a payload whose `total` does not equal
   * the sum of its rounded lines.
   */
  reason?: 'TOTAL_NOT_RECONCILED' | 'MONEY_MOVING_CEILING' | 'BUDGET_CAP' | string;
  /** FORBIDDEN — so the UI can explain, not just disable (§1). */
  requiredRole?: Role;
  /** POLICY_APPROVAL_REQUIRED (§1). */
  policyId?: string;
  threshold?: Money;
  /**
   * FLOOR_PRICE_BREACH (§1, §6). The full shape is
   * `FloorPriceBreachDetails` in `domain/proposals`; every key is optional
   * here because this one bag is keyed by code, and a caller that has not
   * checked `code` has no business assuming any of them are present.
   */
  floorPrice?: Money;
  resultingMarginRate?: Rate;
  requiresPolicy?: string;
  /** Ruling R6: which constraint produced `floorPrice`, and both candidates. */
  absoluteFloorPrice?: Money;
  marginFloorPrice?: Money;
  bindingFloorBasis?: BindingFloorBasis;
  /** SYNC_FAILED (§1). */
  provider?: string;
  providerCode?: string;
  /** ATTENDANCE_LOCKED (§8). */
  approvedAt?: Timestamp;
  unlockPath?: string;
  unlockActionType?: string;
  /** §7 `POST /v1/approvals/{id}/decide` when the world moved under the diff. */
  diffChanged?: boolean;
  /** DIFF_CHANGED (§7) — the fresh diff's hash, alongside `diff` above. */
  diffHash?: string;
  /** §8 `ENGAGEMENT_CLOSE_OUT` while incomplete. */
  blockers?: string[];
  /** BULK_NOT_PERMITTED (§7) — every row in the batch that must be decided alone. */
  notBulkApprovable?: NotBulkApprovable[];
  [key: string]: unknown;
}

/** One row `app.bulk_decide` refused to decide in bulk, and why. */
export interface NotBulkApprovable {
  id: string;
  ref: string;
  reason: 'MONETARY_VALUE' | 'MONEY_MOVING_TYPE' | string;
}

/** §1 the error body. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetails;
    /** Present on `POLICY_APPROVAL_REQUIRED`; see §3. */
    approvalRequestId?: string;
  };
}

/* ------------------------------------------------------------------ *
 * Small shared shapes reused across sections
 * ------------------------------------------------------------------ */

/** §2 sidebar / queue badge. */
export interface Badge {
  count: number;
  severity: BadgeSeverity;
}

/**
 * §5, §10 a metric cell. Each carries its own `drillTo` so the UI never
 * hardcodes a drill route.
 */
export interface MetricValue<T = Money | number> {
  value: T;
  secondary?: string;
  delta?: MetricDelta;
  drillTo?: string;
  /** §10 `ADMIN_HOURS_SAVED` — the number is an estimate, label it. */
  estimate?: boolean;
}

/** §10 period-over-period movement on a metric. */
export interface MetricDelta {
  rate: Rate;
  direction: 'UP' | 'DOWN' | 'FLAT';
  severity?: Severity;
  comparedTo?: string;
}

/** §1 header sent on every state-changing POST. Keys are retained 24 hours. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;

/** §1 header set when a replayed key returned the original response. */
export const IDEMPOTENT_REPLAY_HEADER = 'Idempotent-Replay' as const;

/** §1 base path. Tenant is implicit from auth. */
export const API_BASE_PATH = '/v1' as const;
