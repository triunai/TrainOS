/**
 * §17 + §18 · Model tiers, routing, provider keys, usage and budgets.
 *
 * Screens M20-S20 (tiers and routing), M20-S21 (provider keys),
 * M20-S16 (usage, cost and budgets).
 *
 * `jury` is the §18 object, never the §17 boolean: GATE runs at promotion time
 * against the golden set, SAMPLE runs asynchronously after the human decides
 * and never blocks, ESCALATE blocks only when a trigger fires.
 */

import type { Budget, ModelTier, ProviderKey, RoutingEntry, UsageResponse } from "@trainos/contract";
import { PROVIDER_ANTHROPIC, USER_KHAIRUL } from "@trainos/contract";
import { myr } from "./_helpers";

/** Provider key records beyond the canonical Anthropic one. */
export const PROVIDER_GOOGLE = "prv_google";
export const PROVIDER_OPENAI = "prv_openai";
export const PROVIDER_DEEPSEEK = "prv_deepseek";
export const PROVIDER_ANTHROPIC_BATCH = "prv_anthropic_batch";
export const PROVIDER_EMBEDDINGS = "prv_embeddings";

/**
 * §17 `GET /v1/ai/tiers` — all nine tiers.
 *
 * STRONG_2 is degraded with its live fallback named, and SPECIAL is paused by
 * cap, which is what puts rule extraction behind an approval on M20-S16.
 */
export const modelTiers: ModelTier[] = [
  {
    key: "FAST",
    model: "Gemini 3.1 Flash",
    provider: "GOOGLE",
    routing: "THROUGHPUT",
    fallbackChain: ["FAST_UI", "MID"],
    cacheStrategy: "PROMPT_1H",
    maxOutputTokens: 4096,
    allowedHours: [[0, 24]],
    monthlyCap: myr(8000),
    spend: myr(4100),
    status: "HEALTHY",
  },
  {
    key: "FAST_UI",
    model: "Gemini 3.1 Flash Lite",
    provider: "GOOGLE",
    routing: "THROUGHPUT",
    fallbackChain: ["FAST"],
    cacheStrategy: "PROMPT_15M",
    maxOutputTokens: 2048,
    allowedHours: [[0, 24]],
    monthlyCap: myr(3000),
    spend: myr(900),
    status: "HEALTHY",
  },
  {
    key: "MID",
    model: "DeepSeek V4 Pro",
    provider: "DEEPSEEK",
    routing: "PRICE",
    fallbackChain: ["FAST", "STRONG_1"],
    cacheStrategy: "PROMPT_24H",
    maxOutputTokens: 8192,
    /** Batch-eligible, so it is restricted to off-peak and queues rather than escalates. */
    allowedHours: [
      [0, 9],
      [12, 14],
      [18, 24],
    ],
    monthlyCap: myr(12000),
    spend: myr(7300),
    status: "HEALTHY",
  },
  {
    key: "CHEAP",
    model: "DeepSeek V4 Lite",
    provider: "DEEPSEEK",
    routing: "PRICE",
    fallbackChain: ["FAST"],
    cacheStrategy: "PROMPT_24H",
    maxOutputTokens: 4096,
    allowedHours: [
      [0, 9],
      [18, 24],
    ],
    monthlyCap: myr(4000),
    spend: myr(1200),
    status: "HEALTHY",
  },
  {
    key: "STRONG_1",
    model: "Claude Sonnet 5",
    provider: "ANTHROPIC",
    routing: "FIXED",
    fallbackChain: ["STRONG_2", "STRONG_3"],
    cacheStrategy: "CONTEXT_1H",
    maxOutputTokens: 8192,
    allowedHours: [[0, 24]],
    monthlyCap: myr(15000),
    spend: myr(9600),
    status: "HEALTHY",
  },
  {
    key: "STRONG_2",
    model: "Gemini 3.1 Pro",
    provider: "GOOGLE",
    routing: "PRICE",
    fallbackChain: ["STRONG_3", "MID"],
    cacheStrategy: "CONTEXT_1H",
    maxOutputTokens: 8192,
    allowedHours: [[0, 24]],
    monthlyCap: myr(10000),
    spend: myr(6400),
    status: "DEGRADED",
    degradation: {
      since: "2026-11-14T09:12:00+08:00",
      reason: "PROVIDER_5XX",
      activeFallback: "DEEP_THINK",
    },
  },
  {
    key: "STRONG_3",
    model: "GPT-5.6 Terra",
    provider: "OPENAI",
    routing: "FIXED",
    fallbackChain: ["STRONG_1"],
    cacheStrategy: "PROMPT_1H",
    maxOutputTokens: 8192,
    allowedHours: [[0, 24]],
    monthlyCap: myr(9000),
    spend: myr(3800),
    status: "HEALTHY",
  },
  {
    key: "DEEP_THINK",
    model: "Gemini 3.1 Pro Thinking",
    provider: "GOOGLE",
    routing: "FIXED",
    fallbackChain: ["STRONG_1"],
    cacheStrategy: "CONTEXT_1H",
    maxOutputTokens: 16384,
    allowedHours: [[0, 24]],
    monthlyCap: myr(12000),
    spend: myr(5200),
    status: "HEALTHY",
  },
  {
    key: "SPECIAL",
    model: "Claude Opus 5",
    provider: "ANTHROPIC",
    routing: "FIXED",
    fallbackChain: ["STRONG_1"],
    cacheStrategy: "CONTEXT_1H",
    maxOutputTokens: 16384,
    allowedHours: [[0, 24]],
    monthlyCap: myr(20000),
    spend: myr(20000),
    status: "PAUSED_BY_CAP",
  },
];

/** §17 + §18 `GET /v1/ai/routing` — the twelve-row assignment matrix. */
export const routingEntries: RoutingEntry[] = [
  {
    actionType: "PROPOSAL_DRAFT",
    tier: "STRONG_1",
    escalationLadder: ["STRONG_1", "STRONG_2"],
    jury: {
      mode: "ESCALATE",
      quorum: 2,
      of: 3,
      tiers: ["STRONG_1", "STRONG_2", "STRONG_3"],
      sampleRate: 0.05,
      triggers: { minConfidence: 0.7, maxValue: myr(5000000), firstOfKind: true },
    },
    requiredForAutonomous: true,
  },
  {
    actionType: "PROPOSAL_SEND",
    tier: "STRONG_1",
    escalationLadder: ["STRONG_1", "STRONG_2"],
    jury: {
      mode: "ESCALATE",
      quorum: 2,
      of: 3,
      tiers: ["STRONG_1", "STRONG_2", "STRONG_3"],
      triggers: { minConfidence: 0.7, maxValue: myr(5000000), firstOfKind: true },
    },
    requiredForAutonomous: true,
  },
  {
    actionType: "OPPORTUNITY_CONVERT",
    tier: "FAST",
    escalationLadder: ["FAST", "MID"],
    jury: { mode: "SAMPLE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"], sampleRate: 0.05 },
    requiredForAutonomous: false,
  },
  {
    actionType: "ENQUIRY_ARCHIVE",
    tier: "CHEAP",
    escalationLadder: ["CHEAP", "FAST"],
    jury: { mode: "SAMPLE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"], sampleRate: 0.05 },
    requiredForAutonomous: true,
  },
  {
    actionType: "TNA_RECOMMENDATION_ACCEPT",
    tier: "STRONG_1",
    escalationLadder: ["STRONG_1", "DEEP_THINK"],
    jury: { mode: "GATE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"] },
    requiredForAutonomous: true,
  },
  {
    actionType: "QUOTATION_APPLY",
    tier: "MID",
    escalationLadder: ["MID", "STRONG_1"],
    jury: { mode: "GATE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"] },
    requiredForAutonomous: true,
  },
  {
    actionType: "FOLLOWUP_SEND",
    tier: "MID",
    escalationLadder: ["MID", "STRONG_1"],
    jury: { mode: "SAMPLE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"], sampleRate: 0.05 },
    requiredForAutonomous: true,
  },
  {
    actionType: "REMINDER_SEND",
    tier: "MID",
    escalationLadder: ["MID", "STRONG_1"],
    jury: { mode: "SAMPLE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"], sampleRate: 0.05 },
    requiredForAutonomous: true,
  },
  {
    actionType: "INVOICE_CREATE",
    tier: "STRONG_1",
    escalationLadder: ["STRONG_1"],
    jury: { mode: "GATE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"] },
    requiredForAutonomous: true,
  },
  {
    actionType: "HRDC_PACKET_MARK_SUBMITTED",
    tier: "STRONG_2",
    escalationLadder: ["STRONG_2", "SPECIAL"],
    jury: { mode: "GATE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"] },
    requiredForAutonomous: true,
  },
  {
    actionType: "RULE_CHANGE_APPROVE",
    tier: "SPECIAL",
    escalationLadder: ["STRONG_2", "SPECIAL"],
    jury: {
      mode: "ESCALATE",
      quorum: 2,
      of: 3,
      tiers: ["STRONG_1", "STRONG_2", "STRONG_3"],
      triggers: { minConfidence: 0.8, maxValue: myr(0), firstOfKind: true },
    },
    requiredForAutonomous: true,
  },
  {
    actionType: "ATTENDANCE_APPROVE",
    tier: "FAST",
    escalationLadder: ["FAST"],
    jury: { mode: "GATE", quorum: 2, of: 3, tiers: ["STRONG_1", "STRONG_2", "STRONG_3"] },
    requiredForAutonomous: true,
  },
];

/** §17 how many matrix edits are staged in the UI but not yet applied. */
export const routingUnsavedChanges = 2;

/**
 * §17 `GET /v1/ai/providers` — six cards, four of the states M20-S21 renders.
 *
 * The API never returns a full key: `maskedKey` is all any read gives back,
 * and reveal is a separate audited call.
 */
export const providerKeys: ProviderKey[] = [
  {
    id: PROVIDER_ANTHROPIC,
    provider: "ANTHROPIC",
    label: "Anthropic direct",
    status: "INVALID",
    maskedKey: "sk-ant-••••••••••••9a41",
    scopeTiers: ["STRONG_1"],
    spendMonth: myr(9600),
    cap: myr(15000),
    rotationDate: "2027-03-01",
    billingOwner: "CLIENT_ACCOUNT",
    region: "US",
    lastTestedAt: "2026-11-14T08:40:00+08:00",
    invalidSince: "2026-11-14T08:40:00+08:00",
    /** The card names the tier now carrying its traffic, not just "invalid". */
    activeFallbackTier: "STRONG_2",
    addedBy: { id: USER_KHAIRUL, name: "Khairul Anwar", at: "2026-01-12T10:00:00+08:00" },
  },
  {
    id: PROVIDER_GOOGLE,
    provider: "GOOGLE",
    label: "Google Vertex — asia-southeast1",
    /** 90% of cap — the budget bar M20-S21 renders near its limit. */
    status: "VALID",
    maskedKey: "AIza••••••••••••7c22",
    scopeTiers: ["FAST", "FAST_UI", "STRONG_2", "DEEP_THINK"],
    spendMonth: myr(16650),
    cap: myr(18500),
    rotationDate: "2027-06-30",
    billingOwner: "CLIENT_ACCOUNT",
    region: "SG",
    lastTestedAt: "2026-11-14T06:00:00+08:00",
    addedBy: { id: USER_KHAIRUL, name: "Khairul Anwar", at: "2026-01-12T10:20:00+08:00" },
  },
  {
    id: PROVIDER_OPENAI,
    provider: "OPENAI",
    label: "OpenAI platform",
    /** Expiring: the rotation date is inside thirty days. */
    status: "EXPIRING",
    maskedKey: "sk-proj-••••••••••••1d08",
    scopeTiers: ["STRONG_3"],
    spendMonth: myr(3800),
    cap: myr(9000),
    rotationDate: "2026-12-01",
    billingOwner: "PASS_THROUGH",
    region: "US",
    lastTestedAt: "2026-11-13T06:00:00+08:00",
    addedBy: { id: USER_KHAIRUL, name: "Khairul Anwar", at: "2026-02-03T09:00:00+08:00" },
  },
  {
    id: PROVIDER_DEEPSEEK,
    provider: "DEEPSEEK",
    label: "DeepSeek platform",
    status: "VALID",
    maskedKey: "sk-ds-••••••••••••4b90",
    scopeTiers: ["MID", "CHEAP"],
    spendMonth: myr(8500),
    cap: myr(16000),
    rotationDate: "2027-08-15",
    billingOwner: "CLIENT_ACCOUNT",
    region: "SG",
    lastTestedAt: "2026-11-14T06:00:00+08:00",
    addedBy: { id: USER_KHAIRUL, name: "Khairul Anwar", at: "2026-03-18T14:30:00+08:00" },
  },
  {
    id: PROVIDER_ANTHROPIC_BATCH,
    provider: "ANTHROPIC",
    label: "Anthropic batch — SPECIAL tier",
    status: "VALID",
    maskedKey: "sk-ant-••••••••••••2e17",
    scopeTiers: ["SPECIAL"],
    spendMonth: myr(20000),
    cap: myr(20000),
    rotationDate: "2027-03-01",
    billingOwner: "CLIENT_ACCOUNT",
    region: "US",
    lastTestedAt: "2026-11-14T06:00:00+08:00",
    addedBy: { id: USER_KHAIRUL, name: "Khairul Anwar", at: "2026-05-02T11:00:00+08:00" },
  },
  {
    id: PROVIDER_EMBEDDINGS,
    provider: "OPENAI",
    label: "Embeddings",
    /** The first-run empty state: a slot exists, no key has been saved. */
    status: "NOT_SET",
    maskedKey: "",
    scopeTiers: [],
    spendMonth: myr(0),
    billingOwner: "CLIENT_ACCOUNT",
    region: "US",
    lastTestedAt: null,
    addedBy: { id: USER_KHAIRUL, name: "Khairul Anwar", at: "2026-11-01T09:00:00+08:00" },
  },
];

/**
 * §17 budgets.
 *
 * TIER/SPECIAL is at its cap and paused; the rule-extract action type sits at
 * 98%, which is the "near" state M20-S16 renders before it trips.
 */
export const budgets: Budget[] = [
  { scope: "TIER", key: "SPECIAL", cap: myr(20000), spend: myr(20000), state: "PAUSED" },
  { scope: "TIER", key: "STRONG_1", cap: myr(15000), spend: myr(9600), state: "WITHIN" },
  { scope: "TIER", key: "MID", cap: myr(12000), spend: myr(7300), state: "WITHIN" },
  { scope: "ACTION_TYPE", key: "RULE_CHANGE_APPROVE", cap: myr(6000), spend: myr(5880), state: "NEAR" },
  { scope: "ACTION_TYPE", key: "PROPOSAL_DRAFT", cap: myr(9000), spend: myr(4200), state: "WITHIN" },
  { scope: "AGENT", key: "agent_proposal", cap: myr(4000), spend: myr(1890), state: "WITHIN" },
  { scope: "AGENT", key: "agent_compliance", cap: myr(2000), spend: myr(1180), state: "WITHIN" },
];

/** §17 `GET /v1/ai/usage?period=&groupBy=`, keyed by `period::groupBy`. */
export const usageByGrouping: Record<string, UsageResponse> = {
  "2026-11::TIER": {
    period: "2026-11",
    totals: {
      llm: myr(53700),
      whatsapp: myr(3400),
      compute: myr(9600),
      cacheHitRate: 0.61,
      offPeakShare: 0.44,
      estimatedCacheSaving: myr(24000),
    },
    forecast: myr(81200),
    cap: myr(94000),
    breakdown: [
      {
        key: "SPECIAL",
        label: "Claude Opus 5",
        spend: myr(20000),
        drillTo: "/v1/runs?filter[tier][eq]=SPECIAL&filter[period][eq]=2026-11",
      },
      {
        key: "STRONG_1",
        label: "Claude Sonnet 5",
        spend: myr(9600),
        drillTo: "/v1/runs?filter[tier][eq]=STRONG_1&filter[period][eq]=2026-11",
      },
      {
        key: "MID",
        label: "DeepSeek V4 Pro",
        spend: myr(7300),
        drillTo: "/v1/runs?filter[tier][eq]=MID&filter[period][eq]=2026-11",
      },
      {
        key: "STRONG_2",
        label: "Gemini 3.1 Pro",
        spend: myr(6400),
        drillTo: "/v1/runs?filter[tier][eq]=STRONG_2&filter[period][eq]=2026-11",
      },
      {
        key: "DEEP_THINK",
        label: "Gemini 3.1 Pro Thinking",
        spend: myr(5200),
        drillTo: "/v1/runs?filter[tier][eq]=DEEP_THINK&filter[period][eq]=2026-11",
      },
    ],
    budgets,
  },
  "2026-11::AGENT": {
    period: "2026-11",
    totals: {
      llm: myr(53700),
      whatsapp: myr(3400),
      compute: myr(9600),
      cacheHitRate: 0.61,
      offPeakShare: 0.44,
      estimatedCacheSaving: myr(24000),
    },
    forecast: myr(81200),
    cap: myr(94000),
    breakdown: [
      {
        key: "agent_tna",
        label: "TNA Agent",
        spend: myr(2180),
        drillTo: "/v1/runs?filter[agentId][eq]=agent_tna&filter[period][eq]=2026-11",
      },
      {
        key: "agent_proposal",
        label: "Proposal Agent",
        spend: myr(1890),
        drillTo: "/v1/runs?filter[agentId][eq]=agent_proposal&filter[period][eq]=2026-11",
      },
      {
        key: "agent_lead",
        label: "Lead Agent",
        spend: myr(1240),
        drillTo: "/v1/runs?filter[agentId][eq]=agent_lead&filter[period][eq]=2026-11",
      },
      {
        key: "agent_compliance",
        label: "Compliance Agent",
        spend: myr(1180),
        drillTo: "/v1/runs?filter[agentId][eq]=agent_compliance&filter[period][eq]=2026-11",
      },
      {
        key: "agent_collections",
        label: "Collections Agent",
        spend: myr(980),
        drillTo: "/v1/runs?filter[agentId][eq]=agent_collections&filter[period][eq]=2026-11",
      },
    ],
    budgets,
  },
  "2026-11::ACTION_TYPE": {
    period: "2026-11",
    totals: {
      llm: myr(53700),
      whatsapp: myr(3400),
      compute: myr(9600),
      cacheHitRate: 0.61,
      offPeakShare: 0.44,
      estimatedCacheSaving: myr(24000),
    },
    forecast: myr(81200),
    cap: myr(94000),
    breakdown: [
      {
        key: "RULE_CHANGE_APPROVE",
        label: "Rule extraction and review",
        spend: myr(5880),
        drillTo: "/v1/runs?filter[actionType][eq]=RULE_CHANGE_APPROVE&filter[period][eq]=2026-11",
      },
      {
        key: "PROPOSAL_DRAFT",
        label: "Proposal drafting",
        spend: myr(4200),
        drillTo: "/v1/runs?filter[actionType][eq]=PROPOSAL_DRAFT&filter[period][eq]=2026-11",
      },
      {
        key: "TNA_RECOMMENDATION_ACCEPT",
        label: "TNA analysis",
        spend: myr(2180),
        drillTo: "/v1/runs?filter[actionType][eq]=TNA_RECOMMENDATION_ACCEPT&filter[period][eq]=2026-11",
      },
      {
        key: "REMINDER_SEND",
        label: "Collections reminders",
        spend: myr(980),
        drillTo: "/v1/runs?filter[actionType][eq]=REMINDER_SEND&filter[period][eq]=2026-11",
      },
    ],
    budgets,
  },
};

/** §17 `GET /v1/ai/usage/forecast?period=` — linear on the trailing seven days. */
export const usageForecast = { period: "2026-11", forecast: myr(81200), cap: myr(94000) };
