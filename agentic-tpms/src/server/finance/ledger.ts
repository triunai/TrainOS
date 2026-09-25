import { eq, sql } from "drizzle-orm";
import { fromSen, toSen, type Sen } from "@/lib/money";
import { type Executor, schema } from "../db/client";
import type { TrainingPackage } from "../db/schema";
import type { PaymentVoucher } from "../packages/snapshot";

/**
 * Unit economics: one `job_financial_ledgers` row per package.
 *
 * The row is created PROVISIONALLY when the claim goes to HRD Corp (so the
 * dashboard sees a margin while the receivable is open) from what was
 * committed: the e-TRiS approved grant, the confirmed trainer's day rate x
 * days, and the non-cancelled vendor commitments. Settlement overwrites it
 * with ACTUALS from the paid vouchers and stamps `reconciled_at`; a row with
 * `reconciled_at` null is an estimate and the KPIs say so.
 *
 * `gross_margin` / `net_retained_profit` are generated columns in SQL, so this
 * module only ever writes their inputs.
 */
export type JobLedger = typeof schema.jobFinancialLedgers.$inferSelect;

export async function ensureLedger(executor: Executor, packageId: string): Promise<void> {
  await executor.execute(sql`
    insert into tpms.job_financial_ledgers
      (package_id, approved_grant_amount, trainer_fee_agreed, venue_and_catering_cost, materials_and_printing_cost)
    select p.id,
           coalesce(p.hrdc_approved_amount, p.grant_approved_amount, 0),
           coalesce((select e.day_rate * coalesce(p.duration_days, 0)
                       from tpms.trainer_engagements e
                      where e.package_id = p.id and e.status = 'CONFIRMED'
                      order by e.created_at desc limit 1), 0),
           coalesce((select sum(c.cost) from tpms.vendor_commitments c
                      where c.package_id = p.id and c.status <> 'CANCELLED'
                        and c.vendor_type in ('VENUE', 'CATERING')), 0),
           coalesce((select sum(c.cost) from tpms.vendor_commitments c
                      where c.package_id = p.id and c.status <> 'CANCELLED'
                        and c.vendor_type = 'PRINTING'), 0)
      from tpms.training_packages p
     where p.id = ${packageId}::uuid
    on conflict (package_id) do nothing`);
}

export async function stampLedger(
  executor: Executor,
  packageId: string,
  patch: { claimSubmittedAt?: Date; remittedAt?: Date; taxInvoiceNumber?: string | null },
): Promise<void> {
  await ensureLedger(executor, packageId);
  await executor
    .update(schema.jobFinancialLedgers)
    .set({
      ...(patch.claimSubmittedAt ? { claimSubmittedAt: patch.claimSubmittedAt } : {}),
      ...(patch.remittedAt ? { remittedAt: patch.remittedAt } : {}),
      ...(patch.taxInvoiceNumber ? { taxInvoiceNumber: patch.taxInvoiceNumber } : {}),
    })
    .where(eq(schema.jobFinancialLedgers.packageId, packageId));
}

type CostBucket = "TRAINER" | "VENUE_CATERING" | "MATERIALS" | "COMMISSION";

/** R14: every payee type maps to exactly one cost bucket; a new payee type is an error until mapped. */
const BUCKET: Record<string, CostBucket> = {
  TRAINER: "TRAINER",
  VENUE: "VENUE_CATERING",
  CATERING: "VENUE_CATERING",
  PRINTING: "MATERIALS",
  COMMISSION: "COMMISSION",
};

function bucketOf(v: PaymentVoucher): CostBucket {
  const bucket = BUCKET[v.payeeType];
  if (!bucket) throw new Error(`Unknown payee type on ${v.pvNumber}: ${v.payeeType}`);
  return bucket;
}

/**
 * What a voucher cost the provider. Withholding tax is part of the agreed
 * gross fee — it is withheld from the payee and remitted to LHDN, not saved —
 * so the cost is the net paid plus the WHT added back. Mileage, allowances,
 * deductions and other adjustments are real changes to the cost.
 */
export function voucherCostSen(v: PaymentVoucher): Sen {
  const wht = (v.adjustments ?? [])
    .filter((a) => a.kind === "WITHHOLDING_TAX")
    .reduce((acc, a) => acc + toSen(a.amount), 0);
  return toSen(v.finalAmount) - wht;
}

export interface SettlementFigures {
  approvedGrantSen: Sen;
  trainerFeeAgreedSen: Sen;
  trainerFeePaidSen: Sen;
  venueAndCateringSen: Sen;
  materialsAndPrintingSen: Sen;
  commissionSen: Sen;
  salesRepName: string | null;
  primary: PaymentVoucher | null;
}

/**
 * Actuals for the ledger from the paid vouchers.
 *
 * `trainer_fee_agreed` carries the trainer COST to the provider (agreed fee
 * plus mileage / allowances; WHT excluded per `voucherCostSen`) so that the
 * generated gross margin is true; `trainer_fee_paid` is the cash that reached
 * the trainer. The ledger has one bank-reference column: it records the
 * trainer voucher (or the largest voucher when there is none); every
 * voucher's own reference and receipt stay on `payment_vouchers`.
 */
export function settlementFigures(pkg: TrainingPackage, vouchers: PaymentVoucher[]): SettlementFigures {
  const live = vouchers.filter((v) => v.status !== "CANCELLED");
  const sum = (bucket: CostBucket) => live.filter((v) => bucketOf(v) === bucket).reduce((acc, v) => acc + voucherCostSen(v), 0);
  const trainer = live.filter((v) => bucketOf(v) === "TRAINER");
  const commission = live.find((v) => bucketOf(v) === "COMMISSION");
  const primary = trainer[0] ?? [...live].sort((a, b) => toSen(b.finalAmount) - toSen(a.finalAmount))[0] ?? null;
  return {
    approvedGrantSen: toSen(pkg.hrdcApprovedAmount ?? pkg.grantApprovedAmount),
    trainerFeeAgreedSen: sum("TRAINER"),
    trainerFeePaidSen: trainer.filter((v) => v.status === "PAID").reduce((acc, v) => acc + toSen(v.finalAmount), 0),
    venueAndCateringSen: sum("VENUE_CATERING"),
    materialsAndPrintingSen: sum("MATERIALS"),
    commissionSen: sum("COMMISSION"),
    salesRepName: commission?.payeeName ?? null,
    primary,
  };
}

export async function writeSettlementLedger(
  executor: Executor,
  pkg: TrainingPackage,
  vouchers: PaymentVoucher[],
  invoiceNumber: string | null,
): Promise<JobLedger> {
  const f = settlementFigures(pkg, vouchers);
  await ensureLedger(executor, pkg.id);
  await executor.execute(sql`
    update tpms.job_financial_ledgers l
       set approved_grant_amount       = ${fromSen(f.approvedGrantSen)}::numeric,
           trainer_fee_agreed          = ${fromSen(f.trainerFeeAgreedSen)}::numeric,
           trainer_fee_paid            = ${fromSen(f.trainerFeePaidSen)}::numeric,
           venue_and_catering_cost     = ${fromSen(f.venueAndCateringSen)}::numeric,
           materials_and_printing_cost = ${fromSen(f.materialsAndPrintingSen)}::numeric,
           sales_commission_amount     = ${fromSen(f.commissionSen)}::numeric,
           sales_rep_name              = ${f.salesRepName},
           tax_invoice_number          = coalesce(${invoiceNumber}, l.tax_invoice_number),
           bank_payment_reference      = ${f.primary?.bankReference ?? null},
           payment_receipt_vault_id    = ${f.primary?.receiptVaultId ?? null}::uuid,
           claim_submitted_at          = coalesce(l.claim_submitted_at,
                                           (select min(a.created_at) from tpms.audit_ledger a
                                             where a.entity_id = l.package_id and a.machine = 'FINANCIAL'
                                               and a.to_stage = 'CLAIM_SUBMITTED')),
           remitted_at                 = coalesce(${pkg.remittedAt ?? null}::timestamptz, l.remitted_at),
           reconciled_at               = now()
     where l.package_id = ${pkg.id}::uuid`);
  const [row] = await executor.select().from(schema.jobFinancialLedgers).where(eq(schema.jobFinancialLedgers.packageId, pkg.id));
  return row;
}

export async function getLedger(executor: Executor, packageId: string): Promise<JobLedger | null> {
  const [row] = await executor.select().from(schema.jobFinancialLedgers).where(eq(schema.jobFinancialLedgers.packageId, packageId));
  return row ?? null;
}
