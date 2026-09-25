import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { addDays, daysBetween, todayMY } from "@/lib/dates";
import { fromSen, toSen } from "@/lib/money";
import { type Actor, type Tx, db, rows, schema, SYSTEM_ACTOR, withTx } from "../db/client";
import type { DecisionOption } from "../db/schema";
import { DomainError } from "../domain/errors";
import { raiseDecision, resolvePendingFor } from "../decisions/service";
import { transitionInTx, updatePackageFields } from "../fsm/service";
import { loadSnapshot, type PackageSnapshot } from "../packages/snapshot";
import { finishAgentRun, startAgentRun } from "../ai/runs";
import { recordAudit } from "../audit/ledger";

/**
 * HITL Gate 2 — the T-14 viability & contingency desk.
 *
 * At start−14 days a leased task counts the registered cohort. At or above the
 * minimum viable cohort the package advances to READY_FOR_EVENT on its own
 * (SYSTEM, T14_VIABILITY_PASSED). Below it, automatic vendor confirmations
 * HALT and a decision is raised with the three contingency playbooks from the
 * handoff spec — postpone inside the free venue window, pivot to Remote Online
 * Training (venue DDR zeroed), or cancel and release tentative holds — plus an
 * explicit "proceed anyway" override. Only a named operator chooses.
 *
 * Money figures on the options are EXPOSURE estimates: inside a vendor's free
 * window the exposure is zero; past it the full committed cost is shown as the
 * worst case, because penalty schedules live in each vendor's contract.
 */
export type ViabilityChoice = "POSTPONE" | "PIVOT_ROT" | "CANCEL" | "PROCEED";

export interface ViabilityAssessment {
  packageId: string;
  packageCode: string;
  stage: string;
  activeParticipants: number;
  minParticipants: number;
  viable: boolean;
  daysToStart: number | null;
  windowOpen: boolean;
  venueExposure: { postponeSen: number; cancelSen: number; committedSen: number };
  trainer: { name: string | null; status: string | null; releasePenaltySen: number; confirmed: boolean };
  rot: { capSen: number | null; grantSen: number; amendmentNeeded: boolean; venueSavingSen: number };
  options: DecisionOption[];
}

async function rotCapSen(executor: Tx | ReturnType<typeof db>, pax: number, days: number): Promise<number | null> {
  const [policy] = await rows<{ basis: string; bands: Array<{ minPax: number; maxPax: number; dailyCap: number }> }>(
    executor,
    sql`select basis, bands from tpms.cost_matrix_policies
         where delivery_mode = 'ROT_VIRTUAL' and active and effective_from <= current_date
         order by effective_from desc limit 1`,
  );
  if (!policy || days <= 0) return null;
  const band = policy.bands.find((b) => pax >= b.minPax && pax <= b.maxPax);
  if (!band) return null;
  const perDay = toSen(band.dailyCap);
  return policy.basis === "PER_PAX_DAY" ? perDay * pax * days : perDay * days;
}

export async function assessViability(packageId: string, executor: Tx | ReturnType<typeof db> = db()): Promise<ViabilityAssessment> {
  const s = await loadSnapshot(executor, packageId);
  return assessFromSnapshot(s, executor);
}

async function assessFromSnapshot(s: PackageSnapshot, executor: Tx | ReturnType<typeof db>): Promise<ViabilityAssessment> {
  const today = s.today;
  const venueLike = s.commitments.filter((c) => c.status !== "CANCELLED" && (c.vendorType === "VENUE" || c.vendorType === "CATERING"));
  const committedSen = venueLike.reduce((acc, c) => acc + toSen(c.cost), 0);
  const postponeSen = venueLike
    .filter((c) => !c.postponementDeadline || c.postponementDeadline < today)
    .reduce((acc, c) => acc + toSen(c.cost), 0);
  const cancelSen = venueLike.filter((c) => c.cancellationDeadline < today).reduce((acc, c) => acc + toSen(c.cost), 0);
  const trainerConfirmed = s.engagement?.status === "CONFIRMED";
  const trainerPenalty = trainerConfirmed ? toSen(s.engagement?.dayRate) : 0;
  const days = s.pkg.durationDays ?? 0;
  const pax = Math.max(s.participants.active, 1);
  const capSen = await rotCapSen(executor, pax, days);
  const grantSen = toSen(s.pkg.grantApprovedAmount);
  const daysToStart = s.pkg.startDate ? daysBetween(today, s.pkg.startDate) : null;
  const viable = s.participants.active >= s.pkg.minParticipants;
  const rm = (sen: number) => `RM ${Number(fromSen(sen)).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

  const options: DecisionOption[] = [
    {
      id: "POSTPONE",
      label: "Postpone",
      description: "Move the dates and roll the venue deposit forward inside its free postponement window. Trainer hold moves with it.",
      consequence: postponeSen === 0 ? "No penalty: every venue commitment is still inside its free postponement window." : `Worst-case venue exposure ${rm(postponeSen)} (past the free window — confirm with the venue). e-TRiS dates must be amended by client HR.`,
    },
    {
      id: "PIVOT_ROT",
      label: "Pivot to ROT",
      description: "Convert to Remote Online Training. Venue and catering commitments are released and their DDR costs zeroed.",
      consequence: [
        `Saves ${rm(committedSen - cancelSen)} of venue/catering cost${cancelSen ? `; ${rm(cancelSen)} already past cancellation deadlines` : ""}.`,
        capSen !== null && grantSen > capSen ? `ROT cap ${rm(capSen)} is below the approved grant ${rm(grantSen)} — grant amendment needed.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      id: "CANCEL",
      label: "Cancel",
      description: "Release trainer holds and vendor commitments. Tentative trainer holds carry no penalty under the booking clause.",
      consequence: `Trainer release ${trainerPenalty === 0 ? "penalty-free (tentative hold)" : `exposure ${rm(trainerPenalty)} (engagement was confirmed)`}; venue exposure ${rm(cancelSen)}. The financial FSM voids the reservation.`,
    },
    {
      id: "PROCEED",
      label: "Proceed anyway",
      description: "Run below the minimum cohort (e.g. the client insists). Requires a written reason in the audit trail.",
      consequence: "Vendor confirmations resume. Per-pax programmes claim only for eligible participants.",
    },
  ];

  return {
    packageId: s.pkg.id,
    packageCode: s.pkg.packageCode,
    stage: s.pkg.operationalStage,
    activeParticipants: s.participants.active,
    minParticipants: s.pkg.minParticipants,
    viable,
    daysToStart,
    windowOpen: daysToStart !== null && daysToStart <= 14,
    venueExposure: { postponeSen, cancelSen, committedSen },
    trainer: { name: s.engagement?.trainer.fullName ?? null, status: s.engagement?.status ?? null, releasePenaltySen: trainerPenalty, confirmed: trainerConfirmed },
    rot: { capSen, grantSen, amendmentNeeded: capSen !== null && grantSen > capSen, venueSavingSen: committedSen - cancelSen },
    options,
  };
}

/**
 * Handler body for `viability.t14_check`. Stale tasks (dates moved, stage
 * moved on) are skipped rather than acted on: the task carries the start date
 * it was scheduled for, and a postponement schedules a new one.
 */
export async function runT14Check(packageId: string, scheduledStart: string | null, taskId?: string): Promise<Record<string, unknown>> {
  const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) return { skipped: "PACKAGE_NOT_FOUND" };
  if (!["GRANT_APPROVED", "OPERATIONS_LOCKED"].includes(pkg.operationalStage)) return { skipped: `STAGE_${pkg.operationalStage}` };
  if (scheduledStart && pkg.startDate !== scheduledStart) return { skipped: "DATES_CHANGED" };

  const runId = await startAgentRun(db(), { agent: "operations.t14_viability", tier: "L0", packageId, taskId, inputSummary: `T-14 check for ${pkg.packageCode}` });
  const assessment = await assessViability(packageId);

  if (assessment.viable) {
    let advanced = false;
    await withTx(SYSTEM_ACTOR, { reasonCode: "T14_VIABILITY_PASSED" }, async (tx) => {
      if (pkg.vendorAutoconfirmHalted) {
        await updatePackageFields(packageId, { vendorAutoconfirmHalted: false }, SYSTEM_ACTOR, "VIABILITY_RESUMED", "cohort back above minimum", tx);
      }
      if (pkg.operationalStage === "OPERATIONS_LOCKED") {
        await transitionInTx(tx, {
          packageId, machine: "OPERATIONAL", to: "READY_FOR_EVENT", reason: "T14_VIABILITY_PASSED", actor: SYSTEM_ACTOR,
          details: `${assessment.activeParticipants} registered ≥ minimum ${assessment.minParticipants}`,
        });
        advanced = true;
      }
    });
    const result = { viable: true, advanced, participants: assessment.activeParticipants };
    await finishAgentRun(db(), runId, { status: "SUCCEEDED", output: result, provenance: { tier: "L0", agent: "operations.t14_viability", mode: "RULE" } });
    return result;
  }

  await withTx(SYSTEM_ACTOR, { reasonCode: "VIABILITY_HALT" }, async (tx) => {
    await updatePackageFields(
      packageId,
      { vendorAutoconfirmHalted: true },
      SYSTEM_ACTOR,
      "VIABILITY_HALT",
      `${assessment.activeParticipants} registered < minimum ${assessment.minParticipants}; automatic vendor confirmations halted`,
      tx,
    );
    await raiseDecision(tx, {
      gate: "GATE2_VIABILITY",
      packageId,
      subjectRef: pkg.packageCode,
      title: `T-14 viability · ${pkg.title}`,
      summary: `${assessment.activeParticipants} of minimum ${assessment.minParticipants} participants registered, ${assessment.daysToStart ?? "?"} days to start. Vendor auto-confirmations are halted until you choose a contingency.`,
      payload: { assessment: assessment as unknown as Record<string, unknown> },
      options: assessment.options,
      raisedBy: "operations.t14_viability",
      raisedByTier: "L0",
      slaHours: 48,
    });
  });
  const result = { viable: false, halted: true, participants: assessment.activeParticipants };
  await finishAgentRun(db(), runId, { status: "SUCCEEDED", output: result, provenance: { tier: "L0", agent: "operations.t14_viability", mode: "RULE" } });
  return result;
}

async function releaseTrainerHolds(tx: Tx, packageId: string, reason: string): Promise<number> {
  const active = await tx
    .select()
    .from(schema.trainerEngagements)
    .where(and(eq(schema.trainerEngagements.packageId, packageId), ne(schema.trainerEngagements.status, "RELEASED")));
  for (const e of active) {
    await tx
      .update(schema.trainerEngagements)
      .set({ status: "RELEASED", releasedAt: new Date(), releaseReason: reason, releasePenalty: e.status === "CONFIRMED" ? e.dayRate : "0" })
      .where(eq(schema.trainerEngagements.id, e.id));
    await recordAudit(tx, {
      entityType: "TRAINER_ENGAGEMENT",
      entityId: e.id,
      reasonCode: "TRAINER_HOLD_RELEASED",
      details: reason,
      metadata: { package_id: packageId, previous_status: e.status, penalty: e.status === "CONFIRMED" ? e.dayRate : "0" },
    });
  }
  return active.length;
}

async function cancelCommitments(tx: Tx, packageId: string, types: string[], reason: string, today: string): Promise<number> {
  const active = await tx
    .select()
    .from(schema.vendorCommitments)
    .where(and(eq(schema.vendorCommitments.packageId, packageId), ne(schema.vendorCommitments.status, "CANCELLED"), inArray(schema.vendorCommitments.vendorType, types)));
  for (const c of active) {
    const penalty = c.cancellationDeadline < today ? c.cost : "0";
    await tx.update(schema.vendorCommitments).set({ status: "CANCELLED", cancellationPenalty: penalty }).where(eq(schema.vendorCommitments.id, c.id));
    await recordAudit(tx, {
      entityType: "VENDOR_COMMITMENT",
      entityId: c.id,
      reasonCode: "VENDOR_COMMITMENT_CANCELLED",
      details: reason,
      metadata: { package_id: packageId, vendor_type: c.vendorType, penalty_exposure: penalty },
    });
  }
  return active.length;
}

export interface ResolveViabilityInput {
  choice: ViabilityChoice;
  note?: string;
  newStartDate?: string;
  newEndDate?: string;
}

/** Operator resolution of Gate 2. One transaction per choice; every side effect audited. */
export async function resolveViability(packageId: string, input: ResolveViabilityInput, actor: Actor): Promise<{ stage: string }> {
  if (actor.type !== "USER") throw new DomainError("HUMAN_DECISION_REQUIRED", "Gate 2 is resolved by a named operator");
  const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", "Package not found");
  const today = todayMY();
  const assessment = await assessViability(packageId);

  return withTx(actor, { reasonCode: `VIABILITY_${input.choice}` }, async (tx) => {
    let outcomeStage = pkg.operationalStage;
    const metadata = { choice: input.choice, exposure: assessment.venueExposure, participants: assessment.activeParticipants };

    switch (input.choice) {
      case "POSTPONE": {
        if (!input.newStartDate || !input.newEndDate) throw new DomainError("NEW_DATES_REQUIRED", "Choose the new training dates");
        if (input.newEndDate < input.newStartDate) throw new DomainError("DATES_INVERTED", "End date is before start date");
        if (!pkg.startDate || input.newStartDate <= pkg.startDate) throw new DomainError("POSTPONE_MUST_MOVE_LATER", "A postponement moves the start date later");
        const commitments = await tx
          .select()
          .from(schema.vendorCommitments)
          .where(and(eq(schema.vendorCommitments.packageId, packageId), ne(schema.vendorCommitments.status, "CANCELLED")));
        const shift = daysBetween(pkg.startDate, input.newStartDate);
        for (const c of commitments) {
          await tx
            .update(schema.vendorCommitments)
            .set({
              cancellationDeadline: addDays(c.cancellationDeadline, shift),
              postponementDeadline: c.postponementDeadline ? addDays(c.postponementDeadline, shift) : null,
            })
            .where(eq(schema.vendorCommitments.id, c.id));
        }
        await tx
          .update(schema.trainerEngagements)
          .set({ holdExpiryDate: input.newStartDate })
          .where(and(eq(schema.trainerEngagements.packageId, packageId), ne(schema.trainerEngagements.status, "RELEASED")));
        const outcome = await transitionInTx(tx, {
          packageId, machine: "OPERATIONAL", to: "POSTPONED", reason: "VIABILITY_POSTPONED", actor,
          details: input.note ?? `Postponed to ${input.newStartDate}`, metadata,
          patch: { startDate: input.newStartDate, endDate: input.newEndDate, postponedFromStart: pkg.startDate, vendorAutoconfirmHalted: false },
        });
        outcomeStage = outcome.pkg.operationalStage;
        break;
      }
      case "PIVOT_ROT": {
        await cancelCommitments(tx, packageId, ["VENUE", "CATERING"], "VIABILITY_PIVOT_ROT", today);
        if (pkg.operationalStage === "OPERATIONS_LOCKED") {
          const outcome = await transitionInTx(tx, {
            packageId, machine: "OPERATIONAL", to: "READY_FOR_EVENT", reason: "VIABILITY_PIVOT_ROT", actor,
            details: input.note ?? "Pivoted to Remote Online Training", metadata: { ...metadata, rot: assessment.rot },
            patch: { deliveryMode: "ROT_VIRTUAL", vendorAutoconfirmHalted: false },
          });
          outcomeStage = outcome.pkg.operationalStage;
        } else {
          await updatePackageFields(packageId, { deliveryMode: "ROT_VIRTUAL", vendorAutoconfirmHalted: false }, actor, "VIABILITY_PIVOT_ROT", input.note ?? "Pivoted to ROT before operations lock", tx);
        }
        break;
      }
      case "CANCEL": {
        await releaseTrainerHolds(tx, packageId, "VIABILITY_CANCELLED");
        await cancelCommitments(tx, packageId, ["VENUE", "CATERING", "PRINTING"], "VIABILITY_CANCELLED", today);
        const outcome = await transitionInTx(tx, {
          packageId, machine: "OPERATIONAL", to: "CANCELLED", reason: "VIABILITY_CANCELLED", actor,
          details: input.note ?? "Cancelled at T-14: cohort below minimum", metadata,
          patch: { cancellationReason: input.note ?? "Cohort below minimum viable size at T-14" },
        });
        outcomeStage = outcome.pkg.operationalStage;
        break;
      }
      case "PROCEED": {
        if (!input.note || input.note.trim().length < 10) throw new DomainError("REASON_REQUIRED", "Write why the package proceeds below the minimum cohort");
        if (pkg.operationalStage !== "OPERATIONS_LOCKED") throw new DomainError("LOCK_FIRST", "Lock operations before proceeding past the viability gate");
        const outcome = await transitionInTx(tx, {
          packageId, machine: "OPERATIONAL", to: "READY_FOR_EVENT", reason: "VIABILITY_OVERRIDE_PROCEED", actor,
          details: input.note, metadata, patch: { vendorAutoconfirmHalted: false },
        });
        outcomeStage = outcome.pkg.operationalStage;
        break;
      }
      default: {
        const unknown: never = input.choice;
        throw new DomainError("UNKNOWN_CHOICE", `Unknown viability choice ${String(unknown)}`);
      }
    }

    await resolvePendingFor(tx, "GATE2_VIABILITY", pkg.packageCode, {
      status: "RESOLVED", by: actor.id, chosenOption: input.choice, note: input.note,
    });
    return { stage: outcomeStage };
  });
}

/** POSTPONED → GRANT_APPROVED once the new dates are agreed; the coupling re-schedules T-14. */
export async function confirmReschedule(packageId: string, actor: Actor, note?: string) {
  return withTx(actor, { reasonCode: "RESCHEDULE_CONFIRMED" }, (tx) =>
    transitionInTx(tx, { packageId, machine: "OPERATIONAL", to: "GRANT_APPROVED", reason: "RESCHEDULE_CONFIRMED", actor, details: note }),
  );
}

export async function lockOperations(packageId: string, actor: Actor) {
  return withTx(actor, { reasonCode: "OPERATIONS_READINESS_LOCKED" }, (tx) =>
    transitionInTx(tx, { packageId, machine: "OPERATIONAL", to: "OPERATIONS_LOCKED", reason: "OPERATIONS_READINESS_LOCKED", actor }),
  );
}

export async function startDelivery(packageId: string, actor: Actor) {
  return withTx(actor, { reasonCode: "DELIVERY_STARTED" }, (tx) =>
    transitionInTx(tx, { packageId, machine: "OPERATIONAL", to: "DELIVERY_IN_PROGRESS", reason: "DELIVERY_STARTED", actor }),
  );
}

export async function completeDelivery(packageId: string, actor: Actor) {
  return withTx(actor, { reasonCode: "DELIVERY_VERIFIED_SUCCESS" }, (tx) =>
    transitionInTx(tx, { packageId, machine: "OPERATIONAL", to: "DELIVERY_COMPLETED", reason: "DELIVERY_VERIFIED_SUCCESS", actor }),
  );
}

/** Generic cancellation from any pre-delivery stage; releases holds and commitments first. */
export async function cancelPackage(packageId: string, reason: string, actor: Actor) {
  if (!reason || reason.trim().length < 5) throw new DomainError("REASON_REQUIRED", "Say why the package is cancelled");
  const today = todayMY();
  return withTx(actor, { reasonCode: "PACKAGE_CANCELLED" }, async (tx) => {
    await releaseTrainerHolds(tx, packageId, "PACKAGE_CANCELLED");
    await cancelCommitments(tx, packageId, ["VENUE", "CATERING", "PRINTING"], "PACKAGE_CANCELLED", today);
    return transitionInTx(tx, {
      packageId, machine: "OPERATIONAL", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actor, details: reason,
      patch: { cancellationReason: reason },
    });
  });
}

/** Daily sweep: tentative trainer holds past their expiry are released (no penalty by clause). */
export async function expireHolds(today = todayMY()): Promise<{ released: number }> {
  const expired = await rows<{ id: string; package_id: string }>(
    db(),
    sql`select id, package_id from tpms.trainer_engagements where status = 'TENTATIVE_HOLD' and hold_expiry_date < ${today}::date`,
  );
  for (const e of expired) {
    await withTx(SYSTEM_ACTOR, { reasonCode: "TRAINER_HOLD_EXPIRED" }, async (tx) => {
      await tx.update(schema.trainerEngagements).set({ status: "RELEASED", releasedAt: new Date(), releaseReason: "HOLD_EXPIRED" }).where(eq(schema.trainerEngagements.id, e.id));
      await recordAudit(tx, { entityType: "TRAINER_ENGAGEMENT", entityId: e.id, reasonCode: "TRAINER_HOLD_EXPIRED", metadata: { package_id: e.package_id } });
    });
  }
  return { released: expired.length };
}
