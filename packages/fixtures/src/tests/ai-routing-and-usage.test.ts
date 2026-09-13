/**
 * §17 · the two M20 seams the screens were inferring for themselves.
 *
 * Ruling R12: `RoutingResponse.unsavedChanges` counted something the response
 * never named, so `AiModelsScreen` re-derived which rows those were from tier
 * health. The inference matched the count by construction, which meant a
 * staged edit arriving from anywhere else would have been invisible while the
 * count still said two. `staged` on the row is the fix, and the count is now
 * the list's length — these assert the two cannot drift apart again.
 *
 * Ruling R13: the peak / off-peak series. The seeding is owed by the persona
 * lane, so the assertions here are the ones that hold whether or not the days
 * are filled in, plus the invariant whoever fills them has to satisfy.
 */

import { describe, expect, it } from "vitest";
import { USER_KHAIRUL } from "@trainos/contract";
import { createFixtureClient } from "../index";

const api = createFixtureClient({ latencyMs: 0 });

describe("§17 routing · staged edits are data, not inference", () => {
  it("counts exactly the rows that carry a staged change", async () => {
    const routing = await api.getAiRouting();
    const staged = routing.data.filter((entry) => entry.staged);
    expect(routing.unsavedChanges).toBe(staged.length);
  });

  it("stages a move away from every tier that cannot serve its rows", async () => {
    const routing = await api.getAiRouting();
    const tiers = await api.getAiTiers();
    const unhealthy = new Set(
      tiers.data
        .filter((tier) => tier.status === "DEGRADED" || tier.status === "PAUSED_BY_CAP")
        .map((tier) => tier.key),
    );

    for (const entry of routing.data.filter((row) => unhealthy.has(row.tier))) {
      expect(entry.staged, `${entry.actionType} sits on an unhealthy tier`).toBeDefined();
      expect(entry.staged?.tier).not.toBe(entry.tier);
    }
  });

  it("gives every staged change a sentence, because the admin is being asked to accept it", async () => {
    const routing = await api.getAiRouting();
    for (const entry of routing.data) {
      if (!entry.staged) continue;
      expect(entry.staged.reason.trim()).not.toBe("");
    }
  });

  it("clears both the rows and the count when the matrix is applied", async () => {
    const admin = createFixtureClient({ latencyMs: 0, actorId: USER_KHAIRUL });
    const before = await admin.getAiRouting();
    const applied = await admin.putAiRouting(
      before.data.map((entry) =>
        entry.staged ? { ...entry, tier: entry.staged.tier, staged: undefined } : entry,
      ),
    );
    expect(applied.unsavedChanges).toBe(0);
    expect(applied.data.filter((entry) => entry.staged)).toHaveLength(0);
  });
});

describe("§17 usage · the peak / off-peak series", () => {
  it("serves the demo period and refuses one it does not have", async () => {
    const series = await api.getUsageDaily("2026-11");
    expect(series.period).toBe("2026-11");
    await expect(api.getUsageDaily("2019-01")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /* The chart and the tile above it have to be describing the same month. */
  it("reconciles with the offPeakShare the same period already publishes", async () => {
    const series = await api.getUsageDaily("2026-11");
    expect(series.data.length).toBeGreaterThan(0);

    const usage = await api.getUsage("2026-11", "TIER");
    const peak = series.data.reduce((total, day) => total + day.peak.amount, 0);
    const offPeak = series.data.reduce((total, day) => total + day.offPeak.amount, 0);
    expect(offPeak / (peak + offPeak)).toBeCloseTo(usage.totals.offPeakShare, 2);
  });

  /* And the same money. `totals` is spend so far, not a projection — `forecast`
     is the projection — so the days have to add up to it exactly. */
  it("sums to the period's own spend, to the sen", async () => {
    const series = await api.getUsageDaily("2026-11");
    const usage = await api.getUsage("2026-11", "TIER");
    const spent = series.data.reduce((total, day) => total + day.peak.amount + day.offPeak.amount, 0);
    const totals = usage.totals;
    expect(spent).toBe(totals.llm.amount + totals.whatsapp.amount + totals.compute.amount);
  });

  it("runs one entry per day, in order, with no gap and no repeat", async () => {
    const series = await api.getUsageDaily("2026-11");
    const dates = series.data.map((day) => day.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);
    for (const date of dates) expect(date.startsWith(`${series.period}-`)).toBe(true);

    const first = Date.parse(`${dates[0]}T00:00:00Z`);
    dates.forEach((date, index) => {
      expect(Date.parse(`${date}T00:00:00Z`)).toBe(first + index * 86_400_000);
    });
  });

  /* The reason the chart exists rather than the tile. §17 restricts
     batch-eligible tiers to off-peak hours and makes them queue rather than
     escalate, so the batch window keeps running when nobody is at a desk. If
     peak ever led at the weekend, the routing policy would not be doing what
     the screen says it does. */
  it("shows the batch window still working at the weekend", async () => {
    const series = await api.getUsageDaily("2026-11");
    const weekend = series.data.filter((day) => {
      const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
      return weekday === 0 || weekday === 6;
    });

    expect(weekend.length).toBeGreaterThan(0);
    for (const day of weekend) {
      expect(day.offPeak.amount, `${day.date} off-peak should lead`).toBeGreaterThan(day.peak.amount);
    }
  });

  it("never carries a negative day, in either half", async () => {
    const series = await api.getUsageDaily("2026-11");
    for (const day of series.data) {
      expect(day.peak.amount).toBeGreaterThanOrEqual(0);
      expect(day.offPeak.amount).toBeGreaterThanOrEqual(0);
    }
  });
});
