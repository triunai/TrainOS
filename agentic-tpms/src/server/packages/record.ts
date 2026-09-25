import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "../db/client";
import { DomainError } from "../domain/errors";
import { evaluateGuards, type GuardVerdict } from "../fsm/guards";
import { outgoing, type TransitionRule } from "../fsm/transitions";
import { loadSnapshot, type PackageSnapshot } from "./snapshot";
import { packageIdByCode } from "./queries";

/**
 * The record read model: snapshot + client + the moves available from here,
 * each pre-evaluated against the Level 0 guards so the screen can say exactly
 * what blocks the next step before anyone presses a button.
 * `cache` dedupes the load between the layout and the page in one request.
 */
export interface NextMove {
  rule: TransitionRule;
  verdict: GuardVerdict;
}

export interface PackageRecord {
  snapshot: PackageSnapshot;
  nextOps: NextMove[];
  nextFin: NextMove[];
  pendingDecisions: Array<typeof schema.decisions.$inferSelect>;
}

export const loadPackageRecord = cache(async (code: string): Promise<PackageRecord> => {
  const id = await packageIdByCode(code);
  if (!id) throw new DomainError("PACKAGE_NOT_FOUND", `No package ${code}`);
  const snapshot = await loadSnapshot(db(), id);
  const preview = (machine: "OPERATIONAL" | "FINANCIAL", from: string) =>
    outgoing(machine, from).map((rule) => {
      const projected = { ...snapshot, pkg: { ...snapshot.pkg, [machine === "OPERATIONAL" ? "operationalStage" : "financialStage"]: rule.to } };
      return { rule, verdict: evaluateGuards(projected, rule, rule.actors.includes("USER") ? "USER" : "SYSTEM") };
    });
  const pendingDecisions = await db()
    .select()
    .from(schema.decisions)
    .where(and(eq(schema.decisions.packageId, id), eq(schema.decisions.status, "PENDING")))
    .orderBy(desc(schema.decisions.createdAt));
  return {
    snapshot,
    nextOps: preview("OPERATIONAL", snapshot.pkg.operationalStage),
    nextFin: preview("FINANCIAL", snapshot.pkg.financialStage),
    pendingDecisions,
  };
});
