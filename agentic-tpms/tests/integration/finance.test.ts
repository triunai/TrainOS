import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { todayMY } from "@/lib/dates";
import { verifyChain } from "@/server/audit/ledger";
import { db, rows, schema, withTx } from "@/server/db/client";
import { OPS_STAGES } from "@/server/domain/stages";
import { executiveOverview } from "@/server/finance/kpis";
import { handlers as financeHandlers } from "@/server/finance/tasks";
import { adjustVoucher, draftPaymentVouchers, listVouchers, markVoucherPaid, settlePackage } from "@/server/finance/vouchers";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt } from "../helpers/lifecycle";
import { pdfBytes, runQueued, uploadEvidence } from "../helpers/finance-harness";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);
afterEach(() => {
  delete process.env.TPMS_COMMISSION_RATE;
});

const payment = (ref: string) => ({ bankReference: ref, receiptBytes: pdfBytes(ref), mime: "application/pdf", fileName: `${ref}.pdf` });

/** REMITTED fixture with its vouchers drafted by the handler (the coupling's queued task). */
async function remittedWithVouchers() {
  const fx = await buildPackageAt("REMITTED");
  const drafted = await runQueued(financeHandlers, "finance.draft_payment_vouchers", { packageId: fx.pkg.id });
  const vouchers = await db().select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.packageId, fx.pkg.id));
  const trainer = vouchers.find((v) => v.payeeType === "TRAINER")!;
  const venue = vouchers.find((v) => v.payeeType === "VENUE")!;
  return { ...fx, drafted, trainer, venue };
}

async function settledPackage() {
  const fx = await remittedWithVouchers();
  await adjustVoucher(fx.trainer.id, [
    { kind: "MILEAGE", label: "Mileage KL - PJ return", amount: 120 },
    { kind: "WITHHOLDING_TAX", label: "Withholding tax", amount: -600 },
  ], ALEX);
  await adjustVoucher(fx.venue.id, [], ALEX);
  await markVoucherPaid(fx.trainer.id, payment("MBB-TRX-10001"), ALEX);
  await markVoucherPaid(fx.venue.id, payment("MBB-TRX-10002"), ALEX);
  const settled = await settlePackage(fx.pkg.id, ALEX);
  return { ...fx, settled };
}

describe("pay-when-paid", () => {
  it("refuses to pay a voucher before HRD Corp remits, in the service and in the database", async () => {
    const { pkg, engagementId } = await buildPackageAt("APPROVED");
    const receipt = await uploadEvidence(pkg.id, "PAYMENT_RECEIPT");
    const [pv] = await db()
      .insert(schema.paymentVouchers)
      .values({
        packageId: pkg.id, pvNumber: `PV-EARLY-${pkg.packageCode}`, payeeType: "TRAINER", payeeName: "Farah Aziz",
        engagementId, agreedAmount: "6000.00", finalAmount: "6000.00", status: "APPROVED",
      })
      .returning();
    await expect(markVoucherPaid(pv.id, payment("MBB-TRX-0001"), ALEX)).rejects.toMatchObject({ code: "PAY_WHEN_PAID" });
    // Any other write path hits the database guard, surfaced as the same DomainError.
    await expect(
      withTx(ALEX, { reasonCode: "TEST_DIRECT_PAY" }, (tx) =>
        tx.update(schema.paymentVouchers)
          .set({ status: "PAID", bankReference: "MBB-TRX-0001", receiptVaultId: receipt.id, paidBy: ALEX.id, paidAt: new Date() })
          .where(eq(schema.paymentVouchers.id, pv.id)),
      ),
    ).rejects.toMatchObject({ code: "PAY_WHEN_PAID" });
    const [after] = await db().select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.id, pv.id));
    expect(after.status).toBe("APPROVED");
  });
});

describe("payment vouchers and settlement", () => {
  it("drafts one voucher per payable at REMITTED, idempotently, and raises the AP decision", async () => {
    const fx = await remittedWithVouchers();
    const created = fx.drafted.created as Array<{ payeeType: string; payeeName: string; amount: string; pvNumber: string }>;
    expect(created.map((c) => [c.payeeType, c.payeeName, c.amount]).sort()).toEqual([
      ["TRAINER", "Farah Aziz", "6000.00"],
      ["VENUE", "Sunway Pyramid Convention Centre", "3800.00"],
    ]);
    for (const c of created) expect(c.pvNumber).toMatch(/^PV-\d{4}-\d{5}$/);
    expect(fx.trainer).toMatchObject({ status: "DRAFT", engagementId: fx.engagementId, agreedAmount: "6000.00" });
    expect(fx.trainer.vaultId).toBeTruthy();

    const again = await draftPaymentVouchers(fx.pkg.id);
    expect(again).toMatchObject({ created: [], existing: 2 });
    expect(await listVouchers({ packageId: fx.pkg.id })).toHaveLength(2);

    const [decision] = await db()
      .select()
      .from(schema.decisions)
      .where(and(eq(schema.decisions.gate, "GATE3_AP_DISBURSEMENT"), eq(schema.decisions.packageId, fx.pkg.id)));
    expect(decision).toMatchObject({ status: "PENDING", subjectRef: fx.pkg.packageCode, raisedBy: "finance.pv_drafter" });
    expect(decision.summary).toContain("RM 9,800.00");
  });

  it("adds a commission voucher when a commission rate is configured", async () => {
    process.env.TPMS_COMMISSION_RATE = "0.05";
    const fx = await remittedWithVouchers();
    const commission = (fx.drafted.created as Array<{ payeeType: string; amount: string }>).find((c) => c.payeeType === "COMMISSION");
    expect(commission?.amount).toBe("800.00");
  });

  it("requires approval, a bank reference and a receipt before a voucher is paid", async () => {
    const fx = await remittedWithVouchers();
    await expect(markVoucherPaid(fx.trainer.id, payment("MBB-TRX-2001"), ALEX)).rejects.toMatchObject({ code: "PV_NOT_APPROVED" });
    await expect(
      adjustVoucher(fx.trainer.id, [{ kind: "WITHHOLDING_TAX", label: "Withholding tax", amount: 600 }], ALEX),
    ).rejects.toMatchObject({ code: "WHT_MUST_BE_NEGATIVE" });
    await expect(adjustVoucher(fx.trainer.id, [{ kind: "BONUS", label: "Bonus", amount: 10 }], ALEX)).rejects.toMatchObject({ code: "INVALID_ADJUSTMENT" });

    const approved = await adjustVoucher(fx.trainer.id, [
      { kind: "MILEAGE", label: "Mileage KL - PJ return", amount: 120 },
      { kind: "WITHHOLDING_TAX", label: "Withholding tax", amount: -600 },
    ], ALEX);
    expect(approved).toMatchObject({ status: "APPROVED", finalAmount: "5520.00", approvedBy: ALEX.id });
    expect(approved.vaultId).not.toBe(fx.trainer.vaultId);

    await expect(markVoucherPaid(fx.trainer.id, { ...payment("x"), bankReference: "  " }, ALEX)).rejects.toMatchObject({ code: "BANK_REFERENCE_REQUIRED" });
    await expect(markVoucherPaid(fx.trainer.id, { ...payment("MBB-TRX-2001"), receiptBytes: new Uint8Array() }, ALEX)).rejects.toMatchObject({
      code: "RECEIPT_REQUIRED",
    });
    // The database refuses PAID without evidence on any path (pv_paid_requires_evidence).
    await expect(
      withTx(ALEX, { reasonCode: "TEST_DIRECT_PAY" }, (tx) =>
        tx.update(schema.paymentVouchers).set({ status: "PAID" }).where(eq(schema.paymentVouchers.id, fx.trainer.id)),
      ),
    ).rejects.toMatchObject({ code: "CONSTRAINT_VIOLATION", details: { constraint: "pv_paid_requires_evidence" } });

    const paid = await markVoucherPaid(fx.trainer.id, payment("MBB-TRX-2001"), ALEX);
    expect(paid).toMatchObject({ status: "PAID", bankReference: "MBB-TRX-2001", paidBy: ALEX.id });
    expect(paid.receiptVaultId).toBeTruthy();
    await expect(adjustVoucher(fx.trainer.id, [], ALEX)).rejects.toMatchObject({ code: "PV_PAID_IS_FINAL" });
  });

  it("refuses to settle with an unpaid voucher, then settles with a reconciled ledger", async () => {
    const fx = await remittedWithVouchers();
    const refused = await settlePackage(fx.pkg.id, ALEX).catch((e) => e);
    expect(refused.code).toBe("GUARD_FAILED");
    expect(refused.details.failures.map((f: { code: string }) => f.code)).toContain("VOUCHERS_UNPAID");

    await adjustVoucher(fx.trainer.id, [
      { kind: "MILEAGE", label: "Mileage KL - PJ return", amount: 120 },
      { kind: "WITHHOLDING_TAX", label: "Withholding tax", amount: -600 },
    ], ALEX);
    await adjustVoucher(fx.venue.id, [], ALEX);
    await markVoucherPaid(fx.trainer.id, payment("MBB-TRX-3001"), ALEX);
    const stillOpen = await settlePackage(fx.pkg.id, ALEX).catch((e) => e);
    expect(stillOpen.details.failures.map((f: { code: string }) => f.code)).toContain("VOUCHERS_UNPAID");
    await markVoucherPaid(fx.venue.id, payment("MBB-TRX-3002"), ALEX);

    const { outcome, ledger } = await settlePackage(fx.pkg.id, ALEX);
    expect(outcome.pkg.financialStage).toBe("SETTLED_CLOSED");
    const [move] = await rows<{ actor_type: string; actor_id: string; reason_code: string; from_stage: string }>(
      db(),
      sql`select actor_type, actor_id, reason_code, from_stage from tpms.audit_ledger
           where entity_id = ${fx.pkg.id}::uuid and machine = 'FINANCIAL' and to_stage = 'SETTLED_CLOSED'`,
    );
    expect(move).toEqual({ actor_type: "USER", actor_id: ALEX.id, reason_code: "AP_DISBURSEMENT_CONFIRMED", from_stage: "REMITTED" });
    // Cost = agreed + mileage (WHT is part of the agreed fee, withheld for LHDN): 6,000 + 120 = 6,120.
    expect(ledger).toMatchObject({
      approvedGrantAmount: "16000.00",
      trainerFeeAgreed: "6120.00",
      trainerFeePaid: "5520.00",
      venueAndCateringCost: "3800.00",
      materialsAndPrintingCost: "0.00",
      salesCommissionAmount: "0.00",
      grossMargin: "6080.00",
      netRetainedProfit: "6080.00",
      bankPaymentReference: "MBB-TRX-3001",
      taxInvoiceNumber: `INV-TEST-${fx.pkg.packageCode}`,
    });
    expect(ledger.reconciledAt).toBeInstanceOf(Date);
    expect(ledger.remittedAt).toBeInstanceOf(Date);
    const [decision] = await db()
      .select()
      .from(schema.decisions)
      .where(and(eq(schema.decisions.gate, "GATE3_AP_DISBURSEMENT"), eq(schema.decisions.packageId, fx.pkg.id)));
    expect(decision).toMatchObject({ status: "APPROVED", chosenOption: "SETTLE", resolvedBy: ALEX.id });
    expect((await verifyChain()).ok).toBe(true);
  });
});

describe("executive KPIs", () => {
  it("reads DSO, receivables, pipeline, trainer margin, cash at risk and remittances from the database", async () => {
    const settled = await settledPackage();
    const submitted = await buildPackageAt("CLAIM_SUBMITTED");
    const locked = await buildPackageAt("OPERATIONS_LOCKED");

    const o = await executiveOverview();

    const dso = o.dso.perPackage.find((p) => p.packageId === settled.pkg.id);
    expect(dso?.days).toBe(0);
    expect(o.dso.averageDays).toBe(0);
    expect(o.dso.sampleSize).toBeGreaterThanOrEqual(1);

    const receivable = o.receivables.rows.find((r) => r.packageId === submitted.pkg.id);
    expect(receivable).toMatchObject({ financialStage: "CLAIM_SUBMITTED", invoiceTotal: "16000.00", daysOutstanding: 0 });
    expect(o.receivables.rows.some((r) => r.packageId === settled.pkg.id)).toBe(false);

    expect(o.pipeline.map((p) => p.stage)).toEqual([...OPS_STAGES]);
    expect(o.pipeline.find((p) => p.stage === "OPERATIONS_LOCKED")!.packages).toBeGreaterThanOrEqual(1);

    const trainer = o.marginByTrainer.find((t) => t.trainerId === settled.trainerId);
    expect(trainer).toMatchObject({ packages: 1, reconciled: 1, revenue: "16000.00", grossMargin: "6080.00", marginPct: 38 });

    const atRisk = o.cashAtRisk.rows.find((r) => r.packageId === locked.pkg.id);
    expect(atRisk).toMatchObject({ trainerCommitted: "6000.00", vendorCommitted: "3800.00" });
    expect(o.cashAtRisk.rows.some((r) => r.packageId === settled.pkg.id)).toBe(false);

    expect(o.remittances).toHaveLength(12);
    const thisMonth = o.remittances[o.remittances.length - 1];
    expect(thisMonth.month).toBe(todayMY().slice(0, 7));
    expect(Number(thisMonth.amount)).toBeGreaterThanOrEqual(16000);

    expect(o.topClients.length).toBeGreaterThan(0);
    expect(o.upfront.outstanding).toBe("0.00");
  });
});
