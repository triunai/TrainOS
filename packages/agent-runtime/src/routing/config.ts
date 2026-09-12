/**
 * §17 routing, as a runtime object.
 *
 * The action→tier matrix here is shaped like `GET /v1/ai/routing`'s
 * `RoutingEntry[]` so that when M20-S20 starts writing that endpoint the
 * runtime consumes its response directly, with no translation layer. The tier
 * *bindings* — which model, which provider, how big a context window — are
 * this package's addition: the contract's `ModelTier` names a model as a
 * display string ("Claude Sonnet 5") and the runtime needs an API model id
 * (`claude-sonnet-5`), so both live on the binding.
 *
 * `TierKey` is the contract's nine-value enum. The brief's "CHEAP / STANDARD /
 * STRONG_1..3" does not survive contact with it: there is no `STANDARD`
 * member. `MID` carries that role here, which is what the §17 trace example
 * does too (its orchestrator node runs at `MID`).
 */

import type {
  CacheStrategy,
  GovernedActionType,
  JuryPolicy,
  Money,
  RoutingEntry,
  TierKey,
} from '@trainos/contract';
import type { ProviderId } from '../providers/types';

/* ------------------------------------------------------------------ *
 * Tier bindings
 * ------------------------------------------------------------------ */

/** What a tier key actually calls. */
export interface TierBinding {
  key: TierKey;
  /** The API model id, e.g. `claude-sonnet-5`. */
  model: string;
  provider: ProviderId;
  /** Display name, matching the §17 tier table's `model` column. */
  displayName: string;
  /**
   * Input context window in tokens. Drives the 60% handoff threshold, so a
   * wrong value here shows up as handoffs at the wrong moment, not as an
   * error.
   */
  contextWindow: number;
  maxOutputTokens: number;
  cacheStrategy: CacheStrategy;
  /** Tried in order when this tier errors or has no configured provider. */
  fallbackChain: TierKey[];
  monthlyCap?: Money;
}

/** A budget that can pause work when it trips. §17 `Budget`, minus live spend. */
export interface BudgetLimit {
  scope: 'TIER' | 'AGENT' | 'ACTION_TYPE';
  key: string;
  cap: Money;
}

export interface RoutingConfig {
  tiers: Record<TierKey, TierBinding>;
  /** Exactly the `GET /v1/ai/routing` `data[]` shape. */
  entries: RoutingEntry[];
  /** Used when no entry matches an action type. */
  defaultTier: TierKey;
  budgets: BudgetLimit[];
}

/* ------------------------------------------------------------------ *
 * Jury policies — DECISIONS §2 / §18
 * ------------------------------------------------------------------ */

/**
 * The escalation triggers, straight from DECISIONS §2 and architecture doc 03
 * §5: confidence below 0.70, **or** value above RM 50,000, **or** first-of-kind.
 * `maxValue` is 5,000,000 sen because `Money` is integer sen.
 */
export const ESCALATE_JURY: JuryPolicy = {
  mode: 'ESCALATE',
  quorum: 2,
  of: 3,
  tiers: ['STRONG_1', 'STRONG_2', 'STRONG_3'],
  triggers: { minConfidence: 0.7, maxValue: { amount: 5_000_000, currency: 'MYR' }, firstOfKind: true },
};

/** 5% of live gated actions, after the human decides. Never blocks. */
export const SAMPLE_JURY: JuryPolicy = {
  mode: 'SAMPLE',
  quorum: 2,
  of: 3,
  tiers: ['STRONG_1', 'STRONG_2', 'STRONG_3'],
  sampleRate: 0.05,
};

/** Promotion time only, against the golden set. Never touches a live run. */
export const GATE_JURY: JuryPolicy = {
  mode: 'GATE',
  quorum: 2,
  of: 3,
  tiers: ['STRONG_1', 'STRONG_2', 'STRONG_3'],
};

/* ------------------------------------------------------------------ *
 * The default configuration
 * ------------------------------------------------------------------ */

/**
 * Tier bindings for the demo.
 *
 * Providers are named, not required: the router falls down the chain when a
 * tier's provider has no key, so this same config runs on an Anthropic-only
 * machine, a DeepSeek-only machine, or no keys at all.
 */
export const DEFAULT_TIERS: Record<TierKey, TierBinding> = {
  CHEAP: {
    key: 'CHEAP',
    model: 'deepseek-chat',
    provider: 'deepseek',
    displayName: 'DeepSeek Chat',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    cacheStrategy: 'PROMPT_1H',
    fallbackChain: ['MID', 'STRONG_1'],
  },
  FAST: {
    key: 'FAST',
    model: 'claude-haiku-4-5',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    cacheStrategy: 'PROMPT_15M',
    fallbackChain: ['MID', 'STRONG_1'],
  },
  FAST_UI: {
    key: 'FAST_UI',
    model: 'claude-haiku-4-5',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutputTokens: 2_048,
    cacheStrategy: 'PROMPT_15M',
    fallbackChain: ['FAST', 'MID'],
  },
  MID: {
    key: 'MID',
    model: 'deepseek-v4-pro',
    provider: 'deepseek',
    displayName: 'DeepSeek V4 Pro',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    cacheStrategy: 'PROMPT_1H',
    fallbackChain: ['STRONG_1', 'STRONG_2'],
  },
  STRONG_1: {
    key: 'STRONG_1',
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    cacheStrategy: 'CONTEXT_1H',
    fallbackChain: ['STRONG_2', 'STRONG_3'],
    monthlyCap: { amount: 1_500_000, currency: 'MYR' },
  },
  STRONG_2: {
    key: 'STRONG_2',
    model: 'claude-opus-5',
    provider: 'anthropic',
    displayName: 'Claude Opus 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    cacheStrategy: 'CONTEXT_1H',
    fallbackChain: ['STRONG_3', 'MID'],
  },
  STRONG_3: {
    key: 'STRONG_3',
    // Routed through OpenRouter so the third juror is a genuinely different
    // vendor. A 2-of-3 jury of one vendor's models is not three opinions.
    model: 'openai/gpt-5.2',
    provider: 'openrouter',
    displayName: 'GPT-5.2 (via OpenRouter)',
    contextWindow: 400_000,
    maxOutputTokens: 16_384,
    cacheStrategy: 'NONE',
    fallbackChain: ['STRONG_2', 'MID'],
  },
  DEEP_THINK: {
    key: 'DEEP_THINK',
    model: 'claude-opus-5',
    provider: 'anthropic',
    displayName: 'Claude Opus 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    cacheStrategy: 'CONTEXT_1H',
    fallbackChain: ['STRONG_2', 'STRONG_1'],
  },
  SPECIAL: {
    key: 'SPECIAL',
    model: 'claude-opus-5',
    provider: 'anthropic',
    displayName: 'Claude Opus 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    cacheStrategy: 'CONTEXT_1H',
    fallbackChain: ['STRONG_2'],
    monthlyCap: { amount: 2_000_000, currency: 'MYR' },
  },
};

/**
 * The action→tier matrix.
 *
 * `requiredForAutonomous` follows DECISIONS §1: the money-moving and
 * client-committing types can never be promoted without a jury result, and the
 * reversible read-only ones never need one.
 */
export const DEFAULT_ROUTING_ENTRIES: RoutingEntry[] = [
  {
    actionType: 'PROPOSAL_DRAFT',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: GATE_JURY,
    requiredForAutonomous: true,
  },
  {
    actionType: 'PROPOSAL_SEND',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2', 'STRONG_3'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    actionType: 'QUOTATION_APPLY',
    tier: 'MID',
    escalationLadder: ['MID', 'STRONG_1'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    actionType: 'DISCOUNT_APPROVE',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    actionType: 'OPPORTUNITY_CONVERT',
    tier: 'CHEAP',
    escalationLadder: ['CHEAP', 'MID'],
    jury: SAMPLE_JURY,
    requiredForAutonomous: false,
  },
  {
    actionType: 'ENQUIRY_ARCHIVE',
    tier: 'CHEAP',
    escalationLadder: ['CHEAP', 'MID'],
    jury: SAMPLE_JURY,
    requiredForAutonomous: false,
  },
  {
    actionType: 'FOLLOWUP_SEND',
    tier: 'MID',
    escalationLadder: ['MID', 'STRONG_1'],
    jury: SAMPLE_JURY,
    requiredForAutonomous: true,
  },
  {
    actionType: 'TRAINER_BOOK',
    tier: 'MID',
    escalationLadder: ['MID', 'STRONG_1'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    actionType: 'INVOICE_CREATE',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
];

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  tiers: DEFAULT_TIERS,
  entries: DEFAULT_ROUTING_ENTRIES,
  defaultTier: 'MID',
  budgets: [
    { scope: 'TIER', key: 'SPECIAL', cap: { amount: 2_000_000, currency: 'MYR' } },
    { scope: 'ACTION_TYPE', key: 'PROPOSAL_SEND', cap: { amount: 50_000, currency: 'MYR' } },
  ],
};

/** A config with some tiers or entries replaced. */
export function withRouting(
  base: RoutingConfig,
  overrides: {
    tiers?: Partial<Record<TierKey, Partial<TierBinding>>>;
    entries?: RoutingEntry[];
    budgets?: BudgetLimit[];
    defaultTier?: TierKey;
  },
): RoutingConfig {
  const tiers = { ...base.tiers };
  for (const [key, patch] of Object.entries(overrides.tiers ?? {})) {
    const tierKey = key as TierKey;
    const existing = tiers[tierKey];
    tiers[tierKey] = { ...existing, ...patch };
  }
  return {
    tiers,
    entries: overrides.entries ?? base.entries,
    defaultTier: overrides.defaultTier ?? base.defaultTier,
    budgets: overrides.budgets ?? base.budgets,
  };
}

/** The routing entry for an action type, or `undefined`. */
export function entryFor(
  config: RoutingConfig,
  actionType: GovernedActionType,
): RoutingEntry | undefined {
  return config.entries.find((e) => e.actionType === actionType);
}
