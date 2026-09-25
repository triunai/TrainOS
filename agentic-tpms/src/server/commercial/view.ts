import { and, desc, eq, ne } from "drizzle-orm";
import { type Actor, db, schema, withTx } from "../db/client";
import type { Decision, Quotation, TrainingPackage } from "../db/schema";
import { DomainError } from "../domain/errors";
import { enqueue } from "../queue/queue";
import { EDITABLE_CELLS, QUOTE_CELLS } from "@/server/pricing";
import type { TrainerEngagement, VendorCommitment } from "../packages/snapshot";

/**
 * Read model for the Commercial desk and the quotation canvas: everything a
 * screen needs to render Gate 1 for one package in one call, so the UI never
 * assembles the aggregate itself.
 */
export interface QuotationSummary {
  id: string;
  version: number;
  status: string;
  generatedBy: string;
  quotedAmount: string;
  allowableCap: string;
  marginPct: string;
  createdAt: Date;
  approvedBy: string | null;
}

export interface CommercialView {
  pkg: TrainingPackage;
  versions: QuotationSummary[];
  /** The newest version in full: line items, outline, and `sheetSnapshot` for the Univer canvas. */
  latest: Quotation | null;
  canvas: { editableCells: typeof EDITABLE_CELLS; cellAddresses: typeof QUOTE_CELLS };
  pendingDecision: Decision | null;
  engagement: TrainerEngagement | null;
  venueCommitments: VendorCommitment[];
}

export async function getCommercialView(packageId: string): Promise<CommercialView> {
  const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const all = await db().select().from(schema.quotations).where(eq(schema.quotations.packageId, packageId)).orderBy(desc(schema.quotations.version));
  const [pendingDecision] = await db()
    .select()
    .from(schema.decisions)
    .where(and(eq(schema.decisions.gate, "GATE1_COMMERCIAL"), eq(schema.decisions.subjectRef, pkg.packageCode), eq(schema.decisions.status, "PENDING")));
  const [engagement] = await db()
    .select()
    .from(schema.trainerEngagements)
    .where(and(eq(schema.trainerEngagements.packageId, packageId), ne(schema.trainerEngagements.status, "RELEASED")));
  const venueCommitments = await db()
    .select()
    .from(schema.vendorCommitments)
    .where(and(eq(schema.vendorCommitments.packageId, packageId), eq(schema.vendorCommitments.vendorType, "VENUE")));
  return {
    pkg,
    versions: all.map((q) => ({
      id: q.id,
      version: q.version,
      status: q.status,
      generatedBy: q.generatedBy,
      quotedAmount: q.quotedAmount,
      allowableCap: q.allowableCap,
      marginPct: q.marginPct,
      createdAt: q.createdAt,
      approvedBy: q.approvedBy,
    })),
    latest: all[0] ?? null,
    canvas: { editableCells: EDITABLE_CELLS, cellAddresses: QUOTE_CELLS },
    pendingDecision: pendingDecision ?? null,
    engagement: engagement ?? null,
    venueCommitments,
  };
}

/** "Draft proposal" button: queue the sourcing agent for a DRAFT package (idempotent per package version). */
export async function requestProposalDraft(packageId: string, actor: Actor): Promise<{ taskId: string | null }> {
  return withTx(actor, { reasonCode: "PROPOSAL_REQUESTED" }, async (tx) => {
    const [pkg] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    if (pkg.operationalStage !== "DRAFT") throw new DomainError("PACKAGE_NOT_DRAFT", `${pkg.packageCode} is ${pkg.operationalStage}`);
    const taskId = await enqueue(tx, {
      type: "commercial.draft_proposal",
      payload: { packageId },
      idempotencyKey: `draft:${packageId}:v${pkg.version}`,
    });
    return { taskId };
  });
}
