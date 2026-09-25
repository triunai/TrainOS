import { sql } from "drizzle-orm";
import { daysBetween, todayMY, TZ } from "@/lib/dates";
import { fromSen, toSen } from "@/lib/money";
import { type Executor, db, rows } from "../db/client";
import { assertOpsStage, OPS_STAGES, type OpsStage } from "../domain/stages";

/**
 * Executive overview — the Dashboard's numbers, each one a typed SQL read.
 *
 * Money leaves as NUMERIC strings (never a float); sums inside TypeScript run
 * in sen. Month boundaries are Asia/Kuala_Lumpur calendar months, and "days"
 * are MYT calendar days, so a remittance banked at 07:30 on the 1st counts in
 * the month the operator saw it land.
 */
const MYT = TZ;

// ---------------------------------------------------------------- claim DSO

export type DsoRow = { packageId: string; packageCode: string; title: string; deliveredAt: Date; remittedAt: Date };
export type DsoPackage = DsoRow & { days: number };
export type DsoSummary = {
  /** Every remitted package, newest remittance first. */
  perPackage: DsoPackage[];
  /** Mean days over packages remitted in the window; null when none were. */
  averageDays: number | null;
  windowDays: number;
  sampleSize: number;
};

/** Calendar days in MYT between delivery completion and remittance. */
export function dsoDays(deliveredAt: Date, remittedAt: Date): number {
  return daysBetween(todayMY(deliveredAt), todayMY(remittedAt));
}

/**
 * Claim DSO: days from the DELIVERY_COMPLETED audit row to the REMITTED audit
 * row. Pure over its rows so it can be tested on fixed timestamps (the audit
 * ledger is append-only and stamps its own clock, so a fixture cannot backdate it).
 */
export function computeDso(input: DsoRow[], asOf: Date = new Date(), windowDays = 90): DsoSummary {
  const perPackage = input
    .map((r) => ({ ...r, days: dsoDays(r.deliveredAt, r.remittedAt) }))
    .sort((a, b) => b.remittedAt.getTime() - a.remittedAt.getTime());
  const since = asOf.getTime() - windowDays * 86_400_000;
  const recent = perPackage.filter((p) => p.remittedAt.getTime() >= since && p.remittedAt.getTime() <= asOf.getTime());
  const averageDays = recent.length ? Math.round((recent.reduce((acc, p) => acc + p.days, 0) / recent.length) * 10) / 10 : null;
  return { perPackage, averageDays, windowDays, sampleSize: recent.length };
}

/**
 * Raw `execute` results carry timestamptz as text (Drizzle overrides pg's
 * parser), so instants cross the boundary as epoch milliseconds.
 */
const epochMs = (value: number | string | null): Date | null => (value === null ? null : new Date(Number(value)));

export async function loadDsoRows(executor: Executor = db()): Promise<DsoRow[]> {
  const result = await rows<Omit<DsoRow, "deliveredAt" | "remittedAt"> & { deliveredMs: number; remittedMs: number }>(
    executor,
    sql`with delivered as (
          select entity_id as package_id, min(created_at) as delivered_at
            from tpms.audit_ledger
           where entity_type = 'TRAINING_PACKAGE' and machine = 'OPERATIONAL' and to_stage = 'DELIVERY_COMPLETED'
           group by entity_id
        ), remitted as (
          select entity_id as package_id, max(created_at) as remitted_at
            from tpms.audit_ledger
           where entity_type = 'TRAINING_PACKAGE' and machine = 'FINANCIAL' and to_stage = 'REMITTED'
           group by entity_id
        )
        select p.id as "packageId", p.package_code as "packageCode", p.title,
               (extract(epoch from d.delivered_at) * 1000)::float8 as "deliveredMs",
               (extract(epoch from r.remitted_at) * 1000)::float8 as "remittedMs"
          from remitted r
          join delivered d on d.package_id = r.package_id
          join tpms.training_packages p on p.id = r.package_id`,
  );
  return result.map(({ deliveredMs, remittedMs, ...r }) => ({ ...r, deliveredAt: epochMs(deliveredMs)!, remittedAt: epochMs(remittedMs)! }));
}

export async function claimDso(opts: { asOf?: Date; windowDays?: number } = {}): Promise<DsoSummary> {
  return computeDso(await loadDsoRows(), opts.asOf ?? new Date(), opts.windowDays ?? 90);
}

// ---------------------------------------------------------------- receivables

export type ReceivableRow = {
  packageId: string;
  packageCode: string;
  title: string;
  clientName: string;
  financialStage: string;
  invoiceNumber: string | null;
  invoiceTotal: string | null;
  hrdcApprovedAmount: string | null;
  upfrontAmount: string;
  claimSubmissionRef: string | null;
  submittedAt: Date | null;
  daysOutstanding: number | null;
};

export type Receivables = { total: string; count: number; rows: ReceivableRow[] };

/** Claims with HRD Corp and not yet remitted (submitted, queried, approved): the sum of their invoice totals. */
export async function openReceivables(asOf: Date = new Date()): Promise<Receivables> {
  const result = await rows<Omit<ReceivableRow, "daysOutstanding" | "submittedAt"> & { submittedMs: number | null }>(
    db(),
    sql`select p.id as "packageId", p.package_code as "packageCode", p.title, c.company_name as "clientName",
               p.financial_stage as "financialStage", i.invoice_number as "invoiceNumber", i.total::text as "invoiceTotal",
               p.hrdc_approved_amount::text as "hrdcApprovedAmount", p.upfront_amount::text as "upfrontAmount",
               p.claim_submission_ref as "claimSubmissionRef",
               (select (extract(epoch from min(a.created_at)) * 1000)::float8 from tpms.audit_ledger a
                 where a.entity_id = p.id and a.machine = 'FINANCIAL' and a.to_stage = 'CLAIM_SUBMITTED') as "submittedMs"
          from tpms.training_packages p
          join tpms.corporate_clients c on c.id = p.client_id
          left join tpms.tax_invoices i on i.package_id = p.id
         where p.financial_stage in ('CLAIM_SUBMITTED', 'QUERIED', 'APPROVED')
         order by "submittedMs" nulls last, p.package_code`,
  );
  const today = todayMY(asOf);
  const withAge = result.map(({ submittedMs, ...r }) => {
    const submittedAt = epochMs(submittedMs);
    return { ...r, submittedAt, daysOutstanding: submittedAt ? daysBetween(todayMY(submittedAt), today) : null };
  });
  return {
    total: fromSen(withAge.reduce((acc, r) => acc + toSen(r.invoiceTotal), 0)),
    count: withAge.length,
    rows: withAge,
  };
}

// ---------------------------------------------------------------- pipeline

export type PipelineStage = { stage: OpsStage; packages: number; quotedValue: string };

/** Every operational stage, in display order (zeros included), with its count and quoted value. */
export async function pipelineByStage(): Promise<PipelineStage[]> {
  const result = await rows<{ stage: string; packages: number; quoted: string }>(
    db(),
    sql`select operational_stage as stage, count(*)::int as packages, coalesce(sum(quoted_amount), 0)::text as quoted
          from tpms.training_packages group by operational_stage`,
  );
  const byStage = new Map(result.map((r) => [assertOpsStage(r.stage), r]));
  return OPS_STAGES.map((stage) => ({
    stage,
    packages: byStage.get(stage)?.packages ?? 0,
    quotedValue: fromSen(toSen(byStage.get(stage)?.quoted ?? "0")),
  }));
}

// ---------------------------------------------------------------- margin by trainer

export type TrainerMargin = {
  trainerId: string | null;
  trainerName: string;
  packages: number;
  reconciled: number;
  revenue: string;
  trainerFees: string;
  grossMargin: string;
  netProfit: string;
  marginPct: number | null;
};

/**
 * Unit economics per trainer from `job_financial_ledgers`. A row is an
 * estimate until settlement reconciles it; `reconciled` counts the actuals.
 */
export async function marginByTrainer(): Promise<TrainerMargin[]> {
  const result = await rows<Omit<TrainerMargin, "marginPct">>(
    db(),
    sql`with eng as (
          select distinct on (e.package_id) e.package_id, e.trainer_id
            from tpms.trainer_engagements e
           where e.status <> 'RELEASED'
           order by e.package_id, (e.status = 'CONFIRMED') desc, e.created_at desc
        )
        select t.id as "trainerId", coalesce(t.full_name, 'Unassigned') as "trainerName",
               count(*)::int as packages,
               count(*) filter (where l.reconciled_at is not null)::int as reconciled,
               sum(l.approved_grant_amount)::text as revenue,
               sum(l.trainer_fee_agreed)::text as "trainerFees",
               sum(l.gross_margin)::text as "grossMargin",
               sum(l.net_retained_profit)::text as "netProfit"
          from tpms.job_financial_ledgers l
          left join eng on eng.package_id = l.package_id
          left join tpms.trainers t on t.id = eng.trainer_id
         group by t.id, t.full_name
         order by sum(l.gross_margin) desc`,
  );
  return result.map((r) => {
    const revenue = toSen(r.revenue);
    return { ...r, marginPct: revenue > 0 ? Math.round((toSen(r.grossMargin) / revenue) * 1000) / 10 : null };
  });
}

// ---------------------------------------------------------------- cash at risk

export type CashAtRiskRow = {
  packageId: string;
  packageCode: string;
  title: string;
  operationalStage: string;
  financialStage: string;
  trainerCommitted: string;
  vendorCommitted: string;
  vendorProvisional: string;
};

export type CashAtRisk = { committed: string; provisional: string; rows: CashAtRiskRow[] };

/**
 * Fees the provider has committed on packages HRD Corp has not yet paid for:
 * the confirmed trainer (day rate x days) plus vendors with a signed BEO or a
 * delivery order. Provisional vendor holds are shown separately — they are
 * cancellable inside the vendor's window.
 */
export async function cashAtRisk(): Promise<CashAtRisk> {
  const result = await rows<CashAtRiskRow>(
    db(),
    sql`select p.id as "packageId", p.package_code as "packageCode", p.title,
               p.operational_stage as "operationalStage", p.financial_stage as "financialStage",
               coalesce((select e.day_rate * coalesce(p.duration_days, 0) from tpms.trainer_engagements e
                          where e.package_id = p.id and e.status = 'CONFIRMED'
                          order by e.created_at desc limit 1), 0)::text as "trainerCommitted",
               coalesce((select sum(c.cost) from tpms.vendor_commitments c
                          where c.package_id = p.id and c.status in ('BEO_SIGNED', 'DO_RECEIVED')), 0)::text as "vendorCommitted",
               coalesce((select sum(c.cost) from tpms.vendor_commitments c
                          where c.package_id = p.id and c.status = 'PROVISIONAL'), 0)::text as "vendorProvisional"
          from tpms.training_packages p
         where p.financial_stage not in ('REMITTED', 'SETTLED_CLOSED', 'VOIDED')
           and p.operational_stage <> 'CANCELLED'
         order by p.start_date nulls last, p.package_code`,
  );
  const live = result.filter((r) => toSen(r.trainerCommitted) + toSen(r.vendorCommitted) + toSen(r.vendorProvisional) > 0);
  return {
    committed: fromSen(live.reduce((acc, r) => acc + toSen(r.trainerCommitted) + toSen(r.vendorCommitted), 0)),
    provisional: fromSen(live.reduce((acc, r) => acc + toSen(r.vendorProvisional), 0)),
    rows: live,
  };
}

// ---------------------------------------------------------------- upfront advances

export type AdvanceRow = { packageId: string; packageCode: string; title: string; financialStage: string; upfrontAmount: string };
export type Advances = {
  /** Received and not yet reconciled by a remittance. */
  outstanding: string;
  /** Received on a package that was then voided: owed back to HRD Corp. */
  refundDue: string;
  rows: AdvanceRow[];
};

export async function upfrontAdvances(): Promise<Advances> {
  const result = await rows<AdvanceRow>(
    db(),
    sql`select p.id as "packageId", p.package_code as "packageCode", p.title,
               p.financial_stage as "financialStage", p.upfront_amount::text as "upfrontAmount"
          from tpms.training_packages p
         where (p.upfront_30pct_claimed or p.upfront_amount > 0)
           and p.financial_stage not in ('REMITTED', 'SETTLED_CLOSED')
         order by p.package_code`,
  );
  const sum = (filter: (r: AdvanceRow) => boolean) => fromSen(result.filter(filter).reduce((acc, r) => acc + toSen(r.upfrontAmount), 0));
  return { outstanding: sum((r) => r.financialStage !== "VOIDED"), refundDue: sum((r) => r.financialStage === "VOIDED"), rows: result };
}

// ---------------------------------------------------------------- remittances by month

export type MonthlyRemittance = { month: string; amount: string; packages: number };

/** The last `months` MYT calendar months up to `asOf`, oldest first, zero-filled. */
export async function monthlyRemittances(opts: { months?: number; asOf?: Date } = {}): Promise<MonthlyRemittance[]> {
  const months = Math.max(1, Math.min(60, Math.floor(opts.months ?? 12)));
  const asOf = opts.asOf ?? new Date();
  return rows<MonthlyRemittance>(
    db(),
    sql`with months as (
          select generate_series(
                   date_trunc('month', ${asOf}::timestamptz at time zone ${MYT}) - make_interval(months => ${months - 1}),
                   date_trunc('month', ${asOf}::timestamptz at time zone ${MYT}),
                   interval '1 month')::date as month
        )
        select to_char(m.month, 'YYYY-MM') as month,
               coalesce(sum(p.remittance_amount), 0)::text as amount,
               count(p.id)::int as packages
          from months m
          left join tpms.training_packages p
            on p.remitted_at is not null
           and date_trunc('month', p.remitted_at at time zone ${MYT})::date = m.month
         group by m.month
         order by m.month`,
  );
}

// ---------------------------------------------------------------- top clients

export type ClientLevyValue = {
  clientId: string;
  companyName: string;
  packages: number;
  levyValue: string;
  levyBalanceEstimate: string | null;
};

/** Clients ranked by the grant value drawn from their HRD Corp levy (approved claim, else approved grant). */
export async function topClientsByLevy(limit = 10): Promise<ClientLevyValue[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  return rows<ClientLevyValue>(
    db(),
    sql`select c.id as "clientId", c.company_name as "companyName", count(p.id)::int as packages,
               sum(coalesce(p.hrdc_approved_amount, p.grant_approved_amount))::text as "levyValue",
               c.levy_balance_estimate::text as "levyBalanceEstimate"
          from tpms.corporate_clients c
          join tpms.training_packages p on p.client_id = c.id
         where p.grant_approved_amount is not null
           and p.financial_stage <> 'VOIDED' and p.operational_stage <> 'CANCELLED'
         group by c.id, c.company_name, c.levy_balance_estimate
         order by sum(coalesce(p.hrdc_approved_amount, p.grant_approved_amount)) desc, c.company_name
         limit ${n}`,
  );
}

// ---------------------------------------------------------------- overview

export type ExecutiveOverview = {
  asOf: string;
  dso: DsoSummary;
  receivables: Receivables;
  pipeline: PipelineStage[];
  marginByTrainer: TrainerMargin[];
  cashAtRisk: CashAtRisk;
  upfront: Advances;
  remittances: MonthlyRemittance[];
  topClients: ClientLevyValue[];
};

export async function executiveOverview(opts: { asOf?: Date; months?: number; topClients?: number } = {}): Promise<ExecutiveOverview> {
  const asOf = opts.asOf ?? new Date();
  const [dso, receivables, pipeline, margins, risk, upfront, remittances, topClients] = await Promise.all([
    claimDso({ asOf }),
    openReceivables(asOf),
    pipelineByStage(),
    marginByTrainer(),
    cashAtRisk(),
    upfrontAdvances(),
    monthlyRemittances({ months: opts.months, asOf }),
    topClientsByLevy(opts.topClients),
  ]);
  return {
    asOf: asOf.toISOString(),
    dso,
    receivables,
    pipeline,
    marginByTrainer: margins,
    cashAtRisk: risk,
    upfront,
    remittances,
    topClients,
  };
}
