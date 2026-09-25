import { writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import JSZip from "jszip";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { approveClaimPack, recordHrdcApproval, recordQuery, recordRemittance, redraftTaxInvoice, resubmitAfterQuery } from "@/server/claims/gate3";
import { draftTaxInvoice } from "@/server/claims/invoice";
import { verifyEvidence } from "@/server/claims/collate";
import { handlers as claimsHandlers } from "@/server/claims/tasks";
import { db, rows, schema, withTx } from "@/server/db/client";
import { env } from "@/server/env";
import { updatePackageFields } from "@/server/fsm/service";
import { sha256Hex } from "@/server/lib/crypto";
import { readDocument } from "@/server/storage/vault";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt } from "../helpers/lifecycle";
import { pdfBytes, queuedTask, runQueued, uploadEvidence, vaultOf } from "../helpers/finance-harness";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);
afterEach(() => {
  delete process.env.TPMS_SST_RATE;
});

const draft = (packageId: string) => withTx(ALEX, { reasonCode: "TEST_DRAFT_INVOICE" }, (tx) => draftTaxInvoice(tx, packageId));

async function stageOf(packageId: string): Promise<string> {
  const [row] = await db().select({ s: schema.trainingPackages.financialStage }).from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  return row.s;
}

async function setAttendance(participantId: string, rate: number) {
  await db().execute(sql`update tpms.package_participants set attendance_rate = ${rate} where id = ${participantId}::uuid`);
}

/** Delivered package with T3 + photos verified by an operator, a BEO on file and an unverified JD/14. */
async function deliveredWithEvidence() {
  const fx = await buildPackageAt("DELIVERY_COMPLETED");
  for (const d of [...(await vaultOf(fx.pkg.id, "FORM_T3")), ...(await vaultOf(fx.pkg.id, "PHOTO_EVIDENCE"))]) {
    await verifyEvidence(d.id, { status: "VERIFIED" }, ALEX);
  }
  await uploadEvidence(fx.pkg.id, "BEO", "BEO-7781 signed.pdf");
  const jd14 = await uploadEvidence(fx.pkg.id, "FORM_JD14");
  return { ...fx, jd14 };
}

/** All the way to CLAIM_READY through the collator. */
async function readyPackage() {
  const fx = await deliveredWithEvidence();
  const verdict = await verifyEvidence(fx.jd14.id, { status: "VERIFIED", checks: { managerialSignature: true, companyStamp: true } }, ALEX);
  const result = await runQueued(claimsHandlers, "claims.collate", { packageId: fx.pkg.id }, verdict.recollateTaskId ?? undefined);
  expect(result.ready).toBe(true);
  return fx;
}

describe("HRD Corp tax invoice", () => {
  it("bills a per-group programme at the approved grant once anyone is eligible, and is stable on re-run", async () => {
    const { pkg, participantIds } = await buildPackageAt("DELIVERY_COMPLETED");
    await setAttendance(participantIds[0], 50);
    const first = await draft(pkg.id);
    expect(first.invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(first.invoice).toMatchObject({
      billedTo: "Pembangunan Sumber Manusia Berhad (HRD Corp)",
      employerName: "Kenanga Retail Group Berhad",
      grantReference: "ETRIS-2026-001234",
      subtotal: "16000.00",
      taxRate: "0.0000",
      taxAmount: "0.00",
      total: "16000.00",
    });
    const line = (first.invoice.lineItems as Array<Record<string, unknown>>)[0];
    expect(line).toMatchObject({ basis: "PER_GROUP", quantity: 1, amount: "16000.00", eligibleParticipants: 5 });
    expect(String(line.description)).toMatch(/^Training fee — Leading Through Change \(.+\) · SBL-Khas grant ETRIS-2026-001234$/);
    expect(first.vaultDoc.documentType).toBe("TAX_INVOICE");
    const pdf = await readDocument(first.vaultDoc.id);
    expect(pdf?.intact).toBe(true);
    expect(Buffer.from(pdf!.bytes).subarray(0, 5).toString()).toBe("%PDF-");

    const again = await draft(pkg.id);
    expect(again.changed).toBe(false);
    expect(again.invoice.invoiceNumber).toBe(first.invoice.invoiceNumber);
    expect(await vaultOf(pkg.id, "TAX_INVOICE")).toHaveLength(1);
  });

  it("pro-rates a per-pax programme to eligible participants up to the approved headcount, re-drafting in place", async () => {
    const { pkg, participantIds } = await buildPackageAt("DELIVERY_COMPLETED");
    await updatePackageFields(pkg.id, { deliveryMode: "PUBLIC_PHYSICAL" }, ALEX, "TEST_FIXTURE_PUBLIC_PROGRAMME");
    await setAttendance(participantIds[0], 60);
    await setAttendance(participantIds[1], 75);
    const first = await draft(pkg.id);
    // 4 eligible of 20 approved pax x RM 16,000 grant = RM 3,200
    expect(first.invoice.total).toBe("3200.00");
    expect((first.invoice.lineItems as Array<Record<string, unknown>>)[0]).toMatchObject({
      basis: "PER_PAX",
      quantity: 4,
      unit: "participant",
      unitAmount: "800.00",
      approvedParticipants: 20,
    });

    await setAttendance(participantIds[2], 10);
    const second = await draft(pkg.id);
    expect(second.changed).toBe(true);
    expect(second.created).toBe(false);
    expect(second.invoice.invoiceNumber).toBe(first.invoice.invoiceNumber);
    expect(second.invoice.total).toBe("2400.00");
    expect(second.invoice.vaultId).not.toBe(first.invoice.vaultId);
    const [audit] = await rows<{ reason_code: string }>(
      db(),
      sql`select reason_code from tpms.audit_ledger where entity_id = ${first.invoice.id}::uuid order by seq desc limit 1`,
    );
    expect(audit.reason_code).toBe("INVOICE_REDRAFTED");
  });

  it("applies a configured SST rate tax-inclusive so the total stays the claimable amount", async () => {
    const { pkg } = await buildPackageAt("DELIVERY_COMPLETED");
    process.env.TPMS_SST_RATE = "0.08";
    const result = await draft(pkg.id);
    expect(result.invoice).toMatchObject({ taxRate: "0.0800", subtotal: "14814.81", taxAmount: "1185.19", total: "16000.00" });
    process.env.TPMS_SST_RATE = "8";
    await expect(draft(pkg.id)).rejects.toThrow(/TPMS_SST_RATE must be a fraction/);
  });
});

describe("claim collation", () => {
  it("stays CLAIM_NOT_READY with a checklist while JD/14 is unverified, then reaches CLAIM_READY and raises Gate 3", async () => {
    const fx = await deliveredWithEvidence();
    expect(await stageOf(fx.pkg.id)).toBe("CLAIM_NOT_READY");

    const first = await runQueued(claimsHandlers, "claims.collate", { packageId: fx.pkg.id });
    expect(first.ready).toBe(false);
    const checklist = first.checklist as { missing: string[]; items: Array<{ code: string; ok: boolean; detail: string }> };
    expect(checklist.missing).toEqual(["FORM_JD14"]);
    expect(checklist.items.find((i) => i.code === "FORM_JD14")?.detail).toMatch(/not verified/);
    expect(checklist.items.find((i) => i.code === "BEO_DO")?.ok).toBe(true);
    expect((first.invoice as { invoiceNumber: string }).invoiceNumber).toMatch(/^INV-/);
    expect(await stageOf(fx.pkg.id)).toBe("CLAIM_NOT_READY");
    const [run] = await rows<{ status: string; output: { ready: boolean; checklist: { missing: string[] } } }>(
      db(),
      sql`select status, output from tpms.agent_runs where agent = 'claims.collator' and package_id = ${fx.pkg.id}::uuid order by started_at desc limit 1`,
    );
    expect(run.output.ready).toBe(false);
    expect(run.output.checklist.missing).toEqual(["FORM_JD14"]);

    await expect(verifyEvidence(fx.jd14.id, { status: "VERIFIED", checks: { managerialSignature: true } }, ALEX)).rejects.toMatchObject({
      code: "JD14_CHECKS_REQUIRED",
    });
    await expect(verifyEvidence(fx.jd14.id, { status: "VERIFIED" }, { type: "AGENT", id: "claims.collator" })).rejects.toMatchObject({
      code: "OPERATOR_REQUIRED",
    });
    const verdict = await verifyEvidence(fx.jd14.id, { status: "VERIFIED", checks: { managerialSignature: true, companyStamp: true } }, ALEX);
    expect(verdict.recollateTaskId).toBeTruthy();
    expect(verdict.doc.verifiedBy).toBe(ALEX.id);
    expect(verdict.doc.extractedMetadata).toMatchObject({ operatorVerification: { checks: { managerialSignature: true, companyStamp: true } } });

    const second = await runQueued(claimsHandlers, "claims.collate", { packageId: fx.pkg.id }, verdict.recollateTaskId!);
    expect(second.ready).toBe(true);
    expect(await stageOf(fx.pkg.id)).toBe("CLAIM_READY");

    const [move] = await rows<{ actor_type: string; reason_code: string }>(
      db(),
      sql`select actor_type, reason_code from tpms.audit_ledger
           where entity_id = ${fx.pkg.id}::uuid and machine = 'FINANCIAL' and to_stage = 'CLAIM_READY'`,
    );
    expect(move).toEqual({ actor_type: "SYSTEM", reason_code: "CLAIM_EVIDENCE_VERIFIED" });
    const [decision] = await db()
      .select()
      .from(schema.decisions)
      .where(and(eq(schema.decisions.gate, "GATE3_CLAIM_REVIEW"), eq(schema.decisions.packageId, fx.pkg.id)));
    expect(decision).toMatchObject({ status: "PENDING", subjectRef: fx.pkg.packageCode, raisedBy: "claims.collator", raisedByTier: "L3" });
    expect(decision.summary).toContain("RM 16,000.00");
    expect(decision.summary).toContain("Form JD/14");

    // A stale queued run (from an earlier verification) is a no-op: no second pack, no error.
    const stale = await runQueued(claimsHandlers, "claims.collate", { packageId: fx.pkg.id });
    expect(stale.skipped).toMatch(/CLAIM_READY/);
    expect(await vaultOf(fx.pkg.id, "CLAIM_PACK")).toHaveLength(1);
  });

  it("compiles a claim pack whose manifest hashes match the bytes of every file", async () => {
    const fx = await readyPackage();
    const [packDoc] = await vaultOf(fx.pkg.id, "CLAIM_PACK");
    const read = await readDocument(packDoc.id);
    expect(read?.intact).toBe(true);
    const zip = await JSZip.loadAsync(read!.bytes);
    const paths = Object.keys(zip.files).sort();
    expect(paths).toEqual([
      "00_Cover.pdf",
      "01_Tax_Invoice.pdf",
      "02_Form_T3/01_form_t3.pdf",
      "03_Form_JD14.pdf",
      "04_Photos/01_photo_evidence.pdf",
      "04_Photos/02_photo_evidence.pdf",
      "05_BEO_DO/BEO_01_BEO-7781_signed.pdf",
      "07_Attendance_Summary.pdf",
      "manifest.json",
    ]);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({
      packageCode: fx.pkg.packageCode,
      grantReference: "ETRIS-2026-001234",
      claimableAmount: "16000.00",
      currency: "MYR",
    });
    expect(Object.keys(manifest.files).sort()).toEqual(paths.filter((p) => p !== "manifest.json"));
    for (const [path, hash] of Object.entries(manifest.files as Record<string, string>)) {
      expect(sha256Hex(await zip.file(path)!.async("uint8array")), path).toBe(hash);
    }
    // Evidence is packed byte-for-byte from the vault.
    expect(manifest.files["03_Form_JD14.pdf"]).toBe(fx.jd14.fileHashSha256);
    const [invoice] = await db().select().from(schema.taxInvoices).where(eq(schema.taxInvoices.packageId, fx.pkg.id));
    expect(manifest.invoiceNumber).toBe(invoice.invoiceNumber);
    const [invoicePdf] = (await vaultOf(fx.pkg.id, "TAX_INVOICE")).filter((d) => d.id === invoice.vaultId);
    expect(manifest.files["01_Tax_Invoice.pdf"]).toBe(invoicePdf.fileHashSha256);
  });

  it("refuses to pack evidence whose bytes no longer match the vault hash", async () => {
    const fx = await deliveredWithEvidence();
    const verdict = await verifyEvidence(fx.jd14.id, { status: "VERIFIED", checks: { managerialSignature: true, companyStamp: true } }, ALEX);
    writeFileSync(path.resolve(process.cwd(), env().TPMS_STORAGE_DIR, fx.jd14.filePath), "tampered after verification");
    const result = await runQueued(claimsHandlers, "claims.collate", { packageId: fx.pkg.id }, verdict.recollateTaskId!);
    expect(result.ready).toBe(false);
    const checklist = result.checklist as { missing: string[]; items: Array<{ code: string; detail: string }> };
    expect(checklist.missing).toEqual(["EVIDENCE_INTEGRITY"]);
    expect(checklist.items.find((i) => i.code === "EVIDENCE_INTEGRITY")?.detail).toMatch(/no longer match/);
    expect(await stageOf(fx.pkg.id)).toBe("CLAIM_NOT_READY");
    expect(await vaultOf(fx.pkg.id, "CLAIM_PACK")).toHaveLength(0);
  });

  it("reopens a CLAIM_READY claim when verified evidence is flagged", async () => {
    const fx = await readyPackage();
    const [photo] = await vaultOf(fx.pkg.id, "PHOTO_EVIDENCE");
    await expect(verifyEvidence(photo.id, { status: "FLAGGED" }, ALEX)).rejects.toMatchObject({ code: "NOTES_REQUIRED" });
    const verdict = await verifyEvidence(photo.id, { status: "FLAGGED", notes: "EXIF date does not match the training day" }, ALEX);
    expect(verdict).toMatchObject({ reopened: true, financialStage: "CLAIM_NOT_READY" });
    const [decision] = await db()
      .select()
      .from(schema.decisions)
      .where(and(eq(schema.decisions.gate, "GATE3_CLAIM_REVIEW"), eq(schema.decisions.packageId, fx.pkg.id)));
    expect(decision).toMatchObject({ status: "RESOLVED", chosenOption: "REOPEN", resolvedBy: ALEX.id });

    const result = await runQueued(claimsHandlers, "claims.collate", { packageId: fx.pkg.id });
    expect(result.ready).toBe(false);
    expect((result.checklist as { missing: string[] }).missing).toEqual(["PHOTOS"]);
  });
});

describe("Gate 3 through remittance", () => {
  it("refuses to approve a stale pack, and reopens the claim when an operator re-drafts a changed invoice", async () => {
    const fx = await readyPackage();
    await updatePackageFields(fx.pkg.id, { deliveryMode: "PUBLIC_PHYSICAL" }, ALEX, "TEST_FIXTURE_PUBLIC_PROGRAMME");
    // The invoice changes underneath the compiled pack on a path that skips the operator re-draft:
    expect((await draft(fx.pkg.id)).invoice.total).toBe("4800.00");
    await expect(approveClaimPack(fx.pkg.id, { submissionRef: "CLM-2026-0002" }, ALEX)).rejects.toMatchObject({ code: "CLAIM_PACK_STALE" });

    await setAttendance(fx.participantIds[0], 10);
    const redraft = await redraftTaxInvoice(fx.pkg.id, ALEX);
    expect(redraft).toMatchObject({ reopened: true, changed: true });
    expect(redraft.invoice.total).toBe("4000.00");
    expect(await stageOf(fx.pkg.id)).toBe("CLAIM_NOT_READY");
    const recollated = await runQueued(claimsHandlers, "claims.collate", { packageId: fx.pkg.id });
    expect(recollated.ready).toBe(true);
    const approved = await approveClaimPack(fx.pkg.id, { submissionRef: "CLM-2026-0002" }, ALEX);
    expect(approved.pkg.financialStage).toBe("CLAIM_SUBMITTED");
  });

  it("approves the pack, locks the invoice, handles a query, and remits into PV drafting", async () => {
    const fx = await readyPackage();
    const id = fx.pkg.id;
    await expect(approveClaimPack(id, { submissionRef: "x" }, ALEX)).rejects.toMatchObject({ code: "SUBMISSION_REF_MISSING" });
    await expect(approveClaimPack(id, { submissionRef: "CLM-2026-0001" }, { type: "SYSTEM", id: "sys_daemon" })).rejects.toMatchObject({
      code: "OPERATOR_REQUIRED",
    });

    const approved = await approveClaimPack(id, { submissionRef: "CLM-2026-0001" }, ALEX);
    expect(approved.pkg).toMatchObject({ financialStage: "CLAIM_SUBMITTED", claimSubmissionRef: "CLM-2026-0001" });
    const [pack] = await vaultOf(id, "CLAIM_PACK");
    expect(pack).toMatchObject({ verificationStatus: "VERIFIED", verifiedBy: ALEX.id });
    const [review] = await db().select().from(schema.decisions).where(and(eq(schema.decisions.gate, "GATE3_CLAIM_REVIEW"), eq(schema.decisions.packageId, id)));
    expect(review).toMatchObject({ status: "APPROVED", chosenOption: "APPROVE", resolvedBy: ALEX.id });
    const [ledger] = await db().select().from(schema.jobFinancialLedgers).where(eq(schema.jobFinancialLedgers.packageId, id));
    expect(ledger.claimSubmittedAt).toBeInstanceOf(Date);
    expect(ledger.taxInvoiceNumber).toMatch(/^INV-/);
    expect(ledger.reconciledAt).toBeNull();

    await expect(draft(id)).rejects.toMatchObject({ code: "INVOICE_LOCKED" });

    expect((await recordQuery(id, "Participant 3 attendance unclear on day 2", ALEX)).pkg.financialStage).toBe("QUERIED");
    await expect(draft(id)).rejects.toMatchObject({ code: "INVOICE_LOCKED" });
    expect((await resubmitAfterQuery(id, "Countersigned T3 page re-uploaded to e-TRiS", ALEX)).pkg.financialStage).toBe("CLAIM_SUBMITTED");

    const over = await recordHrdcApproval(id, "17000.00", ALEX).catch((e) => e);
    expect(over.code).toBe("GUARD_FAILED");
    expect(over.details.failures.map((f: { code: string }) => f.code)).toContain("APPROVED_EXCEEDS_INVOICE");
    await expect(recordHrdcApproval(id, "16000.001", ALEX)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect((await recordHrdcApproval(id, "16000.00", ALEX)).pkg.hrdcApprovedAmount).toBe("16000.00");

    await expect(
      recordRemittance(id, { amount: "16000.00", reference: "HRDC-RMT-9001", adviceBytes: new Uint8Array(), mime: "application/pdf", fileName: "advice.pdf" }, ALEX),
    ).rejects.toMatchObject({ code: "REMITTANCE_ADVICE_MISSING" });
    const { outcome, advice } = await recordRemittance(
      id,
      { amount: "16000.00", reference: "HRDC-RMT-9001", adviceBytes: pdfBytes("advice"), mime: "application/pdf", fileName: "advice.pdf" },
      ALEX,
    );
    expect(outcome.pkg).toMatchObject({ financialStage: "REMITTED", remittanceAmount: "16000.00", remittanceReference: "HRDC-RMT-9001" });
    expect(advice.documentType).toBe("REMITTANCE_ADVICE");
    const pvTask = await queuedTask("finance.draft_payment_vouchers", { packageId: id });
    expect(pvTask?.idempotencyKey).toBe(`pv:${id}`);
  });
});
