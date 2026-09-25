import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { formatDate, formatRange, todayMY } from "@/lib/dates";
import { formatRM, fromSen, toSen, type Sen } from "@/lib/money";
import { finishAgentRun, runTier, startAgentRun, type Provenance } from "../ai";
import { type Actor, type Executor, type Tx, db, rows, schema, withTx } from "../db/client";
import type { PvAdjustment, TrainingPackage, VaultDocument } from "../db/schema";
import { raiseDecision, resolvePendingFor } from "../decisions/service";
import { DomainError } from "../domain/errors";
import { assertFinStage } from "../domain/stages";
import { PDF_MIME, PdfBuilder } from "../documents/pdf";
import { transitionInTx, type TransitionOutcome } from "../fsm/service";
import { loadSnapshotFor, type PackageSnapshot, type PaymentVoucher } from "../packages/snapshot";
import {
  amountText,
  applyRate,
  assertUpload,
  assertUuid,
  errorMessage,
  financeConfig,
  lockPackage,
  parseAmount,
  requireOperator,
  runStatus,
  storeOnce,
} from "./common";
import { writeSettlementLedger, type JobLedger } from "./ledger";

/**
 * Accounts payable under pay-when-paid.
 *
 *   REMITTED --(coupling)--> finance.draft_payment_vouchers   agent drafts PVs, raises GATE3_AP_DISBURSEMENT
 *   adjustVoucher        operator sets mileage / WHT / allowances -> APPROVED (PDF regenerated)
 *   markVoucherPaid      operator records bank reference + receipt -> PAID
 *   settlePackage        every live PV PAID -> REMITTED -> SETTLED_CLOSED, ledger reconciled
 *
 * Nothing is paid before HRD Corp remits: the database refuses it
 * (`pv_guard`, PAY_WHEN_PAID) and so does this module, first, with the same
 * code. A PAID voucher always carries a bank reference and a receipt (check
 * constraint `pv_paid_requires_evidence`) and is final (PV_PAID_IS_FINAL).
 */
export const PV_DRAFTER: Actor = { type: "AGENT", id: "finance.pv_drafter" };

export const ADJUSTMENT_KINDS = ["MILEAGE", "WITHHOLDING_TAX", "ALLOWANCE", "DEDUCTION", "OTHER"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** Direction each adjustment may move the payable. R14: an unknown kind is refused. */
const ADJUSTMENT_SIGN: Record<AdjustmentKind, "ADD" | "SUBTRACT" | "EITHER"> = {
  MILEAGE: "ADD",
  ALLOWANCE: "ADD",
  WITHHOLDING_TAX: "SUBTRACT",
  DEDUCTION: "SUBTRACT",
  OTHER: "EITHER",
};

export const PV_STATUSES = ["DRAFT", "APPROVED", "PAID", "CANCELLED"] as const;
export type PvStatus = (typeof PV_STATUSES)[number];

const PAYEE_LABEL: Record<string, string> = {
  TRAINER: "Trainer fee",
  VENUE: "Venue",
  CATERING: "Catering",
  PRINTING: "Printing and materials",
  COMMISSION: "Sales commission",
};

function payeeLabel(type: string): string {
  const label = PAYEE_LABEL[type];
  if (!label) throw new Error(`Unknown payee type: ${type}`);
  return label;
}

// ---------------------------------------------------------------- planning

export type VoucherPlan = {
  payeeType: "TRAINER" | "VENUE" | "CATERING" | "PRINTING" | "COMMISSION";
  payeeName: string;
  engagementId: string | null;
  commitmentId: string | null;
  agreedSen: Sen;
  /** One line explaining the amount, printed on the PV. */
  basis: string;
};

const VENDOR_PAYEE: Record<string, VoucherPlan["payeeType"]> = { VENUE: "VENUE", CATERING: "CATERING", PRINTING: "PRINTING" };

/**
 * What the provider owes for this delivery, derived from the operational
 * record (never from a model): the CONFIRMED trainer engagement at day rate x
 * days, every non-cancelled vendor commitment at its cost, and an optional
 * sales commission on the HRD Corp approved amount (`TPMS_COMMISSION_RATE`,
 * default 0 = no commission voucher).
 */
export function planVouchers(
  s: PackageSnapshot,
  vendorNames: Map<string, string>,
  commission: { rateE4: number; payeeName: string },
): { plans: VoucherPlan[]; warnings: string[] } {
  const plans: VoucherPlan[] = [];
  const warnings: string[] = [];
  const days = s.pkg.durationDays ?? 0;
  const e = s.engagement;
  if (e && e.status === "CONFIRMED") {
    plans.push({
      payeeType: "TRAINER",
      payeeName: e.trainer.fullName,
      engagementId: e.id,
      commitmentId: null,
      agreedSen: toSen(e.dayRate) * days,
      basis: `${days} day(s) x ${formatRM(e.dayRate)} day rate`,
    });
  } else {
    warnings.push(e ? `Trainer engagement is ${e.status}, not CONFIRMED; no trainer voucher drafted` : "No trainer engagement on this package");
  }
  for (const c of s.commitments) {
    if (c.status === "CANCELLED") continue;
    const payeeType = VENDOR_PAYEE[c.vendorType];
    if (!payeeType) throw new Error(`Unknown vendor type on commitment ${c.id}: ${c.vendorType}`);
    plans.push({
      payeeType,
      payeeName: (c.vendorId && vendorNames.get(c.vendorId)) || `${payeeLabel(payeeType)} vendor`,
      engagementId: null,
      commitmentId: c.id,
      agreedSen: toSen(c.cost),
      basis: `${payeeLabel(payeeType)} commitment${c.referenceNumber ? ` ${c.referenceNumber}` : ""} (${c.status})`,
    });
  }
  if (commission.rateE4 > 0) {
    const base = toSen(s.pkg.hrdcApprovedAmount);
    const amount = applyRate(base, commission.rateE4);
    if (amount > 0) {
      plans.push({
        payeeType: "COMMISSION",
        payeeName: commission.payeeName,
        engagementId: null,
        commitmentId: null,
        agreedSen: amount,
        basis: `${(commission.rateE4 / 100).toFixed(2)}% of the HRD Corp approved amount ${formatRM(fromSen(base))}`,
      });
    }
  }
  return { plans, warnings };
}

/** A plan is already covered by a live voucher for the same source. */
function covered(plan: VoucherPlan, existing: PaymentVoucher[]): PaymentVoucher | undefined {
  const live = existing.filter((v) => v.status !== "CANCELLED");
  if (plan.engagementId) return live.find((v) => v.engagementId === plan.engagementId);
  if (plan.commitmentId) return live.find((v) => v.commitmentId === plan.commitmentId);
  return live.find((v) => v.payeeType === plan.payeeType && !v.engagementId && !v.commitmentId);
}

// ---------------------------------------------------------------- PDF

export type VoucherPdfInput = {
  pvNumber: string;
  status: string;
  payeeType: string;
  payeeName: string;
  basis: string;
  remarks: string;
  agreedSen: Sen;
  adjustments: PvAdjustment[];
  finalSen: Sen;
  pkg: Pick<TrainingPackage, "packageCode" | "title" | "startDate" | "endDate" | "etrisGrantId" | "remittanceReference" | "remittedAt">;
  preparedBy: string;
  approvedBy: string | null;
  issueDate: string;
};

/** "Mileage KL - PJ (mileage)"; the kind is not repeated when the label already names it. */
function adjustmentLine(a: PvAdjustment): string {
  const kind = a.kind.replace(/_/g, " ").toLowerCase();
  return a.label.toLowerCase().includes(kind) ? a.label : `${a.label} (${kind})`;
}

export async function renderVoucherPdf(d: VoucherPdfInput): Promise<Uint8Array> {
  const b = await PdfBuilder.create({ title: "Payment Voucher", reference: d.pvNumber });
  b.letterhead(`${payeeLabel(d.payeeType)} · ${d.status}`);
  b.keyValues([
    ["Payee", d.payeeName],
    ["Payee type", payeeLabel(d.payeeType)],
    ["Package", `${d.pkg.packageCode} · ${d.pkg.title}`],
    ["Training dates", formatRange(d.pkg.startDate, d.pkg.endDate)],
    ["e-TRiS grant", d.pkg.etrisGrantId ?? "-"],
    ["HRD Corp remittance", d.pkg.remittanceReference ? `${d.pkg.remittanceReference} · ${formatDate(d.pkg.remittedAt ?? null)}` : "Not yet remitted"],
    ["Voucher date", formatDate(d.issueDate)],
  ]);
  b.heading("Particulars");
  b.table(
    [
      { label: "Item", width: 7 },
      { label: "Amount (RM)", width: 2, align: "right" },
    ],
    [
      [`Agreed amount — ${d.basis}`, amountText(d.agreedSen)],
      ...d.adjustments.map((a) => [adjustmentLine(a), amountText(toSen(a.amount))]),
      ["Net payable", amountText(d.finalSen)],
    ],
    { boldLastRow: true },
  );
  if (d.remarks) {
    b.caption("REMARKS");
    b.text(d.remarks, { size: 9, color: "secondary" });
  }
  b.caption("PAY-WHEN-PAID");
  b.text("Disbursement is released only after HRD Corp has remitted the claim for this package.", { size: 9, color: "secondary" });
  b.spacer(18);
  b.keyValues([
    ["Prepared by", d.preparedBy],
    ["Approved by", d.approvedBy ?? "________________________"],
    ["Received by (payee)", "________________________"],
  ]);
  return b.save({ footer: d.pkg.packageCode });
}

// ---------------------------------------------------------------- drafting (task)

const Remarks = z.object({ remarks: z.string().min(1).max(600) });

async function voucherRemarks(pkg: TrainingPackage, plan: VoucherPlan): Promise<{ remarks: string; provenance: Provenance }> {
  const template = `${payeeLabel(plan.payeeType)} for ${pkg.title} (${formatRange(pkg.startDate, pkg.endDate)}), package ${pkg.packageCode}: ${plan.basis}.`;
  const { output, provenance } = await runTier({
    tier: "L3",
    agent: PV_DRAFTER.id,
    packageId: pkg.id,
    system: "You draft the one-sentence remarks line of a payment voucher for a Malaysian training provider. State what the payment is for. Do not state any amount that is not in the facts.",
    prompt: JSON.stringify({ payeeType: plan.payeeType, payee: plan.payeeName, basis: plan.basis, programme: pkg.title, package: pkg.packageCode }),
    json: { schema: Remarks },
    maxTokens: 200,
    template: () => ({ remarks: template }),
  });
  // The PV is a payment instruction: a model line that loses the package reference is replaced, not trusted.
  return { remarks: output.remarks.includes(pkg.packageCode) ? output.remarks : template, provenance };
}

async function nextPvNumber(executor: Executor, today: string): Promise<string> {
  const [row] = await rows<{ n: number }>(executor, sql`select nextval('tpms.pv_number_seq')::int as n`);
  return `PV-${today.slice(0, 4)}-${String(row.n).padStart(5, "0")}`;
}

async function commissionPayee(executor: Executor, pkg: TrainingPackage): Promise<string> {
  if (!pkg.createdBy) return "Sales representative (unassigned)";
  const [op] = await executor.select().from(schema.operators).where(eq(schema.operators.id, pkg.createdBy));
  return op?.fullName ?? "Sales representative (unassigned)";
}

export type DraftVouchersResult = {
  packageId: string;
  packageCode: string;
  skipped?: string;
  created: Array<{ id: string; pvNumber: string; payeeType: string; payeeName: string; amount: string }>;
  existing: number;
  warnings: string[];
  decisionId?: string;
};

async function draftInTx(tx: Tx, packageId: string): Promise<{ result: DraftVouchersResult; provenance?: Provenance }> {
  const pkg = await lockPackage(tx, packageId);
  const stage = assertFinStage(pkg.financialStage);
  const base = { packageId, packageCode: pkg.packageCode, created: [], existing: 0, warnings: [] };
  if (stage !== "REMITTED") return { result: { ...base, skipped: `financial stage is ${stage}; vouchers are drafted at REMITTED` } };

  const today = todayMY();
  const snapshot = await loadSnapshotFor(tx, pkg, today);
  const vendorIds = snapshot.commitments.map((c) => c.vendorId).filter((id): id is string => Boolean(id));
  const vendorNames = new Map<string, string>();
  for (const id of vendorIds) {
    const [v] = await tx.select({ id: schema.vendors.id, name: schema.vendors.name }).from(schema.vendors).where(eq(schema.vendors.id, id));
    if (v) vendorNames.set(v.id, v.name);
  }
  const cfg = financeConfig();
  const { plans, warnings } = planVouchers(snapshot, vendorNames, { rateE4: cfg.commissionRateE4, payeeName: await commissionPayee(tx, pkg) });

  const created: DraftVouchersResult["created"] = [];
  let provenance: Provenance | undefined;
  let existing = 0;
  for (const plan of plans) {
    if (covered(plan, snapshot.vouchers)) {
      existing += 1;
      continue;
    }
    const pvNumber = await nextPvNumber(tx, today);
    const remarks = await voucherRemarks(pkg, plan);
    provenance = remarks.provenance;
    const pdf = await renderVoucherPdf({
      pvNumber,
      status: "DRAFT",
      payeeType: plan.payeeType,
      payeeName: plan.payeeName,
      basis: plan.basis,
      remarks: remarks.remarks,
      agreedSen: plan.agreedSen,
      adjustments: [],
      finalSen: plan.agreedSen,
      pkg,
      preparedBy: `${PV_DRAFTER.id} (agent draft)`,
      approvedBy: null,
      issueDate: today,
    });
    const doc = await storeOnce(tx, {
      packageId,
      documentType: "PV",
      fileName: `${pvNumber}.pdf`,
      mimeType: PDF_MIME,
      bytes: pdf,
      uploadedBy: PV_DRAFTER.id,
      extractedMetadata: { pvNumber, basis: plan.basis, remarks: remarks.remarks, status: "DRAFT" },
    });
    const [pv] = await tx
      .insert(schema.paymentVouchers)
      .values({
        packageId,
        pvNumber,
        payeeType: plan.payeeType,
        payeeName: plan.payeeName,
        engagementId: plan.engagementId,
        commitmentId: plan.commitmentId,
        agreedAmount: fromSen(plan.agreedSen),
        adjustments: [],
        finalAmount: fromSen(plan.agreedSen),
        status: "DRAFT",
        vaultId: doc.id,
      })
      .returning();
    created.push({ id: pv.id, pvNumber, payeeType: plan.payeeType, payeeName: plan.payeeName, amount: pv.finalAmount });
  }

  const vouchers = await tx.select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.packageId, packageId));
  const live = vouchers.filter((v) => v.status !== "CANCELLED");
  const total = live.reduce((acc, v) => acc + toSen(v.finalAmount), 0);
  const decision = await raiseDecision(tx, {
    gate: "GATE3_AP_DISBURSEMENT",
    packageId,
    subjectRef: pkg.packageCode,
    title: `Disburse payables · ${pkg.packageCode}`,
    summary:
      `HRD Corp remitted ${formatRM(pkg.remittanceAmount)} (${pkg.remittanceReference}). ` +
      `${live.length} voucher(s) totalling ${formatRM(fromSen(total))}: ` +
      live.map((v) => `${v.pvNumber} ${v.payeeName} ${formatRM(v.finalAmount)} [${v.status}]`).join("; ") +
      (warnings.length ? `. Note: ${warnings.join("; ")}` : ""),
    payload: {
      vouchers: live.map((v) => ({ id: v.id, pvNumber: v.pvNumber, payeeType: v.payeeType, payeeName: v.payeeName, amount: v.finalAmount, status: v.status })),
      total: fromSen(total),
      remittanceAmount: pkg.remittanceAmount,
      warnings,
    },
    options: [
      { id: "SETTLE", label: "Settle package", description: "Every voucher paid with a bank reference and receipt; close the package financially" },
    ],
    raisedBy: PV_DRAFTER.id,
    raisedByTier: "L3",
    slaHours: 72,
  });
  return { result: { ...base, created, existing, warnings, decisionId: decision.id }, provenance };
}

/** Body of the `finance.draft_payment_vouchers` task. Idempotent: one live voucher per source. */
export async function draftPaymentVouchers(packageId: string, opts: { taskId?: string | null } = {}): Promise<DraftVouchersResult> {
  assertUuid(packageId, "packageId");
  const runId = await startAgentRun(db(), {
    agent: PV_DRAFTER.id,
    tier: "L3",
    packageId,
    taskId: opts.taskId ?? null,
    inputSummary: `Draft pay-when-paid payment vouchers for ${packageId}`,
  });
  try {
    const { result, provenance } = await withTx(PV_DRAFTER, { reasonCode: "PV_DRAFTING" }, (tx) => draftInTx(tx, packageId));
    await finishAgentRun(db(), runId, {
      status: runStatus(provenance?.mode),
      output: result,
      provenance: provenance ?? { tier: "L0", agent: PV_DRAFTER.id, mode: "RULE" },
      costMyr: provenance?.costMyr ?? 0,
    });
    return result;
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: errorMessage(error) });
    throw error;
  }
}

// ---------------------------------------------------------------- operator actions

async function lockVoucher(tx: Tx, pvId: string): Promise<PaymentVoucher> {
  assertUuid(pvId, "pvId");
  const locked = await tx.execute(sql`select id from tpms.payment_vouchers where id = ${pvId}::uuid for update`);
  if (locked.rows.length === 0) throw new DomainError("PV_NOT_FOUND", `Payment voucher ${pvId} not found`);
  const [pv] = await tx.select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.id, pvId));
  return pv;
}

function assertOpenVoucher(pv: PaymentVoucher): void {
  const status = pv.status as PvStatus;
  if (!PV_STATUSES.includes(status)) throw new Error(`Unknown voucher status on ${pv.pvNumber}: ${pv.status}`);
  if (status === "PAID") throw new DomainError("PV_PAID_IS_FINAL", `${pv.pvNumber} is already paid`);
  if (status === "CANCELLED") throw new DomainError("PV_CANCELLED", `${pv.pvNumber} is cancelled`);
}

export type AdjustmentInput = { kind: string; label: string; amount: number | string };

export function normaliseAdjustments(input: AdjustmentInput[]): { adjustments: PvAdjustment[]; totalSen: Sen } {
  if (!Array.isArray(input)) throw new DomainError("INVALID_ADJUSTMENT", "Adjustments must be a list");
  let totalSen = 0;
  const adjustments = input.map((a, i) => {
    const kind = a.kind as AdjustmentKind;
    const sign = ADJUSTMENT_SIGN[kind];
    if (!sign) throw new DomainError("INVALID_ADJUSTMENT", `Adjustment ${i + 1}: unknown kind ${String(a.kind)}`);
    const label = (a.label ?? "").trim();
    if (label.length < 2 || label.length > 120) throw new DomainError("INVALID_ADJUSTMENT", `Adjustment ${i + 1}: a label is required`);
    const sen = parseAmount(a.amount, `Adjustment ${i + 1} amount`, { allowNegative: true });
    if (sign === "ADD" && sen < 0) throw new DomainError("INVALID_ADJUSTMENT", `${kind.replace(/_/g, " ").toLowerCase()} adds to the payable; enter a positive amount`);
    if (sign === "SUBTRACT" && sen > 0) {
      throw new DomainError(kind === "WITHHOLDING_TAX" ? "WHT_MUST_BE_NEGATIVE" : "INVALID_ADJUSTMENT", `${kind.replace(/_/g, " ").toLowerCase()} reduces the payable; enter a negative amount`);
    }
    totalSen += sen;
    return { kind, label, amount: sen / 100 };
  });
  return { adjustments, totalSen };
}

async function priorRemarks(tx: Tx, pv: PaymentVoucher): Promise<{ basis: string; remarks: string }> {
  if (!pv.vaultId) return { basis: payeeLabel(pv.payeeType), remarks: "" };
  const [doc] = await tx.select().from(schema.complianceVault).where(eq(schema.complianceVault.id, pv.vaultId));
  const meta = (doc?.extractedMetadata ?? {}) as { basis?: string; remarks?: string };
  return { basis: meta.basis ?? payeeLabel(pv.payeeType), remarks: meta.remarks ?? "" };
}

/**
 * Set a voucher's adjustments and approve it. `adjustments` REPLACES the
 * voucher's list (the UI edits the whole list; an empty list approves the
 * agreed amount as-is). Final = agreed + sum(adjustments); withholding tax and
 * deductions are negative. The PV PDF is regenerated as APPROVED.
 */
export async function adjustVoucher(pvId: string, input: AdjustmentInput[], actor: Actor): Promise<PaymentVoucher> {
  requireOperator(actor, "Approving a payment voucher");
  const { adjustments, totalSen } = normaliseAdjustments(input);
  return withTx(actor, { reasonCode: "PV_APPROVED" }, async (tx) => {
    const pv = await lockVoucher(tx, pvId);
    assertOpenVoucher(pv);
    const finalSen = toSen(pv.agreedAmount) + totalSen;
    if (finalSen < 0) throw new DomainError("PV_NEGATIVE", `Adjustments take ${pv.pvNumber} below zero`);
    const [pkg] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, pv.packageId));
    const { basis, remarks } = await priorRemarks(tx, pv);
    const today = todayMY();
    const pdf = await renderVoucherPdf({
      pvNumber: pv.pvNumber,
      status: "APPROVED",
      payeeType: pv.payeeType,
      payeeName: pv.payeeName,
      basis,
      remarks,
      agreedSen: toSen(pv.agreedAmount),
      adjustments,
      finalSen,
      pkg,
      preparedBy: `${PV_DRAFTER.id} (agent draft)`,
      approvedBy: actor.id,
      issueDate: today,
    });
    const doc = await storeOnce(tx, {
      packageId: pv.packageId,
      documentType: "PV",
      fileName: `${pv.pvNumber}.pdf`,
      mimeType: PDF_MIME,
      bytes: pdf,
      uploadedBy: actor.id,
      extractedMetadata: { pvNumber: pv.pvNumber, basis, remarks, status: "APPROVED", final: fromSen(finalSen) },
    });
    const [updated] = await tx
      .update(schema.paymentVouchers)
      .set({ adjustments, finalAmount: fromSen(finalSen), status: "APPROVED", approvedBy: actor.id, vaultId: doc.id })
      .where(eq(schema.paymentVouchers.id, pv.id))
      .returning();
    return updated;
  });
}

export type PaymentInput = { bankReference: string; receiptBytes: Uint8Array; mime: string; fileName: string };

const PAYABLE_STAGES = new Set(["REMITTED", "SETTLED_CLOSED"]);

/**
 * Record a disbursement. Checked here first so the operator gets a clean
 * refusal before any bytes are written, and again by the database
 * (`pv_guard`, `pv_paid_requires_evidence`) so no other path can pay early
 * or without evidence.
 */
export async function markVoucherPaid(pvId: string, input: PaymentInput, actor: Actor): Promise<PaymentVoucher> {
  requireOperator(actor, "Recording a payment");
  const bankReference = (input.bankReference ?? "").trim();
  if (bankReference.length < 4 || bankReference.length > 100) {
    throw new DomainError("BANK_REFERENCE_REQUIRED", "A bank reference (4 to 100 characters) is required to mark a voucher paid");
  }
  assertUpload(input.receiptBytes, input.mime, "RECEIPT_REQUIRED", "The payment receipt");
  return withTx(actor, { reasonCode: "PV_PAID" }, async (tx) => {
    const pv = await lockVoucher(tx, pvId);
    const [pkg] = await tx
      .select({ stage: schema.trainingPackages.financialStage, code: schema.trainingPackages.packageCode })
      .from(schema.trainingPackages)
      .where(eq(schema.trainingPackages.id, pv.packageId));
    if (!PAYABLE_STAGES.has(pkg.stage)) {
      throw new DomainError("PAY_WHEN_PAID", `${pkg.code} is ${pkg.stage}; nothing is disbursed until HRD Corp remits (REMITTED)`);
    }
    assertOpenVoucher(pv);
    if (pv.status !== "APPROVED") throw new DomainError("PV_NOT_APPROVED", `${pv.pvNumber} must be approved before it is paid`);
    const receipt: VaultDocument = await storeOnce(tx, {
      packageId: pv.packageId,
      documentType: "PAYMENT_RECEIPT",
      fileName: input.fileName || `${pv.pvNumber}-receipt`,
      mimeType: input.mime,
      bytes: input.receiptBytes,
      uploadedBy: actor.id,
      verificationStatus: "VERIFIED",
      verifiedBy: actor.id,
      verificationNotes: `${pv.pvNumber} paid, bank reference ${bankReference}`,
      extractedMetadata: { pvNumber: pv.pvNumber, bankReference },
    });
    const [paid] = await tx
      .update(schema.paymentVouchers)
      .set({ status: "PAID", bankReference, receiptVaultId: receipt.id, paidBy: actor.id, paidAt: new Date() })
      .where(eq(schema.paymentVouchers.id, pv.id))
      .returning();
    return paid;
  });
}

export type SettlementResult = { outcome: TransitionOutcome; ledger: JobLedger };

/**
 * Gate 3 AP: close the package. The AP_DISBURSEMENT_CONFIRMED guard refuses
 * while any live voucher is unpaid or lacks evidence (GUARD_FAILED with
 * VOUCHERS_UNPAID / PAYMENT_EVIDENCE_MISSING). On success the ledger is
 * rewritten with actuals and reconciled, and the AP decision resolved.
 */
export async function settlePackage(packageId: string, actor: Actor): Promise<SettlementResult> {
  requireOperator(actor, "Settling a package");
  assertUuid(packageId, "packageId");
  return withTx(actor, { reasonCode: "AP_DISBURSEMENT_CONFIRMED" }, async (tx) => {
    const outcome = await transitionInTx(tx, {
      packageId,
      machine: "FINANCIAL",
      to: "SETTLED_CLOSED",
      reason: "AP_DISBURSEMENT_CONFIRMED",
      actor,
      details: "Every payment voucher paid with bank reference and receipt",
    });
    const vouchers = await tx.select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.packageId, packageId));
    const [invoice] = await tx.select().from(schema.taxInvoices).where(eq(schema.taxInvoices.packageId, packageId));
    const ledger = await writeSettlementLedger(tx, outcome.pkg, vouchers, invoice?.invoiceNumber ?? null);
    await resolvePendingFor(tx, "GATE3_AP_DISBURSEMENT", outcome.pkg.packageCode, {
      status: "APPROVED",
      by: actor.id,
      chosenOption: "SETTLE",
      note: `Settled; gross margin RM ${ledger.grossMargin}`,
    });
    return { outcome, ledger };
  });
}

export type VoucherRow = PaymentVoucher & { packageCode: string; packageTitle: string; financialStage: string };

/** The Payables desk list. */
export async function listVouchers(opts: { packageId?: string; status?: string } = {}): Promise<VoucherRow[]> {
  if (opts.packageId) assertUuid(opts.packageId, "packageId");
  if (opts.status && !(PV_STATUSES as readonly string[]).includes(opts.status)) {
    throw new DomainError("UNKNOWN_STATUS", `Unknown voucher status: ${opts.status}`);
  }
  const where: SQL[] = [];
  if (opts.packageId) where.push(eq(schema.paymentVouchers.packageId, opts.packageId));
  if (opts.status) where.push(eq(schema.paymentVouchers.status, opts.status));
  const result = await db()
    .select({
      voucher: schema.paymentVouchers,
      packageCode: schema.trainingPackages.packageCode,
      packageTitle: schema.trainingPackages.title,
      financialStage: schema.trainingPackages.financialStage,
    })
    .from(schema.paymentVouchers)
    .innerJoin(schema.trainingPackages, eq(schema.trainingPackages.id, schema.paymentVouchers.packageId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.paymentVouchers.createdAt));
  return result.map((r) => ({ ...r.voucher, packageCode: r.packageCode, packageTitle: r.packageTitle, financialStage: r.financialStage }));
}
