import { env } from "../env";
import type { ChatUsage } from "./providers/types";

/**
 * Cost estimation, USD per million tokens.
 *
 * These are list prices held locally so the budget gate and the Usage page
 * have a number before any invoice arrives. OpenRouter reports an
 * authoritative `usage.cost`; when it does, the adapter uses that and marks
 * the row `cost_estimated = false`.
 *
 * Lookup is exact, then the longest key that is a SUFFIX of the id, so a
 * vendor-prefixed id routed through a gateway (`anthropic/claude-sonnet-5`)
 * finds its row.
 */
export interface ModelPrice {
  in: number;
  out: number;
  /** Cached-read input rate. Falls back to `in` when a vendor does not discount. */
  cacheRead?: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // Anthropic list prices. Cache reads are 10% of input, except Fable 5.1,
  // whose published cache-read rate is $0.25/MTok.
  "claude-fable-5-1": { in: 10, out: 50, cacheRead: 0.25 },
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1 },
  // DeepSeek bills a cache hit at a tenth of a miss.
  "deepseek-chat": { in: 0.28, out: 0.42, cacheRead: 0.028 },
  "deepseek-reasoner": { in: 0.28, out: 0.42, cacheRead: 0.028 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
};

/**
 * What an id missing from the table is charged at: Opus-class rates.
 *
 * A zero here would mean an operator who points a tier at a model this table
 * has never heard of gets a budget that can never trip. Over-counting an
 * unknown model is the safe direction for a spending cap; the row still says
 * `cost_estimated`, and OpenRouter's own figure overrides it.
 */
export const UNPRICED_MODEL: ModelPrice = { in: 5, out: 25 };

export function priceFor(model: string): ModelPrice | undefined {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  let best: ModelPrice | undefined;
  let bestLength = 0;
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (model.endsWith(key) && key.length > bestLength && isBoundary(model, key)) {
      best = price;
      bestLength = key.length;
    }
  }
  return best;
}

/** `anthropic/claude-sonnet-5` matches `claude-sonnet-5`; `xclaude-sonnet-5` does not. */
function isBoundary(model: string, key: string): boolean {
  if (model.length === key.length) return true;
  const before = model[model.length - key.length - 1];
  return before === "/" || before === ":" || before === ".";
}

/** USD for one call. Cached reads are billed at the cache rate and excluded from fresh input. */
export function estimateCostUsd(model: string, usage: ChatUsage): number {
  const price = priceFor(model) ?? UNPRICED_MODEL;
  const cacheRead = Math.min(usage.cacheRead ?? 0, usage.in);
  const freshIn = Math.max(0, usage.in - cacheRead);
  const perMillion = freshIn * price.in + cacheRead * (price.cacheRead ?? price.in) + usage.out * price.out;
  return perMillion / 1_000_000;
}

/** MYR per USD, from `USD_TO_MYR` (default 4.45). */
export function usdToMyrRate(): number {
  return env().USD_TO_MYR;
}

/**
 * USD to MYR at `llm_usage.cost_myr` precision (8 dp, migration 0010). Kept
 * as a number, not sen: a single classifier call costs a hundredth of a sen,
 * and an embedding call far less, so rounding each row to sen (or even to
 * 4 dp) would record whole tiers as free.
 */
export function usdToMyr(usd: number, rate: number = usdToMyrRate()): number {
  return Math.round(usd * rate * 1e8) / 1e8;
}
