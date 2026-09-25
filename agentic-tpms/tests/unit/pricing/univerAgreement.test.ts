import { describe, expect, it } from "vitest";
import { DEFAULT_COST_POLICIES, dailyCapFor } from "@/server/pricing/costMatrix";
import { computeQuote, type QuoteInputs } from "@/server/pricing/quoteModel";
import { QUOTE_CELLS, computeWithUniver } from "@/server/pricing/univerEngine";
import { assertEnginesAgree, priceQuotation } from "@/server/pricing/priceQuotation";

/** mulberry32: a tiny seeded PRNG so the 30 cases are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInputs(next: () => number): QuoteInputs {
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const modes = ["IN_HOUSE", "PUBLIC_PHYSICAL", "ROT_VIRTUAL"] as const;
  const deliveryMode = modes[int(0, 2)];
  const policy = DEFAULT_COST_POLICIES.find((p) => p.deliveryMode === deliveryMode)!;
  const pax = deliveryMode === "PUBLIC_PHYSICAL" ? int(1, 40) : int(1, 60);
  const days = int(1, 5);
  const dailyCap = dailyCapFor(policy, pax);
  const cap = policy.basis === "PER_PAX_DAY" ? dailyCap * pax * days : dailyCap * days;
  const overrideRoll = next();
  return {
    deliveryMode,
    pax,
    days,
    // Odd sen values on purpose: the engines must agree on amounts that are not round ringgit.
    trainerDayRate: int(80_000, 600_000),
    venueDdrPerPax: next() < 0.2 ? 0 : int(4_000, 25_000),
    materialsPerPax: int(0, 12_000),
    otherDirectCosts: int(0, 150_000),
    quotedFeeOverride: overrideRoll < 0.4 ? null : overrideRoll < 0.7 ? int(Math.floor(cap / 2), cap) : int(cap, cap * 2),
    policy: { version: policy.version, basis: policy.basis, dailyCap },
  };
}

describe("Univer sheet vs TypeScript model — double entry", () => {
  it("agree to the sen over 30 seeded-random quotations", async () => {
    const next = rng(20260925);
    let exactPct = 0;
    for (let i = 0; i < 30; i += 1) {
      const inputs = randomInputs(next);
      const model = computeQuote(inputs);
      const sheet = await computeWithUniver(inputs);
      const line = (code: string) => model.lineItems.find((l) => l.code === code)!.amount;
      const context = JSON.stringify(inputs);
      expect(sheet.values.allowableCap, context).toBe(model.allowableCap);
      expect(sheet.values.quotedFee, context).toBe(model.quotedFee);
      expect(sheet.values.trainerCost, context).toBe(line("TRAINER"));
      expect(sheet.values.venueCost, context).toBe(line("VENUE"));
      expect(sheet.values.materialsCost, context).toBe(line("MATERIALS"));
      expect(sheet.values.otherCost, context).toBe(line("OTHER"));
      expect(sheet.values.totalDirectCost, context).toBe(model.totalDirectCost);
      expect(sheet.values.grossMargin, context).toBe(model.grossMargin);
      expect(sheet.values.capHeadroom, context).toBe(model.capHeadroom);
      expect(Math.abs(sheet.values.marginPct - model.marginPct), context).toBeLessThanOrEqual(0.01);
      if (sheet.values.marginPct === model.marginPct) exactPct += 1;
      expect(sheet.values.quotedFee).toBeLessThanOrEqual(sheet.values.allowableCap);
      expect(() => assertEnginesAgree(model, sheet.values)).not.toThrow();
    }
    // ROUND in the sheet and the integer rounding in the model should coincide essentially always.
    expect(exactPct).toBeGreaterThanOrEqual(29);
  });

  it("returns a workbook snapshot the browser canvas can load, with labels, formulas and defined names", async () => {
    const inputs: QuoteInputs = {
      deliveryMode: "IN_HOUSE",
      pax: 20,
      days: 2,
      trainerDayRate: 300_000,
      venueDdrPerPax: 9_500,
      materialsPerPax: 5_000,
      otherDirectCosts: 30_000,
      quotedFeeOverride: null,
      policy: { version: "ACM-2026.1", basis: "PER_GROUP_DAY", dailyCap: 800_000 },
    };
    const { snapshot, values } = await computeWithUniver(inputs);
    expect(values.quotedFee).toBe(1_600_000);
    const sheet = (snapshot.sheets as Record<string, { name: string; cellData: Record<string, Record<string, { v?: unknown; f?: string }>> }>).quote;
    expect(sheet.name).toBe("Quote");
    const row = (name: string) => Number(QUOTE_CELLS[name].slice(1)) - 1;
    expect(sheet.cellData[row("DurationDays")][0].v).toBe("DurationDays");
    expect(sheet.cellData[row("DurationDays")][1].v).toBe(2);
    expect(sheet.cellData[row("QuotedFee")][1].f).toContain("MIN(QuotedFeeOverride,TotalMaxAllowable)");
    expect(sheet.cellData[row("TotalDirectCost")][1].f).toBe("=ROUND(SUM(B15:B18),2)");
    // Computed values are saved alongside formulas, so the canvas shows numbers before its own engine runs.
    expect(sheet.cellData[row("QuotedFee")][1].v).toBe(16000);
    const resources = snapshot.resources as Array<{ name: string; data: string }>;
    const names = JSON.parse(resources.find((r) => r.name === "SHEET_DEFINED_NAME_PLUGIN")!.data) as Record<string, { name: string }>;
    expect(Object.values(names).map((n) => n.name)).toEqual(expect.arrayContaining(["TrainerDailyRate", "QuotedFeeOverride", "GrossMarginPercentage"]));
  });

  it("runs well under a second per quotation once warm", async () => {
    const inputs = randomInputs(rng(7));
    await computeWithUniver(inputs);
    const started = performance.now();
    const run = await computeWithUniver(inputs);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(run.durationMs).toBeLessThan(1000);
  });

  it("serialises concurrent runs and keeps each result with its own inputs", async () => {
    const next = rng(99);
    const batch = Array.from({ length: 5 }, () => randomInputs(next));
    const results = await Promise.all(batch.map((i) => priceQuotation(i)));
    results.forEach((r, i) => expect(r.result.quotedFee).toBe(computeQuote(batch[i]).quotedFee));
  });

  it("treats any disagreement as a defect, not a refusal", () => {
    const model = computeQuote(randomInputs(rng(3)));
    const tampered = {
      allowableCap: model.allowableCap,
      quotedFee: model.quotedFee + 1,
      trainerCost: model.lineItems[0].amount,
      venueCost: model.lineItems[1].amount,
      materialsCost: model.lineItems[2].amount,
      otherCost: model.lineItems[3].amount,
      totalDirectCost: model.totalDirectCost,
      grossMargin: model.grossMargin,
      marginPct: model.marginPct,
      capHeadroom: model.capHeadroom,
    };
    let caught: unknown;
    try {
      assertEnginesAgree(model, tampered);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/^PRICING_ENGINE_DISAGREEMENT: quotedFee/);
    expect((caught as { code?: string }).code).toBeUndefined();
  });
});
