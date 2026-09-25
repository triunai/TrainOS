import { and, asc, eq } from "drizzle-orm";
import { addDays, startOfDayMY } from "@/lib/dates";
import { recordAudit } from "../audit/ledger";
import { db, schema, SYSTEM_ACTOR, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { enqueue } from "../queue/queue";
import { assertUuid } from "../finance/common";

/**
 * Stage 7 — retention cadences, scheduled once per delivered package.
 *
 *   EXECUTIVE_PACK_T14   end_date + 14   outcomes pack to the client's decision maker
 *   SYLLABUS_LADDER_T90  end_date + 90   the next course up the ladder
 *   LEVY_YEAR_END_T300   see `levyAlertDate`: levy utilisation alert
 *
 * Each cadence is one `renewal_schedules` row (unique per package + cadence)
 * and one delayed `retention.run` task due at 00:00 MYT on its day. Both are
 * idempotent, so the task can be retried or re-enqueued freely.
 */
export const CADENCES = ["EXECUTIVE_PACK_T14", "SYLLABUS_LADDER_T90", "LEVY_YEAR_END_T300"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_SHORT: Record<Cadence, string> = {
  EXECUTIVE_PACK_T14: "T14",
  SYLLABUS_LADDER_T90: "T90",
  LEVY_YEAR_END_T300: "T300",
};

export function assertCadence(value: string): Cadence {
  if (!(CADENCES as readonly string[]).includes(value)) throw new Error(`Unknown retention cadence: ${value}`);
  return value as Cadence;
}

/**
 * Which cadences a client gets. A levy utilisation alert means nothing to a
 * client that does not pay the HRD Corp levy. R14: an unknown account type is
 * an error, not a default.
 */
const ACCOUNT_CADENCES: Record<string, readonly Cadence[]> = {
  SBL_KHAS_LEVY: CADENCES,
  PRIVATE_CASH: ["EXECUTIVE_PACK_T14", "SYLLABUS_LADDER_T90"],
};

function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export type LevyAlert = { date: string; basis: "END_PLUS_300" | "FISCAL_YEAR_END_MINUS_60"; fiscalYearEnd: string | null };

/**
 * The T+300 levy alert date.
 *
 * Rule: the default is end_date + 300 days. When the client's fiscal-year-end
 * month is known, take F = the first fiscal year end (last day of that month)
 * whose "F - 60 days" falls after end_date + 14 — i.e. after the executive
 * pack, so the two never collide and the alert is never in the past relative
 * to the delivery. If F - 60 is sooner than end_date + 300, the alert moves to
 * F - 60: sixty days is enough for the client's HR to plan and file one more
 * grant before unused levy for that year stops being usable.
 */
export function levyAlertDate(endDate: string, fiscalYearEndMonth: number | null | undefined): LevyAlert {
  const fallback = addDays(endDate, 300);
  if (fiscalYearEndMonth === null || fiscalYearEndMonth === undefined) {
    return { date: fallback, basis: "END_PLUS_300", fiscalYearEnd: null };
  }
  if (!Number.isInteger(fiscalYearEndMonth) || fiscalYearEndMonth < 1 || fiscalYearEndMonth > 12) {
    throw new Error(`Fiscal year end month must be 1-12, got ${fiscalYearEndMonth}`);
  }
  const floor = addDays(endDate, 14);
  let year = Number(endDate.slice(0, 4));
  let fye = lastDayOfMonth(year, fiscalYearEndMonth);
  while (addDays(fye, -60) <= floor) {
    year += 1;
    fye = lastDayOfMonth(year, fiscalYearEndMonth);
  }
  const alert = addDays(fye, -60);
  return alert < fallback
    ? { date: alert, basis: "FISCAL_YEAR_END_MINUS_60", fiscalYearEnd: fye }
    : { date: fallback, basis: "END_PLUS_300", fiscalYearEnd: fye };
}

export function cadenceDates(endDate: string, fiscalYearEndMonth: number | null | undefined): Record<Cadence, { date: string; basis: string }> {
  const levy = levyAlertDate(endDate, fiscalYearEndMonth);
  return {
    EXECUTIVE_PACK_T14: { date: addDays(endDate, 14), basis: "END_PLUS_14" },
    SYLLABUS_LADDER_T90: { date: addDays(endDate, 90), basis: "END_PLUS_90" },
    LEVY_YEAR_END_T300: { date: levy.date, basis: levy.basis },
  };
}

export type ScheduleResult = {
  packageId: string;
  skipped?: string;
  schedules: Array<{ id: string; cadenceType: Cadence; scheduledFor: string; basis: string; taskId: string | null; created: boolean }>;
};

/** Body of the `retention.schedule` task (enqueued by the FSM at DELIVERY_COMPLETED). */
export async function scheduleRetention(packageId: string): Promise<ScheduleResult> {
  assertUuid(packageId, "packageId");
  return withTx(SYSTEM_ACTOR, { reasonCode: "RETENTION_SCHEDULED" }, async (tx) => {
    const [pkg] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
    if (!pkg) return { packageId, skipped: "package not found", schedules: [] };
    if (pkg.operationalStage !== "DELIVERY_COMPLETED") return { packageId, skipped: `operational stage is ${pkg.operationalStage}`, schedules: [] };
    if (!pkg.endDate) return { packageId, skipped: "package has no end date", schedules: [] };
    const [client] = await tx.select().from(schema.corporateClients).where(eq(schema.corporateClients.id, pkg.clientId));
    const cadences = ACCOUNT_CADENCES[client.accountType];
    if (!cadences) throw new Error(`Unknown client account type: ${client.accountType}`);

    const dates = cadenceDates(pkg.endDate, client.fiscalYearEndMonth);
    const schedules: ScheduleResult["schedules"] = [];
    for (const cadence of cadences) {
      const { date, basis } = dates[cadence];
      const inserted = await tx
        .insert(schema.renewalSchedules)
        .values({
          clientId: client.id,
          sourcePackageId: pkg.id,
          cadenceType: cadence,
          scheduledFor: date,
          provenance: { scheduledBy: "retention.schedule", basis, endDate: pkg.endDate, fiscalYearEndMonth: client.fiscalYearEndMonth ?? null },
        })
        .onConflictDoNothing()
        .returning();
      const row =
        inserted[0] ??
        (
          await tx
            .select()
            .from(schema.renewalSchedules)
            .where(and(eq(schema.renewalSchedules.sourcePackageId, pkg.id), eq(schema.renewalSchedules.cadenceType, cadence)))
        )[0];
      const taskId = await enqueue(tx, {
        type: "retention.run",
        payload: { scheduleId: row.id },
        dueAt: startOfDayMY(row.scheduledFor),
        idempotencyKey: `retention.run:${row.id}:${row.scheduledFor}`,
      });
      schedules.push({ id: row.id, cadenceType: cadence, scheduledFor: row.scheduledFor, basis, taskId, created: Boolean(inserted[0]) });
    }
    if (schedules.some((s) => s.created)) {
      await recordAudit(tx, {
        entityType: "TRAINING_PACKAGE",
        entityId: pkg.id,
        reasonCode: "RETENTION_SCHEDULED",
        details: schedules.map((s) => `${CADENCE_SHORT[s.cadenceType]} ${s.scheduledFor}`).join(", "),
        metadata: { package_id: pkg.id, schedules: schedules.map(({ id, cadenceType, scheduledFor, basis }) => ({ id, cadenceType, scheduledFor, basis })) },
      });
    }
    return { packageId, schedules };
  });
}

export type RetentionRow = typeof schema.renewalSchedules.$inferSelect & { clientName: string; packageCode: string; packageTitle: string };

const RETENTION_STATUSES = ["PENDING", "DRAFTED", "APPROVED", "DISPATCHED", "SKIPPED"];

/** The Retention screen list: due first. */
export async function listRetention(opts: { status?: string; packageId?: string; clientId?: string } = {}): Promise<RetentionRow[]> {
  if (opts.status && !RETENTION_STATUSES.includes(opts.status)) throw new DomainError("UNKNOWN_STATUS", `Unknown retention status: ${opts.status}`);
  if (opts.packageId) assertUuid(opts.packageId, "packageId");
  if (opts.clientId) assertUuid(opts.clientId, "clientId");
  const r = schema.renewalSchedules;
  const where = [
    opts.status ? eq(r.status, opts.status) : undefined,
    opts.packageId ? eq(r.sourcePackageId, opts.packageId) : undefined,
    opts.clientId ? eq(r.clientId, opts.clientId) : undefined,
  ].filter((w): w is NonNullable<typeof w> => Boolean(w));
  const result = await db()
    .select({
      schedule: r,
      clientName: schema.corporateClients.companyName,
      packageCode: schema.trainingPackages.packageCode,
      packageTitle: schema.trainingPackages.title,
    })
    .from(r)
    .innerJoin(schema.corporateClients, eq(schema.corporateClients.id, r.clientId))
    .innerJoin(schema.trainingPackages, eq(schema.trainingPackages.id, r.sourcePackageId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(r.scheduledFor), asc(r.cadenceType));
  return result.map((row) => ({ ...row.schedule, clientName: row.clientName, packageCode: row.packageCode, packageTitle: row.packageTitle }));
}
