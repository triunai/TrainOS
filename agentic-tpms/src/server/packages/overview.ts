import { sql } from "drizzle-orm";
import { addDays, todayMY } from "@/lib/dates";
import { db, rows } from "../db/client";

/** Operational read model for the Home screen. Finance KPIs come from the finance lane. */
export interface StageCount {
  stage: string;
  count: number;
  value: string;
}

export async function stageCounts(): Promise<{ ops: StageCount[]; fin: StageCount[] }> {
  const ops = await rows<StageCount>(
    db(),
    sql`select operational_stage as stage, count(*)::int as count, coalesce(sum(coalesce(grant_approved_amount, quoted_amount)), 0)::text as value
          from tpms.training_packages group by operational_stage`,
  );
  const fin = await rows<StageCount>(
    db(),
    sql`select financial_stage as stage, count(*)::int as count, coalesce(sum(coalesce(hrdc_approved_amount, grant_approved_amount, quoted_amount)), 0)::text as value
          from tpms.training_packages group by financial_stage`,
  );
  return { ops, fin };
}

export interface UpcomingDelivery {
  packageCode: string;
  title: string;
  clientName: string;
  startDate: string;
  endDate: string | null;
  operationalStage: string;
  participants: number;
  minParticipants: number;
}

export async function upcomingDeliveries(days = 30): Promise<UpcomingDelivery[]> {
  const today = todayMY();
  return rows<UpcomingDelivery>(
    db(),
    sql`select p.package_code as "packageCode", p.title, c.company_name as "clientName", p.start_date as "startDate", p.end_date as "endDate",
               p.operational_stage as "operationalStage", p.min_participants as "minParticipants",
               (select count(*) from tpms.package_participants pp where pp.package_id = p.id and pp.registration_status <> 'WITHDRAWN')::int as participants
          from tpms.training_packages p join tpms.corporate_clients c on c.id = p.client_id
         where p.start_date between ${today}::date and ${addDays(today, days)}::date
           and p.operational_stage not in ('CANCELLED', 'DELIVERY_COMPLETED')
         order by p.start_date`,
  );
}

export async function pipelineTotals(): Promise<{ live: number; liveValue: string; settledValue: string; decisions: number; exceptions: number; leads7d: number }> {
  const [r] = await rows<{ live: number; liveValue: string; settledValue: string; decisions: number; exceptions: number; leads7d: number }>(
    db(),
    sql`select
          (select count(*) from tpms.training_packages where operational_stage not in ('CANCELLED') and financial_stage not in ('SETTLED_CLOSED','VOIDED'))::int as live,
          (select coalesce(sum(coalesce(grant_approved_amount, quoted_amount)), 0) from tpms.training_packages
            where operational_stage not in ('CANCELLED') and financial_stage not in ('SETTLED_CLOSED','VOIDED'))::text as "liveValue",
          (select coalesce(sum(remittance_amount), 0) from tpms.training_packages where financial_stage = 'SETTLED_CLOSED')::text as "settledValue",
          (select count(*) from tpms.decisions where status = 'PENDING')::int as decisions,
          (select count(*) from tpms.attendance_records where needs_review and resolved_at is null)::int as exceptions,
          (select count(*) from tpms.lead_records where created_at > now() - interval '7 days')::int as "leads7d"`,
  );
  return r;
}
