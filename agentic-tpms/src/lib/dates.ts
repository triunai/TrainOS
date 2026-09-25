/**
 * Calendar dates are 'YYYY-MM-DD' strings end to end. Arithmetic happens in UTC
 * on those strings, so a date never picks up a time zone on the way through.
 * "Today" is the operator's calendar day in Asia/Kuala_Lumpur.
 */
export const TZ = "Asia/Kuala_Lumpur";

export function todayMY(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function dayCount(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  return daysBetween(start, end) + 1;
}

/** Midnight at the start of `date` in Malaysia, as an instant. */
export function startOfDayMY(date: string): Date {
  return new Date(`${date}T00:00:00+08:00`);
}

/**
 * `Intl` supplies only the NUMBERS; month words come from a fixed table. ICU
 * builds disagree on English short months (Node writes "Sept", Chromium
 * "Sep"), and a client component that formats a date during server render
 * would otherwise fail hydration.
 */
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** `26 Sep 2026`, or `26 Sep 2026, 09:05` with time — Malaysia time, identical on server and browser. */
export function formatDate(date: string | Date | null | undefined, withTime = false): string {
  if (!date) return "—";
  const d = typeof date === "string" ? (date.length === 10 ? new Date(`${date}T00:00:00+08:00`) : new Date(date)) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const p = Object.fromEntries(DATE_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  const pad = (v: string | number) => String(v).padStart(2, "0");
  const day = `${pad(p.day)} ${MONTHS_SHORT[Number(p.month) - 1]} ${p.year}`;
  return withTime ? `${day}, ${pad(Number(p.hour) % 24)}:${pad(p.minute)}` : day;
}

export function formatRange(start: string | null, end: string | null): string {
  if (!start) return "Dates not set";
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

// ---- Malaysia-time labels (same words on server and browser; see MONTHS_SHORT)

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function partsMY(value: string | Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const p = Object.fromEntries(DATE_PARTS.formatToParts(typeof value === "string" ? new Date(value) : value).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute) };
}

function weekdayDay(y: number, m: number, d: number): string {
  return `${WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** `10:31` */
export function clockMY(value: string | Date): string {
  const p = partsMY(value);
  return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
}

/** `Sat 26 Sep` for an instant. */
export function dayMY(value: string | Date): string {
  const p = partsMY(value);
  return weekdayDay(p.y, p.m, p.d);
}

/** `Sat 26 Sep, 10:31` */
export function dayTimeMY(value: string | Date): string {
  return `${dayMY(value)}, ${clockMY(value)}`;
}

/** `Sat 26 Sep` for a `YYYY-MM-DD` calendar date. */
export function calendarDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return weekdayDay(y, m, d);
}

/** `26 Sep` for a `YYYY-MM-DD` calendar date. */
export function shortDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}
