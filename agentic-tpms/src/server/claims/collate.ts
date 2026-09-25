import { eq } from "drizzle-orm";
import { z } from "zod";
import { todayMY } from "@/lib/dates";
import { formatRM, fromSen, toSen } from "@/lib/money";
import { finishAgentRun, runTier, startAgentRun, type Provenance } from "../ai";
import { type Actor, type Tx, db, schema, SYSTEM_ACTOR, withTx } from "../db/client";
import type { VaultDocument } from "../db/schema";
import { raiseDecision, resolvePendingFor } from "../decisions/service";
import { DomainError, isDomainError } from "../domain/errors";
import { assertFinStage } from "../domain/stages";
import { transitionInTx } from "../fsm/service";
import { enqueue } from "../queue/queue";
import { loadSnapshot, loadSnapshotFor } from "../packages/snapshot";
import { setVerification } from "../storage/vault";
import { assertUuid, errorMessage, lockPackage, requireOperator, runStatus, storeOnce } from "../finance/common";
import { type ClaimChecklist, evaluateChecklist, selectEvidence, withBlockingItem } from "./checklist";
import { draftTaxInvoice, type InvoiceDraft } from "./invoice";
import { attendanceRows, buildClaimPack, readEvidence, ZIP_MIME, type ClaimManifest } from "./pack";

/**
 * Stage 6 — `claims.collate` (agent `claims.collator`, tier L3).
 *
 * Runs whenever the package is CLAIM_NOT_READY: on entry (FSM coupling) and
 * again after every operator verification (`verifyEvidence`). Each run
 *   1. drafts / refreshes the HRD Corp tax invoice,
 *   2. evaluates the evidence checklist,
 *   3. when complete: compiles the claim pack into the vault, moves the
 *      package CLAIM_NOT_READY -> CLAIM_READY as SYSTEM (CLAIM_EVIDENCE_VERIFIED),
 *      and raises GATE3_CLAIM_REVIEW for a named operator;
 *      otherwise: leaves the stage alone and returns the checklist, which the
 *      Claims desk renders from the task result and the agent run output.
 *
 * Re-runnable: every write is idempotent (invoice updated in place, vault
 * writes deduplicated by hash, one pending decision per gate + subject), and
 * re-enqueues use a key that carries the verification event, so a new
 * verification always schedules a fresh run while a retried one does not.
 */
export const COLLATOR: Actor = { type: "AGENT", id: "claims.collator" };

export type CollateResult = {
  packageId: string;
  packageCode: string;
  financialStage: string;
  ready: boolean;
  skipped?: string;
  checklist?: ClaimChecklist;
  invoice?: { id: string; invoiceNumber: string; total: string; vaultId: string | null; changed: boolean };
  claimPack?: { vaultId: string; sha256: string; fileName: string; manifest: ClaimManifest };
  decisionId?: string;
  reviewerNote?: string;
};

const ReviewerNote = z.object({ note: z.string().min(1).max(1200) });

function templateReviewerNote(checklist: ClaimChecklist, draft: InvoiceDraft | null, upfrontSen: number): string {
  const lines: string[] = [];
  const eligible = checklist.items.find((i) => i.code === "ELIGIBLE_PARTICIPANTS");
  if (eligible?.detail.includes("below 80%")) lines.push(`Attendance: ${eligible.detail}.`);
  if (upfrontSen > 0) lines.push(`Upfront advance of ${formatRM(fromSen(upfrontSen))} is reconciled by HRD Corp at remittance, not on this invoice.`);
  const kirkpatrick = checklist.items.find((i) => i.code === "KIRKPATRICK_REPORT");
  if (kirkpatrick && !kirkpatrick.ok) lines.push("No Kirkpatrick report is attached; it is optional for the claim.");
  if (draft && draft.taxSen > 0) lines.push(`SST of ${formatRM(fromSen(draft.taxSen))} is included in the claimable total (tax-inclusive).`);
  return lines.length ? lines.join(" ") : "All required evidence is verified; no exceptions noted.";
}

async function reviewerNote(packageId: string, checklist: ClaimChecklist, draft: InvoiceDraft | null, upfrontSen: number) {
  return runTier({
    tier: "L3",
    agent: COLLATOR.id,
    packageId,
    system: "You are a claims officer for an HRD Corp registered training provider. Write two or three plain sentences flagging anything a reviewer should check before submitting an SBL-Khas claim. Never state amounts that are not in the facts.",
    prompt: JSON.stringify({ checklist: checklist.items, invoiceTotal: draft ? fromSen(draft.totalSen) : null, upfront: fromSen(upfrontSen) }),
    json: { schema: ReviewerNote },
    maxTokens: 400,
    template: () => ({ note: templateReviewerNote(checklist, draft, upfrontSen) }),
  });
}

async function collateInTx(tx: Tx, packageId: string): Promise<{ result: CollateResult; provenance?: Provenance }> {
  const pkg = await lockPackage(tx, packageId);
  const stage = assertFinStage(pkg.financialStage);
  const base = { packageId, packageCode: pkg.packageCode, financialStage: stage };
  if (stage !== "CLAIM_NOT_READY") {
    // A stale run (the package moved on, or was reopened and re-collated already) is a no-op, not a failure.
    return { result: { ...base, ready: stage === "CLAIM_READY", skipped: `financial stage is ${stage}` } };
  }

  let draft: InvoiceDraft | null = null;
  let invoiceProblem: string | undefined;
  try {
    draft = await draftTaxInvoice(tx, packageId, { by: COLLATOR.id });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    invoiceProblem = `${error.code}: ${error.message}`;
  }

  const today = todayMY();
  const snapshot = await loadSnapshotFor(tx, pkg, today);
  let checklist = evaluateChecklist(snapshot, { invoiceProblem });
  const invoiceSummary = draft && {
    id: draft.invoice.id,
    invoiceNumber: draft.invoice.invoiceNumber,
    total: draft.invoice.total,
    vaultId: draft.invoice.vaultId,
    changed: draft.changed,
  };
  if (!checklist.ready || !draft || !snapshot.invoice) {
    return { result: { ...base, ready: false, checklist, invoice: invoiceSummary ?? undefined } };
  }

  const evidence = await readEvidence(tx, selectEvidence(snapshot), snapshot.invoice);
  if (evidence.corrupted.length > 0) {
    checklist = withBlockingItem(checklist, {
      code: "EVIDENCE_INTEGRITY",
      label: "Evidence files intact",
      detail: evidence.corrupted.map((c) => `${c.fileName}: ${c.reason}`).join("; "),
      vaultIds: evidence.corrupted.map((c) => c.vaultId).filter(Boolean),
    });
    return { result: { ...base, ready: false, checklist, invoice: invoiceSummary ?? undefined } };
  }

  const upfrontSen = toSen(pkg.upfrontAmount);
  const note = await reviewerNote(packageId, checklist, draft, upfrontSen);
  const pack = await buildClaimPack({
    s: snapshot,
    invoice: snapshot.invoice,
    claimableSen: draft.claimableSen,
    checklist,
    evidence: evidence.files,
    roster: await attendanceRows(tx, packageId),
    compiledOn: today,
    reviewerNote: note.output.note,
  });
  const packDoc: VaultDocument = await storeOnce(tx, {
    packageId,
    documentType: "CLAIM_PACK",
    fileName: pack.fileName,
    mimeType: ZIP_MIME,
    bytes: pack.zip,
    uploadedBy: COLLATOR.id,
    extractedMetadata: { manifest: pack.manifest, files: pack.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })) },
  });

  try {
    await transitionInTx(tx, {
      packageId,
      machine: "FINANCIAL",
      to: "CLAIM_READY",
      reason: "CLAIM_EVIDENCE_VERIFIED",
      actor: SYSTEM_ACTOR,
      details: `Claim pack compiled (${pack.files.length + 1} files, sha256 ${pack.sha256.slice(0, 12)})`,
      metadata: { claim_pack_vault_id: packDoc.id, claim_pack_sha256: pack.sha256, invoice_number: draft.invoice.invoiceNumber, claimable_amount: fromSen(draft.claimableSen) },
    });
  } catch (error) {
    // The L0 guard is the floor the checklist builds on; if they ever disagree, show why instead of dead-lettering.
    if (!isDomainError(error) || error.code !== "GUARD_FAILED") throw error;
    const failures = (error.details.failures as Array<{ code: string; message: string }> | undefined) ?? [];
    checklist = withBlockingItem(checklist, {
      code: "FSM_GUARD",
      label: "Claim-ready guard (L0)",
      detail: failures.map((f) => `${f.code}: ${f.message}`).join("; ") || error.message,
      vaultIds: [],
    });
    return { result: { ...base, ready: false, checklist, invoice: invoiceSummary ?? undefined }, provenance: note.provenance };
  }

  const claimable = formatRM(fromSen(draft.claimableSen));
  const decision = await raiseDecision(tx, {
    gate: "GATE3_CLAIM_REVIEW",
    packageId,
    subjectRef: pkg.packageCode,
    title: `Claim pack ready · ${pkg.packageCode}`,
    summary:
      `Claimable ${claimable} on invoice ${draft.invoice.invoiceNumber} (grant ${pkg.etrisGrantId}). ` +
      `Checklist: ${checklist.items.map((i) => `${i.label} — ${i.ok ? "OK" : i.required ? "MISSING" : "optional"}`).join("; ")}. ` +
      note.output.note,
    payload: {
      claimableAmount: fromSen(draft.claimableSen),
      invoiceId: draft.invoice.id,
      invoiceNumber: draft.invoice.invoiceNumber,
      claimPackVaultId: packDoc.id,
      claimPackSha256: packDoc.fileHashSha256,
      checklist: checklist.items,
      manifest: pack.manifest,
      reviewerNote: note.output.note,
      provenance: note.provenance,
    },
    options: [
      { id: "APPROVE", label: "Approve for e-TRiS submission", description: "Record the e-TRiS claim reference; the package moves to CLAIM_SUBMITTED", consequence: "The tax invoice is locked" },
      { id: "REOPEN", label: "Flag a document", description: "Flag the failing evidence; the package returns to CLAIM_NOT_READY and is re-collated" },
    ],
    raisedBy: COLLATOR.id,
    raisedByTier: "L3",
    slaHours: 48,
  });

  return {
    result: {
      ...base,
      financialStage: "CLAIM_READY",
      ready: true,
      checklist,
      invoice: invoiceSummary ?? undefined,
      claimPack: { vaultId: packDoc.id, sha256: packDoc.fileHashSha256, fileName: pack.fileName, manifest: pack.manifest },
      decisionId: decision.id,
      reviewerNote: note.output.note,
    },
    provenance: note.provenance,
  };
}

/** Body of the `claims.collate` task; also callable directly (e.g. a "Re-collate" button). */
export async function collateClaim(packageId: string, opts: { taskId?: string | null } = {}): Promise<CollateResult> {
  assertUuid(packageId, "packageId");
  const runId = await startAgentRun(db(), {
    agent: COLLATOR.id,
    tier: "L3",
    packageId,
    taskId: opts.taskId ?? null,
    inputSummary: `Collate SBL-Khas claim evidence and compile the claim pack for ${packageId}`,
  });
  try {
    const { result, provenance } = await withTx(COLLATOR, { reasonCode: "CLAIM_COLLATION" }, (tx) => collateInTx(tx, packageId));
    await finishAgentRun(db(), runId, {
      status: runStatus(provenance?.mode),
      output: result,
      provenance: provenance ?? { tier: "L0", agent: COLLATOR.id, mode: "RULE" },
      costMyr: provenance?.costMyr ?? 0,
    });
    return result;
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: errorMessage(error) });
    throw error;
  }
}

/** Read-only checklist for the Claims desk (no invoice draft, no writes). */
export async function claimChecklist(packageId: string): Promise<ClaimChecklist> {
  assertUuid(packageId, "packageId");
  return evaluateChecklist(await loadSnapshot(db(), packageId));
}

// ---------------------------------------------------------------- operator verification

/** Evidence an operator verifies on the Claims desk. R14: anything else is refused, not waved through. */
export const VERIFIABLE_EVIDENCE = ["FORM_T3", "FORM_JD14", "PHOTO_EVIDENCE", "BEO", "DO"] as const;
const CLAIM_EVIDENCE = new Set<string>(VERIFIABLE_EVIDENCE);

export type VerifyEvidenceInput = {
  status: "VERIFIED" | "FLAGGED";
  notes?: string;
  /** Form JD/14 only: both must be confirmed before it can be VERIFIED. */
  checks?: { managerialSignature?: boolean; companyStamp?: boolean };
};

export type VerifyEvidenceResult = {
  doc: VaultDocument;
  financialStage: string;
  /** The re-collation task scheduled by this verdict, when one was. */
  recollateTaskId: string | null;
  /** True when flagging moved a CLAIM_READY package back to CLAIM_NOT_READY. */
  reopened: boolean;
};

/**
 * An operator's verdict on one piece of claim evidence.
 *
 *   - CLAIM_NOT_READY: records the verdict and re-enqueues `claims.collate`
 *     (key carries the document and the verdict time, so each verdict gets
 *     exactly one fresh run).
 *   - CLAIM_READY + FLAGGED: records the verdict, moves the package back to
 *     CLAIM_NOT_READY (CLAIM_EVIDENCE_REOPENED — the coupling re-enqueues the
 *     collator) and resolves the pending Gate 3 review, whose pack is now stale.
 *   - any other stage: records the verdict only.
 */
export async function verifyEvidence(vaultId: string, input: VerifyEvidenceInput, actor: Actor): Promise<VerifyEvidenceResult> {
  requireOperator(actor, "Verifying claim evidence");
  assertUuid(vaultId, "vaultId");
  if (input.status !== "VERIFIED" && input.status !== "FLAGGED") {
    throw new DomainError("UNKNOWN_VERDICT", `Unknown verification status: ${String(input.status)}`);
  }
  const notes = (input.notes ?? "").trim();
  if (input.status === "FLAGGED" && notes.length < 3) throw new DomainError("NOTES_REQUIRED", "Say why the document is flagged");

  return withTx(actor, { reasonCode: input.status === "VERIFIED" ? "EVIDENCE_VERIFIED" : "EVIDENCE_FLAGGED", reasonDetails: notes }, async (tx) => {
    const [doc] = await tx.select().from(schema.complianceVault).where(eq(schema.complianceVault.id, vaultId));
    if (!doc) throw new DomainError("EVIDENCE_NOT_FOUND", `Vault document ${vaultId} not found`);
    if (!doc.packageId) throw new DomainError("EVIDENCE_NOT_PACKAGED", "This document is not attached to a package");
    if (!CLAIM_EVIDENCE.has(doc.documentType)) {
      throw new DomainError("EVIDENCE_TYPE_UNSUPPORTED", `${doc.documentType} is not claim evidence verified on the Claims desk`);
    }
    const checks = { managerialSignature: input.checks?.managerialSignature === true, companyStamp: input.checks?.companyStamp === true };
    if (doc.documentType === "FORM_JD14" && input.status === "VERIFIED" && !(checks.managerialSignature && checks.companyStamp)) {
      throw new DomainError("JD14_CHECKS_REQUIRED", "A Form JD/14 is verified only once both the managerial signature and the company stamp are confirmed");
    }

    const pkg = await lockPackage(tx, doc.packageId);
    const stage = assertFinStage(pkg.financialStage);
    const updated = await setVerification(tx, doc.id, input.status, actor.id, notes || undefined, {
      ...doc.extractedMetadata,
      operatorVerification: {
        status: input.status,
        by: actor.id,
        ...(doc.documentType === "FORM_JD14" ? { checks } : {}),
      },
    });

    let recollateTaskId: string | null = null;
    let reopened = false;
    if (stage === "CLAIM_NOT_READY") {
      recollateTaskId = await enqueue(tx, {
        type: "claims.collate",
        payload: { packageId: pkg.id },
        idempotencyKey: `collate:${pkg.id}:evidence:${doc.id}:${input.status}:${updated.verifiedAt?.getTime() ?? Date.now()}`,
      });
    } else if (stage === "CLAIM_READY" && input.status === "FLAGGED") {
      await transitionInTx(tx, {
        packageId: pkg.id,
        machine: "FINANCIAL",
        to: "CLAIM_NOT_READY",
        reason: "CLAIM_EVIDENCE_REOPENED",
        actor,
        details: `${doc.documentType} ${doc.fileName} flagged: ${notes}`,
        metadata: { vault_id: doc.id, document_type: doc.documentType },
      });
      reopened = true;
      await resolvePendingFor(tx, "GATE3_CLAIM_REVIEW", pkg.packageCode, {
        status: "RESOLVED",
        by: actor.id,
        chosenOption: "REOPEN",
        note: `Evidence reopened: ${doc.documentType} flagged (${notes})`,
      });
    }
    const [after] = await tx.select({ stage: schema.trainingPackages.financialStage }).from(schema.trainingPackages).where(eq(schema.trainingPackages.id, pkg.id));
    return { doc: updated, financialStage: after.stage, recollateTaskId, reopened };
  });
}
