import { and, desc, eq, ne, sql } from "drizzle-orm";
import { addDays, todayMY } from "@/lib/dates";
import { fromSen, toSen } from "@/lib/money";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Tx, db, schema, withTx } from "../db/client";
import type { Quotation, TrainingPackage, VaultDocument } from "../db/schema";
import { resolvePendingFor } from "../decisions/service";
import { PDF_MIME } from "../documents/pdf";
import { DomainError } from "../domain/errors";
import { transition, transitionInTx, type TransitionOutcome } from "../fsm/service";
import { checkTransition } from "../fsm/transitions";
import { draftProposalKey } from "../queue/keys";
import { enqueue } from "../queue/queue";
import { storeDocument } from "../storage/vault";
import {
  activePolicy,
  computeQuote,
  inputsFromStored,
  policyTerms,
  recomputeFromCells,
  type QuoteInputs,
  type StoredLineItem,
} from "@/server/pricing";
import { beoFileName, quotationReference, renderOutlinePdf, renderQuotationPdf, renderTrainerAgreementPdf } from "./documents";
import type { CourseOutline } from "./outline";
import {
  firstAgentVersion,
  insertQuotationVersion,
  lineItemsDiff,
  lockPackage,
  proposalRefs,
  raiseGate1Decision,
  supersedeOthers,
  type LineChange,
  type ProposalRefs,
} from "./quotations";

/**
 * Gate 1 — the commercial sign-off, and the Stage-4 hold helpers.
 *
 * WHY `approveAndDispatch` is one transaction: the quotation's APPROVED
 * status, the three vault documents, the QUOTED move (with its audit row and
 * the enqueued dispatch), the tentative trainer/venue holds and the resolved
 * decision either all exist or none do. A half-approved package — QUOTED with
 * no quotation PDF, or a PDF for a quotation still awaiting approval — is not
 * a state anyone can reason about.
 */
function refuseAgent(actor: Actor, what: string): void {
  if (actor.type === "AGENT") throw new DomainError("AGENT_CANNOT_COMMIT", `An agent cannot ${what}; a named operator must`);
}

// ---------------------------------------------------------------- revisions
export async function saveQuotationRevision(packageId: string, edits: Record<string, unknown>, actor: Actor): Promise<Quotation> {
  if (actor.type !== "USER") throw new DomainError("USER_REQUIRED", "Only an operator saves a quotation revision");
  const preview = await recomputeFromCells(packageId, edits, actor);
  return withTx(actor, { reasonCode: "QUOTATION_REVISED" }, async (tx) => {
    const pkg = await lockPackage(tx, packageId);
    if (pkg.operationalStage !== "DRAFT") {
      throw new DomainError("PACKAGE_NOT_DRAFT", `${pkg.packageCode} is ${pkg.operationalStage}; request a revision before editing the quotation`);
    }
    const [base] = await tx
      .select()
      .from(schema.quotations)
      .where(eq(schema.quotations.packageId, packageId))
      .orderBy(desc(schema.quotations.version))
      .limit(1);
    if (!base || base.id !== preview.basedOn.quotationId) {
      throw new DomainError("QUOTATION_CHANGED", "A newer quotation version was saved while you were editing; reload the sheet");
    }
    const quotation = await insertQuotationVersion(tx, {
      pkg,
      priced: preview.priced,
      refs: proposalRefs(base),
      outline: base.courseOutline,
      generatedBy: "USER",
      provenance: {
        editedBy: actor.id,
        basedOnVersion: base.version,
        edits: Object.fromEntries(Object.entries(preview.edits).map(([k, v]) => [k, v === null || v === undefined ? null : fromSen(v)])),
        pricing: { tier: "L0", mode: "RULE", engines: preview.priced.engines },
      },
    });
    await raiseGate1Decision(tx, { pkg, quotation, warnings: preview.result.warnings, raisedBy: actor.id, tier: "L0" });
    return quotation;
  });
}

// ---------------------------------------------------------------- approval
function asOutline(value: Record<string, unknown>): CourseOutline {
  if (!Array.isArray(value.days) || !Array.isArray(value.learningOutcomes) || typeof value.courseCode !== "string") {
    throw new DomainError("OUTLINE_MISSING", "This quotation has no Form HRD-L&D outline; re-draft the proposal");
  }
  return value as unknown as CourseOutline;
}

/**
 * The quotation must still describe THIS package under the CURRENT matrix:
 * a headcount, date or policy change after drafting makes it stale, and a
 * stored price that no longer follows from its stored inputs is corrupt.
 */
async function assertQuotationCurrent(tx: Tx, pkg: TrainingPackage, q: Quotation): Promise<QuoteInputs> {
  const inputs = inputsFromStored(q.inputs);
  const stale: string[] = [];
  if (inputs.deliveryMode !== pkg.deliveryMode) stale.push(`delivery mode is now ${pkg.deliveryMode}`);
  if (inputs.pax !== pkg.paxEstimate) stale.push(`headcount is now ${pkg.paxEstimate} (quoted for ${inputs.pax})`);
  if (pkg.durationDays !== null && inputs.days !== pkg.durationDays) stale.push(`duration is now ${pkg.durationDays} day(s) (quoted for ${inputs.days})`);
  if (stale.length) throw new DomainError("QUOTATION_STALE", `The package changed since this quotation was priced: ${stale.join("; ")}. Revise it first.`);

  const terms = policyTerms(await activePolicy(pkg.deliveryMode, pkg.startDate ?? todayMY(), tx), pkg.paxEstimate);
  if (terms.version !== inputs.policy.version || terms.basis !== inputs.policy.basis || terms.dailyCap !== inputs.policy.dailyCap) {
    throw new DomainError(
      "COST_POLICY_CHANGED",
      `Priced under ${inputs.policy.version} at ${fromSen(inputs.policy.dailyCap)}/day; the matrix now says ${terms.version} at ${fromSen(terms.dailyCap)}/day. Revise the quotation.`,
    );
  }
  const recomputed = computeQuote(inputs);
  if (
    recomputed.quotedFee !== toSen(q.quotedAmount) ||
    recomputed.allowableCap !== toSen(q.allowableCap) ||
    recomputed.totalDirectCost !== toSen(q.totalDirectCost)
  ) {
    throw new DomainError("QUOTATION_INTEGRITY", `Quotation v${q.version}'s stored amounts do not follow from its stored inputs`);
  }
  const outline = q.courseOutline as Record<string, unknown>;
  if (typeof outline.durationDays === "number" && outline.durationDays !== inputs.days) {
    throw new DomainError("OUTLINE_STALE", `The course outline covers ${outline.durationDays} day(s) but the quotation ${inputs.days}; re-draft the proposal`);
  }
  return inputs;
}

async function storePdf(tx: Tx, input: { pkg: TrainingPackage; type: string; fileName: string; bytes: Uint8Array; actor: Actor; trainerId?: string | null; meta?: Record<string, unknown> }): Promise<VaultDocument> {
  return storeDocument(tx, {
    packageId: input.pkg.id,
    trainerId: input.trainerId ?? null,
    documentType: input.type,
    fileName: input.fileName,
    mimeType: PDF_MIME,
    bytes: input.bytes,
    uploadedBy: input.actor.id,
    extractedMetadata: input.meta ?? {},
  });
}

/**
 * Tentative holds for what the approved quotation proposed. A hold already in
 * place for the same resource is refreshed; a TENTATIVE hold for a different
 * one (the revision changed trainer/venue) is released; anything already
 * CONFIRMED or BEO_SIGNED is left alone — a commitment is changed by a human.
 */
async function ensureHolds(tx: Tx, pkg: TrainingPackage, refs: ProposalRefs, inputs: QuoteInputs): Promise<{ engagementId: string | null; commitmentId: string | null }> {
  if (!pkg.startDate) throw new DomainError("DATES_MISSING", "Holds need a start date");
  let engagementId: string | null = null;
  if (refs.trainerId) {
    const [current] = await tx
      .select()
      .from(schema.trainerEngagements)
      .where(and(eq(schema.trainerEngagements.packageId, pkg.id), ne(schema.trainerEngagements.status, "RELEASED")));
    const dayRate = fromSen(inputs.trainerDayRate);
    if (current && current.status === "TENTATIVE_HOLD" && current.trainerId !== refs.trainerId) {
      await tx
        .update(schema.trainerEngagements)
        .set({ status: "RELEASED", releasedAt: new Date(), releaseReason: "QUOTATION_REVISED" })
        .where(eq(schema.trainerEngagements.id, current.id));
      await recordAudit(tx, {
        entityType: "TRAINER_ENGAGEMENT",
        entityId: current.id,
        reasonCode: "TRAINER_HOLD_RELEASED",
        details: "Revised quotation proposes a different trainer",
        metadata: { package_id: pkg.id, trainer_id: current.trainerId, replaced_by: refs.trainerId },
      });
    }
    if (current && (current.status !== "TENTATIVE_HOLD" || current.trainerId === refs.trainerId)) {
      if (current.status === "TENTATIVE_HOLD") {
        await tx
          .update(schema.trainerEngagements)
          .set({ dayRate, holdExpiryDate: pkg.startDate })
          .where(eq(schema.trainerEngagements.id, current.id));
      }
      engagementId = current.id;
    } else {
      const [created] = await tx
        .insert(schema.trainerEngagements)
        .values({ packageId: pkg.id, trainerId: refs.trainerId, status: "TENTATIVE_HOLD", dayRate, holdExpiryDate: pkg.startDate, payWhenPaid: true })
        .returning();
      engagementId = created.id;
      await recordAudit(tx, {
        entityType: "TRAINER_ENGAGEMENT",
        entityId: created.id,
        reasonCode: "TRAINER_HOLD_PLACED",
        details: `Tentative hold until ${pkg.startDate}`,
        metadata: { package_id: pkg.id, trainer_id: refs.trainerId, day_rate: dayRate, hold_expiry_date: pkg.startDate },
      });
    }
  }

  let commitmentId: string | null = null;
  const venues = await tx
    .select()
    .from(schema.vendorCommitments)
    .where(and(eq(schema.vendorCommitments.packageId, pkg.id), eq(schema.vendorCommitments.vendorType, "VENUE"), ne(schema.vendorCommitments.status, "CANCELLED")));
  for (const held of venues) {
    if (held.status === "PROVISIONAL" && held.vendorId !== refs.venueId) {
      await tx.update(schema.vendorCommitments).set({ status: "CANCELLED" }).where(eq(schema.vendorCommitments.id, held.id));
      await recordAudit(tx, {
        entityType: "VENDOR_COMMITMENT",
        entityId: held.id,
        reasonCode: "VENUE_HOLD_RELEASED",
        details: "Revised quotation proposes a different venue (or none)",
        metadata: { package_id: pkg.id, vendor_id: held.vendorId, replaced_by: refs.venueId },
      });
    }
  }
  if (refs.venueId) {
    const [vendor] = await tx.select().from(schema.vendors).where(eq(schema.vendors.id, refs.venueId));
    if (!vendor) throw new DomainError("VENUE_NOT_FOUND", `Venue ${refs.venueId} no longer exists`);
    const cost = fromSen(inputs.venueDdrPerPax * inputs.pax * inputs.days);
    const terms = {
      cost,
      cancellationDeadline: addDays(pkg.startDate, -vendor.cancellationNoticeDays),
      postponementDeadline: addDays(pkg.startDate, -vendor.freePostponementDays),
    };
    const same = venues.find((v) => v.vendorId === refs.venueId);
    if (same) {
      if (same.status === "PROVISIONAL") await tx.update(schema.vendorCommitments).set(terms).where(eq(schema.vendorCommitments.id, same.id));
      commitmentId = same.id;
    } else {
      const [created] = await tx
        .insert(schema.vendorCommitments)
        .values({ packageId: pkg.id, vendorId: vendor.id, vendorType: "VENUE", status: "PROVISIONAL", ...terms })
        .returning();
      commitmentId = created.id;
      await recordAudit(tx, {
        entityType: "VENDOR_COMMITMENT",
        entityId: created.id,
        reasonCode: "VENUE_HOLD_PLACED",
        details: `${vendor.name} provisional; free cancellation until ${terms.cancellationDeadline}`,
        metadata: { package_id: pkg.id, vendor_id: vendor.id, ...terms },
      });
    }
  }
  return { engagementId, commitmentId };
}

export interface ApproveResult {
  outcome: TransitionOutcome;
  quotation: Quotation;
  documents: { quotation: VaultDocument; outline: VaultDocument; trainerAgreement: VaultDocument | null };
  engagementId: string | null;
  commitmentId: string | null;
  lineItemsDiff: Record<string, LineChange>;
}

export async function approveAndDispatch(packageId: string, quotationId: string, actor: Actor): Promise<ApproveResult> {
  // Fail fast (and with the FSM's own code) before rendering anything for an actor who may not approve.
  const [pre] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pre) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const check = checkTransition("OPERATIONAL", pre.operationalStage, "QUOTED", "COMMERCIAL_TERMS_APPROVED", actor.type);
  if (!check.ok) throw new DomainError(check.code, check.message, { from: pre.operationalStage, to: "QUOTED" });

  return withTx(actor, { reasonCode: "COMMERCIAL_TERMS_APPROVED" }, async (tx) => {
    const pkg = await lockPackage(tx, packageId);
    const [q] = await tx.select().from(schema.quotations).where(eq(schema.quotations.id, quotationId));
    if (!q || q.packageId !== packageId) throw new DomainError("QUOTATION_NOT_FOUND", `Quotation ${quotationId} does not belong to ${pkg.packageCode}`);
    if (q.status !== "AWAITING_APPROVAL" && q.status !== "DRAFT") {
      throw new DomainError("QUOTATION_NOT_APPROVABLE", `Quotation v${q.version} is ${q.status}`);
    }
    const [latest] = await tx
      .select({ id: schema.quotations.id, version: schema.quotations.version })
      .from(schema.quotations)
      .where(eq(schema.quotations.packageId, packageId))
      .orderBy(desc(schema.quotations.version))
      .limit(1);
    if (latest.id !== q.id) throw new DomainError("QUOTATION_NOT_LATEST", `v${q.version} is not the latest version (v${latest.version})`);

    const inputs = await assertQuotationCurrent(tx, pkg, q);
    const outline = asOutline(q.courseOutline);
    const refs = proposalRefs(q);
    const [client] = await tx.select().from(schema.corporateClients).where(eq(schema.corporateClients.id, pkg.clientId));

    const now = new Date();
    const [approved] = await tx
      .update(schema.quotations)
      .set({ status: "APPROVED", approvedBy: actor.id, approvedAt: now })
      .where(eq(schema.quotations.id, q.id))
      .returning();
    await supersedeOthers(tx, packageId, q.id);

    // Documents render with the package as it will be once quoted (course and price applied).
    const quotedView: TrainingPackage = { ...pkg, quotedAmount: approved.quotedAmount, courseId: refs.courseId ?? pkg.courseId };
    const reference = quotationReference(pkg, approved.version);
    const quotationDoc = await storePdf(tx, {
      pkg,
      type: "QUOTATION",
      fileName: `${reference}.pdf`,
      bytes: await renderQuotationPdf({ pkg: quotedView, client, quotation: approved, outline }),
      actor,
      meta: { quotation_id: approved.id, version: approved.version, quoted_amount: approved.quotedAmount },
    });
    const outlineDoc = await storePdf(tx, {
      pkg,
      type: "FORM_HRD_LD",
      fileName: `LD-${pkg.packageCode}-v${approved.version}.pdf`,
      bytes: await renderOutlinePdf({ pkg: quotedView, client, outline }),
      actor,
      meta: { quotation_id: approved.id, course_code: outline.courseCode },
    });
    let agreementDoc: VaultDocument | null = null;
    if (refs.trainerId) {
      const [trainer] = await tx.select().from(schema.trainers).where(eq(schema.trainers.id, refs.trainerId));
      if (!trainer) throw new DomainError("TRAINER_NOT_FOUND", `Proposed trainer ${refs.trainerId} no longer exists`);
      agreementDoc = await storePdf(tx, {
        pkg,
        type: "TRAINER_AGREEMENT",
        fileName: `TA-${pkg.packageCode}-v${approved.version}.pdf`,
        bytes: await renderTrainerAgreementPdf({ pkg: quotedView, client, trainer, dayRate: fromSen(inputs.trainerDayRate), days: inputs.days, outline }),
        actor,
        trainerId: trainer.id,
        meta: { quotation_id: approved.id, status: "TENTATIVE", day_rate: fromSen(inputs.trainerDayRate) },
      });
    }

    const first = await firstAgentVersion(tx, packageId);
    const diff = first ? lineItemsDiff(first.lineItems as StoredLineItem[], approved.lineItems as StoredLineItem[]) : {};

    const outcome = await transitionInTx(tx, {
      packageId,
      machine: "OPERATIONAL",
      to: "QUOTED",
      reason: "COMMERCIAL_TERMS_APPROVED",
      actor,
      metadata: {
        line_items_diff: diff,
        quotation_id: approved.id,
        version: approved.version,
        first_agent_version: first?.version ?? null,
        vault: { quotation: quotationDoc.id, form_hrd_ld: outlineDoc.id, trainer_agreement: agreementDoc?.id ?? null },
      },
      patch: {
        quotedAmount: approved.quotedAmount,
        allowableCostCap: approved.allowableCap,
        trainerDayRate: fromSen(inputs.trainerDayRate),
        costPolicyVersion: approved.costPolicyVersion,
        courseId: refs.courseId ?? pkg.courseId,
      },
    });

    const holds = await ensureHolds(tx, outcome.pkg, refs, inputs);
    await resolvePendingFor(tx, "GATE1_COMMERCIAL", pkg.packageCode, {
      status: "APPROVED",
      by: actor.id,
      chosenOption: "APPROVE",
      note: `Approved quotation v${approved.version}`,
    });
    await recordAudit(tx, {
      entityType: "QUOTATION",
      entityId: approved.id,
      reasonCode: "QUOTATION_APPROVED",
      details: `${pkg.packageCode} v${approved.version} approved by ${actor.id}`,
      metadata: { package_id: pkg.id, version: approved.version, quoted_amount: approved.quotedAmount, line_items_diff: diff },
    });

    return {
      outcome,
      quotation: approved,
      documents: { quotation: quotationDoc, outline: outlineDoc, trainerAgreement: agreementDoc },
      engagementId: holds.engagementId,
      commitmentId: holds.commitmentId,
      lineItemsDiff: diff,
    };
  });
}

// ---------------------------------------------------------------- after QUOTED
/** QUOTED → GRANT_PENDING. The FSM couples ESTIMATE → GRANT_RESERVED and enqueues the e-TRiS dossier. */
export async function clientAccepted(packageId: string, actor: Actor): Promise<TransitionOutcome> {
  return transition({ packageId, machine: "OPERATIONAL", to: "GRANT_PENDING", reason: "CLIENT_ACCEPTED_QUOTATION", actor });
}

/** QUOTED → DRAFT with the client's note, and the sourcing agent re-drafts from there. */
export async function requestRevision(packageId: string, note: string, actor: Actor): Promise<TransitionOutcome> {
  const text = note.trim();
  if (!text) throw new DomainError("NOTE_REQUIRED", "Say what the client asked to change");
  return withTx(actor, { reasonCode: "QUOTATION_REVISION_REQUESTED", reasonDetails: text }, async (tx) => {
    const outcome = await transitionInTx(tx, {
      packageId,
      machine: "OPERATIONAL",
      to: "DRAFT",
      reason: "QUOTATION_REVISION_REQUESTED",
      actor,
      details: text,
      metadata: { note: text },
    });
    await enqueue(tx, {
      type: "commercial.draft_proposal",
      payload: { packageId, revisionNote: text },
      idempotencyKey: draftProposalKey(packageId, outcome.pkg.version),
    });
    return outcome;
  });
}

// ---------------------------------------------------------------- Stage-4 helpers
/** TENTATIVE_HOLD → CONFIRMED, only for a TTT-verified trainer whose certificate covers the last training day. */
export async function confirmTrainer(engagementId: string, actor: Actor) {
  refuseAgent(actor, "confirm a trainer");
  return withTx(actor, { reasonCode: "TRAINER_CONFIRMED" }, async (tx) => {
    await tx.execute(sql`select id from tpms.trainer_engagements where id = ${engagementId}::uuid for update`);
    const [row] = await tx
      .select({ e: schema.trainerEngagements, t: schema.trainers, p: schema.trainingPackages })
      .from(schema.trainerEngagements)
      .innerJoin(schema.trainers, eq(schema.trainers.id, schema.trainerEngagements.trainerId))
      .innerJoin(schema.trainingPackages, eq(schema.trainingPackages.id, schema.trainerEngagements.packageId))
      .where(eq(schema.trainerEngagements.id, engagementId));
    if (!row) throw new DomainError("ENGAGEMENT_NOT_FOUND", `Trainer engagement ${engagementId} not found`);
    const { e, t, p } = row;
    if (e.status !== "TENTATIVE_HOLD") throw new DomainError("ENGAGEMENT_NOT_TENTATIVE", `The engagement is ${e.status}`);
    if (p.operationalStage === "CANCELLED") throw new DomainError("PACKAGE_CANCELLED", `${p.packageCode} is cancelled`);
    if (!t.tttVerified) throw new DomainError("TTT_UNVERIFIED", `${t.fullName}'s HRD Corp TTT certificate is not verified`);
    if (t.tttCertExpiryDate && p.endDate && t.tttCertExpiryDate < p.endDate) {
      throw new DomainError("TTT_EXPIRES_BEFORE_DELIVERY", `${t.fullName}'s TTT certificate expires on ${t.tttCertExpiryDate}, before the last training day ${p.endDate}`);
    }
    const [confirmed] = await tx
      .update(schema.trainerEngagements)
      .set({ status: "CONFIRMED", tttCertVerified: true })
      .where(eq(schema.trainerEngagements.id, engagementId))
      .returning();
    await recordAudit(tx, {
      entityType: "TRAINER_ENGAGEMENT",
      entityId: engagementId,
      reasonCode: "TRAINER_CONFIRMED",
      details: `${t.fullName} confirmed for ${p.packageCode}`,
      metadata: { package_id: p.id, trainer_id: t.id, day_rate: e.dayRate, ttt_cert_number: t.tttCertNumber },
    });
    return confirmed;
  });
}

const BEO_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

/** Vault the vendor-signed Banquet Event Order and move the venue commitment PROVISIONAL → BEO_SIGNED. */
export async function signVenueBeo(
  commitmentId: string,
  file: { bytes: Uint8Array; fileName?: string; mimeType?: string; referenceNumber?: string | null },
  actor: Actor,
) {
  refuseAgent(actor, "sign a venue BEO");
  const mimeType = file.mimeType ?? PDF_MIME;
  if (!BEO_MIME.has(mimeType)) throw new DomainError("UNSUPPORTED_FILE_TYPE", `A BEO must be a PDF or an image, not ${mimeType}`);
  if (!file.bytes || file.bytes.byteLength === 0) throw new DomainError("BEO_FILE_EMPTY", "The BEO file is empty");
  return withTx(actor, { reasonCode: "VENUE_BEO_SIGNED" }, async (tx) => {
    await tx.execute(sql`select id from tpms.vendor_commitments where id = ${commitmentId}::uuid for update`);
    const [row] = await tx
      .select({ c: schema.vendorCommitments, p: schema.trainingPackages })
      .from(schema.vendorCommitments)
      .innerJoin(schema.trainingPackages, eq(schema.trainingPackages.id, schema.vendorCommitments.packageId))
      .where(eq(schema.vendorCommitments.id, commitmentId));
    if (!row) throw new DomainError("COMMITMENT_NOT_FOUND", `Vendor commitment ${commitmentId} not found`);
    const { c, p } = row;
    if (c.vendorType !== "VENUE") throw new DomainError("NOT_A_VENUE", `Commitment ${commitmentId} is ${c.vendorType}, not a venue`);
    if (c.status !== "PROVISIONAL") throw new DomainError("COMMITMENT_NOT_PROVISIONAL", `The venue commitment is ${c.status}`);
    if (p.operationalStage === "CANCELLED") throw new DomainError("PACKAGE_CANCELLED", `${p.packageCode} is cancelled`);
    const doc = await storeDocument(tx, {
      packageId: p.id,
      documentType: "BEO",
      fileName: beoFileName(p.packageCode, file.fileName ?? "beo.pdf"),
      mimeType,
      bytes: file.bytes,
      uploadedBy: actor.id,
      verificationStatus: "VERIFIED",
      verifiedBy: actor.id,
      verificationNotes: "Vendor-signed BEO uploaded by the operator",
      extractedMetadata: { commitment_id: c.id, vendor_id: c.vendorId, reference_number: file.referenceNumber ?? null },
    });
    const [signed] = await tx
      .update(schema.vendorCommitments)
      .set({ status: "BEO_SIGNED", referenceNumber: file.referenceNumber ?? c.referenceNumber })
      .where(eq(schema.vendorCommitments.id, commitmentId))
      .returning();
    await recordAudit(tx, {
      entityType: "VENDOR_COMMITMENT",
      entityId: commitmentId,
      reasonCode: "VENUE_BEO_SIGNED",
      details: `BEO signed for ${p.packageCode}`,
      metadata: { package_id: p.id, vault_id: doc.id, reference_number: signed.referenceNumber },
    });
    return { commitment: signed, document: doc };
  });
}
