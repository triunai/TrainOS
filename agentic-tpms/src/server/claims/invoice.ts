import { eq, sql } from "drizzle-orm";
import { formatDate, formatRange, todayMY } from "@/lib/dates";
import { formatRM, fromSen, toSen, type Sen } from "@/lib/money";
import { recordAudit } from "../audit/ledger";
import { type Executor, rows, schema } from "../db/client";
import type { VaultDocument } from "../db/schema";
import { DomainError } from "../domain/errors";
import { assertFinStage, DELIVERY_MODE_LABEL, type DeliveryMode, type FinStage } from "../domain/stages";
import { PDF_MIME, PdfBuilder } from "../documents/pdf";
import { claimableSen } from "../fsm/guards";
import { loadSnapshotFor, type PackageSnapshot, type TaxInvoice } from "../packages/snapshot";
import { amountText, canonicalJson, financeConfig, lockPackage, storeOnce } from "../finance/common";

/**
 * The HRD Corp tax invoice for the SBL-Khas (balance) claim.
 *
 * Design note — invoice total = claimable amount. The invoice bills HRD Corp
 * for exactly what the delivery made claimable (`claimableSen`: a per-group
 * programme claims the approved grant once one participant is eligible; a
 * per-pax programme is pro-rated to eligible participants up to the approved
 * headcount). An optional 30% upfront advance is NOT deducted here: HRD Corp
 * reconciles it at remittance (remittance + upfront = HRD Corp approved), so
 * the PDF shows it as an informational note only.
 *
 * SST — `TPMS_SST_RATE`, a fraction, default 0. Whether and how SST applies
 * to HRD Corp-funded training services must be confirmed by the provider's
 * tax adviser before a non-zero rate is configured. A configured rate is
 * applied tax-INCLUSIVE: HRD Corp never pays more than the claimable grant, so
 * SST is carved out of the total (subtotal = total / (1 + rate)) rather than
 * added on top. That keeps the L0 guard's invariant (invoice total =
 * claimable) true at any rate.
 *
 * Every field is deterministic. A tax invoice is a legal document, so no model
 * writes any part of it; the L3 collator only writes reviewer notes.
 */
export const HRD_CORP_BILLED_TO = "Pembangunan Sumber Manusia Berhad (HRD Corp)";

type InvoiceStagePolicy = "NOT_YET" | "OPEN" | "LOCKED" | "VOID";

/** R14: every financial stage has an explicit invoice policy. */
const INVOICE_POLICY: Record<FinStage, InvoiceStagePolicy> = {
  ESTIMATE: "NOT_YET",
  GRANT_RESERVED: "NOT_YET",
  UPFRONT_CLAIM_SUBMITTED: "NOT_YET",
  CLAIM_NOT_READY: "OPEN",
  CLAIM_READY: "OPEN",
  CLAIM_SUBMITTED: "LOCKED",
  QUERIED: "LOCKED",
  APPROVED: "LOCKED",
  REMITTED: "LOCKED",
  SETTLED_CLOSED: "LOCKED",
  VOIDED: "VOID",
};

export interface InvoiceLine {
  description: string;
  basis: "PER_GROUP" | "PER_PAX";
  quantity: number;
  unit: "programme" | "participant";
  /** Gross claimable per unit (before any tax-inclusive SST split). */
  unitAmount: string;
  /** Net of SST; equals the invoice subtotal. */
  amount: string;
  eligibleParticipants: number;
  approvedParticipants: number | null;
}

export type InvoiceDraft = {
  invoice: TaxInvoice;
  vaultDoc: VaultDocument;
  /** False when an identical invoice already existed and nothing was rewritten. */
  changed: boolean;
  created: boolean;
  claimableSen: Sen;
  subtotalSen: Sen;
  taxSen: Sen;
  totalSen: Sen;
};

export function deliveryLabel(mode: string): string {
  const label = (DELIVERY_MODE_LABEL as Record<string, string | undefined>)[mode];
  if (!label) throw new Error(`Unknown delivery mode: ${mode}`);
  return label;
}

/** Tax-inclusive split of a gross amount at `rateE4` (1e-4 units). */
export function splitInclusive(gross: Sen, rateE4: number): { subtotal: Sen; tax: Sen } {
  if (rateE4 === 0) return { subtotal: gross, tax: 0 };
  const subtotal = Math.round((gross * 10_000) / (10_000 + rateE4));
  return { subtotal, tax: gross - subtotal };
}

export function invoiceLine(s: PackageSnapshot, subtotal: Sen): InvoiceLine {
  const mode = s.pkg.deliveryMode as DeliveryMode;
  deliveryLabel(mode);
  const perPax = mode === "PUBLIC_PHYSICAL";
  const grant = toSen(s.pkg.grantApprovedAmount);
  const approvedPax = s.pkg.grantApprovedPax ?? null;
  const billable = perPax ? Math.min(s.participants.eligible, approvedPax ?? s.participants.active) : 1;
  const unitAmount = perPax ? Math.round(grant / Math.max(1, approvedPax ?? s.participants.active)) : claimableSen(s);
  return {
    description: `Training fee — ${s.pkg.title} (${formatRange(s.pkg.startDate, s.pkg.endDate)}) · SBL-Khas grant ${s.pkg.etrisGrantId}`,
    basis: perPax ? "PER_PAX" : "PER_GROUP",
    quantity: billable,
    unit: perPax ? "participant" : "programme",
    unitAmount: fromSen(unitAmount),
    amount: fromSen(subtotal),
    eligibleParticipants: s.participants.eligible,
    approvedParticipants: approvedPax,
  };
}

type InvoiceFields = Pick<
  TaxInvoice,
  "subtotal" | "taxRate" | "taxAmount" | "total" | "grantReference" | "employerName" | "employerMycoid" | "lineItems"
>;

/** Everything the PDF prints except the issue date, normalised so a DB round trip compares equal. */
function invoiceFingerprint(f: InvoiceFields): string {
  return canonicalJson({
    subtotal: toSen(f.subtotal),
    taxRate: Number(f.taxRate),
    taxAmount: toSen(f.taxAmount),
    total: toSen(f.total),
    grantReference: f.grantReference,
    employerName: f.employerName,
    employerMycoid: f.employerMycoid ?? null,
    lineItems: f.lineItems,
  });
}

async function nextInvoiceNumber(executor: Executor, today: string): Promise<string> {
  const [row] = await rows<{ n: number }>(executor, sql`select nextval('tpms.invoice_number_seq')::int as n`);
  return `INV-${today.slice(0, 4)}-${String(row.n).padStart(5, "0")}`;
}

export interface InvoicePdfInput {
  invoiceNumber: string;
  issueDate: string;
  billedTo: string;
  employerName: string;
  employerMycoid: string | null;
  grantReference: string;
  packageCode: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  deliveryMode: string;
  line: InvoiceLine;
  subtotalSen: Sen;
  taxSen: Sen;
  totalSen: Sen;
  sstRateText: string;
  upfrontSen: Sen;
  upfrontClaimed: boolean;
}

export async function renderInvoicePdf(d: InvoicePdfInput): Promise<Uint8Array> {
  const b = await PdfBuilder.create({ title: "Tax Invoice", reference: d.invoiceNumber });
  b.letterhead(`Invoice date ${formatDate(d.issueDate)}`);
  b.caption("BILL TO");
  b.keyValues([
    ["Billed to", d.billedTo],
    ["On behalf of employer", d.employerName],
    ["Employer MyCoID", d.employerMycoid ?? "Not recorded"],
    ["e-TRiS grant reference", d.grantReference],
    ["Package", `${d.packageCode} · ${d.title}`],
    ["Training dates", formatRange(d.startDate, d.endDate)],
    ["Delivery", deliveryLabel(d.deliveryMode)],
  ]);
  b.heading("Particulars");
  const basis =
    d.line.basis === "PER_PAX"
      ? `${d.line.quantity} eligible participant(s) of ${d.line.approvedParticipants ?? "-"} approved x ${formatRM(d.line.unitAmount)}`
      : `Per-group programme; ${d.line.eligibleParticipants} participant(s) met the 80% attendance rule`;
  b.table(
    [
      { label: "Description", width: 6 },
      { label: "Qty", width: 1, align: "right" },
      { label: "Amount (RM)", width: 2, align: "right" },
    ],
    [[`${d.line.description}\n${basis}`, String(d.line.quantity), amountText(toSen(d.line.amount))]],
  );
  const pctText = `${(Number(d.sstRateText) * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  b.table(
    [
      { label: "", width: 7 },
      { label: "RM", width: 2, align: "right" },
    ],
    [
      ["Subtotal", amountText(d.subtotalSen)],
      [`SST (${pctText}${d.taxSen > 0 ? ", included in the claimable amount" : ""})`, amountText(d.taxSen)],
      ["Total payable by HRD Corp", amountText(d.totalSen)],
    ],
    { boldLastRow: true },
  );
  if (d.upfrontClaimed || d.upfrontSen > 0) {
    b.caption("INFORMATIONAL NOTE");
    b.text(
      `An upfront claim of ${formatRM(fromSen(d.upfrontSen))} (30% of the approved grant) has been received under this grant. ` +
        "It is not deducted from this invoice: HRD Corp reconciles the advance at remittance (remittance + upfront = approved claim).",
      { size: 9, color: "secondary" },
    );
  }
  b.spacer(10);
  b.text("This invoice is submitted with the SBL-Khas claim pack through e-TRiS.", { size: 8.5, color: "muted" });
  return b.save({ footer: d.packageCode });
}

/**
 * Draft (or re-draft) the package's tax invoice inside the caller's
 * transaction. One invoice per package (the table is unique on package_id):
 * before submission it is updated in place — same number, new amounts, a new
 * vault PDF — and after submission it is locked (INVOICE_LOCKED). A re-run
 * with nothing changed rewrites nothing.
 */
export async function draftTaxInvoice(
  executor: Executor,
  packageId: string,
  opts: { by?: string; today?: string } = {},
): Promise<InvoiceDraft> {
  const today = opts.today ?? todayMY();
  const by = opts.by ?? "claims.collator";
  const pkg = await lockPackage(executor, packageId);
  const policy = INVOICE_POLICY[assertFinStage(pkg.financialStage)];
  if (policy === "LOCKED") {
    throw new DomainError("INVOICE_LOCKED", `The claim for ${pkg.packageCode} is with HRD Corp (${pkg.financialStage}); its tax invoice can no longer change`);
  }
  if (policy === "VOID") throw new DomainError("PACKAGE_VOIDED", `${pkg.packageCode} is voided; there is nothing to invoice`);
  if (policy === "NOT_YET") {
    throw new DomainError("CLAIM_NOT_OPEN", `The balance claim for ${pkg.packageCode} opens when delivery completes (financial stage ${pkg.financialStage})`);
  }
  if (!pkg.etrisGrantId) throw new DomainError("GRANT_REFERENCE_MISSING", "The e-TRiS grant reference is required on the invoice");

  const snapshot = await loadSnapshotFor(executor, pkg, today);
  const claimable = claimableSen(snapshot);
  if (claimable <= 0) {
    throw new DomainError("NOTHING_CLAIMABLE", "No participant reached 80% attendance, or no grant amount is recorded; nothing is claimable");
  }
  const cfg = financeConfig();
  const { subtotal, tax } = splitInclusive(claimable, cfg.sstRateE4);
  const line = invoiceLine(snapshot, subtotal);
  const fields = {
    billedTo: HRD_CORP_BILLED_TO,
    employerName: snapshot.client.companyName,
    employerMycoid: snapshot.client.hrdcorpMycoid ?? null,
    grantReference: pkg.etrisGrantId,
    subtotal: fromSen(subtotal),
    taxRate: cfg.sstRateText,
    taxAmount: fromSen(tax),
    total: fromSen(claimable),
    lineItems: [line] as unknown[],
  };

  const existing = snapshot.invoice;
  if (existing?.vaultId && invoiceFingerprint(existing) === invoiceFingerprint(fields)) {
    const [vaultDoc] = await executor.select().from(schema.complianceVault).where(eq(schema.complianceVault.id, existing.vaultId));
    return { invoice: existing, vaultDoc, changed: false, created: false, claimableSen: claimable, subtotalSen: subtotal, taxSen: tax, totalSen: claimable };
  }

  const invoiceNumber = existing?.invoiceNumber ?? (await nextInvoiceNumber(executor, today));
  const pdf = await renderInvoicePdf({
    invoiceNumber,
    issueDate: today,
    billedTo: fields.billedTo,
    employerName: fields.employerName,
    employerMycoid: fields.employerMycoid,
    grantReference: fields.grantReference,
    packageCode: pkg.packageCode,
    title: pkg.title,
    startDate: pkg.startDate,
    endDate: pkg.endDate,
    deliveryMode: pkg.deliveryMode,
    line,
    subtotalSen: subtotal,
    taxSen: tax,
    totalSen: claimable,
    sstRateText: cfg.sstRateText,
    upfrontSen: toSen(pkg.upfrontAmount),
    upfrontClaimed: pkg.upfront30pctClaimed,
  });
  const vaultDoc = await storeOnce(executor, {
    packageId: pkg.id,
    documentType: "TAX_INVOICE",
    fileName: `${invoiceNumber}.pdf`,
    mimeType: PDF_MIME,
    bytes: pdf,
    uploadedBy: by,
    extractedMetadata: { invoiceNumber, total: fields.total, subtotal: fields.subtotal, taxAmount: fields.taxAmount },
  });

  let invoice: TaxInvoice;
  if (existing) {
    [invoice] = await executor
      .update(schema.taxInvoices)
      .set({ ...fields, vaultId: vaultDoc.id, issuedAt: new Date() })
      .where(eq(schema.taxInvoices.id, existing.id))
      .returning();
  } else {
    [invoice] = await executor
      .insert(schema.taxInvoices)
      .values({ ...fields, packageId: pkg.id, invoiceNumber, vaultId: vaultDoc.id })
      .returning();
  }
  await recordAudit(executor, {
    entityType: "TAX_INVOICE",
    entityId: invoice.id,
    reasonCode: existing ? "INVOICE_REDRAFTED" : "INVOICE_DRAFTED",
    details: `${invoiceNumber} ${fields.total}`,
    metadata: {
      package_id: pkg.id,
      invoice_number: invoiceNumber,
      total: fields.total,
      previous_total: existing?.total ?? null,
      vault_id: vaultDoc.id,
      sha256: vaultDoc.fileHashSha256,
    },
  });
  return { invoice, vaultDoc, changed: true, created: !existing, claimableSen: claimable, subtotalSen: subtotal, taxSen: tax, totalSen: claimable };
}

export async function getTaxInvoice(executor: Executor, packageId: string): Promise<TaxInvoice | null> {
  const [row] = await executor.select().from(schema.taxInvoices).where(eq(schema.taxInvoices.packageId, packageId));
  return row ?? null;
}
