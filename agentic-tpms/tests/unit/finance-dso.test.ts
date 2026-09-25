import { describe, expect, it } from "vitest";
import { computeDso, dsoDays } from "@/server/finance/kpis";
import { normaliseAdjustments } from "@/server/finance/vouchers";
import { splitInclusive } from "@/server/claims/invoice";

const row = (code: string, delivered: string, remitted: string) => ({
  packageId: code,
  packageCode: code,
  title: code,
  deliveredAt: new Date(delivered),
  remittedAt: new Date(remitted),
});

describe("claim DSO", () => {
  it("counts MYT calendar days, not UTC days", () => {
    // 23:30 MYT on 1 Aug is 15:30 UTC; 00:30 MYT on 31 Aug is 30 Aug in UTC.
    expect(dsoDays(new Date("2026-08-01T23:30:00+08:00"), new Date("2026-08-31T00:30:00+08:00"))).toBe(30);
  });

  it("averages packages remitted in the last 90 days and lists every package newest first", () => {
    const summary = computeDso(
      [
        row("PKG-A", "2026-06-01T10:00:00+08:00", "2026-07-16T09:00:00+08:00"), // 45 days
        row("PKG-B", "2026-03-01T10:00:00+08:00", "2026-04-30T16:00:00+08:00"), // 60 days, outside the window
        row("PKG-C", "2026-08-01T23:30:00+08:00", "2026-08-31T00:30:00+08:00"), // 30 days
      ],
      new Date("2026-09-25T12:00:00+08:00"),
    );
    expect(summary.perPackage.map((p) => [p.packageCode, p.days])).toEqual([
      ["PKG-C", 30],
      ["PKG-A", 45],
      ["PKG-B", 60],
    ]);
    expect(summary).toMatchObject({ averageDays: 37.5, sampleSize: 2, windowDays: 90 });
  });

  it("has no average when nothing was remitted in the window", () => {
    expect(computeDso([], new Date("2026-09-25T00:00:00Z")).averageDays).toBeNull();
  });
});

describe("money rules", () => {
  it("splits SST out of a claimable total without changing the total", () => {
    expect(splitInclusive(1_600_000, 0)).toEqual({ subtotal: 1_600_000, tax: 0 });
    const { subtotal, tax } = splitInclusive(1_600_000, 800);
    expect(subtotal + tax).toBe(1_600_000);
    expect(subtotal).toBe(1_481_481);
  });

  it("normalises voucher adjustments and rejects the wrong sign", () => {
    const { adjustments, totalSen } = normaliseAdjustments([
      { kind: "MILEAGE", label: "Mileage", amount: "120.50" },
      { kind: "WITHHOLDING_TAX", label: "WHT 10%", amount: -600 },
      { kind: "OTHER", label: "Parking", amount: 12.4 },
    ]);
    expect(totalSen).toBe(12_050 - 60_000 + 1_240);
    expect(adjustments.map((a) => a.amount)).toEqual([120.5, -600, 12.4]);
    expect(() => normaliseAdjustments([{ kind: "DEDUCTION", label: "Late", amount: 50 }])).toThrow(/negative/);
    expect(() => normaliseAdjustments([{ kind: "MILEAGE", label: "Mileage", amount: 1.005 }])).toThrow(/two decimals/);
  });
});
