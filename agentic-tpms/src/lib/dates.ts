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

export function formatDate(date: string | Date | null | undefined, withTime = false): string {
  if (!date) return "—";
  const d = typeof date === "string" ? (date.length === 10 ? new Date(`${date}T00:00:00+08:00`) : new Date(date)) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(d);
}

export function formatRange(start: string | null, end: string | null): string {
  if (!start) return "Dates not set";
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}
