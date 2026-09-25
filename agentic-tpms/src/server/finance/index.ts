/**
 * Accounts payable, unit economics and the executive KPIs — public surface for
 * the Payables desk and the Dashboard. The task handler lives in ./tasks.
 */
export {
  draftPaymentVouchers,
  adjustVoucher,
  markVoucherPaid,
  settlePackage,
  listVouchers,
  planVouchers,
  normaliseAdjustments,
  ADJUSTMENT_KINDS,
  PV_STATUSES,
  PV_DRAFTER,
  type AdjustmentInput,
  type PaymentInput,
  type DraftVouchersResult,
  type SettlementResult,
  type VoucherRow,
} from "./vouchers";
export { getLedger, settlementFigures, voucherCostSen, type JobLedger } from "./ledger";
export {
  executiveOverview,
  claimDso,
  computeDso,
  openReceivables,
  pipelineByStage,
  marginByTrainer,
  cashAtRisk,
  upfrontAdvances,
  monthlyRemittances,
  topClientsByLevy,
  type ExecutiveOverview,
  type DsoSummary,
} from "./kpis";
export { financeConfig } from "./common";
export { payablesDesk, payablesState, type PayablesDesk, type PayablesGroup, type PayablesState, type PlannedPayable } from "./payables";
export { marginByPackage, type PackageMargin } from "./margins";
