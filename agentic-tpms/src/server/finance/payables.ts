import { eq, sql } from "drizzle-orm";
import { todayMY, TZ } from "@/lib/dates";
import { fromSen, toSen } from "@/lib/money";
import { db, rows, schema } from "../db/client";
import { loadSnapshot } from "../packages/snapshot";
import { financeConfig } from "./common";
import { listVouchers, planVouchers, type VoucherRow } from "./vouchers";

/**
 * The cross-package Payables desk (Finance › Payables, Gate 3 AP).
 *
 * Pay-when-paid means a delivered package owes its trainer and vendors long
 * before anything is payable: vouchers are drafted only when HRD Corp remits.
 * So the desk shows three kinds of package, by financial stage:
 *
 *   PAYABLE              REMITTED: the vouchers can be approved and paid, then the package settled
 *   AWAITING_REMITTANCE  delivered, claim not yet remitted: what WILL be owed (from `planVouchers`,
 *                        the same derivation the drafter uses), shown as waiting on HRD Corp
 *   SETTLED              SETTLED_CLOSED: every voucher paid, history
 *
 * R14: a stage with no mapping is an error, not a silent omission.
 */
export type PayablesState = "PAYABLE" | "AWAITING_REMITTANCE" | "SETTLED";

const STAGE_STATE: Record<string, PayablesState | null> = {
  ESTIMATE: null,
  GRANT_RESERVED: null,
  UPFRONT_CLAIM_SUBMITTED: null,
  CLAIM_NOT_READY: "AWAITING_REMITTANCE",
  CLAIM_READY: "AWAITING_REMITTANCE",
  CLAIM_SUBMITTED: "AWAITING_REMITTANCE",
  QUERIED: "AWAITING_REMITTANCE",
  APPROVED: "AWAITING_REMITTANCE",
  REMITTED: "PAYABLE",
  SETTLED_CLOSED: "SETTLED",
  VOIDED: null,
};

export function payablesState(financialStage: string): PayablesState | null {
  if (!(financialStage in STAGE_STATE)) throw new Error(`Unknown financial stage: ${financialStage}`);
  return STAGE_STATE[financialStage];
}

export type PlannedPayable = { payeeType: string; payeeName: string; basis: string; agreed: string };

export type PayablesGroup = {
  packageId: string;
  packageCode: string;
  title: string;
  clientName: string;
  financialStage: string;
  endDate: string | null;
  state: PayablesState;
  remittanceReference: string | null;
  remittanceAmount: string | null;
  vouchers: VoucherRow[];
  /** AWAITING_REMITTANCE only: the payables the drafter will create when HRD Corp remits. */
  planned: PlannedPayable[];
  /** Sum of the live vouchers' final amounts, or of the planned agreed amounts while awaiting. */
  total: string;
  unpaid: string;
  /** REMITTED with at least one live voucher and every live voucher PAID. */
  readyToSettle: boolean;
};

export type PayablesDesk = {
  groups: PayablesGroup[];
  metrics: {
    /** Unpaid live vouchers on remitted packages (DRAFT to approve + APPROVED to pay). */
    payableNow: { amount: string; vouchers: number; toApprove: number; toPay: number };
    /** Owed on delivered packages whose claim HRD Corp has not remitted. */
    awaitingRemittance: { amount: string; packages: number };
    /** Vouchers marked PAID in the current Malaysia calendar month. */
    paidThisMonth: { amount: string; vouchers: number };
    readyToSettle: number;
  };
};

type PackageRow = {
  packageId: string;
  packageCode: string;
  title: string;
  clientName: string;
  financialStage: string;
  endDate: string | null;
  remittanceReference: string | null;
  remittanceAmount: string | null;
  createdBy: string | null;
};

const live = (v: VoucherRow) => v.status !== "CANCELLED";

async function plannedFor(packageId: string, createdBy: string | null, today: string): Promise<PlannedPayable[]> {
  const snapshot = await loadSnapshot(db(), packageId, today);
  const vendorIds = snapshot.commitments.map((c) => c.vendorId).filter((id): id is string => Boolean(id));
  const vendorNames = new Map<string, string>();
  if (vendorIds.length) {
    const found = await rows<{ id: string; name: string }>(db(), sql`select id, name from tpms.vendors where id = any (${`{${vendorIds.join(",")}}`}::uuid[])`);
    for (const v of found) vendorNames.set(v.id, v.name);
  }
  let payeeName = "Sales representative (unassigned)";
  if (createdBy) {
    const [op] = await db().select({ name: schema.operators.fullName }).from(schema.operators).where(eq(schema.operators.id, createdBy));
    if (op) payeeName = op.name;
  }
  const { plans } = planVouchers(snapshot, vendorNames, { rateE4: financeConfig().commissionRateE4, payeeName });
  return plans.map((p) => ({ payeeType: p.payeeType, payeeName: p.payeeName, basis: p.basis, agreed: fromSen(p.agreedSen) }));
}

export async function payablesDesk(opts: { asOf?: Date } = {}): Promise<PayablesDesk> {
  const asOf = opts.asOf ?? new Date();
  const today = todayMY(asOf);
  const [packages, vouchers, [paid]] = await Promise.all([
    rows<PackageRow>(
      db(),
      sql`select p.id as "packageId", p.package_code as "packageCode", p.title, c.company_name as "clientName",
                 p.financial_stage as "financialStage", p.end_date as "endDate",
                 p.remittance_reference as "remittanceReference", p.remittance_amount::text as "remittanceAmount",
                 p.created_by as "createdBy"
            from tpms.training_packages p
            join tpms.corporate_clients c on c.id = p.client_id
           where p.financial_stage in ('CLAIM_NOT_READY', 'CLAIM_READY', 'CLAIM_SUBMITTED', 'QUERIED', 'APPROVED', 'REMITTED', 'SETTLED_CLOSED')
              or exists (select 1 from tpms.payment_vouchers v where v.package_id = p.id)
           order by p.end_date nulls last, p.package_code`,
    ),
    listVouchers(),
    rows<{ amount: string; vouchers: number }>(
      db(),
      sql`select coalesce(sum(final_amount), 0)::text as amount, count(*)::int as vouchers
            from tpms.payment_vouchers
           where status = 'PAID'
             and date_trunc('month', paid_at at time zone ${TZ}) = date_trunc('month', ${asOf}::timestamptz at time zone ${TZ})`,
    ),
  ]);

  const byPackage = new Map<string, VoucherRow[]>();
  for (const v of vouchers) byPackage.set(v.packageId, [...(byPackage.get(v.packageId) ?? []), v]);

  const groups: PayablesGroup[] = [];
  for (const p of packages) {
    const state = payablesState(p.financialStage);
    if (!state) continue;
    const own = (byPackage.get(p.packageId) ?? []).sort((a, b) => a.pvNumber.localeCompare(b.pvNumber));
    const liveOwn = own.filter(live);
    const planned = state === "AWAITING_REMITTANCE" && liveOwn.length === 0 ? await plannedFor(p.packageId, p.createdBy, today) : [];
    const totalSen = liveOwn.length ? liveOwn.reduce((acc, v) => acc + toSen(v.finalAmount), 0) : planned.reduce((acc, v) => acc + toSen(v.agreed), 0);
    const unpaidSen = liveOwn.length ? liveOwn.filter((v) => v.status !== "PAID").reduce((acc, v) => acc + toSen(v.finalAmount), 0) : totalSen;
    groups.push({
      packageId: p.packageId,
      packageCode: p.packageCode,
      title: p.title,
      clientName: p.clientName,
      financialStage: p.financialStage,
      endDate: p.endDate,
      state,
      remittanceReference: p.remittanceReference,
      remittanceAmount: p.remittanceAmount,
      vouchers: own,
      planned,
      total: fromSen(totalSen),
      unpaid: fromSen(state === "SETTLED" ? 0 : unpaidSen),
      readyToSettle: state === "PAYABLE" && liveOwn.length > 0 && liveOwn.every((v) => v.status === "PAID"),
    });
  }

  const payableVouchers = groups.filter((g) => g.state === "PAYABLE").flatMap((g) => g.vouchers.filter((v) => live(v) && v.status !== "PAID"));
  const awaiting = groups.filter((g) => g.state === "AWAITING_REMITTANCE");
  return {
    groups,
    metrics: {
      payableNow: {
        amount: fromSen(payableVouchers.reduce((acc, v) => acc + toSen(v.finalAmount), 0)),
        vouchers: payableVouchers.length,
        toApprove: payableVouchers.filter((v) => v.status === "DRAFT").length,
        toPay: payableVouchers.filter((v) => v.status === "APPROVED").length,
      },
      awaitingRemittance: { amount: fromSen(awaiting.reduce((acc, g) => acc + toSen(g.unpaid), 0)), packages: awaiting.length },
      paidThisMonth: { amount: fromSen(toSen(paid?.amount ?? "0")), vouchers: paid?.vouchers ?? 0 },
      readyToSettle: groups.filter((g) => g.readyToSettle).length,
    },
  };
}
