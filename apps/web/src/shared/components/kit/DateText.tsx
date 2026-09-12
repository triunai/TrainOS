import type { DateOnly, Timestamp } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";

/**
 * A date, rendered `dd MMM yyyy` — `12 Nov 2026`. The pack writes dates this
 * way everywhere, and the day-first order is not a preference: `04 Mar 2024`
 * cannot be misread the way `03/04/2024` can.
 *
 * The contract carries two date shapes — `DateOnly` (`2026-11-12`) and
 * `Timestamp` (a full ISO instant with offset). Both arrive here. A `DateOnly`
 * is parsed as a calendar date and never as an instant: `new Date("2026-11-12")`
 * is UTC midnight, which in Kuala Lumpur is still the 12th but in Honolulu is
 * the 11th. Rendering a training date a day early is a real defect, so the
 * date-only path splits the string rather than trusting the Date constructor.
 */

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

/** Format either contract date shape to `dd MMM yyyy`. Returns `—` for empty input. */
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

export interface DateTextProps {
  value: DateOnly | Timestamp | null | undefined;
  /** Append `HH:mm`. Ignored for a date-only value, which has no time to show. */
  withTime?: boolean;
  className?: string;
}

export function DateText({ value, withTime, className }: DateTextProps) {
  const time = withTime ? formatTime(value) : "";
  return (
    <time dateTime={value ?? undefined} className={cn("whitespace-nowrap", className)}>
      {formatDate(value)}
      {time ? ` · ${time}` : ""}
    </time>
  );
}
