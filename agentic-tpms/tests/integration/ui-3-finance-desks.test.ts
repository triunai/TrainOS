import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/server/db/client";
import { addMonths, claimWindow, listClaimQueueDetail, recordQuery, summariseClaimQueue } from "@/server/claims";
import { adjustVoucher, marginByPackage, markVoucherPaid, payablesDesk, payablesState, settlePackage } from "@/server/finance";
import { listRetentionDesk } from "@/server/retention";
import { handlers as retentionHandlers } from "@/server/retention/tasks";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { pdfBytes, runQueued } from "../helpers/finance-harness";
import { handlers as financeHandlers } from "@/server/finance/tasks";
import { buildPackageAt } from "../helpers/lifecycle";

/**
 * UI-3 read models: the cross-package Claims queue, the Payables desk, margin
 * by package and the Retention desk rows. Each is a read over state the
 * finance lane's services wrote, so the fixtures drive packages there with
 * the lifecycle helper and the real Gate 3 services.
 */
beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

/** One package at each claim stage, plus a settled one. REMITTED has its vouchers drafted by the task. */
async function addClaimQueueFixtures() {
  const notReady = await buildPackageAt("DELIVERY_COMPLETED");
  const ready = await buildPackageAt("CLAIM_READY");
  const queried = await buildPackageAt("CLAIM_SUBMITTED");
  const approved = await buildPackageAt("APPROVED");
  const remitted = await buildPackageAt("REMITTED");
  await runQueued(financeHandlers, "finance.draft_payment_vouchers", { packageId: remitted.pkg.id });
  const settled = await buildPackageAt("SETTLED_CLOSED");
  return { notReady, ready, queried, approved, remitted, settled };
}

let w: Awaited<ReturnType<typeof addClaimQueueFixtures>>;
const QUERY = "Form T3 day 2 PM is missing two participant signatures";

beforeAll(async () => {
  w = await addClaimQueueFixtures();
  await recordQuery(w.queried.pkg.id, QUERY, ALEX);
});

const payment = (ref: string) => ({ bankReference: ref, receiptBytes: pdfBytes(ref), mime: "application/pdf", fileName: `${ref}.pdf` });

describe("claim window", () => {
  it("adds calendar months clamped to the month's last day", () => {
    expect(addMonths("2026-03-31", 6)).toBe("2026-09-30");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-01-15", 6)).toBe("2026-07-15");
  });

  it("flags an unsubmitted claim inside 45 days of the 6-month deadline, and ignores the window once filed", () => {
    expect(claimWindow("2026-03-31", "CLAIM_NOT_READY", "2026-07-01")).toEqual({ deadline: "2026-09-30", daysLeft: 91, state: "OPEN" });
    expect(claimWindow("2026-03-31", "CLAIM_READY", "2026-09-01")).toEqual({ deadline: "2026-09-30", daysLeft: 29, state: "CLOSING" });
    expect(claimWindow("2026-03-31", "CLAIM_NOT_READY", "2026-10-02")).toMatchObject({ daysLeft: -2, state: "LAPSED" });
    expect(claimWindow("2026-03-31", "CLAIM_SUBMITTED", "2026-10-02")).toMatchObject({ state: "FILED" });
  });
});

describe("claims queue detail", () => {
  it("adds claimable, checklist progress and the open query to every open claim, in FSM stage order", async () => {
    const items = await listClaimQueueDetail();
    const by = (code: string) => items.find((i) => i.packageCode === code)!;
    const codes = [w.notReady, w.ready, w.queried, w.approved, w.remitted].map((f) => f.pkg.packageCode);
    expect(items.map((i) => i.packageCode).sort()).toEqual([...codes].sort());
    expect(items.some((i) => i.packageCode === w.settled.pkg.packageCode)).toBe(false);

    const ready = by(w.ready.pkg.packageCode);
    expect(ready).toMatchObject({ financialStage: "CLAIM_READY", claimable: "16000.00", awaiting: "16000.00" });
    // The lifecycle fixture books a venue but files no BEO: the one required item the collator would block on.
    expect(ready.checklist).toEqual({ ok: 5, required: 6, ready: false, missing: ["Venue BEO / delivery order on file"] });
    expect(ready.window?.state).toBe("OPEN");

    const queried = by(w.queried.pkg.packageCode);
    expect(queried.financialStage).toBe("QUERIED");
    expect(queried.query).toMatchObject({ note: QUERY, raisedBy: ALEX.id, count: 1 });
    expect(queried.window?.state).toBe("FILED");
    expect(queried.submittedAt).not.toBeNull();

    expect(by(w.approved.pkg.packageCode)).toMatchObject({ awaiting: "16000.00", query: null });
    expect(by(w.remitted.pkg.packageCode)).toMatchObject({ awaiting: "0.00" });
  });

  it("summarises the queue for the metric strip and the stage tabs", async () => {
    const s = summariseClaimQueue(await listClaimQueueDetail());
    expect(s.stages).toEqual([
      { stage: "CLAIM_NOT_READY", count: 1 },
      { stage: "CLAIM_READY", count: 1 },
      { stage: "CLAIM_SUBMITTED", count: 0 },
      { stage: "QUERIED", count: 1 },
      { stage: "APPROVED", count: 1 },
      { stage: "REMITTED", count: 1 },
    ]);
    expect(s.claimable).toEqual({ count: 4, amount: "64000.00" });
    expect(s.notSubmitted).toEqual({ count: 2, amount: "32000.00" });
    expect(s.queried).toEqual({ count: 1, amount: "16000.00" });
    expect(s.approved).toEqual({ count: 1, amount: "16000.00" });
    expect(s.awaitingHrdc).toBe("64000.00");
  });
});

describe("payables desk", () => {
  it("rejects a financial stage it has no mapping for (R14)", () => {
    expect(payablesState("REMITTED")).toBe("PAYABLE");
    expect(payablesState("GRANT_RESERVED")).toBeNull();
    expect(() => payablesState("PAID_OUT")).toThrow(/Unknown financial stage/);
  });

  it("shows unremitted packages as planned payables waiting on HRD Corp, and remitted ones as payable", async () => {
    const desk = await payablesDesk();
    const by = (code: string) => desk.groups.find((g) => g.packageCode === code)!;

    const approved = by(w.approved.pkg.packageCode);
    expect(approved.state).toBe("AWAITING_REMITTANCE");
    expect(approved.vouchers).toEqual([]);
    expect(approved.planned.map((p) => [p.payeeType, p.payeeName, p.agreed])).toEqual([
      ["TRAINER", "Farah Aziz", "6000.00"],
      ["VENUE", "Sunway Pyramid Convention Centre", "3800.00"],
    ]);
    expect(approved.total).toBe("9800.00");

    const remitted = by(w.remitted.pkg.packageCode);
    expect(remitted).toMatchObject({ state: "PAYABLE", total: "9800.00", unpaid: "9800.00", readyToSettle: false });
    expect(remitted.vouchers.map((v) => v.status)).toEqual(["DRAFT", "DRAFT"]);
    expect(by(w.settled.pkg.packageCode)).toMatchObject({ state: "SETTLED", unpaid: "0.00" });

    expect(desk.metrics.payableNow).toEqual({ amount: "9800.00", vouchers: 2, toApprove: 2, toPay: 0 });
    // not ready, ready, queried, approved: four delivered packages owing 9,800 each once HRD Corp pays.
    expect(desk.metrics.awaitingRemittance).toEqual({ amount: "39200.00", packages: 4 });
    // The settled fixture's trainer voucher was paid today.
    expect(desk.metrics.paidThisMonth).toEqual({ amount: "6000.00", vouchers: 1 });
  });

  it("lists a voucher on an unremitted package as waiting, and marks a fully paid package ready to settle", async () => {
    const [early] = await db()
      .insert(schema.paymentVouchers)
      .values({
        packageId: w.approved.pkg.id, pvNumber: `PV-EARLY-${w.approved.pkg.packageCode}`, payeeType: "TRAINER", payeeName: "Farah Aziz",
        engagementId: w.approved.engagementId, agreedAmount: "6000.00", finalAmount: "6000.00", status: "APPROVED",
      })
      .returning();
    const vouchers = await db().select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.packageId, w.remitted.pkg.id));
    for (const v of vouchers) await adjustVoucher(v.id, [], ALEX);
    for (const v of vouchers) await markVoucherPaid(v.id, payment(`MBB-${v.pvNumber}`), ALEX);

    const desk = await payablesDesk();
    const approved = desk.groups.find((g) => g.packageCode === w.approved.pkg.packageCode)!;
    expect(approved).toMatchObject({ state: "AWAITING_REMITTANCE", planned: [], total: "6000.00" });
    expect(approved.vouchers.map((v) => v.id)).toEqual([early.id]);
    // Not payable: it is not counted as payable now, it is counted as awaiting remittance.
    expect(desk.metrics.payableNow.vouchers).toBe(0);

    const remitted = desk.groups.find((g) => g.packageCode === w.remitted.pkg.packageCode)!;
    expect(remitted).toMatchObject({ readyToSettle: true, unpaid: "0.00" });
    expect(desk.metrics.readyToSettle).toBe(1);
    expect(desk.metrics.paidThisMonth).toEqual({ amount: "15800.00", vouchers: 3 });
  });
});

describe("margin by package", () => {
  it("reads the reconciled ledger a settlement writes", async () => {
    await settlePackage(w.remitted.pkg.id, ALEX);
    const margins = await marginByPackage();
    const row = margins.find((m) => m.packageCode === w.remitted.pkg.packageCode)!;
    expect(row).toMatchObject({
      reconciled: true,
      trainerName: "Farah Aziz",
      revenue: "16000.00",
      directCost: "9800.00",
      grossMargin: "6200.00",
      marginPct: 38.8,
      financialStage: "SETTLED_CLOSED",
    });
    expect(margins[0].packageCode).toBe(w.remitted.pkg.packageCode);
  });
});

describe("retention desk", () => {
  it("adds the recipient an approval would send to", async () => {
    await runQueued(retentionHandlers, "retention.schedule", { packageId: w.notReady.pkg.id });
    const rows = (await listRetentionDesk()).filter((r) => r.sourcePackageId === w.notReady.pkg.id);
    expect(rows.map((r) => r.cadenceType)).toEqual(["EXECUTIVE_PACK_T14", "SYLLABUS_LADDER_T90", "LEVY_YEAR_END_T300"]);
    for (const r of rows) expect(r).toMatchObject({ picName: "Nurul Hassan", picEmail: "nurul@example.my", recommendedCourse: null, status: "PENDING" });
    expect(await listRetentionDesk({ status: "DISPATCHED" })).toEqual([]);
  });
});
