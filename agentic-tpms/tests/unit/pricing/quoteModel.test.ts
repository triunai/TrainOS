import { describe, expect, it } from "vitest";
import { DEFAULT_COST_POLICIES, allowableCapSen, dailyCapFor, validateBands } from "@/server/pricing/costMatrix";
import { computeQuote, divRoundHalfAway, marginPercent, type QuoteInputs } from "@/server/pricing/quoteModel";

const policy = (mode: "IN_HOUSE" | "PUBLIC_PHYSICAL" | "ROT_VIRTUAL") => {
  const p = DEFAULT_COST_POLICIES.find((x) => x.deliveryMode === mode);
  if (!p) throw new Error(mode);
  return p;
};

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code ?? "NO_CODE";
  }
  return "DID_NOT_THROW";
};

const base = (over: Partial<QuoteInputs> = {}): QuoteInputs => ({
  deliveryMode: "IN_HOUSE",
  pax: 20,
  days: 2,
  trainerDayRate: 300_000,
  venueDdrPerPax: 9_500,
  materialsPerPax: 5_000,
  otherDirectCosts: 30_000,
  quotedFeeOverride: null,
  policy: { version: "ACM-2026.1", basis: "PER_GROUP_DAY", dailyCap: 800_000 },
  ...over,
});

describe("Allowable Cost Matrix bands (ACM-2026.1)", () => {
  it.each([
    [1, 600_000],
    [10, 600_000],
    [11, 800_000],
    [20, 800_000],
    [21, 1_050_000],
    [25, 1_050_000],
    [26, 1_200_000],
    [35, 1_200_000],
    [36, 1_400_000],
    [60, 1_400_000],
  ])("IN_HOUSE %i pax -> %i sen/day", (pax, cap) => {
    expect(dailyCapFor(policy("IN_HOUSE"), pax)).toBe(cap);
  });

  it.each([
    [1, 400_000],
    [10, 400_000],
    [11, 600_000],
    [25, 600_000],
    [26, 800_000],
    [60, 800_000],
  ])("ROT_VIRTUAL %i pax -> %i sen/day", (pax, cap) => {
    expect(dailyCapFor(policy("ROT_VIRTUAL"), pax)).toBe(cap);
  });

  it("PUBLIC_PHYSICAL is RM 1,300 per pax per day up to 999 pax", () => {
    expect(dailyCapFor(policy("PUBLIC_PHYSICAL"), 1)).toBe(130_000);
    expect(dailyCapFor(policy("PUBLIC_PHYSICAL"), 999)).toBe(130_000);
    expect(code(() => dailyCapFor(policy("PUBLIC_PHYSICAL"), 1000))).toBe("PAX_OUTSIDE_MATRIX");
  });

  it("refuses a headcount no band covers instead of guessing the nearest band", () => {
    expect(code(() => dailyCapFor(policy("IN_HOUSE"), 0))).toBe("PAX_OUTSIDE_MATRIX");
    expect(code(() => dailyCapFor(policy("IN_HOUSE"), 61))).toBe("PAX_OUTSIDE_MATRIX");
    expect(code(() => dailyCapFor(policy("ROT_VIRTUAL"), 61))).toBe("PAX_OUTSIDE_MATRIX");
    expect(code(() => dailyCapFor(policy("IN_HOUSE"), 12.5))).toBe("PAX_OUTSIDE_MATRIX");
  });

  it("carries the verification caveat in the source note", () => {
    for (const p of DEFAULT_COST_POLICIES) {
      expect(p.sourceNote).toMatch(/handoff spec v4\.2/);
      expect(p.sourceNote).toMatch(/MUST be verified against the current HRD Corp Allowable Cost Matrix circular/);
      expect(p.sourceNote).toMatch(/ROT .*ILLUSTRATIVE/);
    }
  });

  it("computes the cap per group-day or per pax-day", () => {
    expect(allowableCapSen("PER_GROUP_DAY", 800_000, 20, 2)).toBe(1_600_000);
    expect(allowableCapSen("PER_PAX_DAY", 130_000, 12, 2)).toBe(3_120_000);
  });

  it("validates bands: contiguous from 1, no gaps, no overlaps, positive caps", () => {
    expect(validateBands([{ minPax: 11, maxPax: 20, dailyCap: 8000 }, { minPax: 1, maxPax: 10, dailyCap: 6000 }])).toHaveLength(2);
    expect(code(() => validateBands([{ minPax: 2, maxPax: 10, dailyCap: 6000 }]))).toBe("INVALID_COST_BANDS");
    expect(code(() => validateBands([{ minPax: 1, maxPax: 10, dailyCap: 6000 }, { minPax: 12, maxPax: 20, dailyCap: 8000 }]))).toBe("INVALID_COST_BANDS");
    expect(code(() => validateBands([{ minPax: 1, maxPax: 10, dailyCap: 6000 }, { minPax: 10, maxPax: 20, dailyCap: 8000 }]))).toBe("INVALID_COST_BANDS");
    expect(code(() => validateBands([{ minPax: 1, maxPax: 10, dailyCap: 0 }]))).toBe("INVALID_COST_BANDS");
    expect(code(() => validateBands([{ minPax: 1, maxPax: 10, dailyCap: 60.005 }]))).toBe("INVALID_COST_BANDS");
    expect(code(() => validateBands([]))).toBe("INVALID_COST_BANDS");
  });
});

describe("computeQuote", () => {
  it("prices a 20-pax, 2-day in-house programme at the cap with integer sen lines", () => {
    const q = computeQuote(base());
    expect(q.allowableCap).toBe(1_600_000);
    expect(q.quotedFee).toBe(1_600_000);
    const byCode = Object.fromEntries(q.lineItems.map((l) => [l.code, l]));
    expect(byCode.TRAINER).toMatchObject({ qty: 2, unitCost: 300_000, amount: 600_000, kind: "COST" });
    expect(byCode.VENUE).toMatchObject({ qty: 40, unitCost: 9_500, amount: 380_000 });
    expect(byCode.MATERIALS).toMatchObject({ qty: 20, unitCost: 5_000, amount: 100_000 });
    expect(byCode.OTHER).toMatchObject({ qty: 1, amount: 30_000 });
    expect(byCode.COURSE_FEE).toMatchObject({ qty: 2, unit: "group-day", unitCost: 800_000, amount: 1_600_000, kind: "FEE" });
    expect(q.totalDirectCost).toBe(1_110_000);
    expect(q.grossMargin).toBe(490_000);
    expect(q.marginPct).toBe(30.63);
    expect(q.capHeadroom).toBe(0);
    expect(q.warnings).toEqual([]);
    for (const l of q.lineItems) {
      expect(Number.isInteger(l.amount)).toBe(true);
      expect(l.qty * l.unitCost).toBe(l.amount);
    }
    expect(q.lineItems.filter((l) => l.kind === "COST").reduce((a, l) => a + l.amount, 0)).toBe(q.totalDirectCost);
  });

  it("prices per pax per day for public programmes", () => {
    const q = computeQuote(base({ deliveryMode: "PUBLIC_PHYSICAL", pax: 12, policy: { version: "ACM-2026.1", basis: "PER_PAX_DAY", dailyCap: 130_000 } }));
    expect(q.allowableCap).toBe(3_120_000);
    expect(q.lineItems.find((l) => l.code === "COURSE_FEE")).toMatchObject({ qty: 24, unit: "pax-day", unitCost: 130_000 });
  });

  it("never quotes above the cap: an override above it is clamped and flagged", () => {
    const q = computeQuote(base({ quotedFeeOverride: 2_000_000 }));
    expect(q.quotedFee).toBe(1_600_000);
    expect(q.warnings).toContain("OVERRIDE_CLAMPED_TO_CAP");
    expect(q.capHeadroom).toBe(0);
  });

  it("honours an override below the cap and reports headroom", () => {
    const q = computeQuote(base({ quotedFeeOverride: 1_500_001 }));
    expect(q.quotedFee).toBe(1_500_001);
    expect(q.capHeadroom).toBe(99_999);
    expect(q.warnings).not.toContain("OVERRIDE_CLAMPED_TO_CAP");
    // 1,500,001 is not divisible by 2 days: shown as one programme so qty × unit = amount still holds.
    expect(q.lineItems.find((l) => l.code === "COURSE_FEE")).toMatchObject({ qty: 1, unit: "programme", unitCost: 1_500_001 });
  });

  it("forces the venue cost to zero for remote online training", () => {
    const q = computeQuote(base({ deliveryMode: "ROT_VIRTUAL", policy: { version: "ACM-2026.1", basis: "PER_GROUP_DAY", dailyCap: 600_000 } }));
    expect(q.lineItems.find((l) => l.code === "VENUE")).toMatchObject({ unitCost: 0, amount: 0 });
    expect(q.warnings).toContain("ROT_VENUE_ZEROED");
    const clean = computeQuote(base({ deliveryMode: "ROT_VIRTUAL", venueDdrPerPax: 0 }));
    expect(clean.warnings).not.toContain("ROT_VENUE_ZEROED");
  });

  it("warns on thin and negative margins at the exact boundary", () => {
    // fee 1,600,000; cost = trainer rate × 2 + 0 → margin exactly 20.00% at cost 1,280,000
    const at20 = computeQuote(base({ trainerDayRate: 640_000, venueDdrPerPax: 0, materialsPerPax: 0, otherDirectCosts: 0 }));
    expect(at20.marginPct).toBe(20);
    expect(at20.warnings).not.toContain("MARGIN_BELOW_20");
    const below = computeQuote(base({ trainerDayRate: 640_001, venueDdrPerPax: 0, materialsPerPax: 0, otherDirectCosts: 0 }));
    expect(below.marginPct).toBe(20);
    expect(below.grossMargin).toBe(319_998);
    const clearlyBelow = computeQuote(base({ trainerDayRate: 640_200, venueDdrPerPax: 0, materialsPerPax: 0, otherDirectCosts: 0 }));
    expect(clearlyBelow.marginPct).toBe(19.98);
    expect(clearlyBelow.warnings).toEqual(["MARGIN_BELOW_20"]);
    const negative = computeQuote(base({ trainerDayRate: 900_000 }));
    expect(negative.grossMargin).toBeLessThan(0);
    expect(negative.warnings).toEqual(expect.arrayContaining(["NEGATIVE_MARGIN", "MARGIN_BELOW_20"]));
  });

  it("rounds the margin percentage half away from zero, on integers", () => {
    expect(marginPercent(12_345, 100_000)).toBe(12.35);
    expect(marginPercent(-12_345, 100_000)).toBe(-12.35);
    expect(marginPercent(1, 3)).toBe(33.33);
    expect(marginPercent(0, 0)).toBe(0);
    expect(divRoundHalfAway(5, 2)).toBe(3);
    expect(divRoundHalfAway(-5, 2)).toBe(-3);
  });

  it("refuses malformed inputs instead of coercing them (R14)", () => {
    expect(code(() => computeQuote(base({ pax: 2.5 })))).toBe("INVALID_QUOTE_INPUT");
    expect(code(() => computeQuote(base({ days: 0 })))).toBe("INVALID_QUOTE_INPUT");
    expect(code(() => computeQuote(base({ trainerDayRate: 3000.5 })))).toBe("INVALID_QUOTE_INPUT");
    expect(code(() => computeQuote(base({ materialsPerPax: -1 })))).toBe("INVALID_QUOTE_INPUT");
    expect(code(() => computeQuote(base({ quotedFeeOverride: -100 })))).toBe("INVALID_QUOTE_INPUT");
    expect(code(() => computeQuote(base({ deliveryMode: "HYBRID" as never })))).toBe("INVALID_QUOTE_INPUT");
    expect(code(() => computeQuote(base({ policy: { version: "x", basis: "PER_HOUR" as never, dailyCap: 1 } })))).toBe("INVALID_QUOTE_INPUT");
  });
});
