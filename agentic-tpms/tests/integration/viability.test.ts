import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayMY } from "@/lib/dates";
import { db, rows, schema } from "@/server/db/client";
import { assessViability, cancelPackage, confirmReschedule, resolveViability, runT14Check } from "@/server/operations/viability";
import { listPackageCards } from "@/server/packages/queries";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt } from "../helpers/lifecycle";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

/** A package at OPERATIONS_LOCKED with `n` participants (the helper adds them on the way to READY). */
async function lockedWith(n: number) {
  const f = await buildPackageAt("OPERATIONS_LOCKED");
  const { addParticipant } = await import("../helpers/factory");
  const { fixtureNric } = await import("../helpers/lifecycle");
  for (let i = 0; i < n; i += 1) await addParticipant(f.pkg.id, `P${i}`, fixtureNric(91, i));
  return f;
}

async function stageOf(id: string) {
  const [p] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, id));
  return p;
}

describe("Gate 2 — T-14 viability", () => {
  it("advances a viable cohort to READY_FOR_EVENT as SYSTEM", async () => {
    const { pkg } = await lockedWith(6);
    const result = await runT14Check(pkg.id, pkg.startDate);
    expect(result).toMatchObject({ viable: true, advanced: true });
    expect((await stageOf(pkg.id)).operationalStage).toBe("READY_FOR_EVENT");
  });

  it("halts vendor confirmations and raises a decision below 5 pax", async () => {
    const { pkg } = await lockedWith(3);
    const result = await runT14Check(pkg.id, pkg.startDate);
    expect(result).toMatchObject({ viable: false, halted: true });
    const after = await stageOf(pkg.id);
    expect(after.operationalStage).toBe("OPERATIONS_LOCKED");
    expect(after.vendorAutoconfirmHalted).toBe(true);
    const [decision] = await db().select().from(schema.decisions).where(eq(schema.decisions.subjectRef, pkg.packageCode));
    expect(decision.gate).toBe("GATE2_VIABILITY");
    expect(decision.options.map((o) => o.id)).toEqual(["POSTPONE", "PIVOT_ROT", "CANCEL", "PROCEED"]);
    // The board counts it as at risk: the tri-factor lights say nothing about the cohort.
    const card = (await listPackageCards()).find((c) => c.id === pkg.id);
    expect(card?.viabilityHalted).toBe(true);
  });

  it("skips a stale task after the dates moved", async () => {
    const { pkg } = await lockedWith(2);
    expect(await runT14Check(pkg.id, "2020-01-01")).toEqual({ skipped: "DATES_CHANGED" });
  });

  it("POSTPONE moves dates, shifts vendor deadlines, and reschedule re-arms T-14", async () => {
    const { pkg } = await lockedWith(2);
    await runT14Check(pkg.id, pkg.startDate);
    const newStart = addDays(pkg.startDate as string, 28);
    await resolveViability(pkg.id, { choice: "POSTPONE", newStartDate: newStart, newEndDate: addDays(newStart, 1), note: "Client moved to next month" }, ALEX);
    const postponed = await stageOf(pkg.id);
    expect(postponed.operationalStage).toBe("POSTPONED");
    expect(postponed.startDate).toBe(newStart);
    expect(postponed.postponedFromStart).toBe(pkg.startDate);
    const [commitment] = await db().select().from(schema.vendorCommitments).where(eq(schema.vendorCommitments.packageId, pkg.id));
    expect(commitment.cancellationDeadline).toBe(addDays(newStart, -14));

    await confirmReschedule(pkg.id, ALEX);
    const [t14] = await rows<{ n: number }>(
      db(),
      sql`select count(*)::int as n from tpms.task_queue where idempotency_key = ${`t14:${pkg.id}:${newStart}`}`,
    );
    expect(t14.n).toBe(1);
    const [decision] = await db().select().from(schema.decisions).where(eq(schema.decisions.subjectRef, pkg.packageCode));
    expect(decision).toMatchObject({ status: "RESOLVED", chosenOption: "POSTPONE", resolvedBy: ALEX.id });
  });

  it("PIVOT_ROT releases the venue and reaches READY_FOR_EVENT", async () => {
    const { pkg } = await lockedWith(3);
    await runT14Check(pkg.id, pkg.startDate);
    await resolveViability(pkg.id, { choice: "PIVOT_ROT" }, ALEX);
    const after = await stageOf(pkg.id);
    expect(after).toMatchObject({ operationalStage: "READY_FOR_EVENT", deliveryMode: "ROT_VIRTUAL" });
    const commitments = await db().select().from(schema.vendorCommitments).where(eq(schema.vendorCommitments.packageId, pkg.id));
    expect(commitments.every((c) => c.status === "CANCELLED")).toBe(true);
  });

  it("CANCEL releases holds and voids the financial machine", async () => {
    const { pkg } = await lockedWith(1);
    await resolveViability(pkg.id, { choice: "CANCEL", note: "Only one registration" }, ALEX);
    const after = await stageOf(pkg.id);
    expect(after).toMatchObject({ operationalStage: "CANCELLED", financialStage: "VOIDED" });
    const engagements = await db().select().from(schema.trainerEngagements).where(eq(schema.trainerEngagements.packageId, pkg.id));
    expect(engagements.every((e) => e.status === "RELEASED")).toBe(true);
  });

  it("PROCEED demands a written reason and is refused for a SYSTEM actor", async () => {
    const { pkg } = await lockedWith(4);
    await expect(resolveViability(pkg.id, { choice: "PROCEED", note: "short" }, ALEX)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(resolveViability(pkg.id, { choice: "PROCEED", note: "Client insists; four managers are the whole team" }, { type: "SYSTEM", id: "x" })).rejects.toMatchObject({ code: "HUMAN_DECISION_REQUIRED" });
    await resolveViability(pkg.id, { choice: "PROCEED", note: "Client insists; four managers are the whole team" }, ALEX);
    expect((await stageOf(pkg.id)).operationalStage).toBe("READY_FOR_EVENT");
  });

  it("assesses exposure: inside the free window, postponement costs nothing", async () => {
    const { pkg } = await lockedWith(2);
    const a = await assessViability(pkg.id);
    expect(a.venueExposure.postponeSen).toBe(0);
    expect(a.trainer.confirmed).toBe(true);
    expect(a.options[0].consequence).toMatch(/No penalty/);
    expect(todayMY() < (pkg.startDate as string)).toBe(true);
  });

  it("cancelPackage requires a reason", async () => {
    const { pkg } = await buildPackageAt("QUOTED");
    await expect(cancelPackage(pkg.id, "", ALEX)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await cancelPackage(pkg.id, "Client chose another provider", ALEX);
    expect((await stageOf(pkg.id)).financialStage).toBe("VOIDED");
  });
});
