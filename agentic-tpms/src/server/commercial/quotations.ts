import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { formatRM, fromSen } from "@/lib/money";
import { recordAudit } from "../audit/ledger";
import { type Executor, type Tx, rows, schema } from "../db/client";
import type { Decision, Quotation, TrainingPackage } from "../db/schema";
import { raiseDecision } from "../decisions/service";
import { DomainError } from "../domain/errors";
import {
  computedSummary,
  toStoredInputs,
  toStoredLineItems,
  type PricedQuotation,
  type StoredLineItem,
} from "@/server/pricing";
import type { CourseOutline } from "./outline";

/**
 * Quotation versions: the Gate-1 worktree.
 *
 * WHY versions are append-only: the first AGENT version and the version the
 * operator approved are both kept, and the audit row of the QUOTED move
 * carries the field-level diff between them — the record shows exactly what
 * the human changed before signing.
 */
export const SOURCING_AGENT = "commercial.sourcing_agent";

/** Proposal references stored beside the model inputs in `quotations.inputs`. */
const refsSchema = z
  .object({
    courseId: z.string().uuid().nullable().optional(),
    trainerId: z.string().uuid().nullable().optional(),
    venueId: z.string().uuid().nullable().optional(),
  })
  .passthrough();

export interface ProposalRefs {
  courseId: string | null;
  trainerId: string | null;
  venueId: string | null;
}

export function proposalRefs(quotation: Pick<Quotation, "inputs">): ProposalRefs {
  const parsed = refsSchema.safeParse(quotation.inputs);
  if (!parsed.success) throw new Error(`Quotation inputs carry malformed proposal references: ${parsed.error.message}`);
  return { courseId: parsed.data.courseId ?? null, trainerId: parsed.data.trainerId ?? null, venueId: parsed.data.venueId ?? null };
}

/** numeric(6,2) holds ±9999.99; a pathological override (1 sen fee) must not crash the insert. */
function storablePct(pct: number): string {
  return Math.max(-9999.99, Math.min(9999.99, pct)).toFixed(2);
}

export async function lockPackage(tx: Tx, packageId: string): Promise<TrainingPackage> {
  await tx.execute(sql`select id from tpms.training_packages where id = ${packageId}::uuid for update`);
  const [pkg] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  return pkg;
}

export interface NewVersionInput {
  pkg: TrainingPackage;
  priced: PricedQuotation;
  refs: ProposalRefs;
  outline: CourseOutline | Record<string, unknown>;
  generatedBy: "AGENT" | "USER";
  provenance: Record<string, unknown>;
  extraInputs?: Record<string, unknown>;
  extraComputed?: Record<string, unknown>;
}

/**
 * Insert version n+1 as AWAITING_APPROVAL and supersede every open
 * (DRAFT / AWAITING_APPROVAL) version. The caller holds the package lock, so
 * two writers cannot both claim version n+1.
 */
export async function insertQuotationVersion(tx: Tx, input: NewVersionInput): Promise<Quotation> {
  const { pkg, priced } = input;
  const [{ next }] = await rows<{ next: number }>(
    tx,
    sql`select coalesce(max(version), 0)::int + 1 as next from tpms.quotations where package_id = ${pkg.id}::uuid`,
  );
  await tx
    .update(schema.quotations)
    .set({ status: "SUPERSEDED" })
    .where(and(eq(schema.quotations.packageId, pkg.id), inArray(schema.quotations.status, ["DRAFT", "AWAITING_APPROVAL"])));

  const r = priced.result;
  const [row] = await tx
    .insert(schema.quotations)
    .values({
      packageId: pkg.id,
      version: next,
      status: "AWAITING_APPROVAL",
      inputs: {
        ...toStoredInputs(priced.inputs),
        courseId: input.refs.courseId,
        trainerId: input.refs.trainerId,
        venueId: input.refs.venueId,
        startDate: pkg.startDate,
        endDate: pkg.endDate,
        ...(input.extraInputs ?? {}),
      },
      lineItems: toStoredLineItems(r.lineItems),
      computed: { ...computedSummary(r), engines: priced.engines, univerMs: priced.sheet.durationMs, ...(input.extraComputed ?? {}) },
      allowableCap: fromSen(r.allowableCap),
      quotedAmount: fromSen(r.quotedFee),
      totalDirectCost: fromSen(r.totalDirectCost),
      grossMargin: fromSen(r.grossMargin),
      marginPct: storablePct(r.marginPct),
      costPolicyVersion: priced.inputs.policy.version,
      courseOutline: input.outline as Record<string, unknown>,
      sheetSnapshot: priced.sheet.snapshot,
      generatedBy: input.generatedBy,
      provenance: input.provenance,
    })
    .returning();

  await recordAudit(tx, {
    entityType: "QUOTATION",
    entityId: row.id,
    reasonCode: input.generatedBy === "AGENT" ? "QUOTATION_DRAFTED" : "QUOTATION_REVISED",
    details: `${pkg.packageCode} v${row.version} ${formatRM(row.quotedAmount)} (cap ${formatRM(row.allowableCap)}, margin ${row.marginPct}%)`,
    metadata: {
      package_id: pkg.id,
      version: row.version,
      quoted_amount: row.quotedAmount,
      allowable_cap: row.allowableCap,
      margin_pct: row.marginPct,
      warnings: r.warnings,
      generated_by: input.generatedBy,
    },
  });
  return row;
}

export async function raiseGate1Decision(
  executor: Executor,
  input: { pkg: TrainingPackage; quotation: Quotation; warnings: string[]; raisedBy: string; tier: "L0" | "L3"; note?: string },
): Promise<Decision> {
  const { pkg, quotation } = input;
  const warningText = input.warnings.length ? ` Warnings: ${input.warnings.join(", ")}.` : "";
  return raiseDecision(executor, {
    gate: "GATE1_COMMERCIAL",
    packageId: pkg.id,
    subjectRef: pkg.packageCode,
    title: `Approve quotation v${quotation.version} · ${pkg.title}`,
    summary:
      `Fee ${formatRM(quotation.quotedAmount)} against a cap of ${formatRM(quotation.allowableCap)} (${quotation.costPolicyVersion}); ` +
      `direct cost ${formatRM(quotation.totalDirectCost)}, margin ${formatRM(quotation.grossMargin)} (${quotation.marginPct}%).${warningText}` +
      (input.note ? ` Note: ${input.note}` : ""),
    payload: {
      quotationId: quotation.id,
      version: quotation.version,
      quotedAmount: quotation.quotedAmount,
      allowableCap: quotation.allowableCap,
      marginPct: quotation.marginPct,
      warnings: input.warnings,
      refs: proposalRefs(quotation),
    },
    options: [
      {
        id: "APPROVE",
        label: "Approve & dispatch",
        description: `Approve v${quotation.version}, store the quotation, Form HRD-L&D and trainer agreement, and move the package to Quoted`,
        consequence: "The client receives the quotation; the trainer and venue are held tentatively",
      },
      {
        id: "REVISE",
        label: "Edit on the canvas",
        description: "Change costs or the fee; the server recomputes a new version with both engines",
      },
    ],
    raisedBy: input.raisedBy,
    raisedByTier: input.tier,
    slaHours: 24,
  });
}

export interface LineChange {
  old: Pick<StoredLineItem, "qty" | "unitCost" | "amount" | "label"> | null;
  new: Pick<StoredLineItem, "qty" | "unitCost" | "amount" | "label"> | null;
  fields: string[];
}

/** Field-level diff of line items, keyed by line code. Unchanged lines are omitted. */
export function lineItemsDiff(before: StoredLineItem[], after: StoredLineItem[]): Record<string, LineChange> {
  const pick = (l: StoredLineItem | undefined) => (l ? { label: l.label, qty: l.qty, unitCost: l.unitCost, amount: l.amount } : null);
  const codes = [...new Set([...before.map((l) => l.code), ...after.map((l) => l.code)])];
  const diff: Record<string, LineChange> = {};
  for (const code of codes) {
    const a = before.find((l) => l.code === code);
    const b = after.find((l) => l.code === code);
    const fields = (["qty", "unit", "unitCost", "amount", "label"] as const).filter((f) => (a ? a[f] : undefined) !== (b ? b[f] : undefined));
    if (fields.length > 0) diff[code] = { old: pick(a), new: pick(b), fields };
  }
  return diff;
}

export async function firstAgentVersion(executor: Executor, packageId: string): Promise<Quotation | undefined> {
  const [row] = await executor
    .select()
    .from(schema.quotations)
    .where(and(eq(schema.quotations.packageId, packageId), eq(schema.quotations.generatedBy, "AGENT")))
    .orderBy(asc(schema.quotations.version))
    .limit(1);
  return row;
}

export async function supersedeOthers(tx: Tx, packageId: string, keepId: string): Promise<void> {
  await tx
    .update(schema.quotations)
    .set({ status: "SUPERSEDED" })
    .where(
      and(
        eq(schema.quotations.packageId, packageId),
        ne(schema.quotations.id, keepId),
        inArray(schema.quotations.status, ["DRAFT", "AWAITING_APPROVAL"]),
      ),
    );
}
