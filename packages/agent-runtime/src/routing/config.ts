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
 *
 * ---
 *
 * ## L7 alignment (2026-09-13)
 *
 * `docs/research/2026-09-13-model-pricing-rebaseline.md` and
 * `docs/research/2026-09-13-ai-storage-and-pdpa-practices.md` found this file
 * disagreeing with `docs/bd/proposal-content-pack-v2.md` §4.1 on four of
 * eight tiers, the STRONG jury concentrated 2-of-3 on Anthropic, and — the
 * Opus-pass finding folded in here — CHEAP reading raw enquiry PII through
 * DeepSeek's own China-hosted API, which the PDPA research flags as **not
 * usable for PII at all**, not merely a price mismatch.
 *
 * **Direction: code leads, the pack follows.** L6's own prompt says §4.1
 * gets rewritten "to match `packages/agent-runtime/src/routing/config.ts`
 * after L7" — this file is upstream. Where the pack named a specific model
 * this file did not carry, that model was pulled in here because it is also
 * what the research prices as the cheapest one that passes the job; where
 * the pack and research disagreed with what compliance requires (any direct
 * DeepSeek API call for PII-bearing tiers), compliance won and neither the
 * pack nor the prior code binding survives.
 *
 * Changes:
 * - STRONG_2 moves from Claude Opus 5 (Anthropic) to Gemini 3.1 Pro, so the
 *   three STRONG jurors are three vendors — Anthropic, Google, OpenAI — not
 *   two Anthropic models and one. Cheaper too: research §4.
 * - CHEAP moves from `deepseek-chat` on DeepSeek's direct API to Qwen3.7
 *   Flash via OpenRouter — the single cheapest model in the price table, and
 *   critically *not* DeepSeek's own China-hosted endpoint, which the PDPA
 *   research says cannot carry PII under any configuration.
 * - FAST moves from Claude Haiku 4.5 to DeepSeek V4.1-Flash, carried over
 *   OpenRouter with a `hostConstraint` allow-list (below) pinning it to
 *   non-China hosts, because OpenRouter's default routing for DeepSeek is
 *   not guaranteed to avoid PRC-hosted infrastructure (ai-storage-and-pdpa-
 *   practices.md §2, §6). MID's DeepSeek V4 Pro has the identical
 *   compliance exposure per the same research, but is *not* moved here —
 *   `test/orchestrator.test.ts` hard-codes MID falling back because nothing
 *   serves `deepseek`, in a test outside this lane's pathspec (config.ts +
 *   its own tests only). Flagged as a follow-up, not fixed silently — see
 *   the comment on `DEFAULT_TIERS.MID`.
 * - FAST-UI moves from Claude Haiku 4.5 to gpt-oss-120B via Groq — cheaper
 *   than the Cerebras alternative the pack also named, and already
 *   US-hosted with zero data retention, so it carries no `hostConstraint`.
 * - `DEFAULT_ROUTING_ENTRIES` grows from 9 rows to all 24
 *   `GOVERNED_ACTION_TYPES` (the Opus-pass finding: 15 types were falling
 *   silently to `defaultTier` MID with no jury). Tiers and jury modes for
 *   the 15 new rows are read off `docs/design/DECISIONS.md` §1's autonomy
 *   matrix and the approval-role table in
 *   `docs/architecture/03-action-envelope-and-policy-gate.md`.
 * - DEEP_THINK and SPECIAL are untouched: no exploration doc sized their
 *   volume (pricing research §2) and neither is named in this lane's brief.
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

/**
 * A host/infrastructure allow-list for a tier binding.
 *
 * Exists because a `ProviderId` names a gateway, not a data center: routing
 * a call through `openrouter` says which wire format is spoken, not which
 * physical host answers it. For a model whose *native* vendor stores data on
 * PRC servers by default (DeepSeek, Qwen — ai-storage-and-pdpa-practices.md
 * §2), OpenRouter's default routing is not guaranteed to avoid PRC-hosted
 * infrastructure, so the tier has to say explicitly which upstream hosts it
 * trusts. A tier with no `hostConstraint` is unconstrained — this is an
 * allow-list added where compliance requires one, not a universal field.
 */
export interface HostConstraint {
  /** Upstream hosts/providers this tier's call may be served from. */
  allowedHosts: string[];
  /** Why the allow-list exists, surfaced in a refused call's error message. */
  reason: string;
}

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
  /** See {@link HostConstraint}. Present only where compliance requires it. */
  hostConstraint?: HostConstraint;
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
 * Vendor identity — independent of which gateway carries the call
 * ------------------------------------------------------------------ */

/**
 * The model's actual origin, as distinct from {@link TierBinding.provider}.
 *
 * `provider` says which wire format/gateway handles a call — `openrouter`
 * fronts Google, OpenAI, DeepSeek and Qwen models alike. A jury built for
 * vendor independence needs to know whose model is answering, not whose API
 * shape was spoken, so this is computed from the model id instead.
 */
export type ModelVendor = 'anthropic' | 'google' | 'openai' | 'deepseek' | 'qwen' | 'unknown';

const VENDOR_PATTERNS: ReadonlyArray<readonly [RegExp, ModelVendor]> = [
  [/^claude-/, 'anthropic'],
  [/^google\//, 'google'],
  [/gemini/, 'google'],
  [/^openai\//, 'openai'],
  [/gpt-/, 'openai'],
  [/deepseek/, 'deepseek'],
  [/qwen/, 'qwen'],
];

/** The vendor whose model actually answers a tier's calls. */
export function vendorFor(binding: TierBinding): ModelVendor {
  const model = binding.model.toLowerCase();
  for (const [pattern, vendor] of VENDOR_PATTERNS) {
    if (pattern.test(model)) return vendor;
  }
  return 'unknown';
}

/** The vendor behind each tier a jury policy calls, in order. */
export function juryVendors(
  policy: JuryPolicy,
  tiers: Record<TierKey, TierBinding> = DEFAULT_TIERS,
): ModelVendor[] {
  return policy.tiers.map((key) => vendorFor(tiers[key]));
}

/**
 * Whether a jury's tiers are answered by distinct, identified vendors.
 *
 * A 2-of-3 quorum drawn from one vendor's models cannot catch that vendor's
 * own systematic failure mode — this is the check the pricing research ran
 * by hand (§4) to find STRONG_1/STRONG_2 both on Anthropic.
 */
export function hasIndependentJury(
  policy: JuryPolicy,
  tiers: Record<TierKey, TierBinding> = DEFAULT_TIERS,
): boolean {
  const vendors = juryVendors(policy, tiers);
  return vendors.every((v) => v !== 'unknown') && new Set(vendors).size === vendors.length;
}

/* ------------------------------------------------------------------ *
 * Host constraints — DeepSeek/Qwen via OpenRouter, non-China hosts only
 * ------------------------------------------------------------------ */

/**
 * ai-storage-and-pdpa-practices.md §2/§3/§6: DeepSeek's direct API is not
 * usable for PII at all (stored on PRC servers by policy), and DeepSeek/Qwen
 * routed through OpenRouter must be pinned to a specific non-China host —
 * OpenRouter's default routing gives no such guarantee. Baseten, Fireworks
 * and Azure are the non-China hosts the research names as actually serving
 * DeepSeek's models today.
 */
const NON_CHINA_HOSTS = ['baseten', 'fireworks', 'azure'] as const;

const DEEPSEEK_QWEN_HOST_CONSTRAINT: HostConstraint = {
  allowedHosts: [...NON_CHINA_HOSTS],
  reason:
    'DeepSeek/Qwen via OpenRouter must be pinned to a non-China host explicitly; ' +
    'OpenRouter default routing does not guarantee one, and the direct DeepSeek ' +
    'API is not usable for PII under any host (docs/research/2026-09-13-ai-storage-and-pdpa-practices.md §2, §6).',
};

/** Whether a host is inside a tier's allow-list. A tier with no constraint allows any host. */
export function isHostAllowed(binding: TierBinding, host: string): boolean {
  if (!binding.hostConstraint) return true;
  return binding.hostConstraint.allowedHosts.includes(host);
}

/** A call that would land outside its tier's host allow-list. */
export class HostNotAllowedError extends Error {
  constructor(binding: TierBinding, host: string) {
    const c = binding.hostConstraint;
    super(
      `Tier ${binding.key} (${binding.model}) may not run on host "${host}": ${
        c?.reason ?? 'no reason recorded'
      } Allowed hosts: ${c?.allowedHosts.join(', ') ?? 'none'}.`,
    );
    this.name = 'HostNotAllowedError';
  }
}

/** Throws {@link HostNotAllowedError} when `host` is outside the tier's allow-list. */
export function assertHostAllowed(binding: TierBinding, host: string): void {
  if (!isHostAllowed(binding, host)) throw new HostNotAllowedError(binding, host);
}

/**
 * Tiers, among those actually carried over OpenRouter, that read raw inbound
 * message/document content directly (enquiry email, TNA documents,
 * participant lists) per the PDPA per-tier data-handling matrix
 * (ai-storage-and-pdpa-practices.md §3): FAST and CHEAP (DeepSeek Flash /
 * Qwen). FAST-UI also touches inbound-derived text but runs on Cerebras/Groq
 * — already US-hosted with zero retention, not an ambiguous-routing gateway
 * — so it carries no `hostConstraint`. MID (DeepSeek V4 Pro) reads the same
 * class of content and belongs in this list on compliance grounds, but it is
 * still bound to DeepSeek's direct API rather than OpenRouter — see the
 * comment on `DEFAULT_TIERS.MID` for why that move is out of this lane's
 * pathspec — so it is a known, flagged gap rather than a silent one.
 */
export const INBOUND_CONTENT_TIERS: readonly TierKey[] = ['FAST', 'CHEAP'];

/* ------------------------------------------------------------------ *
 * The default configuration
 * ------------------------------------------------------------------ */

/**
 * Tier bindings for the demo.
 *
 * Providers are named, not required: the router falls down the chain when a
 * tier's provider has no key, so this same config runs on an Anthropic-only
 * machine, an OpenRouter-only machine, or no keys at all.
 */
export const DEFAULT_TIERS: Record<TierKey, TierBinding> = {
  CHEAP: {
    key: 'CHEAP',
    // Off DeepSeek's direct API entirely: the PDPA research (§2) says that
    // endpoint is not usable for PII under any configuration, and CHEAP
    // reads raw enquiry text. Qwen3.7 Flash via OpenRouter is also the
    // single cheapest model in the price table (pricing research §1).
    model: 'qwen/qwen3.7-flash',
    provider: 'openrouter',
    displayName: 'Qwen3.7 Flash (via OpenRouter)',
    contextWindow: 1_000_000,
    maxOutputTokens: 4_096,
    cacheStrategy: 'PROMPT_15M',
    fallbackChain: ['MID', 'STRONG_1'],
    hostConstraint: DEEPSEEK_QWEN_HOST_CONSTRAINT,
  },
  FAST: {
    key: 'FAST',
    // DeepSeek V4.1-Flash, per the pack's §4.1 naming and confirmed as the
    // cheapest model that passes this tier's job (pricing research §1) —
    // ~7-8x cheaper than the Claude Haiku 4.5 binding it replaces. Carried
    // over OpenRouter, pinned non-China, for the same reason as CHEAP.
    model: 'deepseek/deepseek-v4.1-flash',
    provider: 'openrouter',
    displayName: 'DeepSeek V4.1-Flash (via OpenRouter)',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    cacheStrategy: 'PROMPT_15M',
    fallbackChain: ['MID', 'STRONG_1'],
    hostConstraint: DEEPSEEK_QWEN_HOST_CONSTRAINT,
  },
  FAST_UI: {
    key: 'FAST_UI',
    // gpt-oss-120B: the pack names Cerebras or Groq; Groq prices cheaper
    // ($0.15/$0.60 vs Cerebras $0.35/$0.75 — pricing research §1) and is
    // already zero-retention US infrastructure, so no hostConstraint is
    // needed. `openai-compatible` is the runtime's escape hatch for exactly
    // this — an OpenAI-wire-format endpoint that is neither Anthropic nor
    // OpenRouter (providers/types.ts).
    model: 'openai/gpt-oss-120b',
    provider: 'openai-compatible',
    displayName: 'gpt-oss-120B (via Groq)',
    contextWindow: 128_000,
    maxOutputTokens: 2_048,
    cacheStrategy: 'PROMPT_15M',
    fallbackChain: ['FAST', 'MID'],
  },
  MID: {
    key: 'MID',
    // Left on DeepSeek's direct API, unlike CHEAP/FAST above. The PDPA
    // research (§3) names MID's TNA/participant-extraction text as needing
    // the same non-China-only treatment, and that is a real compliance gap
    // — but `test/orchestrator.test.ts`'s escalation-path test (outside
    // this lane's pathspec: config.ts + its own tests only) hard-codes MID
    // falling back because nothing serves `deepseek`, and asserts on the
    // literal "no key configured for deepseek" reason string. Moving MID to
    // OpenRouter belongs in a follow-up lane that also updates that test.
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
    // Moved off Claude Opus 5: STRONG_1 and STRONG_2 were both Anthropic, a
    // 2-of-3 jury on one vendor's models against a 2-of-3 quorum (pricing
    // research §4). Gemini 3.1 Pro restores vendor independence for free —
    // roughly 2.5x cheaper on input, 2x on output, than Opus 5 — and is the
    // model the pack itself names for this slot. No native Google adapter
    // exists in this runtime (providers/types.ts's `ProviderId` is closed),
    // so it is carried the same way STRONG_3 already carries OpenAI: over
    // OpenRouter.
    model: 'google/gemini-3.1-pro',
    provider: 'openrouter',
    displayName: 'Gemini 3.1 Pro (via OpenRouter)',
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
 *
 * All 24 `GOVERNED_ACTION_TYPES` (`packages/contract/src/actions.ts`) have an
 * explicit row. Fifteen were previously unmapped and fell silently to
 * `defaultTier` (MID) with no jury attached — the second Opus-pass finding.
 * Tier and jury choices for those fifteen are read off DECISIONS.md §1's
 * autonomy matrix and the approval-role table in architecture doc 03
 * (`docs/architecture/03-action-envelope-and-policy-gate.md` §"policy rows"):
 * a row whose approver escalates to MD and whose DECISIONS §1 launch level is
 * "Act w/ approval, never" gets STRONG_1 + ESCALATE_JURY; a reversible,
 * read-only or "never gated" row gets CHEAP/MID + SAMPLE_JURY;
 * AGENT_AUTONOMY_CHANGE gets GATE_JURY because it *is* the promotion decision
 * GATE mode exists for (architecture doc 03: "GATE runs against the golden
 * set when an AGENT_AUTONOMY_CHANGE proposes a promotion").
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
  // --- Previously unmapped (Opus-pass finding). DECISIONS §1 / policy-gate table. ---
  {
    // DECISIONS §1: "TNA analysis, programme recommendation — Suggest —
    // never auto-acts; output feeds a human step."
    actionType: 'TNA_RECOMMENDATION_ACCEPT',
    tier: 'MID',
    escalationLadder: ['MID', 'STRONG_1'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // APV-06: OPS approver when attendance isn't locked or the packet is
    // incomplete.
    actionType: 'ENGAGEMENT_CLOSE_OUT',
    tier: 'MID',
    escalationLadder: ['MID', 'STRONG_1'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // CMP-01: always gated, OPS — the lock is one-way (DECISIONS §1).
    actionType: 'ATTENDANCE_APPROVE',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // CMP-02/03: FINANCE, escalating to MD when a claim reference exists —
    // a compliance-sensitive correction.
    actionType: 'ATTENDANCE_UNLOCK',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // CMP-04: FINANCE always — an HRD Corp compliance filing.
    actionType: 'HRDC_PACKET_MARK_SUBMITTED',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // FIN-02: FINANCE always, MD@360m — money-moving, same class as
    // INVOICE_CREATE above.
    actionType: 'INVOICE_PUSH',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // FIN-06: FINANCE only when the recorded amount mismatches (write-off
    // or overpayment) — a recording step, not a commitment.
    actionType: 'PAYMENT_RECORD',
    tier: 'MID',
    escalationLadder: ['MID', 'STRONG_1'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // FIN-03/04: reminders 1-2 promote to autonomous after a clean streak;
    // reminder 3 is "always human" (DECISIONS §1) — same shape as
    // FOLLOWUP_SEND above.
    actionType: 'REMINDER_SEND',
    tier: 'MID',
    escalationLadder: ['MID', 'STRONG_1'],
    jury: SAMPLE_JURY,
    requiredForAutonomous: true,
  },
  {
    // APV-07: SALES_MANAGER always, MD@360m — a mass client-facing send.
    actionType: 'BROADCAST_SEND',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // GOV-01: MD-gated always. This *is* the promotion decision GATE mode
    // exists for (architecture doc 03).
    actionType: 'AGENT_AUTONOMY_CHANGE',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: GATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // GOV-02: "never gated" (Phase 1 decision 6) — pausing an agent is a
    // reversible safety action, not a commitment.
    actionType: 'AGENT_PAUSE',
    tier: 'CHEAP',
    escalationLadder: ['CHEAP', 'MID'],
    jury: SAMPLE_JURY,
    requiredForAutonomous: false,
  },
  {
    // FIN-07: MD always — raising a spend ceiling.
    actionType: 'BUDGET_CAP_RAISE',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // CMP-05: FINANCE, escalating to ADMIN — a regulatory rule
    // interpretation, "never" autonomous per DECISIONS §1.
    actionType: 'RULE_CHANGE_APPROVE',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // FIN-05 / ruling R3: MD always — the collections ladder's most severe
    // step.
    actionType: 'ACCOUNT_TRADING_HOLD',
    tier: 'STRONG_1',
    escalationLadder: ['STRONG_1', 'STRONG_2'],
    jury: ESCALATE_JURY,
    requiredForAutonomous: true,
  },
  {
    // Ruling R18: moving a deal across pipeline stages — bookkeeping, same
    // class as OPPORTUNITY_CONVERT above.
    actionType: 'OPPORTUNITY_STAGE_CHANGE',
    tier: 'CHEAP',
    escalationLadder: ['CHEAP', 'MID'],
    jury: SAMPLE_JURY,
    requiredForAutonomous: false,
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
