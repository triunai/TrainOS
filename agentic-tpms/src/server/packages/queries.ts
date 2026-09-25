import { sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import type { ReadinessFacts } from "./readiness";

/**
 * Read models for the cockpit. One wide query per screen rather than N+1:
 * the board and the list need the package, its client, and the active
 * trainer/venue facts that drive the traffic lights.
 */
export interface PackageCard extends ReadinessFacts {
  id: string;
  packageCode: string;
  title: string;
  clientName: string;
  financialStage: string;
  endDate: string | null;
  paxEstimate: number;
  participants: number;
  quotedAmount: string;
  grantApprovedAmount: string | null;
  pendingDecisions: number;
  /** Gate 2 halted vendor auto-confirmations: the cohort was below minimum at T-14. */
  viabilityHalted: boolean;
  updatedAt: Date;
}

export async function listPackageCards(opts: { includeClosed?: boolean; search?: string } = {}): Promise<PackageCard[]> {
  const search = opts.search ? `%${opts.search.toLowerCase()}%` : null;
  return rows<PackageCard>(
    db(),
    sql`select p.id, p.package_code as "packageCode", p.title, c.company_name as "clientName",
               p.operational_stage as "operationalStage", p.financial_stage as "financialStage",
               p.delivery_mode as "deliveryMode", p.venue_by_client as "venueByClient",
               p.start_date as "startDate", p.end_date as "endDate", p.pax_estimate as "paxEstimate",
               p.quoted_amount as "quotedAmount", p.grant_approved_amount as "grantApprovedAmount",
               p.etris_grant_id as "etrisGrantId", p.updated_at as "updatedAt",
               p.vendor_autoconfirm_halted as "viabilityHalted",
               te.status as "trainerStatus", (te.ttt_cert_verified and t.ttt_verified) as "trainerTttVerified",
               te.hold_expiry_date as "trainerHoldExpiry", t.full_name as "trainerName",
               vc.status as "venueStatus", vc.postponement_deadline as "venuePostponementDeadline", v.name as "venueName",
               (select count(*) from tpms.package_participants pp where pp.package_id = p.id and pp.registration_status <> 'WITHDRAWN')::int as participants,
               (select count(*) from tpms.decisions d where d.package_id = p.id and d.status = 'PENDING')::int as "pendingDecisions"
          from tpms.training_packages p
          join tpms.corporate_clients c on c.id = p.client_id
          left join lateral (
            select * from tpms.trainer_engagements e where e.package_id = p.id and e.status <> 'RELEASED'
             order by e.created_at desc limit 1) te on true
          left join tpms.trainers t on t.id = te.trainer_id
          left join lateral (
            select * from tpms.vendor_commitments x where x.package_id = p.id and x.vendor_type = 'VENUE'
             order by (x.status = 'CANCELLED'), x.created_at desc limit 1) vc on true
          left join tpms.vendors v on v.id = vc.vendor_id
         where (${opts.includeClosed ?? true} or p.operational_stage not in ('CANCELLED'))
           and (${search}::text is null or lower(p.title) like ${search} or lower(p.package_code) like ${search}
                or lower(c.company_name) like ${search})
         order by p.start_date nulls last, p.package_code`,
  );
}

export async function packageIdByCode(code: string): Promise<string | undefined> {
  const [r] = await rows<{ id: string }>(db(), sql`select id from tpms.training_packages where package_code = ${code}`);
  return r?.id;
}
