import { and, desc, eq, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { type Executor, rows, schema } from "../db/client";
import type {
  Client,
  Quotation,
  TrainingPackage,
  Trainer,
  VaultDocument,
} from "../db/schema";
import { todayMY } from "@/lib/dates";

export type TrainerEngagement = typeof schema.trainerEngagements.$inferSelect;
export type VendorCommitment = typeof schema.vendorCommitments.$inferSelect;
export type TaxInvoice = typeof schema.taxInvoices.$inferSelect;
export type PaymentVoucher = typeof schema.paymentVouchers.$inferSelect;

export interface AttendanceSummary {
  /** Day × session slots each active participant should have. */
  slotsPerParticipant: number;
  /** Active participants with every slot recorded. */
  complete: number;
  /** Slots with no effective record, across all active participants. */
  missingSlots: number;
  /** Effective records flagged for operator review and not yet resolved. */
  openReviews: number;
  /** Records by track, for the dual-track view. */
  byTrack: Record<string, number>;
}

export interface ParticipantSummary {
  total: number;
  active: number;
  confirmed: number;
  eligible: number;
  withdrawn: number;
}

export interface PackageSnapshot {
  pkg: TrainingPackage;
  client: Client;
  engagement: (TrainerEngagement & { trainer: Trainer }) | null;
  commitments: VendorCommitment[];
  participants: ParticipantSummary;
  attendance: AttendanceSummary;
  vault: VaultDocument[];
  latestQuotation: Quotation | null;
  invoice: TaxInvoice | null;
  vouchers: PaymentVoucher[];
  today: string;
}

export async function loadSnapshot(executor: Executor, packageId: string, today = todayMY()): Promise<PackageSnapshot> {
  const [pkg] = await executor.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new Error(`Package ${packageId} not found`);
  return loadSnapshotFor(executor, pkg, today);
}

export async function loadSnapshotFor(executor: Executor, pkg: TrainingPackage, today = todayMY()): Promise<PackageSnapshot> {
  const packageId = pkg.id;
  const [client] = await executor.select().from(schema.corporateClients).where(eq(schema.corporateClients.id, pkg.clientId));

  const engagementRows = await executor
    .select({ e: schema.trainerEngagements, t: schema.trainers })
    .from(schema.trainerEngagements)
    .innerJoin(schema.trainers, eq(schema.trainers.id, schema.trainerEngagements.trainerId))
    .where(and(eq(schema.trainerEngagements.packageId, packageId), ne(schema.trainerEngagements.status, "RELEASED")));
  const engagement = engagementRows[0] ? { ...engagementRows[0].e, trainer: engagementRows[0].t } : null;

  const commitments = await executor
    .select()
    .from(schema.vendorCommitments)
    .where(eq(schema.vendorCommitments.packageId, packageId));

  const [participants] = await rows<ParticipantSummary>(
    executor,
    sql`select count(*)::int as total,
               count(*) filter (where registration_status <> 'WITHDRAWN')::int as active,
               count(*) filter (where registration_status = 'CONFIRMED')::int as confirmed,
               count(*) filter (where registration_status <> 'WITHDRAWN' and hrd_claim_eligible)::int as eligible,
               count(*) filter (where registration_status = 'WITHDRAWN')::int as withdrawn
          from tpms.package_participants where package_id = ${packageId}::uuid`,
  );

  const days = pkg.durationDays ?? 0;
  const slotsPerParticipant = days * 2;
  const [attendance] = await rows<{ complete: number; missing: number; open_reviews: number }>(
    executor,
    sql`with active as (
          select id from tpms.package_participants
           where package_id = ${packageId}::uuid and registration_status <> 'WITHDRAWN'
        ), filled as (
          select a.id, count(e.*) filter (where e.day_index <= ${days}) as n
            from active a
            left join tpms.v_attendance_effective e on e.participant_id = a.id
           group by a.id
        )
        select count(*) filter (where n >= ${slotsPerParticipant})::int as complete,
               coalesce(sum(greatest(${slotsPerParticipant} - n, 0)), 0)::int as missing,
               (select count(*) from tpms.attendance_records r
                 where r.package_id = ${packageId}::uuid and r.needs_review and r.resolved_at is null
                   and r.participant_id in (select id from active))::int as open_reviews
          from filled`,
  );
  const trackRows = await rows<{ track: string; n: number }>(
    executor,
    sql`select track, count(*)::int as n from tpms.attendance_records
         where package_id = ${packageId}::uuid group by track`,
  );

  const vault = await executor
    .select()
    .from(schema.complianceVault)
    .where(eq(schema.complianceVault.packageId, packageId))
    .orderBy(desc(schema.complianceVault.createdAt));

  const [latestQuotation] = await executor
    .select()
    .from(schema.quotations)
    .where(eq(schema.quotations.packageId, packageId))
    .orderBy(desc(schema.quotations.version))
    .limit(1);

  const [invoice] = await executor.select().from(schema.taxInvoices).where(eq(schema.taxInvoices.packageId, packageId));
  const vouchers = await executor.select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.packageId, packageId));

  return {
    pkg,
    client,
    engagement,
    commitments,
    participants: participants ?? { total: 0, active: 0, confirmed: 0, eligible: 0, withdrawn: 0 },
    attendance: {
      slotsPerParticipant,
      complete: attendance?.complete ?? 0,
      missingSlots: attendance?.missing ?? 0,
      openReviews: attendance?.open_reviews ?? 0,
      byTrack: Object.fromEntries(trackRows.map((r) => [r.track, r.n])),
    },
    vault,
    latestQuotation: latestQuotation ?? null,
    invoice: invoice ?? null,
    vouchers,
    today,
  };
}

/** Documents of one type that are not flagged (the latest first). */
export function docsOf(snapshot: PackageSnapshot, type: string, status?: "VERIFIED" | "PENDING"): VaultDocument[] {
  return snapshot.vault.filter(
    (d) => d.documentType === type && d.verificationStatus !== "FLAGGED" && (!status || d.verificationStatus === status),
  );
}
