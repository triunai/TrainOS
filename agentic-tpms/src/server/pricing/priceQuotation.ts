import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { toSen, type Sen } from "@/lib/money";
import { todayMY } from "@/lib/dates";
import { type Actor, type Executor, db, schema } from "../db/client";
import type { Quotation, TrainingPackage } from "../db/schema";
import { DomainError } from "../domain/errors";
import { activePolicy, assertDeliveryMode, policyTerms } from "./costMatrix";
import {
  computeQuote,
  computedSummary,
  toStoredInputs,
  toStoredLineItems,
  type QuoteInputs,
  type QuoteResult,
  type StoredLineItem,
  type StoredQuoteInputs,
} from "./quoteModel";
import { EDITABLE_CELLS, UNIVER_ENGINE_VERSION, computeWithUniver, type SheetValues, type UniverRun } from "./univerEngine";

/**
 * Double-entry pricing: every quotation is computed by the pure TypeScript
 * model AND by the Univer sheet, and the two must agree to the sen.
 *
 * WHY a disagreement throws a plain Error (not a DomainError): it is a defect
 * in one of the engines, not a policy refusal an operator can act on. The
 * worker retries it and then dead-letters it loudly; it never produces a
 * quotation.
 */
export interface CostInputs {
  trainerDayRate: Sen;
  venueDdrPerPax: Sen;
  materialsPerPax: Sen;
  otherDirectCosts: Sen;
  quotedFeeOverride?: Sen | null;
}

export interface PricedQuotation {
  inputs: QuoteInputs;
  result: QuoteResult;
  sheet: UniverRun;
  engines: { primary: string; secondary: string; agreement: "EXACT_TO_THE_SEN" };
}

/** Margin % is rounded once per engine; one hundredth of a percent is the only tolerated difference. */
const MARGIN_PCT_TOLERANCE = 0.01 + 1e-9;

export function assertEnginesAgree(result: QuoteResult, values: SheetValues): void {
  const line = (code: string) => result.lineItems.find((l) => l.code === code)?.amount ?? Number.NaN;
  const pairs: Array<[string, number, number]> = [
    ["allowableCap", result.allowableCap, values.allowableCap],
    ["quotedFee", result.quotedFee, values.quotedFee],
    ["trainerCost", line("TRAINER"), values.trainerCost],
    ["venueCost", line("VENUE"), values.venueCost],
    ["materialsCost", line("MATERIALS"), values.materialsCost],
    ["otherCost", line("OTHER"), values.otherCost],
    ["totalDirectCost", result.totalDirectCost, values.totalDirectCost],
    ["grossMargin", result.grossMargin, values.grossMargin],
    ["capHeadroom", result.capHeadroom, values.capHeadroom],
  ];
  const mismatches = pairs.filter(([, a, b]) => a !== b).map(([name, a, b]) => `${name}: model ${a} sen, sheet ${b} sen`);
  if (Math.abs(result.marginPct - values.marginPct) > MARGIN_PCT_TOLERANCE) {
    mismatches.push(`marginPct: model ${result.marginPct}, sheet ${values.marginPct}`);
  }
  if (mismatches.length > 0) {
    throw new Error(`PRICING_ENGINE_DISAGREEMENT: ${mismatches.join("; ")}`);
  }
}

export async function priceQuotation(inputs: QuoteInputs): Promise<PricedQuotation> {
  const result = computeQuote(inputs);
  const sheet = await computeWithUniver(inputs);
  assertEnginesAgree(result, sheet.values);
  return { inputs, result, sheet, engines: { primary: "quoteModel.ts", secondary: UNIVER_ENGINE_VERSION, agreement: "EXACT_TO_THE_SEN" } };
}

// ---------------------------------------------------------------- package facts
export interface PackageFacts {
  deliveryMode: QuoteInputs["deliveryMode"];
  pax: number;
  days: number;
  /** Date the Allowable Cost Matrix is read at: the first training day, else today. */
  onDate: string;
}

/** Pricing facts come from the package, never from the canvas: the operator edits costs, not headcount. */
export function packageFacts(pkg: TrainingPackage, fallbackDays?: number): PackageFacts {
  const days = pkg.durationDays ?? fallbackDays ?? 0;
  if (!days || days < 1) throw new DomainError("DATES_MISSING", "Set the training dates (or pick a course with a duration) before pricing");
  if (!pkg.paxEstimate || pkg.paxEstimate < 1) throw new DomainError("PAX_MISSING", "Set the estimated headcount before pricing");
  return { deliveryMode: assertDeliveryMode(pkg.deliveryMode), pax: pkg.paxEstimate, days, onDate: pkg.startDate ?? todayMY() };
}

export async function resolveQuoteInputs(executor: Executor, facts: PackageFacts, costs: CostInputs): Promise<QuoteInputs> {
  const policy = await activePolicy(facts.deliveryMode, facts.onDate, executor);
  return {
    deliveryMode: facts.deliveryMode,
    pax: facts.pax,
    days: facts.days,
    trainerDayRate: costs.trainerDayRate,
    venueDdrPerPax: costs.venueDdrPerPax,
    materialsPerPax: costs.materialsPerPax,
    otherDirectCosts: costs.otherDirectCosts,
    quotedFeeOverride: costs.quotedFeeOverride ?? null,
    policy: policyTerms(policy, facts.pax),
  };
}

// ---------------------------------------------------------------- stored shapes
const money = z.string().regex(/^-?\d+\.\d{2}$/);
const storedInputsSchema = z
  .object({
    deliveryMode: z.enum(["IN_HOUSE", "PUBLIC_PHYSICAL", "ROT_VIRTUAL"]),
    pax: z.number().int(),
    days: z.number().int(),
    trainerDayRate: money,
    venueDdrPerPax: money,
    materialsPerPax: money,
    otherDirectCosts: money,
    quotedFeeOverride: money.nullable(),
    policy: z.object({ version: z.string(), basis: z.enum(["PER_GROUP_DAY", "PER_PAX_DAY"]), dailyCap: money }),
  })
  .passthrough();

/** Back from a quotation row's `inputs` jsonb to model inputs. A row that does not parse is corrupt, not "zero". */
export function inputsFromStored(stored: unknown): QuoteInputs {
  const parsed = storedInputsSchema.safeParse(stored);
  if (!parsed.success) throw new Error(`Quotation inputs are not in the stored shape: ${parsed.error.message}`);
  const s = parsed.data;
  return {
    deliveryMode: s.deliveryMode,
    pax: s.pax,
    days: s.days,
    trainerDayRate: toSen(s.trainerDayRate),
    venueDdrPerPax: toSen(s.venueDdrPerPax),
    materialsPerPax: toSen(s.materialsPerPax),
    otherDirectCosts: toSen(s.otherDirectCosts),
    quotedFeeOverride: s.quotedFeeOverride === null ? null : toSen(s.quotedFeeOverride),
    policy: { version: s.policy.version, basis: s.policy.basis, dailyCap: toSen(s.policy.dailyCap) },
  };
}

export function costsOf(inputs: QuoteInputs): CostInputs {
  return {
    trainerDayRate: inputs.trainerDayRate,
    venueDdrPerPax: inputs.venueDdrPerPax,
    materialsPerPax: inputs.materialsPerPax,
    otherDirectCosts: inputs.otherDirectCosts,
    quotedFeeOverride: inputs.quotedFeeOverride ?? null,
  };
}

// ---------------------------------------------------------------- canvas edits
export type CostKey = (typeof EDITABLE_CELLS)[keyof typeof EDITABLE_CELLS];
const COST_KEYS = Object.values(EDITABLE_CELLS) as CostKey[];

/**
 * Edits arrive from the browser canvas keyed by the sheet's cell name
 * (`TrainerDailyRate`) or the model key (`trainerDayRate`), in RINGGIT as
 * typed. Unknown keys are refused (R14): a canvas that sends a formula cell
 * or a headcount is asking to edit something the operator may not edit.
 */
export function parseCellEdits(edits: Record<string, unknown>): Partial<CostInputs> {
  const out: Partial<CostInputs> = {};
  for (const [rawKey, rawValue] of Object.entries(edits)) {
    const key: CostKey | undefined =
      rawKey in EDITABLE_CELLS ? EDITABLE_CELLS[rawKey as keyof typeof EDITABLE_CELLS] : COST_KEYS.find((k) => k === rawKey);
    if (!key) {
      throw new DomainError("UNKNOWN_CELL", `${rawKey} is not an editable cell (editable: ${Object.keys(EDITABLE_CELLS).join(", ")})`);
    }
    const blank = rawValue === null || rawValue === undefined || (typeof rawValue === "string" && rawValue.trim() === "");
    if (blank) {
      if (key !== "quotedFeeOverride") throw new DomainError("INVALID_CELL_VALUE", `${rawKey} cannot be blank`);
      out.quotedFeeOverride = null;
      continue;
    }
    const text = typeof rawValue === "number" ? String(rawValue) : typeof rawValue === "string" ? rawValue.replace(/[,\s]/g, "").replace(/^RM/i, "") : "";
    if (!/^\d+(\.\d{1,2})?$/.test(text) || (typeof rawValue === "number" && !Number.isFinite(rawValue))) {
      throw new DomainError("INVALID_CELL_VALUE", `${rawKey} must be a non-negative ringgit amount with at most two decimals (got ${JSON.stringify(rawValue)})`);
    }
    out[key] = toSen(text);
  }
  return out;
}

export interface RecomputePreview {
  packageId: string;
  basedOn: { quotationId: string; version: number };
  edits: Partial<CostInputs>;
  inputs: QuoteInputs;
  storedInputs: StoredQuoteInputs;
  result: QuoteResult;
  lineItems: StoredLineItem[];
  computed: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  editedBy: string;
  /** The full double-entry result, for `saveQuotationRevision` to persist without a third computation. */
  priced: PricedQuotation;
}

export async function latestQuotation(packageId: string, executor: Executor = db()): Promise<Quotation | undefined> {
  const [row] = await executor
    .select()
    .from(schema.quotations)
    .where(eq(schema.quotations.packageId, packageId))
    .orderBy(desc(schema.quotations.version))
    .limit(1);
  return row;
}

/**
 * Server-side recompute of canvas edits. The browser's own formula results
 * are never read: the edited inputs are merged onto the latest quotation's
 * inputs, the headcount/days/policy are re-read from the package, and both
 * engines run again. Read-only — `saveQuotationRevision` persists.
 */
export async function recomputeFromCells(
  packageId: string,
  editedInputs: Record<string, unknown>,
  actor: Actor,
  executor: Executor = db(),
): Promise<RecomputePreview> {
  if (actor.type !== "USER") throw new DomainError("USER_REQUIRED", "Only an operator edits the quotation sheet");
  const edits = parseCellEdits(editedInputs);
  const [pkg] = await executor.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const base = await latestQuotation(packageId, executor);
  if (!base) throw new DomainError("NO_QUOTATION", "There is no quotation to edit yet; draft a proposal first");

  const baseInputs = inputsFromStored(base.inputs);
  const facts = packageFacts(pkg, baseInputs.days);
  const costs: CostInputs = { ...costsOf(baseInputs), ...edits };
  const inputs = await resolveQuoteInputs(executor, facts, costs);
  const priced = await priceQuotation(inputs);
  return {
    packageId,
    basedOn: { quotationId: base.id, version: base.version },
    edits,
    inputs,
    storedInputs: toStoredInputs(inputs),
    result: priced.result,
    lineItems: toStoredLineItems(priced.result.lineItems),
    computed: { ...computedSummary(priced.result), engines: priced.engines, univerMs: priced.sheet.durationMs },
    snapshot: priced.sheet.snapshot,
    editedBy: actor.id,
    priced,
  };
}
