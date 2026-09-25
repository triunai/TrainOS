import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getBudgetStates, getUsageSummary, updateTierConfig } from "@/server/ai";
import { db } from "@/server/db/client";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator, makePackage } from "../helpers/factory";
import { clearAiTables, restoreAiEnv, useAiEnv } from "../unit/ai/ai-env";

/** Noon on 20 September 2026 in Kuala Lumpur (UTC+8). */
const NOW = new Date("2026-09-20T04:00:00Z");

interface Seed {
  at: string;
  tier: string;
  agent: string;
  provider: string;
  model: string;
  status: "OK" | "ERROR" | "FALLBACK_TEMPLATE" | "BUDGET_BLOCKED";
  myr?: string;
  input?: number;
  cache?: number;
  packageId?: string | null;
  error?: string | null;
}

async function seed(row: Seed): Promise<void> {
  await db().execute(sql`insert into tpms.llm_usage
      (agent, tier, provider, model, package_id, input_tokens, cache_read_tokens, cost_myr, status, error, created_at)
    values (${row.agent}, ${row.tier}, ${row.provider}, ${row.model}, ${row.packageId ?? null}::uuid, ${row.input ?? 0},
            ${row.cache ?? 0}, ${row.myr ?? "0"}::numeric, ${row.status}, ${row.error ?? null}, ${row.at}::timestamptz)`);
}

let p1: { id: string; packageCode: string; title: string };
let p2: { id: string; packageCode: string; title: string };

beforeAll(async () => {
  await useTestDatabase();
  await makeOperator();
  p1 = await makePackage();
  p2 = await makePackage();
});
afterAll(async () => {
  restoreAiEnv();
  await releaseTestDatabase();
});

beforeEach(async () => {
  useAiEnv();
  await clearAiTables();
  const L3 = { tier: "L3", agent: "commercial.outline_writer", provider: "deepseek", model: "deepseek-chat" } as const;
  const L4 = { tier: "L4", agent: "retention.copywriter", provider: "anthropic", model: "claude-sonnet-5" } as const;
  const L1 = { tier: "L1", agent: "inbox.classifier", provider: "gemini", model: "gemini-2.5-flash-lite" } as const;
  const TEMPLATE = { provider: "template", model: "deterministic-template" } as const;

  // 23:59:59 on 31 August in KL: last month, however close.
  await seed({ ...L3, at: "2026-08-31T15:59:59Z", status: "OK", myr: "100.0000" });
  // 00:00 on 1 September in KL is still 31 August in UTC: this month.
  await seed({ ...L3, at: "2026-08-31T16:00:00Z", status: "OK", myr: "1.0000", input: 1_000, cache: 200, packageId: p1.id });
  await seed({ tier: "EMBED", agent: "knowledge.embedder", provider: "openai-compatible", model: "text-embedding-3-small", at: "2026-09-10T03:00:00Z", status: "OK", myr: "0.1000", input: 500 });
  await seed({ ...L4, at: "2026-09-14T02:00:00Z", status: "OK", myr: "2.0000", input: 1_000, packageId: p2.id });
  await seed({ ...L4, at: "2026-09-18T02:00:00Z", status: "ERROR", error: "HTTP 503: Overloaded" });
  await seed({ ...L1, at: "2026-09-19T02:00:00Z", status: "OK", myr: "0.5000", input: 2_000, cache: 1_000 });
  await seed({ ...L1, ...TEMPLATE, at: "2026-09-20T01:00:00Z", status: "FALLBACK_TEMPLATE", error: "NO_PROVIDER_CONFIGURED: x" });
  await seed({ ...L3, at: "2026-09-20T01:30:00Z", status: "OK", myr: "0.2500", packageId: p1.id, error: "OUTPUT_INVALID: not JSON" });
  await seed({ ...L4, ...TEMPLATE, at: "2026-09-20T02:00:00Z", status: "BUDGET_BLOCKED", error: "BUDGET_EXHAUSTED: x" });
  // 00:30 on 1 October in KL: next month.
  await seed({ ...L1, at: "2026-09-30T16:30:00Z", status: "OK", myr: "9.0000" });
});

describe("usage summary", () => {
  it("totals this KL calendar month and nothing either side of it", async () => {
    const s = await getUsageSummary({ now: NOW });
    expect(s.month).toBe("2026-09");
    expect(s.timeZone).toBe("Asia/Kuala_Lumpur");
    expect(s.totalMyr).toBe("3.8500");
    expect(s.calls).toBe(6);
  });

  it("breaks spend down by tier, agent, provider+model and package", async () => {
    const s = await getUsageSummary({ now: NOW });
    expect(s.byTier.map((t) => [t.key, t.costMyr, t.calls])).toEqual([
      ["L4", "2.0000", 3],
      ["L3", "1.2500", 2],
      ["L1", "0.5000", 2],
      ["EMBED", "0.1000", 1],
    ]);
    expect(s.byTier[0].share).toBeCloseTo(200 / 385, 10);
    expect(s.byAgent.map((a) => [a.key, a.costMyr])).toEqual([
      ["retention.copywriter", "2.0000"],
      ["commercial.outline_writer", "1.2500"],
      ["inbox.classifier", "0.5000"],
      ["knowledge.embedder", "0.1000"],
    ]);
    // Model calls only: template and budget rows are not a provider's traffic.
    expect(s.byModel.map((m) => [m.provider, m.model, m.costMyr, m.calls])).toEqual([
      ["anthropic", "claude-sonnet-5", "2.0000", 2],
      ["deepseek", "deepseek-chat", "1.2500", 2],
      ["gemini", "gemini-2.5-flash-lite", "0.5000", 1],
      ["openai-compatible", "text-embedding-3-small", "0.1000", 1],
    ]);
    expect(s.topPackages).toEqual([
      { packageId: p2.id, packageCode: p2.packageCode, title: p2.title, costMyr: "2.0000", calls: 1 },
      { packageId: p1.id, packageCode: p1.packageCode, title: p1.title, costMyr: "1.2500", calls: 2 },
    ]);
  });

  it("returns a zero-filled daily series from the 1st to today", async () => {
    const s = await getUsageSummary({ now: NOW });
    expect(s.daily).toHaveLength(20);
    expect(s.daily[0]).toEqual({ date: "2026-09-01", costMyr: "1.0000", calls: 1 });
    expect(s.daily[1]).toEqual({ date: "2026-09-02", costMyr: "0.0000", calls: 0 });
    expect(s.daily.find((d) => d.date === "2026-09-14")).toEqual({ date: "2026-09-14", costMyr: "2.0000", calls: 1 });
    expect(s.daily[19]).toEqual({ date: "2026-09-20", costMyr: "0.2500", calls: 3 });
    expect(s.daily.reduce((acc, d) => acc + Math.round(Number(d.costMyr) * 100), 0)).toBe(385);
  });

  it("forecasts linearly from the trailing seven days, flagged as an estimate", async () => {
    const s = await getUsageSummary({ now: NOW });
    // 14–20 Sep spent RM 2.75 → RM 0.39/day × 10 remaining days + RM 3.85 so far.
    expect(s.forecast).toEqual({ projectedMyr: "7.75", trailing7DayAverageMyr: "0.39", remainingDays: 10, isEstimate: true });
  });

  it("reports the template-fallback share and the cache-hit ratio", async () => {
    const s = await getUsageSummary({ now: NOW });
    // Answers are OK rows on L1/L3/L4 whose output was used; the repaired call does not count.
    expect(s.templateFallback).toEqual({ share: 0.4, fallbacks: 2, answers: 3 });
    expect(s.cacheHitRatio).toBeCloseTo(1_200 / 4_500, 10);
  });

  it("puts each tier's budget WITHIN, NEAR (≥80%) or PAUSED (≥100%)", async () => {
    await updateTierConfig("L4", { monthlyCapMyr: "2.40" }, ALEX);
    await updateTierConfig("L1", { monthlyCapMyr: "0.50" }, ALEX);
    const s = await getUsageSummary({ now: NOW });
    const states = Object.fromEntries(s.budgets.map((b) => [b.tier, [b.state, b.spentMyr, b.capMyr]]));
    expect(states).toEqual({
      L1: ["PAUSED", "0.5000", "0.50"],
      L3: ["WITHIN", "1.2500", "250.00"],
      L4: ["NEAR", "2.0000", "2.40"],
      EMBED: ["WITHIN", "0.1000", "30.00"],
    });
    expect(await getBudgetStates({ now: NOW })).toEqual(s.budgets);
  });

  it("an empty month is all zeros, not NaN", async () => {
    const s = await getUsageSummary({ now: new Date("2026-03-15T04:00:00Z") });
    expect(s).toMatchObject({ month: "2026-03", totalMyr: "0.0000", calls: 0, cacheHitRatio: 0, templateFallback: { share: 0, fallbacks: 0, answers: 0 } });
    expect(s.forecast.projectedMyr).toBe("0.00");
    expect(s.daily).toHaveLength(15);
    expect(s.budgets.every((b) => b.state === "WITHIN")).toBe(true);
  });
});
