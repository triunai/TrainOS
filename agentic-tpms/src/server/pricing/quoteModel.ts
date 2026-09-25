import { fromSen, type Sen } from "@/lib/money";
import { DELIVERY_MODES, type DeliveryMode } from "../domain/stages";
import { DomainError } from "../domain/errors";
import type { CostBasis } from "./costMatrix";

/**
 * The quotation model — Level 0, pure TypeScript, integer sen throughout.
 *
 * WHY a second engine exists at all: the operator sees and edits the model
 * as a Univer spreadsheet (univerEngine.ts). A spreadsheet is easy to get
 * subtly wrong (a range that misses a row, a float that rounds the other
 * way), so every price is computed twice — here and in the sheet — and
 * `priceQuotation` refuses to proceed unless both agree to the sen.
 *
 * The fee can never exceed the Allowable Cost Matrix cap: an override above
 * the cap is clamped (with a warning), and the database refuses a quotation
 * row or package whose quoted amount exceeds its cap as a second line.
 */
export interface QuotePolicyTerms {
  version: string;
  basis: CostBasis;
  /** Daily cap in sen for this headcount (already resolved from the band). */
  dailyCap: Sen;
}

export interface QuoteInputs {
  deliveryMode: DeliveryMode;
  pax: number;
  days: number;
  trainerDayRate: Sen;
  /** Daily delegate rate (venue + F&B) per participant per day. */
  venueDdrPerPax: Sen;
  /** Printed/e-materials per participant for the whole programme. */
  materialsPerPax: Sen;
  otherDirectCosts: Sen;
  /** Operator's fee; null/undefined = quote at the cap. */
  quotedFeeOverride?: Sen | null;
  policy: QuotePolicyTerms;
}

export const LINE_CODES = ["TRAINER", "VENUE", "MATERIALS", "OTHER", "COURSE_FEE"] as const;
export type LineCode = (typeof LINE_CODES)[number];

export interface QuoteLineItem {
  code: LineCode;
  label: string;
  qty: number;
  unit: string;
  unitCost: Sen;
  amount: Sen;
  kind: "COST" | "FEE";
}

export const QUOTE_WARNINGS = ["MARGIN_BELOW_20", "OVERRIDE_CLAMPED_TO_CAP", "NEGATIVE_MARGIN", "ROT_VENUE_ZEROED"] as const;
export type QuoteWarning = (typeof QUOTE_WARNINGS)[number];

export interface QuoteResult {
  allowableCap: Sen;
  quotedFee: Sen;
  lineItems: QuoteLineItem[];
  totalDirectCost: Sen;
  grossMargin: Sen;
  /** Percentage of the quoted fee, 2 decimals, rounded half away from zero. */
  marginPct: number;
  capHeadroom: Sen;
  warnings: QuoteWarning[];
}

export const MIN_HEALTHY_MARGIN_PCT = 20;
/** Upper bound on any single money input (RM 10m) — a typo guard, not policy. */
const MAX_MONEY_SEN = 1_000_000_000;

function assertMoney(name: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_MONEY_SEN) {
    throw new DomainError("INVALID_QUOTE_INPUT", `${name} must be a whole number of sen between 0 and ${MAX_MONEY_SEN} (got ${String(value)})`);
  }
}

/** R14: an unknown mode or basis, a fractional headcount or a float amount is refused, never coerced. */
export function assertQuoteInputs(inputs: QuoteInputs): void {
  if (!(DELIVERY_MODES as readonly string[]).includes(inputs.deliveryMode)) {
    throw new DomainError("INVALID_QUOTE_INPUT", `Unknown delivery mode ${String(inputs.deliveryMode)}`);
  }
  if (!Number.isInteger(inputs.pax) || inputs.pax < 1 || inputs.pax > 999) {
    throw new DomainError("INVALID_QUOTE_INPUT", `Headcount must be a whole number from 1 to 999 (got ${inputs.pax})`);
  }
  if (!Number.isInteger(inputs.days) || inputs.days < 1 || inputs.days > 30) {
    throw new DomainError("INVALID_QUOTE_INPUT", `Duration must be a whole number of days from 1 to 30 (got ${inputs.days})`);
  }
  assertMoney("trainerDayRate", inputs.trainerDayRate);
  assertMoney("venueDdrPerPax", inputs.venueDdrPerPax);
  assertMoney("materialsPerPax", inputs.materialsPerPax);
  assertMoney("otherDirectCosts", inputs.otherDirectCosts);
  if (inputs.quotedFeeOverride !== null && inputs.quotedFeeOverride !== undefined) {
    assertMoney("quotedFeeOverride", inputs.quotedFeeOverride);
  }
  if (inputs.policy.basis !== "PER_GROUP_DAY" && inputs.policy.basis !== "PER_PAX_DAY") {
    throw new DomainError("INVALID_QUOTE_INPUT", `Unknown cost basis ${String(inputs.policy.basis)}`);
  }
  assertMoney("policy.dailyCap", inputs.policy.dailyCap);
}

/** Exact integer rounding of num/den, half away from zero (spreadsheet ROUND semantics). */
export function divRoundHalfAway(num: number, den: number): number {
  if (den === 0) throw new Error("division by zero");
  const sign = Math.sign(num) * Math.sign(den);
  const a = Math.abs(num);
  const b = Math.abs(den);
  return sign * Math.floor((2 * a + b) / (2 * b));
}

/** Margin as a percentage with two decimals: round(margin × 10000 / fee) / 100, computed on integers. */
export function marginPercent(grossMargin: Sen, quotedFee: Sen): number {
  if (quotedFee === 0) return 0;
  return divRoundHalfAway(grossMargin * 10_000, quotedFee) / 100;
}

function feeLine(inputs: QuoteInputs, quotedFee: Sen): QuoteLineItem {
  // Show the fee per billing unit when it divides exactly; otherwise as one lot, so qty × unit = amount always holds.
  const perPax = inputs.policy.basis === "PER_PAX_DAY";
  const units = perPax ? inputs.pax * inputs.days : inputs.days;
  const exact = units > 0 && quotedFee % units === 0;
  return {
    code: "COURSE_FEE",
    label: "Course fee (HRD Corp SBL-Khas claimable)",
    qty: exact ? units : 1,
    unit: exact ? (perPax ? "pax-day" : "group-day") : "programme",
    unitCost: exact ? quotedFee / units : quotedFee,
    amount: quotedFee,
    kind: "FEE",
  };
}

export function computeQuote(inputs: QuoteInputs): QuoteResult {
  assertQuoteInputs(inputs);
  const { pax, days, policy } = inputs;
  const warnings: QuoteWarning[] = [];

  const allowableCap = policy.basis === "PER_PAX_DAY" ? policy.dailyCap * pax * days : policy.dailyCap * days;
  const override = inputs.quotedFeeOverride ?? null;
  if (override !== null && override > allowableCap) warnings.push("OVERRIDE_CLAMPED_TO_CAP");
  const quotedFee = Math.min(override ?? allowableCap, allowableCap);

  const rot = inputs.deliveryMode === "ROT_VIRTUAL";
  if (rot && inputs.venueDdrPerPax > 0) warnings.push("ROT_VENUE_ZEROED");
  const ddr = rot ? 0 : inputs.venueDdrPerPax;

  const costs: QuoteLineItem[] = [
    { code: "TRAINER", label: "Trainer professional fee", qty: days, unit: "day", unitCost: inputs.trainerDayRate, amount: inputs.trainerDayRate * days, kind: "COST" },
    {
      code: "VENUE",
      label: rot ? "Venue & F&B (not applicable: remote online)" : "Venue & F&B (daily delegate rate)",
      qty: pax * days,
      unit: "pax-day",
      unitCost: ddr,
      amount: ddr * pax * days,
      kind: "COST",
    },
    { code: "MATERIALS", label: "Training materials", qty: pax, unit: "pax", unitCost: inputs.materialsPerPax, amount: inputs.materialsPerPax * pax, kind: "COST" },
    { code: "OTHER", label: "Other direct costs", qty: 1, unit: "lot", unitCost: inputs.otherDirectCosts, amount: inputs.otherDirectCosts, kind: "COST" },
  ];

  const totalDirectCost = costs.reduce((acc, line) => acc + line.amount, 0);
  const grossMargin = quotedFee - totalDirectCost;
  const marginPct = marginPercent(grossMargin, quotedFee);
  if (grossMargin < 0) warnings.push("NEGATIVE_MARGIN");
  if (marginPct < MIN_HEALTHY_MARGIN_PCT) warnings.push("MARGIN_BELOW_20");

  return {
    allowableCap,
    quotedFee,
    lineItems: [...costs, feeLine(inputs, quotedFee)],
    totalDirectCost,
    grossMargin,
    marginPct,
    capHeadroom: allowableCap - quotedFee,
    warnings,
  };
}

// ---------------------------------------------------------------- storage shape
/**
 * The database edge: jsonb carries money as NUMERIC-style strings (AGENTS.md
 * rule 7), the model carries sen. These two functions are the only converters.
 */
export interface StoredLineItem {
  code: LineCode;
  label: string;
  qty: number;
  unit: string;
  unitCost: string;
  amount: string;
  kind: "COST" | "FEE";
}

export function toStoredLineItems(items: QuoteLineItem[]): StoredLineItem[] {
  return items.map((i) => ({ ...i, unitCost: fromSen(i.unitCost), amount: fromSen(i.amount) }));
}

export interface StoredQuoteInputs {
  deliveryMode: DeliveryMode;
  pax: number;
  days: number;
  trainerDayRate: string;
  venueDdrPerPax: string;
  materialsPerPax: string;
  otherDirectCosts: string;
  quotedFeeOverride: string | null;
  policy: { version: string; basis: CostBasis; dailyCap: string };
}

export function toStoredInputs(inputs: QuoteInputs): StoredQuoteInputs {
  return {
    deliveryMode: inputs.deliveryMode,
    pax: inputs.pax,
    days: inputs.days,
    trainerDayRate: fromSen(inputs.trainerDayRate),
    venueDdrPerPax: fromSen(inputs.venueDdrPerPax),
    materialsPerPax: fromSen(inputs.materialsPerPax),
    otherDirectCosts: fromSen(inputs.otherDirectCosts),
    quotedFeeOverride: inputs.quotedFeeOverride === null || inputs.quotedFeeOverride === undefined ? null : fromSen(inputs.quotedFeeOverride),
    policy: { version: inputs.policy.version, basis: inputs.policy.basis, dailyCap: fromSen(inputs.policy.dailyCap) },
  };
}

export function computedSummary(result: QuoteResult): Record<string, unknown> {
  return {
    allowableCap: fromSen(result.allowableCap),
    quotedFee: fromSen(result.quotedFee),
    totalDirectCost: fromSen(result.totalDirectCost),
    grossMargin: fromSen(result.grossMargin),
    marginPct: result.marginPct,
    capHeadroom: fromSen(result.capHeadroom),
    warnings: result.warnings,
  };
}
