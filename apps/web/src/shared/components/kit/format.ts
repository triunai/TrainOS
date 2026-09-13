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

/**
 * An ISO range → the pack's compact form.
 *
 *   "2026-11-12/2026-11-13" → "12–13 Nov 2026"
 *   "2026-11-30/2026-12-01" → "30 Nov – 01 Dec 2026"
 *   "2026-12-30/2027-01-02" → "30 Dec 2026 – 02 Jan 2027"
 *   "2026-11-12/2026-11-12" → "12 Nov 2026"
 *
 * The contract returns rendered ranges as one slash-joined string on
 * engagements and trainer availability. Collapsing the shared parts is the
 * whole point: "12 Nov 2026 – 13 Nov 2026" makes a reader compare two dates to
 * find the one digit that differs.
 *
 * An en dash, not a hyphen. A hyphen between dates reads as a compound word.
 *
 * A string that is not a range falls through to `formatDate`, so a single date
 * passed here renders correctly rather than as a defect.
 */
export function formatDateRange(value: string | null | undefined): string {
  if (!value) return "—";

  const [from, to] = value.split("/");
  if (!to) return formatDate(from);

  const start = DATE_ONLY.exec(from);
  const end = DATE_ONLY.exec(to);
  if (!start || !end) return `${formatDate(from)} – ${formatDate(to)}`;

  const [, startYear, startMonth, startDay] = start;
  const [, endYear, endMonth, endDay] = end;

  if (from === to) return formatDate(from);

  /* Same month and year: only the day differs, so only the day repeats. */
  if (startYear === endYear && startMonth === endMonth) {
    return `${startDay}–${endDay} ${MONTHS[Number(endMonth) - 1]} ${endYear}`;
  }

  /* Same year: the year is stated once, at the end. Days stay zero-padded, as
     `formatDate` renders them everywhere else — the pack writes "04 Mar 2024",
     and a range that dropped the pad would be the only place in the app where a
     day is one character wide. */
  if (startYear === endYear) {
    return `${startDay} ${MONTHS[Number(startMonth) - 1]} – ${endDay} ${
      MONTHS[Number(endMonth) - 1]
    } ${endYear}`;
  }

  /* Crossing a year boundary: nothing can be collapsed, and the years are the
     most important part of the answer. */
  return `${formatDate(from)} – ${formatDate(to)}`;
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

/**
 * Words that are acronyms rather than words, and must not be title-cased.
 *
 * Lower-casing the whole enum and re-capitalising the first character is what
 * put "Md", "Hrdc packet mark submitted", "Tna questionnaire" and "Whatsapp" on
 * screen. §13 names amateur tells as the thing the primary persona reads first,
 * and "Md" sitting next to "Sales manager" in the same column is one.
 *
 * This set is derived from the enum values the contract and fixtures actually
 * ship, not from guesswork — every member below appears as a whole word in a
 * real value. Membership is deliberately conservative, because over-preserving
 * is its own defect: `MY`, `US`, `WA`, `SG`, `MS`, `AM`, `PM`, `ON`, `NO`, `OK`
 * and `AS` all occur as enum words too, and preserving `MY` would render
 * `MY_TASKS` as "MY tasks". A token earns a place here only if it has no
 * reading as an ordinary lower-case word.
 */
const PRESERVED_TOKENS = new Set([
  "AI",
  "DOCX",
  "HRD",
  "HRDC",
  "HTML",
  "MD",
  "MYR",
  "PDF",
  "PPTX",
  "QR",
  "SBL",
  "SLA",
  "TNA",
  "TTT",
  "UI",
]);

/**
 * Tokens whose correct spelling is neither lower nor upper case. A brand name
 * is wrong in both directions: "whatsapp" and "WHATSAPP" are as wrong as
 * "Whatsapp", so preserving the input case is not enough and the spelling has
 * to be written down.
 */
const CASED_TOKENS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
};

/**
 * `UPPER_SNAKE` → `Sentence case`. The contract speaks in enums; users do not.
 *
 *   AWAITING_MD                → "Awaiting MD"
 *   HRDC_PACKET_MARK_SUBMITTED → "HRDC packet mark submitted"
 *   WHATSAPP                   → "WhatsApp"
 *   PROPOSAL_SENT              → "Proposal sent"
 *
 * Sentence case, not title case: only the first word is capitalised, because
 * every other label in the product is sentence case and a title-cased enum
 * would be the one place that is not.
 *
 * The acronym handling lives here rather than at the call sites on purpose.
 * `channelLabel` below is the older, narrower version of this fix — a map for
 * one union — and it only ever corrected the screens that remembered to call
 * it, which is why "Whatsapp" was still rendering from the template-kind
 * column. Twenty-odd screens call `humanise`; one of them getting an acronym
 * right is not a property worth having.
 */
export function humanise(value: string): string {
  const words = value.split("_").filter((word) => word !== "");
  if (words.length === 0) return "";

  return words
    .map((word, index) => {
      const upper = word.toUpperCase();
      const cased = CASED_TOKENS[upper];
      if (cased) return cased;
      if (PRESERVED_TOKENS.has(upper)) return upper;

      const lower = word.toLowerCase();
      /* Sentence case: the first word carries the capital, the rest do not. */
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/**
 * `plural(1, "suggestion")` → `"1 suggestion"`, `plural(4, "suggestion")` →
 * `"4 suggestions"`.
 *
 * Every count line in this product reads "N things", and writing the count and
 * the noun separately is how "1 suggested next steps" reaches a screenshot —
 * it did, on the renewals header. One helper rather than a conditional at each
 * call site, and the irregular plural is a parameter because "1 company" does
 * not become "2 companys".
 *
 * The number is part of the returned string on purpose: a caller that formats
 * the count itself and asks only for the noun has to repeat the `=== 1` test
 * to know which noun to ask for.
 */
export function plural(count: number, one: string, many?: string): string {
  return `${count} ${count === 1 ? one : (many ?? `${one}s`)}`;
}

/**
 * The two message channels, spelled the way the product spells them.
 *
 * `humanise("WHATSAPP")` gives "Whatsapp", which is wrong in the only way a
 * brand name can be wrong and which reached two screenshots before anyone
 * noticed.
 *
 * The union is written out here because the contract inlines
 * `'EMAIL' | 'WHATSAPP'` at each of its four use sites and exports no name for
 * it — noted as a contract gap. The map is keyed by the union, so a third
 * channel is a compile error here rather than a silently lower-cased name.
 */
export type MessageChannel = "EMAIL" | "WHATSAPP";

const CHANNEL_LABEL: Record<MessageChannel, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
};

export function channelLabel(channel: MessageChannel): string {
  return CHANNEL_LABEL[channel];
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

/* ------------------------------------------------------------------ *
 * Relative dates
 * ------------------------------------------------------------------ */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Both contract date shapes to an epoch millisecond, or null. */
function toInstant(value: DateOnly | Timestamp | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    /* Local midnight, for the same reason `formatDate` splits the string: a
       date-only value is a calendar date, and `new Date("2026-11-12")` is UTC
       midnight, which is the 11th in half the world. */
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * How long ago something happened — `3 days ago`, `yesterday`, `just now`.
 *
 * Two deliberate fall-backs to the calendar date, both because "ago" stops
 * being the more useful phrasing:
 *
 *  - A value in the FUTURE of the anchor. "in 2 months" is not an answer to
 *    "when was this last checked", and a future timestamp on a past event is a
 *    clock disagreement rather than a fact about the record.
 *  - Anything older than about a month. "7 weeks ago" makes the reader do the
 *    arithmetic the date would have saved them.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside so that the
 * anchor is a decision of the caller's — a screen reading a world whose clock
 * is not the wall clock (the fixture world is pinned to a single instant) can
 * say so, and a test can pin it without touching the global clock.
 */
export function formatRelativeDate(
  value: DateOnly | Timestamp | null | undefined,
  now: DateOnly | Timestamp | number = Date.now(),
): string {
  const then = toInstant(value);
  if (then === null) return "—";

  const anchor = toInstant(now) ?? Date.now();
  const elapsed = anchor - then;
  if (elapsed < 0) return formatDate(value);
  if (elapsed < MINUTE) return "just now";

  /* `numeric: "auto"` is what turns 1 day into "yesterday" rather than "1 day
     ago", which is the phrasing every one of these columns wants. */
  const relative = new Intl.RelativeTimeFormat("en-MY", { numeric: "auto" });
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour");

  const days = Math.floor(elapsed / DAY);
  if (days < 7) return relative.format(-days, "day");
  if (days < 31) return relative.format(-Math.floor(days / 7), "week");
  return formatDate(value);
}
