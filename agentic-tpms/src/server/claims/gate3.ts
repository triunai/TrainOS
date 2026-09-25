import { and, desc, eq, ne, sql } from "drizzle-orm";
import { fromSen } from "@/lib/money";
import { type Actor, type Executor, db, rows, schema, withTx } from "../db/client";
import type { VaultDocument } from "../db/schema";
import { resolvePendingFor } from "../decisions/service";
import { DomainError } from "../domain/errors";
import { transitionInTx, type TransitionOutcome } from "../fsm/service";
import { setVerification } from "../storage/vault";
import { assertUpload, assertUuid, lockPackage, parseAmount, requireOperator, storeOnce } from "../finance/common";
import { stampLedger } from "../finance/ledger";
import type { TaxInvoice } from "../packages/snapshot";
import { draftTaxInvoice, getTaxInvoice, type InvoiceDraft } from "./invoice";

/**
 * Gate 3 — the claim, from review to remittance. Every move here is a named
 * operator's act (the FSM rows accept USER only), recorded through
 * `transitionInTx` so the L0 guards and the database both check it:
 *
 *   CLAIM_READY --approveClaimPack--> CLAIM_SUBMITTED --recordHrdcApproval--> APPROVED
 *        CLAIM_SUBMITTED <--resubmitAfterQuery-- QUERIED <--recordQuery--'
 *   APPROVED --recordRemittance--> REMITTED   (coupling enqueues PV drafting)
 */

function requireRef(value: string | null | undefined, code: string, label: string): string {
  const ref = (value ?? "").trim();
  if (ref.length < 4 || ref.length > 100) throw new DomainError(code, `${label} is required (4 to 100 characters)`);
  return ref;
}

function requireNote(note: string | null | undefined, label: string): string {
  const text = (note ?? "").trim();
  if (text.length < 3) throw new DomainError("NOTES_REQUIRED", `${label} needs a note`);
  return text;
}

async function latestClaimPack(executor: Executor, packageId: string): Promise<VaultDocument | undefined> {
  const [pack] = await executor
    .select()
    .from(schema.complianceVault)
    .where(
      and(
        eq(schema.complianceVault.packageId, packageId),
        eq(schema.complianceVault.documentType, "CLAIM_PACK"),
        ne(schema.complianceVault.verificationStatus, "FLAGGED"),
      ),
    )
    .orderBy(desc(schema.complianceVault.createdAt))
    .limit(1);
  return pack;
}

/**
 * Operator re-draft from the Claims desk (e.g. after an attendance
 * correction). While CLAIM_NOT_READY it simply refreshes the invoice (the
 * next collation picks it up). While CLAIM_READY a changed invoice makes the
 * compiled pack stale, so the claim is reopened (CLAIM_EVIDENCE_REOPENED —
 * the coupling re-enqueues the collator) and the pending review resolved.
 */
export async function redraftTaxInvoice(packageId: string, actor: Actor): Promise<InvoiceDraft & { reopened: boolean }> {
  requireOperator(actor, "Re-drafting a tax invoice");
  assertUuid(packageId, "packageId");
  return withTx(actor, { reasonCode: "INVOICE_REDRAFT_REQUESTED" }, async (tx) => {
    const pkg = await lockPackage(tx, packageId);
    const draft = await draftTaxInvoice(tx, packageId, { by: actor.id });
    if (!draft.changed || pkg.financialStage !== "CLAIM_READY") return { ...draft, reopened: false };
    await transitionInTx(tx, {
      packageId,
      machine: "FINANCIAL",
      to: "CLAIM_NOT_READY",
      reason: "CLAIM_EVIDENCE_REOPENED",
      actor,
      details: `Tax invoice ${draft.invoice.invoiceNumber} re-drafted to RM ${draft.invoice.total}; the claim pack must be recompiled`,
      metadata: { invoice_id: draft.invoice.id, invoice_vault_id: draft.vaultDoc.id },
    });
    await resolvePendingFor(tx, "GATE3_CLAIM_REVIEW", pkg.packageCode, {
      status: "RESOLVED",
      by: actor.id,
      chosenOption: "REOPEN",
      note: "Invoice re-drafted; the pack is being recompiled",
    });
    return { ...draft, reopened: true };
  });
}

/**
 * The pack about to be approved must carry the invoice as it stands now: its
 * manifest's 01_Tax_Invoice.pdf hash must equal the current invoice PDF's.
 * Anything else means the pack went stale after compilation.
 */
function assertPackCurrent(pack: VaultDocument | undefined, invoice: TaxInvoice | null, invoicePdf: VaultDocument | undefined): void {
  if (!pack) return; // the CLAIM_PACK_APPROVED guard reports a missing pack
  const manifest = (pack.extractedMetadata as { manifest?: { files?: Record<string, string>; claimableAmount?: string } }).manifest;
  const packed = manifest?.files?.["01_Tax_Invoice.pdf"];
  if (!invoice || !invoicePdf || !packed || packed !== invoicePdf.fileHashSha256 || manifest?.claimableAmount !== invoice.total) {
    throw new DomainError("CLAIM_PACK_STALE", "The claim pack does not carry the current tax invoice; re-collate before approving");
  }
}

/**
 * Gate 3 approval: the operator has uploaded the pack to e-TRiS and records
 * the claim reference. Marks the exact pack bytes VERIFIED by the approver,
 * resolves the review decision, and opens the unit-economics ledger row.
 */
export async function approveClaimPack(packageId: string, input: { submissionRef: string; note?: string }, actor: Actor): Promise<TransitionOutcome> {
  requireOperator(actor, "Approving a claim pack");
  assertUuid(packageId, "packageId");
  const ref = requireRef(input.submissionRef, "SUBMISSION_REF_MISSING", "The e-TRiS claim submission reference");
  return withTx(actor, { reasonCode: "CLAIM_PACK_APPROVED" }, async (tx) => {
    const pkg = await lockPackage(tx, packageId);
    const pack = await latestClaimPack(tx, packageId);
    const invoice = await getTaxInvoice(tx, packageId);
    const [invoicePdf] = invoice?.vaultId
      ? await tx.select().from(schema.complianceVault).where(eq(schema.complianceVault.id, invoice.vaultId))
      : [];
    assertPackCurrent(pack, invoice, invoicePdf);
    const outcome = await transitionInTx(tx, {
      packageId,
      machine: "FINANCIAL",
      to: "CLAIM_SUBMITTED",
      reason: "CLAIM_PACK_APPROVED",
      actor,
      details: input.note?.trim() || `Submitted to e-TRiS as ${ref}`,
      patch: { claimSubmissionRef: ref },
      metadata: { claim_pack_vault_id: pack?.id ?? null, claim_pack_sha256: pack?.fileHashSha256 ?? null },
    });
    if (pack && pack.verificationStatus !== "VERIFIED") {
      await setVerification(tx, pack.id, "VERIFIED", actor.id, `Approved for e-TRiS submission ${ref}`);
    }
    await resolvePendingFor(tx, "GATE3_CLAIM_REVIEW", pkg.packageCode, {
      status: "APPROVED",
      by: actor.id,
      chosenOption: "APPROVE",
      note: `e-TRiS claim reference ${ref}`,
    });
    await stampLedger(tx, packageId, { claimSubmittedAt: new Date(), taxInvoiceNumber: invoice?.invoiceNumber ?? null });
    return outcome;
  });
}

export async function recordQuery(packageId: string, note: string, actor: Actor): Promise<TransitionOutcome> {
  requireOperator(actor, "Recording an HRD Corp query");
  assertUuid(packageId, "packageId");
  const text = requireNote(note, "An HRD Corp query");
  return withTx(actor, { reasonCode: "CLAIM_QUERIED_BY_HRDC" }, (tx) =>
    transitionInTx(tx, { packageId, machine: "FINANCIAL", to: "QUERIED", reason: "CLAIM_QUERIED_BY_HRDC", actor, details: text, metadata: { query: text } }),
  );
}

export async function resubmitAfterQuery(packageId: string, note: string, actor: Actor): Promise<TransitionOutcome> {
  requireOperator(actor, "Resubmitting a queried claim");
  assertUuid(packageId, "packageId");
  const text = requireNote(note, "A query response");
  return withTx(actor, { reasonCode: "QUERY_RESPONSE_RESUBMITTED" }, (tx) =>
    transitionInTx(tx, { packageId, machine: "FINANCIAL", to: "CLAIM_SUBMITTED", reason: "QUERY_RESPONSE_RESUBMITTED", actor, details: text, metadata: { response: text } }),
  );
}

export async function recordHrdcApproval(packageId: string, amount: string | number, actor: Actor): Promise<TransitionOutcome> {
  requireOperator(actor, "Recording HRD Corp's claim approval");
  assertUuid(packageId, "packageId");
  const approved = fromSen(parseAmount(amount, "The approved amount"));
  return withTx(actor, { reasonCode: "CLAIM_APPROVED_BY_HRDC" }, (tx) =>
    transitionInTx(tx, {
      packageId,
      machine: "FINANCIAL",
      to: "APPROVED",
      reason: "CLAIM_APPROVED_BY_HRDC",
      actor,
      details: `HRD Corp approved RM ${approved}`,
      patch: { hrdcApprovedAmount: approved },
    }),
  );
}

export type RemittanceInput = {
  amount: string | number;
  reference: string;
  adviceBytes: Uint8Array;
  mime: string;
  fileName: string;
};

/**
 * The remittance advice lands in the vault first (the REMITTANCE_RECEIVED
 * guard requires it), then APPROVED -> REMITTED with the amount, reference
 * and time. The FSM coupling enqueues `finance.draft_payment_vouchers` in the
 * same transaction: pay-when-paid starts exactly here.
 */
export async function recordRemittance(packageId: string, input: RemittanceInput, actor: Actor): Promise<{ outcome: TransitionOutcome; advice: VaultDocument }> {
  requireOperator(actor, "Recording an HRD Corp remittance");
  assertUuid(packageId, "packageId");
  const amount = fromSen(parseAmount(input.amount, "The remitted amount"));
  const reference = requireRef(input.reference, "REMITTANCE_REF_MISSING", "The remittance reference");
  assertUpload(input.adviceBytes, input.mime, "REMITTANCE_ADVICE_MISSING", "The remittance advice");
  return withTx(actor, { reasonCode: "REMITTANCE_RECEIVED" }, async (tx) => {
    const pkg = await lockPackage(tx, packageId);
    if (pkg.financialStage !== "APPROVED") {
      throw new DomainError("CLAIM_NOT_APPROVED", `${pkg.packageCode} is ${pkg.financialStage}; a remittance is recorded after HRD Corp approves the claim`);
    }
    const advice = await storeOnce(tx, {
      packageId,
      documentType: "REMITTANCE_ADVICE",
      fileName: input.fileName || `remittance-${reference}.pdf`,
      mimeType: input.mime,
      bytes: input.adviceBytes,
      uploadedBy: actor.id,
      verificationStatus: "VERIFIED",
      verifiedBy: actor.id,
      verificationNotes: `Remittance ${reference} for RM ${amount}`,
      extractedMetadata: { amount, reference },
    });
    const remittedAt = new Date();
    const outcome = await transitionInTx(tx, {
      packageId,
      machine: "FINANCIAL",
      to: "REMITTED",
      reason: "REMITTANCE_RECEIVED",
      actor,
      details: `HRD Corp remitted RM ${amount} (${reference})`,
      patch: { remittanceAmount: amount, remittanceReference: reference, remittedAt },
      metadata: { remittance_advice_vault_id: advice.id },
    });
    await stampLedger(tx, packageId, { remittedAt });
    return { outcome, advice };
  });
}

// ---------------------------------------------------------------- Claims desk read model

const CLAIM_STAGES = ["CLAIM_NOT_READY", "CLAIM_READY", "CLAIM_SUBMITTED", "QUERIED", "APPROVED", "REMITTED"] as const;

export type ClaimQueueRow = {
  packageId: string;
  packageCode: string;
  title: string;
  clientName: string;
  financialStage: string;
  endDate: string | null;
  etrisGrantId: string | null;
  invoiceNumber: string | null;
  invoiceTotal: string | null;
  claimSubmissionRef: string | null;
  hrdcApprovedAmount: string | null;
  remittanceAmount: string | null;
  upfrontAmount: string;
  pendingDecisionId: string | null;
};

/** Packages with an open claim, oldest delivery first. */
export async function listClaimQueue(opts: { stages?: string[] } = {}): Promise<ClaimQueueRow[]> {
  const stages = opts.stages?.length ? opts.stages : [...CLAIM_STAGES];
  for (const s of stages) {
    if (!(CLAIM_STAGES as readonly string[]).includes(s)) throw new DomainError("UNKNOWN_STAGE", `Not a claim stage: ${s}`);
  }
  return rows<ClaimQueueRow>(
    db(),
    sql`select p.id as "packageId", p.package_code as "packageCode", p.title, c.company_name as "clientName",
               p.financial_stage as "financialStage", p.end_date as "endDate", p.etris_grant_id as "etrisGrantId",
               i.invoice_number as "invoiceNumber", i.total::text as "invoiceTotal",
               p.claim_submission_ref as "claimSubmissionRef", p.hrdc_approved_amount::text as "hrdcApprovedAmount",
               p.remittance_amount::text as "remittanceAmount", p.upfront_amount::text as "upfrontAmount",
               (select d.id from tpms.decisions d
                 where d.package_id = p.id and d.gate = 'GATE3_CLAIM_REVIEW' and d.status = 'PENDING'
                 limit 1) as "pendingDecisionId"
          from tpms.training_packages p
          join tpms.corporate_clients c on c.id = p.client_id
          left join tpms.tax_invoices i on i.package_id = p.id
         where p.financial_stage = any (${`{${stages.join(",")}}`}::text[])
         order by p.end_date nulls last, p.package_code`,
  );
}
