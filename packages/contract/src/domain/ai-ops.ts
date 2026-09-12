/**
 * §17 · AI operations — model tiers and routing, provider keys (BYOK),
 * usage and budgets. With the §18 jury supersede.
 *
 * Screens M20-S20 (models), M20-S21 (providers), M20-S16 (usage).
 */

import type { EditedBy, Money, Rate, Timestamp } from '../envelope';
import type {
  AiProvider,
  BillingOwner,
  BudgetScope,
  BudgetState,
  CacheStrategy,
  JuryMode,
  ProviderKeyStatus,
  RoutingStrategy,
  TierKey,
  TierStatus,
} from '../enums';
import type { GovernedActionType } from '../actions';

/* ------------------------------------------------------------------ *
 * §17 · Model tiers — M20-S20
 * ------------------------------------------------------------------ */

/**
 * §17 `[startHour, endHour)` in MYT.
 *
 * A run requested outside the window queues to the next window when the tier
 * is batch-eligible, otherwise it escalates.
 * TODO(contract §17 Q3): confirm queue-vs-escalate for non-batch tiers.
 */
export type AllowedHourWindow = [start: number, end: number];

/** §17 why a tier is degraded and what is carrying its traffic. */
export interface TierDegradation {
  since: Timestamp;
  /** e.g. `PROVIDER_5XX`. */
  reason: string;
  activeFallback: TierKey;
}

/** §17 one row of the tier table. */
export interface ModelTier {
  key: TierKey;
  model: string;
  provider?: AiProvider;
  routing?: RoutingStrategy;
  fallbackChain?: TierKey[];
  cacheStrategy?: CacheStrategy;
  maxOutputTokens?: number;
  allowedHours?: AllowedHourWindow[];
  monthlyCap?: Money;
  spend?: Money;
  status: TierStatus;
  degradation?: TierDegradation;
}

/** §17 `PUT /v1/ai/tiers/{key}`. */
export interface ModelTierWrite {
  model?: string;
  provider?: AiProvider;
  routing?: RoutingStrategy;
  fallbackChain?: TierKey[];
  cacheStrategy?: CacheStrategy;
  maxOutputTokens?: number;
  allowedHours?: AllowedHourWindow[];
  monthlyCap?: Money;
}

/* ------------------------------------------------------------------ *
 * §18 · Jury — an object, not a boolean
 * ------------------------------------------------------------------ */

/**
 * §18 / DECISIONS §2 the conditions under which an `ESCALATE` jury blocks.
 *
 * A live blocking jury runs only when confidence is below `minConfidence`,
 * **or** the value exceeds `maxValue`, **or** the action is first-of-kind
 * (new client, new programme, new trainer).
 */
export interface JuryTriggers {
  minConfidence: number;
  maxValue: Money;
  firstOfKind: boolean;
}

/**
 * §18 the jury policy on a routing entry.
 *
 * Supersedes the §17 `{ enabled: boolean, … }` form. The jury is a **gate**,
 * not a per-action step:
 * - `GATE` runs at promotion time against the golden set only.
 * - `SAMPLE` runs asynchronously after the human decides and never blocks;
 *   sampled results emit `JuryDisagreed` for drift monitoring without
 *   touching the decision.
 * - `ESCALATE` blocks only when a trigger fires.
 */
export interface JuryPolicy {
  mode: JuryMode;
  quorum: number;
  of: number;
  tiers: TierKey[];
  /** SAMPLE mode — DECISIONS §2 proposes 5% of live gated actions. */
  sampleRate?: Rate;
  /** ESCALATE mode. */
  triggers?: JuryTriggers;
}

/* ------------------------------------------------------------------ *
 * §17 · Routing — M20-S20
 * ------------------------------------------------------------------ */

/** §17 one row of the action→tier assignment matrix. */
export interface RoutingEntry {
  actionType: GovernedActionType;
  tier: TierKey;
  escalationLadder: TierKey[];
  jury: JuryPolicy;
  /** Whether a jury result is required before this type may run AUTONOMOUS. */
  requiredForAutonomous: boolean;
}

/**
 * §17 `GET /v1/ai/routing`. `PUT` applies to **future runs only** — never
 * retroactive.
 */
export interface RoutingResponse {
  data: RoutingEntry[];
  /** Count of edits staged in the UI but not yet applied. */
  unsavedChanges: number;
}

/* ------------------------------------------------------------------ *
 * §17 · Provider keys (BYOK) — M20-S21
 * ------------------------------------------------------------------ */

/**
 * §17 a provider key record.
 *
 * The API **never** returns a full key. `POST /v1/ai/providers` is write-only
 * and returns the masked record; reveal is a separate audited call,
 * `POST /v1/ai/providers/{id}/reveal`, which returns the key once and writes
 * `ProviderKeyRevealed`. `region` is returned before a key is saved so the
 * customer makes the PDPA residency call knowingly.
 * TODO(contract §17 Q4): should reveal exist at all once a key is saved, or
 * only rotate-and-replace?
 */
export interface ProviderKey {
  id: string;
  provider: AiProvider;
  label: string;
  status: ProviderKeyStatus;
  /** Always masked, e.g. `sk-ant-••••••••••••9a41`. */
  maskedKey: string;
  scopeTiers: TierKey[];
  spendMonth: Money;
  cap?: Money;
  rotationDate?: string;
  billingOwner: BillingOwner;
  /** Residency region, e.g. `US`. */
  region: string;
  lastTestedAt: Timestamp | null;
  invalidSince?: Timestamp;
  activeFallbackTier?: TierKey;
  addedBy: EditedBy;
}

/** §17 `POST /v1/ai/providers` — the key is write-only. */
export interface ProviderKeyCreateRequest {
  provider: AiProvider;
  label: string;
  key: string;
  scopeTiers: TierKey[];
  billingOwner: BillingOwner;
  region: string;
  cap?: Money;
  rotationDate?: string;
}

/** §17 `POST /v1/ai/providers/{id}/test` — live probe, updates `lastTestedAt`. */
export interface ProviderKeyTestResponse {
  status: ProviderKeyStatus;
  lastTestedAt: Timestamp;
  message?: string;
}

/** §17 `POST /v1/ai/providers/{id}/rotate` — old key invalidated immediately. */
export interface ProviderKeyRotateRequest {
  key: string;
}

/** §17 `POST /v1/ai/providers/{id}/reveal` — returns the key once, audited. */
export interface ProviderKeyRevealResponse {
  key: string;
  revealedAt: Timestamp;
}

/* ------------------------------------------------------------------ *
 * §17 · Usage and budgets — M20-S16
 * ------------------------------------------------------------------ */

/** §17 spend by cost class for the period. */
export interface UsageTotals {
  llm: Money;
  whatsapp: Money;
  compute: Money;
  cacheHitRate: Rate;
  offPeakShare: Rate;
  estimatedCacheSaving: Money;
}

/** §17 one row of the usage breakdown, with its own drill route. */
export interface UsageBreakdownRow {
  key: string;
  label: string;
  spend: Money;
  drillTo: string;
}

/**
 * §17 a budget.
 *
 * A tripped cap sets the affected routing entry to `PAUSED_BY_CAP`; runs
 * requesting it get `409 AGENT_PAUSED` with `details.reason: "BUDGET_CAP"`.
 * Raising a cap goes through `POST /v1/actions` `type: BUDGET_CAP_RAISE`,
 * which returns `QUEUED_FOR_APPROVAL` with `approverRole: MD`.
 */
export interface Budget {
  scope: BudgetScope;
  key: string;
  cap: Money;
  spend: Money;
  state: BudgetState;
}

/** §17 `GET /v1/ai/usage?period=&groupBy=`. */
export interface UsageResponse {
  period: string;
  totals: UsageTotals;
  forecast: Money;
  cap: Money;
  breakdown: UsageBreakdownRow[];
  budgets: Budget[];
}

/** §17 `GET /v1/ai/usage/forecast?period=`. */
export interface UsageForecast {
  period: string;
  forecast: Money;
  cap: Money;
}

/** §17 `PUT /v1/ai/budgets/{scope}/{key}` — raising a cap is MD-gated. */
export interface BudgetWrite {
  cap: Money;
}

/** §17 `POST /v1/actions` `type: BUDGET_CAP_RAISE`. */
export interface BudgetCapRaisePayload {
  scope: BudgetScope;
  key: string;
  cap: Money;
  reason?: string;
}
