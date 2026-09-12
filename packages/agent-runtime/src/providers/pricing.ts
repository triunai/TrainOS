/**
 * Cost estimation.
 *
 * ⚠️ EVERY NUMBER IN THIS FILE IS AN APPROXIMATION, held here so that
 * `TraceNode.cost` and the M20-S16 usage screens have something real to
 * render before billing is wired up. Anthropic rates are the published list
 * prices; the DeepSeek and OpenRouter rows are order-of-magnitude and will
 * drift. OpenRouter returns an authoritative `usage.cost`, and when it does
 * the adapter uses it and marks the result `costEstimated: false`.
 *
 * Override the whole table, or one model, with {@link withPrices}.
 */

import type { Money } from '@trainos/contract';

/** USD per million tokens. */
export interface ModelPrice {
  in: number;
  out: number;
  /** Cached-read input rate. Anthropic reads at 10% of input. */
  cacheRead?: number;
  /** Cache-write rate. Anthropic writes at 125% of input for the 5m TTL. */
  cacheWrite?: number;
}

/**
 * Price per million tokens, keyed by model id.
 *
 * Lookup is exact first, then longest-prefix, so `anthropic/claude-sonnet-5`
 * routed through OpenRouter finds the `claude-sonnet-5` row.
 */
export const DEFAULT_PRICES: Readonly<Record<string, ModelPrice>> = {
  /* Anthropic — published list prices, USD / MTok. */
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },

  /* DeepSeek — approximate, cache-hit input billed far below cache-miss. */
  'deepseek-chat': { in: 0.28, out: 0.42, cacheRead: 0.028 },
  'deepseek-reasoner': { in: 0.28, out: 0.42, cacheRead: 0.028 },
  'deepseek-v4-pro': { in: 0.55, out: 2.19, cacheRead: 0.055 },

  /* Mock — free, so a no-key demo run reports a zero cost honestly. */
  'mock-model': { in: 0, out: 0 },
} as const;

/** A price table plus the currency conversion the contract's `Money` needs. */
export interface PriceBook {
  prices: Readonly<Record<string, ModelPrice>>;
  /**
   * MYR per USD. Approximate and overridable — `Money` is MYR sen and every
   * provider bills USD, so a conversion has to happen somewhere and being
   * explicit about it beats burying it.
   */
  usdToMyr: number;
}

export const DEFAULT_PRICE_BOOK: PriceBook = {
  prices: DEFAULT_PRICES,
  usdToMyr: 4.45,
};

/** A price book with some rows replaced. */
export function withPrices(
  book: PriceBook,
  overrides: Record<string, ModelPrice>,
  usdToMyr?: number,
): PriceBook {
  return {
    prices: { ...book.prices, ...overrides },
    usdToMyr: usdToMyr ?? book.usdToMyr,
  };
}

/** Exact match, then longest matching suffix of the model id. */
export function priceFor(model: string, book: PriceBook = DEFAULT_PRICE_BOOK): ModelPrice | undefined {
  const exact = book.prices[model];
  if (exact) return exact;
  let best: ModelPrice | undefined;
  let bestLength = 0;
  for (const [key, price] of Object.entries(book.prices)) {
    if (model.endsWith(key) && key.length > bestLength) {
      best = price;
      bestLength = key.length;
    }
  }
  return best;
}

/**
 * USD for one call.
 *
 * Cached reads are billed at the cache rate and are *excluded* from the
 * ordinary input count, because every provider reports them that way:
 * `cacheRead` is a subset of the input tokens, not an addition to them.
 */
export function estimateCostUsd(
  model: string,
  usage: { in: number; out: number; cacheRead?: number; cacheWrite?: number },
  book: PriceBook = DEFAULT_PRICE_BOOK,
): number {
  const price = priceFor(model, book);
  if (!price) return 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const freshIn = Math.max(0, usage.in - cacheRead - cacheWrite);
  const perMillion =
    freshIn * price.in +
    cacheRead * (price.cacheRead ?? price.in) +
    cacheWrite * (price.cacheWrite ?? price.in) +
    usage.out * price.out;
  return perMillion / 1_000_000;
}

/** USD → `Money` in MYR sen, rounded half-up per DECISIONS §7. */
export function usdToMoney(usd: number, book: PriceBook = DEFAULT_PRICE_BOOK): Money {
  const sen = Math.round(usd * book.usdToMyr * 100);
  return { amount: sen, currency: 'MYR' };
}

/** Sum a list of `Money`. Every value in this runtime is MYR. */
export function sumMoney(values: readonly Money[]): Money {
  return { amount: values.reduce((acc, m) => acc + m.amount, 0), currency: 'MYR' };
}

/** `1850000` → `RM 18,500.00`. */
export function formatMoney(money: Money): string {
  const major = money.amount / 100;
  return `RM ${major.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
