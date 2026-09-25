import { sql } from "drizzle-orm";
import { db, rows } from "../db/client";

export interface ClientRow {
  id: string;
  companyName: string;
  companyDomain: string | null;
  ssmRegistration: string | null;
  hrdcorpMycoid: string | null;
  levyRegistered: boolean;
  malaysianHeadcount: number | null;
  fiscalYearEndMonth: number | null;
  accountType: string;
  primaryPicName: string;
  primaryPicEmail: string;
  primaryPicPhone: string;
  packages: number;
  liveValue: string;
  settledValue: string;
  lastStart: string | null;
}

export async function listClients(search?: string): Promise<ClientRow[]> {
  const q = search ? `%${search.toLowerCase()}%` : null;
  return rows<ClientRow>(
    db(),
    sql`select c.id, c.company_name as "companyName", c.company_domain as "companyDomain", c.ssm_registration as "ssmRegistration",
               c.hrdcorp_mycoid as "hrdcorpMycoid", c.levy_registered as "levyRegistered", c.malaysian_headcount as "malaysianHeadcount",
               c.fiscal_year_end_month as "fiscalYearEndMonth", c.account_type as "accountType",
               c.primary_pic_name as "primaryPicName", c.primary_pic_email as "primaryPicEmail", c.primary_pic_phone as "primaryPicPhone",
               count(p.id)::int as packages,
               coalesce(sum(coalesce(p.grant_approved_amount, p.quoted_amount)) filter (where p.operational_stage not in ('CANCELLED') and p.financial_stage <> 'SETTLED_CLOSED'), 0)::text as "liveValue",
               coalesce(sum(p.remittance_amount) filter (where p.financial_stage = 'SETTLED_CLOSED'), 0)::text as "settledValue",
               max(p.start_date)::text as "lastStart"
          from tpms.corporate_clients c
          left join tpms.training_packages p on p.client_id = c.id
         where ${q}::text is null or lower(c.company_name) like ${q} or lower(coalesce(c.company_domain, '')) like ${q}
         group by c.id
         order by c.company_name`,
  );
}

export interface SearchHit {
  kind: "PACKAGE" | "LEAD" | "CLIENT";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** One box, three entities. ILIKE is enough at single-tenant scale. */
export async function search(query: string): Promise<SearchHit[]> {
  const q = `%${query.toLowerCase()}%`;
  return rows<SearchHit>(
    db(),
    sql`(select 'PACKAGE' as kind, p.id::text, p.package_code || ' · ' || p.title as title, c.company_name || ' · ' || p.operational_stage as subtitle,
                '/operations/' || p.package_code as href
           from tpms.training_packages p join tpms.corporate_clients c on c.id = p.client_id
          where lower(p.package_code) like ${q} or lower(p.title) like ${q} or lower(c.company_name) like ${q} or lower(coalesce(p.etris_grant_id, '')) like ${q}
          limit 20)
        union all
        (select 'LEAD', l.id::text, l.company_name || ' · ' || l.pic_full_name, l.status || ' · ' || coalesce(l.training_topic, ''), '/leads/' || l.id
           from tpms.lead_records l
          where lower(l.company_name) like ${q} or lower(l.pic_email) like ${q} or lower(l.pic_full_name) like ${q} or l.pic_phone_e164 like ${q}
          limit 20)
        union all
        (select 'CLIENT', c.id::text, c.company_name, coalesce(c.company_domain, '') || ' · ' || c.primary_pic_name, '/clients/' || c.id
           from tpms.corporate_clients c
          where lower(c.company_name) like ${q} or lower(coalesce(c.company_domain, '')) like ${q} or lower(coalesce(c.ssm_registration, '')) like ${q}
          limit 20)`,
  );
}
