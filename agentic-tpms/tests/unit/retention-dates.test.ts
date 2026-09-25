import { describe, expect, it } from "vitest";
import { cadenceDates, levyAlertDate } from "@/server/retention/schedule";

describe("retention cadence dates", () => {
  it("defaults the levy alert to end + 300 days", () => {
    expect(levyAlertDate("2026-01-10", null)).toEqual({ date: "2026-11-06", basis: "END_PLUS_300", fiscalYearEnd: null });
  });

  it("moves the levy alert to 60 days before the fiscal year end when that is sooner", () => {
    expect(levyAlertDate("2026-01-10", 6)).toEqual({ date: "2026-05-01", basis: "FISCAL_YEAR_END_MINUS_60", fiscalYearEnd: "2026-06-30" });
    expect(levyAlertDate("2026-10-01", 12)).toEqual({ date: "2026-11-01", basis: "FISCAL_YEAR_END_MINUS_60", fiscalYearEnd: "2026-12-31" });
  });

  it("skips a fiscal year end whose alert would land before the T+14 pack, and keeps end + 300 when that is sooner", () => {
    // FYE 30 Jun 2026 - 60 = 1 May 2026, before end + 14; next FYE alert (1 May 2027) is later than 16 Apr 2027.
    expect(levyAlertDate("2026-06-20", 6)).toEqual({ date: "2027-04-16", basis: "END_PLUS_300", fiscalYearEnd: "2027-06-30" });
  });

  it("uses the true last day of February", () => {
    expect(levyAlertDate("2027-06-01", 2).fiscalYearEnd).toBe("2028-02-29");
  });

  it("rejects an impossible fiscal month", () => {
    expect(() => levyAlertDate("2026-01-10", 13)).toThrow(/1-12/);
  });

  it("puts T14 and T90 at end + 14 and end + 90", () => {
    const dates = cadenceDates("2026-10-02", null);
    expect(dates.EXECUTIVE_PACK_T14.date).toBe("2026-10-16");
    expect(dates.SYLLABUS_LADDER_T90.date).toBe("2026-12-31");
  });
});
