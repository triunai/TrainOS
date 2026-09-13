import type { DateOnly } from "@trainos/contract";

/**
 * The calendar's date arithmetic, as a leaf module.
 *
 * Same two reasons `format.ts` exists: a file that exports both a component and
 * a plain function cannot be hot-replaced, and a leaf module cannot be part of
 * an import cycle. Everything here takes strings and returns strings or numbers.
 *
 * EVERY calculation is UTC. `new Date("2026-11-12")` is UTC midnight, which in
 * Kuala Lumpur is still the 12th and in Honolulu is the 11th — `formatDate`
 * already had to work around that, and a grid is worse: a day-shifted anchor
 * moves a delivery into the wrong CELL, which reads as a scheduling error
 * rather than as a formatting one. Working in UTC throughout and never handing
 * a `Date` back out means the local clock cannot reach the arithmetic at all.
 */

export type CalendarView = "month" | "week";

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Monday first. Malaysia's working week runs Monday to Friday (Johor, Kedah,
 * Kelantan and Terengganu excepted), so a Sunday-first grid would put both
 * weekend days at opposite ends of the row and split the working block.
 */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A `Date` in UTC → its `YYYY-MM-DD` key. The only way a Date leaves here. */
function toKey(date: Date): DateOnly {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → UTC midnight, or `null` when the string is not a day key. */
function parseKey(value: string): Date | null {
  const match = DAY_KEY.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The day key for a contract `DateOnly` or `Timestamp`.
 *
 * A timestamp carries its own offset (`+08:00` in every fixture), so slicing
 * the first ten characters keeps the day the SERVER meant rather than the day
 * the reader's clock would convert it to.
 */
export function dayKeyOf(value: string | null | undefined): DateOnly | null {
  if (!value) return null;
  const key = value.slice(0, 10);
  return DAY_KEY.test(key) ? key : null;
}

/** `n` days after `key`. Negative `n` goes back. */
export function addDays(key: DateOnly, n: number): DateOnly {
  const parsed = parseKey(key);
  if (!parsed) return key;
  return toKey(new Date(parsed.getTime() + n * DAY_MS));
}

/** The Monday of `key`'s week. */
export function startOfWeek(key: DateOnly): DateOnly {
  const parsed = parseKey(key);
  if (!parsed) return key;
  /* getUTCDay is 0 for Sunday, so Sunday is six days INTO the week, not before it. */
  const offset = (parsed.getUTCDay() + 6) % 7;
  return addDays(key, -offset);
}

/** The first of `key`'s month. */
export function startOfMonth(key: DateOnly): DateOnly {
  const parsed = parseKey(key);
  if (!parsed) return key;
  return toKey(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1)));
}

/**
 * The previous or next period.
 *
 * Month stepping clamps to the first, so stepping forward from 31 January
 * lands on 1 February rather than on 3 March — `Date.UTC` normalises an
 * overflowing day silently, and a grid that skipped February would be a defect
 * nobody could explain from the UI.
 */
export function shiftPeriod(anchor: DateOnly, view: CalendarView, delta: number): DateOnly {
  if (view === "week") return addDays(anchor, delta * 7);
  const parsed = parseKey(anchor);
  if (!parsed) return anchor;
  return toKey(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + delta, 1)));
}

/** `"November 2026"`, or `"09 – 15 Nov 2026"` for a week. */
export function periodLabel(anchor: DateOnly, view: CalendarView): string {
  const parsed = parseKey(anchor);
  if (!parsed) return anchor;

  if (view === "month") {
    return `${MONTHS_LONG[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
  }

  const from = startOfWeek(anchor);
  const to = addDays(from, 6);
  const start = parseKey(from);
  const end = parseKey(to);
  if (!start || !end) return anchor;

  const day = (date: Date) => String(date.getUTCDate()).padStart(2, "0");
  const month = (date: Date) => MONTHS_LONG[date.getUTCMonth()]?.slice(0, 3) ?? "";

  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${day(start)} – ${day(end)} ${month(end)} ${end.getUTCFullYear()}`;
  }
  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${day(start)} ${month(start)} – ${day(end)} ${month(end)} ${end.getUTCFullYear()}`;
  }
  return `${day(start)} ${month(start)} ${start.getUTCFullYear()} – ${day(end)} ${month(end)} ${end.getUTCFullYear()}`;
}

/**
 * Every day key the grid draws: 42 for a month, 7 for a week.
 *
 * Six rows always, never five-or-six. A grid that changes height when the month
 * changes makes everything below it jump, and the reader loses their place
 * between November and December for no information gained.
 */
export function calendarDays(anchor: DateOnly, view: CalendarView): DateOnly[] {
  const first = view === "week" ? startOfWeek(anchor) : startOfWeek(startOfMonth(anchor));
  const count = view === "week" ? 7 : 42;
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

/** Whether `key` falls in the same calendar month as `anchor`. */
export function isSameMonth(key: DateOnly, anchor: DateOnly): boolean {
  return key.slice(0, 7) === anchor.slice(0, 7);
}

/** The day of the month, unpadded, for the cell's number. */
export function dayOfMonth(key: DateOnly): string {
  return String(Number(key.slice(8, 10)));
}

/**
 * Every day an engagement occupies, from the contract's `dates[]`.
 *
 * `Engagement.dates` lists the delivery days explicitly rather than a start and
 * an end, so a two-day course that skips a public holiday is two entries and
 * not a three-day span. Expanding a range here would invent the missing day.
 */
export function daysCovered(dates: readonly string[]): DateOnly[] {
  return dates.map((date) => dayKeyOf(date)).filter((key): key is DateOnly => key !== null);
}
