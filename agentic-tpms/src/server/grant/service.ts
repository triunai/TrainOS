import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { addDays } from "@/lib/dates";
import { fromSen, toSen } from "@/lib/money";
import { type Actor, type Tx, db, schema, withTx } from "../db/client";
import type { TrainingPackage, VaultDocument } from "../db/schema";
import { resolvePendingFor } from "../decisions/service";
import { DomainError } from "../domain/errors";
import { transition, transitionInTx, type PackagePatch, type TransitionOutcome } from "../fsm/service";
import { checkTransition } from "../fsm/transitions";
import { setVerification } from "../storage/vault";
import { lockPackage } from "@/server/commercial";

/**
 * Stage 3 decisions: confirm the grant (GRANT_PENDING → GRANT_APPROVED) and
 * file the optional 30% upfront claim (GRANT_RESERVED → UPFRONT_CLAIM_SUBMITTED).
 *
 * WHY the operator's values win over the extractor's: the letter is the
 * source of truth, the extraction is a reading aid. Every field where the
 * operator's entry differs from what the extractor read is kept in the
 * audit metadata, so a later query about the grant shows both.
 */
export const UPFRONT_CLAIM_RATE = 0.3;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates are YYYY-MM-DD");
export const confirmGrantSchema = z
  .object({
    grantId: z.string().trim().min(6).max(64).transform((s) => s.toUpperCase()),
    approvedAmount: z.union([z.string(), z.number()]).transform((v, ctx) => {
      const text = String(v).replace(/[,\s]/g, "").replace(/^RM/i, "");
      if (!/^\d+(\.\d{1,2})?$/.test(text) || toSen(text) <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approvedAmount must be a positive ringgit amount" });
        return z.NEVER;
      }
      return fromSen(toSen(text));
    }),
    approvedPax: z.number().int().min(1).max(999),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
  })
  .strict()
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: "endDate is before startDate" });
export type ConfirmGrantInput = z.input<typeof confirmGrantSchema>;

async function latestLetter(tx: Tx, packageId: string): Promise<VaultDocument | undefined> {
  const [row] = await tx
    .select()
    .from(schema.complianceVault)
    .where(
      and(
        eq(schema.complianceVault.packageId, packageId),
        eq(schema.complianceVault.documentType, "ETRIS_APPROVAL"),
        ne(schema.complianceVault.verificationStatus, "FLAGGED"),
      ),
    )
    .orderBy(desc(schema.complianceVault.createdAt))
    .limit(1);
  return row;
}

/** When the grant moves the dates, the tentative trainer hold and provisional venue deadlines move with them. */
async function realignHolds(tx: Tx, pkg: TrainingPackage): Promise<void> {
  if (!pkg.startDate) return;
  await tx
    .update(schema.trainerEngagements)
    .set({ holdExpiryDate: pkg.startDate })
    .where(and(eq(schema.trainerEngagements.packageId, pkg.id), eq(schema.trainerEngagements.status, "TENTATIVE_HOLD")));
  const provisional = await tx
    .select({ c: schema.vendorCommitments, v: schema.vendors })
    .from(schema.vendorCommitments)
    .innerJoin(schema.vendors, eq(schema.vendors.id, schema.vendorCommitments.vendorId))
    .where(and(eq(schema.vendorCommitments.packageId, pkg.id), eq(schema.vendorCommitments.status, "PROVISIONAL")));
  for (const { c, v } of provisional) {
    await tx
      .update(schema.vendorCommitments)
      .set({
        cancellationDeadline: addDays(pkg.startDate, -v.cancellationNoticeDays),
        postponementDeadline: addDays(pkg.startDate, -v.freePostponementDays),
      })
      .where(eq(schema.vendorCommitments.id, c.id));
  }
}

export async function confirmGrant(packageId: string, input: ConfirmGrantInput, actor: Actor): Promise<{ outcome: TransitionOutcome; letter: VaultDocument }> {
  const parsed = confirmGrantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_GRANT_DETAILS", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  const values = parsed.data;

  const [pre] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pre) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const check = checkTransition("OPERATIONAL", pre.operationalStage, "GRANT_APPROVED", "GRANT_CONFIRMED_LOCKED", actor.type);
  if (!check.ok) throw new DomainError(check.code, check.message, { from: pre.operationalStage, to: "GRANT_APPROVED" });

  return withTx(actor, { reasonCode: "GRANT_CONFIRMED_LOCKED" }, async (tx) => {
    const pkg = await lockPackage(tx, packageId);
    const letter = await latestLetter(tx, packageId);
    if (!letter) throw new DomainError("APPROVAL_LETTER_MISSING", "Upload the e-TRiS approval letter before confirming the grant");

    const extraction = (letter.extractedMetadata.extraction ?? null) as Record<string, unknown> | null;
    const confirmed = {
      grantId: values.grantId,
      approvedAmount: values.approvedAmount,
      approvedPax: values.approvedPax,
      startDate: values.startDate ?? pkg.startDate,
      endDate: values.endDate ?? pkg.endDate,
    };
    const overrides: Record<string, { extracted: unknown; confirmed: unknown }> = {};
    if (extraction) {
      for (const [field, value] of Object.entries(confirmed)) {
        const read = extraction[field];
        const same = field === "approvedAmount" && typeof read === "string" ? toSen(read) === toSen(String(value)) : read === value;
        if (read !== null && read !== undefined && !same) overrides[field] = { extracted: read, confirmed: value };
      }
    }

    const verified = await setVerification(
      tx,
      letter.id,
      "VERIFIED",
      actor.id,
      Object.keys(overrides).length ? `Verified with operator corrections: ${Object.keys(overrides).join(", ")}` : "Verified against the e-TRiS approval letter",
      { ...letter.extractedMetadata, confirmed, overrides },
    );

    const datesMoved = confirmed.startDate !== pkg.startDate || confirmed.endDate !== pkg.endDate;
    const patch: PackagePatch = {
      etrisGrantId: values.grantId,
      grantApprovedAmount: values.approvedAmount,
      grantApprovedPax: values.approvedPax,
      grantApprovedAt: new Date(),
      ...(datesMoved ? { startDate: confirmed.startDate, endDate: confirmed.endDate } : {}),
    };
    const outcome = await transitionInTx(tx, {
      packageId,
      machine: "OPERATIONAL",
      to: "GRANT_APPROVED",
      reason: "GRANT_CONFIRMED_LOCKED",
      actor,
      metadata: { vault_id: letter.id, confirmed, overrides, extraction_available: Boolean(extraction) },
      patch,
    });
    if (datesMoved) await realignHolds(tx, outcome.pkg);
    await resolvePendingFor(tx, "GRANT_VERIFICATION", pkg.packageCode, {
      status: "APPROVED",
      by: actor.id,
      chosenOption: "CONFIRM",
      note: `Grant ${values.grantId} confirmed at ${values.approvedAmount}`,
    });
    return { outcome, letter: verified };
  });
}

/** The operator rejects a letter (wrong programme, unreadable): FLAGGED in the vault, decision closed as REJECTED. */
export async function flagApprovalLetter(packageId: string, vaultId: string, note: string, actor: Actor): Promise<VaultDocument> {
  if (actor.type !== "USER") throw new DomainError("USER_REQUIRED", "Only an operator flags an approval letter");
  if (!note.trim()) throw new DomainError("NOTE_REQUIRED", "Say why the letter is flagged");
  return withTx(actor, { reasonCode: "ETRIS_APPROVAL_FLAGGED", reasonDetails: note }, async (tx) => {
    const pkg = await lockPackage(tx, packageId);
    const [doc] = await tx.select().from(schema.complianceVault).where(eq(schema.complianceVault.id, vaultId));
    if (!doc || doc.packageId !== packageId || doc.documentType !== "ETRIS_APPROVAL") {
      throw new DomainError("DOCUMENT_NOT_FOUND", `No approval letter ${vaultId} on ${pkg.packageCode}`);
    }
    const flagged = await setVerification(tx, vaultId, "FLAGGED", actor.id, note.trim());
    await resolvePendingFor(tx, "GRANT_VERIFICATION", pkg.packageCode, { status: "REJECTED", by: actor.id, chosenOption: "FLAG", note: note.trim() });
    return flagged;
  });
}

/** 30% of the approved grant, rounded to the sen exactly as the L0 guard computes it. */
export function upfrontAmountSen(grantApprovedAmount: string | null): number {
  return Math.round(toSen(grantApprovedAmount) * UPFRONT_CLAIM_RATE);
}

export async function fileUpfrontClaim(packageId: string, actor: Actor): Promise<TransitionOutcome> {
  const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  if (toSen(pkg.grantApprovedAmount) <= 0) throw new DomainError("GRANT_NOT_APPROVED", "Confirm the grant before filing the upfront claim");
  const upfront = upfrontAmountSen(pkg.grantApprovedAmount);
  return transition({
    packageId,
    machine: "FINANCIAL",
    to: "UPFRONT_CLAIM_SUBMITTED",
    reason: "UPFRONT_CLAIM_FILED",
    actor,
    metadata: { upfront_rate: UPFRONT_CLAIM_RATE, grant_approved_amount: pkg.grantApprovedAmount, upfront_amount: fromSen(upfront) },
    patch: { upfrontAmount: fromSen(upfront), upfront30pctClaimed: true },
  });
}
