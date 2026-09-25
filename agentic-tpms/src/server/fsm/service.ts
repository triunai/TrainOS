import { eq, sql } from "drizzle-orm";
import { addDays, startOfDayMY } from "@/lib/dates";
import { type Actor, type Tx, setAuditContext, schema, withTx, SYSTEM_ACTOR } from "../db/client";
import type { TrainingPackage } from "../db/schema";
import { DomainError } from "../domain/errors";
import type { Machine } from "../domain/stages";
import { enqueue } from "../queue/queue";
import { loadSnapshotFor } from "../packages/snapshot";
import { evaluateGuards, type GuardResult } from "./guards";
import { checkTransition } from "./transitions";

/**
 * The only code path that moves a package between stages.
 *
 *   1. lock the aggregate row (FOR UPDATE) so two operators cannot race it
 *   2. check the move against the transition table (same table as the DB)
 *   3. run the Level 0 guards against a snapshot with the patch applied
 *   4. stamp actor + reason on the transaction and write the row — the DB
 *      re-checks the move and writes the hash-chained audit entry itself
 *   5. apply the cross-machine coupling and enqueue reactions, in the same
 *      transaction, so the event and its follow-up work commit together
 */
export type PackagePatch = Partial<
  Pick<
    TrainingPackage,
    | "deliveryMode"
    | "venueByClient"
    | "startDate"
    | "endDate"
    | "paxEstimate"
    | "minParticipants"
    | "etrisGrantId"
    | "grantApprovedAmount"
    | "grantApprovedPax"
    | "grantApprovedAt"
    | "quotedAmount"
    | "allowableCostCap"
    | "trainerDayRate"
    | "costPolicyVersion"
    | "upfront30pctClaimed"
    | "upfrontAmount"
    | "claimSubmissionRef"
    | "hrdcApprovedAmount"
    | "remittanceAmount"
    | "remittanceReference"
    | "remittedAt"
    | "vendorAutoconfirmHalted"
    | "cancellationReason"
    | "postponedFromStart"
    | "title"
    | "courseId"
  >
>;

export interface TransitionInput {
  packageId: string;
  machine: Machine;
  to: string;
  reason: string;
  actor: Actor;
  details?: string;
  metadata?: Record<string, unknown>;
  patch?: PackagePatch;
}

export interface TransitionOutcome {
  pkg: TrainingPackage;
  from: string;
  to: string;
  warnings: GuardResult[];
  followUps: Array<{ machine: Machine; from: string; to: string; reason: string }>;
}

const stageColumn = (machine: Machine) => (machine === "OPERATIONAL" ? "operationalStage" : "financialStage");

export async function transition(input: TransitionInput): Promise<TransitionOutcome> {
  return withTx(input.actor, { reasonCode: input.reason, reasonDetails: input.details }, (tx) => transitionInTx(tx, input));
}

export async function transitionInTx(tx: Tx, input: TransitionInput): Promise<TransitionOutcome> {
  const locked = await tx.execute(sql`select id from tpms.training_packages where id = ${input.packageId}::uuid for update`);
  if (locked.rows.length === 0) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${input.packageId} not found`);
  const [current] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, input.packageId));

  const from = current[stageColumn(input.machine)];
  const check = checkTransition(input.machine, from, input.to, input.reason, input.actor.type);
  if (!check.ok) throw new DomainError(check.code, check.message, { from, to: input.to, reason: input.reason });

  // Guards see the package as it WILL be: the patch travels with the move.
  const projected: TrainingPackage = { ...current, ...(input.patch ?? {}), [stageColumn(input.machine)]: input.to };
  const snapshot = await loadSnapshotFor(tx, projected);
  const verdict = evaluateGuards(snapshot, check.rule, input.actor.type);
  if (verdict.blocking.length > 0) {
    throw new DomainError(
      "GUARD_FAILED",
      verdict.blocking.map((g) => g.message).join("; "),
      { failures: verdict.blocking, warnings: verdict.warnings, from, to: input.to, reason: input.reason },
    );
  }

  await setAuditContext(tx, input.actor, {
    reasonCode: input.reason,
    reasonDetails: input.details ?? check.rule.description,
    metadata: {
      ...(input.metadata ?? {}),
      ...(verdict.warnings.length ? { guard_warnings: verdict.warnings } : {}),
    },
  });

  const [updated] = await tx
    .update(schema.trainingPackages)
    .set({ ...(input.patch ?? {}), [stageColumn(input.machine)]: input.to })
    .where(eq(schema.trainingPackages.id, input.packageId))
    .returning();

  const followUps = await couple(tx, input, from, updated);
  const [final] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, input.packageId));
  return { pkg: final, from, to: input.to, warnings: verdict.warnings, followUps };
}

/**
 * Event coupling between the two machines, plus the reactions each move
 * schedules. Follow-up transitions run through `transitionInTx`, so they are
 * guarded and audited exactly like a direct one.
 */
async function couple(tx: Tx, input: TransitionInput, from: string, pkg: TrainingPackage) {
  const followUps: TransitionOutcome["followUps"] = [];
  const run = async (machine: Machine, to: string, reason: string, actor: Actor = input.actor) => {
    const outcome = await transitionInTx(tx, { packageId: pkg.id, machine, to, reason, actor });
    followUps.push({ machine, from: outcome.from, to, reason }, ...outcome.followUps);
  };
  const id = pkg.id;

  if (input.machine === "OPERATIONAL") {
    switch (input.to) {
      case "QUOTED":
        await enqueue(tx, { type: "commercial.dispatch_quotation", payload: { packageId: id }, idempotencyKey: `dispatch:${id}:v${pkg.version}` });
        break;
      case "GRANT_PENDING":
        if (pkg.financialStage === "ESTIMATE") await run("FINANCIAL", "GRANT_RESERVED", "CLIENT_ACCEPTED_QUOTATION");
        await enqueue(tx, { type: "grant.compile_dossier", payload: { packageId: id }, idempotencyKey: `dossier:${id}:${pkg.version}` });
        break;
      case "GRANT_APPROVED":
        if (pkg.startDate) {
          const t14 = addDays(pkg.startDate, -14);
          await enqueue(tx, {
            type: "viability.t14_check",
            payload: { packageId: id, startDate: pkg.startDate },
            dueAt: startOfDayMY(t14),
            idempotencyKey: `t14:${id}:${pkg.startDate}`,
          });
        }
        break;
      case "READY_FOR_EVENT":
        await enqueue(tx, { type: "delivery.issue_magic_links", payload: { packageId: id }, idempotencyKey: `links:${id}:${pkg.startDate}` });
        if (pkg.startDate) {
          await enqueue(tx, {
            type: "delivery.start",
            payload: { packageId: id },
            dueAt: new Date(startOfDayMY(pkg.startDate).getTime() + 7 * 3600_000),
            idempotencyKey: `start:${id}:${pkg.startDate}`,
          });
        }
        break;
      case "DELIVERY_COMPLETED":
        if (pkg.financialStage === "GRANT_RESERVED" || pkg.financialStage === "UPFRONT_CLAIM_SUBMITTED") {
          await run("FINANCIAL", "CLAIM_NOT_READY", "TRAINING_COMPLETED", SYSTEM_ACTOR);
        }
        await enqueue(tx, { type: "certificates.issue", payload: { packageId: id }, idempotencyKey: `certs:${id}` });
        await enqueue(tx, { type: "retention.schedule", payload: { packageId: id }, idempotencyKey: `retention:${id}` });
        break;
      case "CANCELLED":
        if (["ESTIMATE", "GRANT_RESERVED", "UPFRONT_CLAIM_SUBMITTED"].includes(pkg.financialStage)) {
          await run("FINANCIAL", "VOIDED", "PACKAGE_CANCELLED");
        }
        break;
      default:
        break;
    }
  } else {
    switch (input.to) {
      case "CLAIM_NOT_READY":
        await enqueue(tx, { type: "claims.collate", payload: { packageId: id }, idempotencyKey: `collate:${id}:${pkg.version}` });
        break;
      case "REMITTED":
        await enqueue(tx, { type: "finance.draft_payment_vouchers", payload: { packageId: id }, idempotencyKey: `pv:${id}` });
        break;
      default:
        break;
    }
  }
  void from;
  return followUps;
}

/**
 * A field update that is not a stage change (dates, headcount, trainer rate).
 * Still goes through the audit context — the database refuses it otherwise.
 */
export async function updatePackageFields(
  packageId: string,
  patch: PackagePatch,
  actor: Actor,
  reasonCode: string,
  details?: string,
  tx?: Tx,
): Promise<TrainingPackage> {
  const work = async (t: Tx) => {
    await setAuditContext(t, actor, { reasonCode, reasonDetails: details });
    const [row] = await t
      .update(schema.trainingPackages)
      .set(patch)
      .where(eq(schema.trainingPackages.id, packageId))
      .returning();
    if (!row) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    return row;
  };
  return tx ? work(tx) : withTx(actor, { reasonCode, reasonDetails: details }, work);
}
