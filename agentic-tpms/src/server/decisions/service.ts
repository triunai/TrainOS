import { and, desc, eq, sql } from "drizzle-orm";
import { type Executor, db, schema } from "../db/client";
import type { Decision, DecisionOption } from "../db/schema";
import { DomainError } from "../domain/errors";

/**
 * The HITL decision queue behind the Decisions Desk. An agent or rule RAISES
 * a decision; only a named operator RESOLVES one. One pending decision per
 * (gate, subject) — raising it again returns the existing row instead of
 * stacking duplicates (unique partial index `uq_pending_decision`).
 */
export type Gate = Decision["gate"];

export const GATES = [
  "GATE1_COMMERCIAL",
  "GRANT_VERIFICATION",
  "GATE2_VIABILITY",
  "ATTENDANCE_EXCEPTION",
  "GATE3_CLAIM_REVIEW",
  "GATE3_AP_DISBURSEMENT",
  "OUTBOX_BATCH",
  "LEAD_TRIAGE",
  "RETENTION_PROPOSAL",
] as const;

export const GATE_LABEL: Record<(typeof GATES)[number], string> = {
  GATE1_COMMERCIAL: "Gate 1 · Commercial sign-off",
  GRANT_VERIFICATION: "Grant verification",
  GATE2_VIABILITY: "Gate 2 · T-14 viability",
  ATTENDANCE_EXCEPTION: "Attendance exception",
  GATE3_CLAIM_REVIEW: "Gate 3 · Claim pack review",
  GATE3_AP_DISBURSEMENT: "Gate 3 · AP disbursement",
  OUTBOX_BATCH: "Outbound outbox",
  LEAD_TRIAGE: "Lead triage",
  RETENTION_PROPOSAL: "Retention proposal",
};

export interface RaiseInput {
  gate: (typeof GATES)[number];
  packageId?: string | null;
  subjectRef: string;
  title: string;
  summary: string;
  payload?: Record<string, unknown>;
  options?: DecisionOption[];
  raisedBy: string;
  raisedByTier?: "L0" | "L1" | "L2" | "L3" | "L4";
  slaHours?: number;
}

export async function raiseDecision(executor: Executor, input: RaiseInput): Promise<Decision> {
  const [existing] = await executor
    .select()
    .from(schema.decisions)
    .where(and(eq(schema.decisions.gate, input.gate), eq(schema.decisions.subjectRef, input.subjectRef), eq(schema.decisions.status, "PENDING")));
  if (existing) {
    const [refreshed] = await executor
      .update(schema.decisions)
      .set({ summary: input.summary, payload: input.payload ?? existing.payload, options: input.options ?? existing.options })
      .where(eq(schema.decisions.id, existing.id))
      .returning();
    return refreshed;
  }
  const [row] = await executor
    .insert(schema.decisions)
    .values({
      gate: input.gate,
      packageId: input.packageId ?? null,
      subjectRef: input.subjectRef,
      title: input.title,
      summary: input.summary,
      payload: input.payload ?? {},
      options: input.options ?? [],
      raisedBy: input.raisedBy,
      raisedByTier: input.raisedByTier ?? null,
      slaDueAt: input.slaHours ? new Date(Date.now() + input.slaHours * 3600_000) : null,
    })
    .returning();
  return row;
}

export async function resolveDecision(
  executor: Executor,
  id: string,
  resolution: { status: "APPROVED" | "REJECTED" | "RESOLVED"; by: string; chosenOption?: string; note?: string },
): Promise<Decision> {
  const [row] = await executor
    .update(schema.decisions)
    .set({
      status: resolution.status,
      resolvedBy: resolution.by,
      resolvedAt: new Date(),
      chosenOption: resolution.chosenOption ?? null,
      resolutionNote: resolution.note ?? null,
    })
    .where(and(eq(schema.decisions.id, id), eq(schema.decisions.status, "PENDING")))
    .returning();
  if (!row) throw new DomainError("DECISION_NOT_PENDING", "This decision was already resolved by someone else");
  return row;
}

/** Resolve whatever is pending for (gate, subject) — used when the gate's action itself settles it. */
export async function resolvePendingFor(
  executor: Executor,
  gate: (typeof GATES)[number],
  subjectRef: string,
  resolution: { status: "APPROVED" | "REJECTED" | "RESOLVED"; by: string; chosenOption?: string; note?: string },
): Promise<Decision | undefined> {
  const [pending] = await executor
    .select()
    .from(schema.decisions)
    .where(and(eq(schema.decisions.gate, gate), eq(schema.decisions.subjectRef, subjectRef), eq(schema.decisions.status, "PENDING")));
  return pending ? resolveDecision(executor, pending.id, resolution) : undefined;
}

export async function listDecisions(opts: { status?: string; packageId?: string; limit?: number } = {}): Promise<Decision[]> {
  const where = [
    opts.status ? eq(schema.decisions.status, opts.status) : undefined,
    opts.packageId ? eq(schema.decisions.packageId, opts.packageId) : undefined,
  ].filter(Boolean);
  return db()
    .select()
    .from(schema.decisions)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.decisions.createdAt))
    .limit(opts.limit ?? 200);
}

export async function pendingCount(): Promise<number> {
  const result = await db().execute(sql`select count(*)::int as n from tpms.decisions where status = 'PENDING'`);
  return (result.rows[0] as { n: number }).n;
}
