import { sql } from "drizzle-orm";
import { db, rows } from "../db/client";

export interface DecisionRow {
  id: string;
  gate: string;
  title: string;
  summary: string;
  status: string;
  raisedBy: string;
  raisedByTier: string | null;
  slaDueAt: Date | null;
  createdAt: Date;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  chosenOption: string | null;
  packageCode: string | null;
  clientName: string | null;
  subjectRef: string;
}

/** The desk's read model: decisions with their package and client, SLA first. */
export async function listDecisionRows(status: "PENDING" | "RESOLVED_ANY" = "PENDING", limit = 200): Promise<DecisionRow[]> {
  return rows<DecisionRow>(
    db(),
    sql`select d.id, d.gate, d.title, d.summary, d.status, d.raised_by as "raisedBy", d.raised_by_tier as "raisedByTier",
               d.sla_due_at as "slaDueAt", d.created_at as "createdAt", d.resolved_by as "resolvedBy",
               d.resolved_at as "resolvedAt", d.chosen_option as "chosenOption", d.subject_ref as "subjectRef",
               p.package_code as "packageCode", c.company_name as "clientName"
          from tpms.decisions d
          left join tpms.training_packages p on p.id = d.package_id
          left join tpms.corporate_clients c on c.id = p.client_id
         where (${status} = 'PENDING' and d.status = 'PENDING') or (${status} = 'RESOLVED_ANY' and d.status <> 'PENDING')
         order by case when d.status = 'PENDING' then coalesce(d.sla_due_at, d.created_at + interval '3 days') end nulls last,
                  d.resolved_at desc nulls last, d.created_at desc
         limit ${limit}`,
  );
}
