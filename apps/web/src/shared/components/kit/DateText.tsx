import type { DateOnly, Timestamp } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { formatDate, formatTime } from "./format";

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
