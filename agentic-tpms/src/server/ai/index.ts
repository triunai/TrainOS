/**
 * Public surface of the AI layer. Callers depend on THIS file only.
 *
 * Contract (stable — feature code is written against it):
 *   runTier(input) -> { output, provenance }
 *     - never throws for provider trouble: a missing key, a spent budget, a
 *       provider error or a schema failure all fall back to `input.template()`
 *       with `provenance.mode = "TEMPLATE"` and a `fallbackReason`
 *     - records one tpms.llm_usage row per model call (and one for a fallback)
 *   embed(texts) -> { vectors, model }, embedQuery(text, storedModel)
 *   startAgentRun / finishAgentRun
 *
 * The router (./router.ts) resolves BYOK keys (Settings first, then env),
 * enforces the per-tier and per-key monthly caps, walks each tier's fallback
 * chain, and validates JSON output with one repair round.
 */
export type { LlmTier, AgentTier, Provenance, RunTierInput, RunTierResult } from "./types";
export { runTier, extractJson, TIER_TIMEOUT_MS, type FallbackReason } from "./router";
export {
  embed,
  embedQuery,
  currentEmbeddingModel,
  localEmbed,
  sameModelFamily,
  cosineSimilarity,
  EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_MODEL,
  type EmbedOptions,
} from "./embeddings";
export { startAgentRun, finishAgentRun } from "./runs";

// Settings › AI providers
export {
  addProviderKey,
  listProviderKeys,
  testProviderKey,
  disableProviderKey,
  type AddProviderKeyInput,
  type KeyStatus,
  type KeyTestResult,
  type ProviderKeyView,
} from "./keys";
export {
  DEFAULT_TIERS,
  TIER_KEYS,
  seedTierConfig,
  getTierConfig,
  listTierConfig,
  updateTierConfig,
  type TierKey,
  type TierPatch,
  type TierRoute,
  type TierSettings,
} from "./tiers";
export { PROVIDER_IDS, type ProviderId } from "./providers";

// Settings › Usage
export {
  getUsageSummary,
  getBudgetStates,
  type CostSlice,
  type DailyPoint,
  type ModelSlice,
  type PackageSlice,
  type TierBudget,
  type UsageSummary,
} from "./usage";
export { type BudgetState } from "./spend";
export { estimateCostUsd, priceFor, usdToMyr } from "./pricing";

/** Test seam: route every provider call through a stub. Never call outside tests. */
export { setFetchForTests, resetFetch } from "./router";
