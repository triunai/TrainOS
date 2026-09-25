import { describe, expect, it } from "vitest";
import { MODEL_PRICES, UNPRICED_MODEL, estimateCostUsd, priceFor, usdToMyr } from "@/server/ai/pricing";
import { extractJson } from "@/server/ai/router";
import { budgetState } from "@/server/ai/spend";

describe("price table", () => {
  it("matches exact ids and vendor-prefixed ids by longest suffix", () => {
    expect(priceFor("claude-sonnet-5")).toEqual({ in: 2, out: 10, cacheRead: 0.2 });
    expect(priceFor("anthropic/claude-sonnet-5")).toBe(MODEL_PRICES["claude-sonnet-5"]);
    expect(priceFor("deepseek/deepseek-chat")).toBe(MODEL_PRICES["deepseek-chat"]);
    expect(priceFor("google/gemini-2.5-flash-lite")).toBe(MODEL_PRICES["gemini-2.5-flash-lite"]);
    expect(priceFor("openai/text-embedding-3-small")).toBe(MODEL_PRICES["text-embedding-3-small"]);
    expect(priceFor("anthropic/claude-fable-5-1")).toBe(MODEL_PRICES["claude-fable-5-1"]);
  });

  it("does not match a suffix that is not on an id boundary, and unknown models are unpriced", () => {
    expect(priceFor("xclaude-sonnet-5")).toBeUndefined();
    expect(priceFor("mystery-model")).toBeUndefined();
  });

  it("charges an unknown model at the conservative rate so a budget can still trip", () => {
    expect(estimateCostUsd("mystery-model", { in: 1_000_000, out: 0 })).toBe(UNPRICED_MODEL.in);
  });

  it("holds the list prices the budget gate relies on", () => {
    expect(MODEL_PRICES["claude-opus-5"]).toMatchObject({ in: 5, out: 25, cacheRead: 0.5 });
    expect(MODEL_PRICES["claude-haiku-4-5"]).toMatchObject({ in: 1, out: 5, cacheRead: 0.1 });
    expect(MODEL_PRICES["claude-fable-5-1"]).toMatchObject({ in: 10, out: 50 });
    expect(MODEL_PRICES["deepseek-reasoner"]).toEqual(MODEL_PRICES["deepseek-chat"]);
    expect(MODEL_PRICES["deepseek-chat"]).toEqual({ in: 0.28, out: 0.42, cacheRead: 0.028 });
    expect(MODEL_PRICES["gemini-2.5-flash-lite"]).toEqual({ in: 0.1, out: 0.4 });
    expect(MODEL_PRICES["text-embedding-3-small"]).toEqual({ in: 0.02, out: 0 });
  });

  it("bills cached reads at the cache rate, excluded from fresh input", () => {
    expect(estimateCostUsd("claude-haiku-4-5", { in: 1_000_000, out: 1_000_000, cacheRead: 500_000 })).toBeCloseTo(0.5 + 0.05 + 5, 10);
    // Gemini has no cache discount in the table: cached tokens bill at the input rate.
    expect(estimateCostUsd("gemini-2.5-flash-lite", { in: 1_000_000, out: 0, cacheRead: 400_000 })).toBeCloseTo(0.1, 10);
  });

  it("converts USD to MYR at the given rate, to cost_myr's eight places (0010)", () => {
    expect(usdToMyr(1, 4.45)).toBe(4.45);
    expect(usdToMyr(0.0004396, 4.45)).toBe(0.00195622);
    // A 20-token embedding call: rounded to 4 dp this recorded as free.
    expect(usdToMyr(0.0000004, 4.45)).toBe(0.00000178);
    expect(usdToMyr(0, 4.45)).toBe(0);
  });
});

describe("budget state", () => {
  it("is WITHIN below 80%, NEAR from 80%, PAUSED at or over the cap, and PAUSED for a zero cap", () => {
    expect(budgetState("47.99", "60.00")).toBe("WITHIN");
    expect(budgetState("48.00", "60.00")).toBe("NEAR");
    expect(budgetState("59.99", "60.00")).toBe("NEAR");
    expect(budgetState("60.00", "60.00")).toBe("PAUSED");
    expect(budgetState("75", "60")).toBe("PAUSED");
    expect(budgetState("0", "0")).toBe("PAUSED");
  });
});

describe("JSON extraction", () => {
  it("strips ```json fences and surrounding prose", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nAnything else?')).toBe('{"a":1}');
    expect(extractJson('Sure! {"a": {"b": 2}} Hope that helps.')).toBe('{"a": {"b": 2}}');
    expect(extractJson('  [1,2]  ')).toBe("[1,2]");
    expect(extractJson('```json\n{"a":1')).toBe('{"a":1');
  });

  it("returns null when there is no object at all", () => {
    expect(extractJson("")).toBeNull();
    expect(extractJson("I cannot help with that.")).toBeNull();
  });
});
