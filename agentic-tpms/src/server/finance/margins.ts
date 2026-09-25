import { sql } from "drizzle-orm";
import { toSen } from "@/lib/money";
import { db, rows } from "../db/client";

/**
 * Unit economics per package, from `job_financial_ledgers` (the per-trainer
 * roll-up is `marginByTrainer` in ./kpis). A ledger row opens provisionally
 * when the claim goes to HRD Corp and is rewritten with actuals at settlement;
 * `reconciled` says which one a row is, so the screen can label estimates.
 */
export type PackageMargin = {
  packageId: string;
  packageCode: string;
  title: string;
  clientName: string;
  financialStage: string;
  trainerName: string | null;
  revenue: string;
  directCost: string;
  grossMargin: string;
  netProfit: string;
  marginPct: number | null;
  reconciled: boolean;
};

/** Most recently touched first (settlements and new claims float up). */
export async function marginByPackage(opts: { limit?: number } = {}): Promise<PackageMargin[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 10)));
  const result = await rows<Omit<PackageMargin, "marginPct">>(
    db(),
    sql`select p.id as "packageId", p.package_code as "packageCode", p.title, c.company_name as "clientName",
               p.financial_stage as "financialStage",
               (select t.full_name from tpms.trainer_engagements e join tpms.trainers t on t.id = e.trainer_id
                 where e.package_id = p.id and e.status <> 'RELEASED'
                 order by (e.status = 'CONFIRMED') desc, e.created_at desc limit 1) as "trainerName",
               l.approved_grant_amount::text as revenue,
               (l.trainer_fee_agreed + l.venue_and_catering_cost + l.materials_and_printing_cost)::text as "directCost",
               l.gross_margin::text as "grossMargin",
               l.net_retained_profit::text as "netProfit",
               (l.reconciled_at is not null) as reconciled
          from tpms.job_financial_ledgers l
          join tpms.training_packages p on p.id = l.package_id
          join tpms.corporate_clients c on c.id = p.client_id
         order by coalesce(l.reconciled_at, l.updated_at) desc, p.package_code
         limit ${limit}`,
  );
  return result.map((r) => {
    const revenue = toSen(r.revenue);
    return { ...r, marginPct: revenue > 0 ? Math.round((toSen(r.grossMargin) / revenue) * 1000) / 10 : null };
  });
}
