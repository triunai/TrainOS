import { LocaleType, Univer, type IWorkbookData } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import "@univerjs/sheets/facade";
import "@univerjs/engine-formula/facade";
import "@univerjs/sheets-formula/facade";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import FormulaEnUS from "@univerjs/engine-formula/locale/en-US";
import SheetsFormulaEnUS from "@univerjs/sheets-formula/locale/en-US";
import { fromSen, toSen, type Sen } from "@/lib/money";
import { assertQuoteInputs, type QuoteInputs } from "./quoteModel";

/**
 * The same quotation model as `quoteModel.ts`, expressed as a Univer
 * workbook and evaluated by Univer's own formula engine, headless in Node.
 *
 * WHY: the operator reviews and edits the quote on a Univer canvas in the
 * browser. The snapshot returned here IS that sheet (labels in column A,
 * values in column B, every derived cell a named-range formula), so what the
 * operator sees is the computation that ran, not a picture of it.
 *
 * Determinism: calculation completion is awaited with the facade's
 * `getFormula().onCalculationResultApplied()` (resolves when the latest
 * calculation session's results are applied to the sheet model), then every
 * derived cell is checked to hold a finite number and the workbook to carry
 * no formula error — a cell that did not compute is a thrown defect, never a
 * silently-zero price. Each run builds and disposes its own Univer instance;
 * runs are serialised through one in-process queue.
 */
export const UNIVER_ENGINE_VERSION = "@univerjs/engine-formula@1.0.2";
export const QUOTE_SHEET_ID = "quote";
export const QUOTE_SHEET_NAME = "Quote";
export const QUOTE_WORKBOOK_ID = "tpms-quotation";

type CellKind = "input" | "policy" | "formula";

interface SheetRow {
  name: string;
  kind: CellKind;
  note: string;
  formula?: string;
}

/**
 * Row order is the sheet layout (row 1 is the header, so ROWS[0] is row 2).
 * Names are workbook-level defined names pointing at column B of their row,
 * so formulas read like the handoff spec (`=TrainerDailyRate*DurationDays`).
 */
const ROWS: readonly SheetRow[] = [
  { name: "DeliveryMode", kind: "policy", note: "IN_HOUSE / PUBLIC_PHYSICAL / ROT_VIRTUAL" },
  { name: "DurationDays", kind: "policy", note: "Training days (from the package dates)" },
  { name: "PaxCount", kind: "policy", note: "Participants (package headcount)" },
  { name: "TrainerDailyRate", kind: "input", note: "RM per day · editable" },
  { name: "VenueDDRPerPax", kind: "input", note: "RM per pax per day (venue + F&B) · editable · zero for ROT" },
  { name: "MaterialsCostPerPax", kind: "input", note: "RM per participant · editable" },
  { name: "OtherCosts", kind: "input", note: "RM lump sum · editable" },
  { name: "CostPolicyVersion", kind: "policy", note: "Allowable Cost Matrix version" },
  { name: "CapBasis", kind: "policy", note: "PER_GROUP_DAY or PER_PAX_DAY" },
  { name: "StatutoryDailyCap", kind: "policy", note: "RM per day (per pax per day for PER_PAX_DAY)" },
  { name: "QuotedFeeOverride", kind: "input", note: "RM · editable · blank = quote at the cap" },
  {
    name: "TotalMaxAllowable",
    kind: "formula",
    note: "Allowable cost cap",
    formula: '=ROUND(IF(CapBasis="PER_PAX_DAY",StatutoryDailyCap*PaxCount*DurationDays,StatutoryDailyCap*DurationDays),2)',
  },
  {
    name: "QuotedFee",
    kind: "formula",
    note: "MIN(override, cap), or the cap",
    formula: "=ROUND(IF(ISBLANK(QuotedFeeOverride),TotalMaxAllowable,MIN(QuotedFeeOverride,TotalMaxAllowable)),2)",
  },
  { name: "TotalTrainerCost", kind: "formula", note: "Trainer rate × days", formula: "=ROUND(TrainerDailyRate*DurationDays,2)" },
  {
    name: "TotalVenueCost",
    kind: "formula",
    note: "DDR × pax × days (zero for ROT)",
    formula: '=IF(DeliveryMode="ROT_VIRTUAL",0,ROUND(VenueDDRPerPax*PaxCount*DurationDays,2))',
  },
  { name: "TotalMaterialsCost", kind: "formula", note: "Materials × pax", formula: "=ROUND(MaterialsCostPerPax*PaxCount,2)" },
  { name: "TotalOtherCost", kind: "formula", note: "Other direct costs", formula: "=ROUND(OtherCosts,2)" },
  { name: "TotalDirectCost", kind: "formula", note: "Sum of cost lines", formula: "=ROUND(SUM(B15:B18),2)" },
  { name: "GrossMarginAmount", kind: "formula", note: "Fee − direct cost", formula: "=ROUND(QuotedFee-TotalDirectCost,2)" },
  {
    name: "GrossMarginPercentage",
    kind: "formula",
    note: "Margin ÷ fee × 100",
    formula: "=IF(QuotedFee=0,0,ROUND(GrossMarginAmount/QuotedFee*100,2))",
  },
  { name: "CapHeadroom", kind: "formula", note: "Cap − fee", formula: "=ROUND(TotalMaxAllowable-QuotedFee,2)" },
];

/** A1 address of each named cell (column B). */
export const QUOTE_CELLS: Readonly<Record<string, string>> = Object.fromEntries(ROWS.map((r, i) => [r.name, `B${i + 2}`]));

/** The cells the operator may edit on the canvas, mapped to the model input they feed. */
export const EDITABLE_CELLS = {
  TrainerDailyRate: "trainerDayRate",
  VenueDDRPerPax: "venueDdrPerPax",
  MaterialsCostPerPax: "materialsPerPax",
  OtherCosts: "otherDirectCosts",
  QuotedFeeOverride: "quotedFeeOverride",
} as const;

// Guard the layout against an edit that moves the SUM range off the cost rows.
if (QUOTE_CELLS.TotalTrainerCost !== "B15" || QUOTE_CELLS.TotalOtherCost !== "B18") {
  throw new Error("Quote sheet layout drifted: TotalDirectCost's SUM(B15:B18) no longer covers the cost rows");
}

export interface SheetValues {
  allowableCap: Sen;
  quotedFee: Sen;
  trainerCost: Sen;
  venueCost: Sen;
  materialsCost: Sen;
  otherCost: Sen;
  totalDirectCost: Sen;
  grossMargin: Sen;
  marginPct: number;
  capHeadroom: Sen;
}

export interface UniverRun {
  values: SheetValues;
  /** IWorkbookData — load it into the browser Univer canvas to render the same sheet. */
  snapshot: Record<string, unknown>;
  durationMs: number;
}

const rm = (sen: Sen): number => Number(fromSen(sen));

function inputValue(name: string, inputs: QuoteInputs): string | number | null {
  switch (name) {
    case "DeliveryMode":
      return inputs.deliveryMode;
    case "DurationDays":
      return inputs.days;
    case "PaxCount":
      return inputs.pax;
    case "TrainerDailyRate":
      return rm(inputs.trainerDayRate);
    case "VenueDDRPerPax":
      return rm(inputs.venueDdrPerPax);
    case "MaterialsCostPerPax":
      return rm(inputs.materialsPerPax);
    case "OtherCosts":
      return rm(inputs.otherDirectCosts);
    case "CostPolicyVersion":
      return inputs.policy.version;
    case "CapBasis":
      return inputs.policy.basis;
    case "StatutoryDailyCap":
      return rm(inputs.policy.dailyCap);
    case "QuotedFeeOverride":
      return inputs.quotedFeeOverride === null || inputs.quotedFeeOverride === undefined ? null : rm(inputs.quotedFeeOverride);
    default:
      throw new Error(`Quote sheet row ${name} has no input mapping`);
  }
}

/** The workbook as data: labels, inputs, formulas, defined names. Pure — also used to seed the canvas. */
export function buildQuoteWorkbook(inputs: QuoteInputs): IWorkbookData {
  const cellData: Record<number, Record<number, Record<string, unknown>>> = {
    0: { 0: { v: "Parameter" }, 1: { v: "Value" }, 2: { v: "Notes" } },
  };
  const names: Record<string, { id: string; name: string; formulaOrRefString: string; localSheetId: string }> = {};
  ROWS.forEach((row, index) => {
    const r = index + 1; // zero-based row index; row 0 is the header
    const valueCell: Record<string, unknown> = {};
    if (row.formula) {
      valueCell.f = row.formula;
    } else {
      const value = inputValue(row.name, inputs);
      if (value !== null) valueCell.v = value;
    }
    cellData[r] = { 0: { v: row.name }, 1: valueCell, 2: { v: `${row.kind} · ${row.note}` } };
    names[`dn_${row.name}`] = {
      id: `dn_${row.name}`,
      name: row.name,
      formulaOrRefString: `${QUOTE_SHEET_NAME}!$B$${r + 1}`,
      localSheetId: "AllDefaultWorkbook",
    };
  });

  return {
    id: QUOTE_WORKBOOK_ID,
    name: "Quotation model",
    appVersion: "1.0.2",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: [QUOTE_SHEET_ID],
    sheets: {
      [QUOTE_SHEET_ID]: {
        id: QUOTE_SHEET_ID,
        name: QUOTE_SHEET_NAME,
        rowCount: ROWS.length + 4,
        columnCount: 3,
        cellData,
        columnData: { 0: { w: 190 }, 1: { w: 140 }, 2: { w: 340 } },
      },
    },
    resources: [{ name: "SHEET_DEFINED_NAME_PLUGIN", data: JSON.stringify(names) }],
  } as unknown as IWorkbookData;
}

type Json = Record<string, unknown>;

function deepMerge(...objects: Json[]): Json {
  const out: Json = {};
  for (const object of objects) {
    for (const [key, value] of Object.entries(object ?? {})) {
      out[key] =
        value && typeof value === "object" && !Array.isArray(value) ? deepMerge((out[key] as Json) ?? {}, value as Json) : value;
    }
  }
  return out;
}

const LOCALES = deepMerge(SheetsEnUS as unknown as Json, FormulaEnUS as unknown as Json, SheetsFormulaEnUS as unknown as Json);
const CALCULATION_TIMEOUT_MS = 5_000;

let queue: Promise<unknown> = Promise.resolve();

/** Serialise engine runs: one Univer instance alive at a time in this process. */
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export function computeWithUniver(inputs: QuoteInputs): Promise<UniverRun> {
  assertQuoteInputs(inputs);
  return serialised(() => runOnce(inputs));
}

async function runOnce(inputs: QuoteInputs): Promise<UniverRun> {
  const started = performance.now();
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: LOCALES as never } });
  try {
    univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: false });
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    const api = FUniver.newAPI(univer);
    const workbook = api.createWorkbook(buildQuoteWorkbook(inputs) as never);
    await api.getFormula().onCalculationResultApplied(CALCULATION_TIMEOUT_MS);

    const sheet = workbook.getSheetBySheetId(QUOTE_SHEET_ID) ?? workbook.getActiveSheet();
    const errors = workbook.getAllFormulaError();
    if (errors.length > 0) {
      throw new Error(`Univer quote sheet has formula errors: ${errors.map((e) => `${e.sheetName}!R${e.row + 1}C${e.column + 1} ${e.errorType}`).join(", ")}`);
    }
    const read = (name: string): number => {
      const value = sheet.getRange(QUOTE_CELLS[name]).getValue();
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Univer did not compute ${name} (${QUOTE_CELLS[name]} = ${JSON.stringify(value)})`);
      }
      return value;
    };
    const values: SheetValues = {
      allowableCap: toSen(read("TotalMaxAllowable")),
      quotedFee: toSen(read("QuotedFee")),
      trainerCost: toSen(read("TotalTrainerCost")),
      venueCost: toSen(read("TotalVenueCost")),
      materialsCost: toSen(read("TotalMaterialsCost")),
      otherCost: toSen(read("TotalOtherCost")),
      totalDirectCost: toSen(read("TotalDirectCost")),
      grossMargin: toSen(read("GrossMarginAmount")),
      marginPct: Math.round(read("GrossMarginPercentage") * 100) / 100,
      capHeadroom: toSen(read("CapHeadroom")),
    };
    // A plain JSON copy: the saved model can hold class instances and undefineds jsonb does not want.
    const snapshot = JSON.parse(JSON.stringify(workbook.save())) as Record<string, unknown>;
    return { values, snapshot, durationMs: Math.round(performance.now() - started) };
  } finally {
    univer.dispose();
  }
}
