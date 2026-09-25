import { execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "@/server/audit/ledger";
import { db, rows, schema } from "@/server/db/client";
import { DEMO_PORTFOLIO, buildDemoPortfolio, type PortfolioBuild } from "@/server/demo/portfolio";
import { taskTotals } from "@/server/demo/tasks";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";

/**
 * The demo seed on an empty database: every portfolio entry lands at the
 * stage it was built to show, the desks have their pending decisions, the
 * audit chain holds, nothing dead-letters, and a second `db:seed` run adds
 * nothing. Track B uses the extraction service on port 8868 when it can be
 * started (see golden-path.test.ts); the expected stages are the same either way.
 */
let built: PortfolioBuild[];
let stopService: (() => Promise<void>) | null = null;

beforeAll(async () => {
  await useTestDatabase();
  process.env.TPMS_TEST_OCR_PORT ??= "8868";
  const service = await import("../helpers/extraction-service");
  service.pointAtTestService();
  if (service.hasServiceVenv) {
    try {
      await service.startExtractionService();
      stopService = service.stopExtractionService;
    } catch (error) {
      console.warn(`[seed] extraction service did not start; Track B falls back to digital T3: ${String(error).slice(0, 300)}`);
    }
  }
  built = await buildDemoPortfolio({ nonce: `seed-test-${Date.now().toString(36)}` });
}, 600_000);

afterAll(async () => {
  await stopService?.();
  await releaseTestDatabase();
});

describe("demo seed", () => {
  it("builds every portfolio entry to its intended stage", async () => {
    expect(built).toHaveLength(DEMO_PORTFOLIO.length);
    for (const { entry, result } of built) {
      if ("lead" in entry.expect) {
        const [lead] = await db().select().from(schema.leadRecords).where(eq(schema.leadRecords.id, result.leadId as string));
        expect([entry.scenario.key, lead.status]).toEqual([entry.scenario.key, entry.expect.lead]);
        expect(result.packageId).toBeNull();
      } else {
        expect([entry.scenario.key, result.final]).toEqual([entry.scenario.key, entry.expect]);
      }
    }
  });

  it("covers the board: 10-14 packages, every stage the demo needs, and open leads", async () => {
    const packages = await rows<{ o: string; f: string }>(db(), sql`select operational_stage as o, financial_stage as f from tpms.training_packages`);
    expect(packages.length).toBeGreaterThanOrEqual(10);
    expect(packages.length).toBeLessThanOrEqual(14);
    const pairs = new Set(packages.map((p) => `${p.o}/${p.f}`));
    for (const needed of [
      "DRAFT/ESTIMATE",
      "QUOTED/ESTIMATE",
      "GRANT_PENDING/GRANT_RESERVED",
      "GRANT_APPROVED/GRANT_RESERVED",
      "OPERATIONS_LOCKED/GRANT_RESERVED",
      "READY_FOR_EVENT/GRANT_RESERVED",
      "DELIVERY_IN_PROGRESS/GRANT_RESERVED",
      "DELIVERY_COMPLETED/CLAIM_NOT_READY",
      "DELIVERY_COMPLETED/CLAIM_READY",
      "DELIVERY_COMPLETED/CLAIM_SUBMITTED",
      "DELIVERY_COMPLETED/QUERIED",
      "DELIVERY_COMPLETED/REMITTED",
      "DELIVERY_COMPLETED/SETTLED_CLOSED",
    ]) {
      expect(pairs.has(needed), needed).toBe(true);
    }
    const leads = await rows<{ status: string }>(db(), sql`select status from tpms.lead_records where status <> 'CONVERTED' order by status`);
    expect(leads.map((l) => l.status)).toEqual(["LEAD_INGESTED", "LEAD_QUALIFIED_TNA", "TRIAGE_REVIEW"]);
    // The untriaged lead's triage is still waiting in the queue, as it would be on a real board.
    const [triage] = await rows<{ n: number }>(db(), sql`select count(*)::int as n from tpms.task_queue where task_type = 'lead.triage' and status = 'QUEUED'`);
    expect(triage.n).toBe(1);
  });

  it("puts a pending decision on every desk the demo shows", async () => {
    const gates = await rows<{ gate: string }>(db(), sql`select distinct gate from tpms.decisions where status = 'PENDING' order by gate`);
    const pending = gates.map((g) => g.gate);
    for (const gate of ["GATE1_COMMERCIAL", "GATE2_VIABILITY", "GATE3_AP_DISBURSEMENT", "GATE3_CLAIM_REVIEW", "LEAD_TRIAGE"]) {
      expect(pending).toContain(gate);
    }
    const inDelivery = built.find((b) => b.entry.stop === "t3.day1")!;
    if (inDelivery.result.ocr.available) expect(pending).toContain("ATTENDANCE_EXCEPTION");
    // The Gate 2 package is halted, not moved.
    const gate2 = built.find((b) => b.entry.stop === "t14")!;
    const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, gate2.result.packageId as string));
    expect(pkg.vendorAutoconfirmHalted).toBe(true);
  });

  it("looks like a real board: varied clients, trainers and courses", async () => {
    const [counts] = await rows<{ clients: number; trainers: number; courses: number }>(
      db(),
      sql`select count(distinct p.client_id)::int as clients,
                 count(distinct e.trainer_id)::int as trainers,
                 count(distinct coalesce(p.course_id::text, q.inputs->>'courseId', q.provenance->'course'->>'courseCode'))::int as courses
            from tpms.training_packages p
            left join tpms.trainer_engagements e on e.package_id = p.id and e.status <> 'RELEASED'
            left join tpms.quotations q on q.package_id = p.id`,
    );
    expect(counts.clients).toBeGreaterThanOrEqual(8);
    expect(counts.trainers).toBeGreaterThanOrEqual(5);
    expect(counts.courses).toBeGreaterThanOrEqual(9);
  });

  it("keeps the audit chain intact and dead-letters nothing", async () => {
    const verdict = await verifyChain();
    expect(verdict.ok).toBe(true);
    const totals = await taskTotals();
    expect(totals.deadLettered).toEqual([]);
    expect(totals.retrying).toEqual([]);
  });

  it("is idempotent enough: running db:seed again adds nothing", async () => {
    const count = async () => (await rows<{ n: number }>(db(), sql`select count(*)::int as n from tpms.training_packages`))[0].n;
    const before = await count();
    const out = execFileSync("npx", ["tsx", "scripts/seed.ts"], { env: { ...process.env }, encoding: "utf8", timeout: 120_000 });
    expect(out).toMatch(/already exist/);
    expect(out).toMatch(/Audit chain: INTACT/);
    expect(await count()).toBe(before);
    expect((await verifyChain()).ok).toBe(true);
  }, 180_000);
});
