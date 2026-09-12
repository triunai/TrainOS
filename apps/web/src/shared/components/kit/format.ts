import type {
  DateOnly,
  LifecycleStep,
  Money,
  PipelineStage,
  TierKey,
  Timestamp,
} from "@trainos/contract";

/**
 * Every pure value-to-display function in the kit, in one leaf module.
 *
 * Two reasons this file exists, and both are structural rather than tidiness.
 *
 * 1. CYCLES. `AgentRunCard` renders `RunStepRow` and `RunStepRow` needed
 *    `formatDuration`, which used to live in `AgentRunCard`. That is a cycle,
 *    `npm run arch:graph` fails on it, and cycles break tree-shaking and make
 *    module init order non-deterministic — which is where "undefined is not a
 *    function" at load comes from. A leaf module imports no component, so
 *    nothing can cycle through it.
 *
 * 2. FAST REFRESH. A file that exports both a component and a plain function
 *    cannot be hot-replaced, and `react-refresh/only-export-components` warns
 *    on every one. Fourteen kit files warned before these helpers moved here.
 *
 * The rule for what belongs: a function here takes values and returns a string
 * or a number. It imports no React and no component. Anything that maps a
 * contract shape onto kit props lives in `adapters.ts` instead.
 */

/* ---- Money ---------------------------------------------------------- */

const CURRENCY_SYMBOL: Record<string, string> = { MYR: "RM" };

/**
 * Format a `Money` to its display string, e.g. `RM 18,500.00`.
 *
 * Table sorting, CSV export and `title` attributes all need the string without
 * a React element around it, which is why this is not folded into `MoneyText`.
 */
export function formatMoney(value: Money, compact = false): string {
  const symbol = CURRENCY_SYMBOL[value.currency] ?? value.currency;
  const major = value.amount / 100;
  const digits = compact ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
  return `${symbol} ${formatted}`;
}

/**
 * `"18500.50"` → 1850050 sen. Returns null for an empty or unparseable field.
 *
 * Contract §1 and §18: money is integer sen, never a float. Every conversion
 * goes through here so no screen writes `parseFloat(x) * 100`, which is how
 * rounding error gets into a quotation.
 */
export function toSen(input: string): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) return null;
  return Math.round(parsed * 100);
}

/** 1850050 sen → `"18500.50"`. The editable form: no separators to fight the caret. */
export function toEditable(value: Money | null): string {
  if (!value) return "";
  return (value.amount / 100).toFixed(2);
}

/* ---- Dates ---------------------------------------------------------- */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format either contract date shape to `dd MMM yyyy`. Empty input gives `—`.
 *
 * A `DateOnly` is parsed as a calendar date and never as an instant:
 * `new Date("2026-11-12")` is UTC midnight, which in Kuala Lumpur is still the
 * 12th but in Honolulu is the 11th. Rendering a training date a day early is a
 * real defect, so the date-only path splits the string rather than trusting the
 * Date constructor.
 */
export function formatDate(value: DateOnly | Timestamp | null | undefined): string {
  if (!value) return "—";

  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";

  const day = String(parsed.getDate()).padStart(2, "0");
  return `${day} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

/** Format the time of a `Timestamp` as `HH:mm`. Empty for a `DateOnly`. */
export function formatTime(value: Timestamp | null | undefined): string {
  if (!value || DATE_ONLY.test(value)) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(
    2,
    "0",
  )}`;
}

/**
 * `"2026-10"` → `"Oct"`. The MetricStrip delta prints "vs Oct" from the
 * contract's `comparedTo`, so the month abbreviation belongs in the kit rather
 * than in each screen that renders a delta.
 *
 * Falls back to the string as given, so an unexpected format degrades to
 * showing it rather than to showing nothing.
 */
export function formatPeriod(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  return MONTHS[Number(match[2]) - 1] ?? value;
}

/* ---- Durations ------------------------------------------------------ */

/** `1900` → `1.9s`, `620` → `620ms`, `65000` → `1m 5s`. The pack's own forms. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/* ---- Labels --------------------------------------------------------- */

/**
 * `STRONG_1` → `STRONG-1`, `DEEP_THINK` → `DEEP THINK`.
 * Underscores are a wire format, not a label.
 */
export function tierLabel(key: TierKey): string {
  return key.replace(/_(\d)$/, "-$1").replace(/_/g, " ");
}

/** Initials from a display name: "Amirah Yusof" → "AY", "Kelvin" → "K". */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** `UPPER_SNAKE` → `Sentence case`. The contract speaks in enums; users do not. */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ---- Lifecycle ------------------------------------------------------ */

const STATE_WORD: Record<LifecycleStep["state"], string> = {
  DONE: "done",
  CURRENT: "current",
  PENDING: "pending",
  BLOCKED: "blocked",
  SKIPPED: "skipped",
  FAILED: "failed",
};

/**
 * The label a step shows: its own, else the pipeline's, else its key.
 *
 * Stage names come from pipeline configuration and never from the client, so
 * this resolves a label and never invents one.
 */
export function stepLabel(step: LifecycleStep, stages?: PipelineStage[]): string {
  if (step.label) return step.label;
  const stage = stages?.find((candidate) => candidate.key === step.key);
  return stage?.label ?? step.key;
}

/**
 * One sentence naming every stage and its state. Used as the dense stepper
 * cell's tooltip AND its accessible name, so the two cannot drift apart.
 */
export function describeSteps(steps: LifecycleStep[], stages?: PipelineStage[]): string {
  return steps.map((step) => `${stepLabel(step, stages)}: ${STATE_WORD[step.state]}`).join(" · ");
}
