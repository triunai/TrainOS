import type { DateOnly, Timestamp } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { formatDate, formatRelativeDate, formatTime } from "./format";

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
 *
 * `relative` switches the same value to "3 days ago". It is a mode of this
 * component rather than a second one: a list column that wants freshness and a
 * record field that wants the date are the same fact rendered for a different
 * question, and two components would be two answers to "how does TrainOS write
 * a date". The absolute date stays on the element's `title` either way, so the
 * exact instant is never more than a hover from the reader.
 */

export interface DateTextProps {
  value: DateOnly | Timestamp | null | undefined;
  /** Append `HH:mm`. Ignored for a date-only value, which has no time to show. */
  withTime?: boolean;
  /**
   * Render how long ago it was instead of the calendar date. Falls back to the
   * date for anything older than a month or ahead of the anchor — see
   * `formatRelativeDate`.
   */
  relative?: boolean;
  /**
   * What "now" is, for `relative`. Defaults to the wall clock.
   *
   * A caller passes it when its world has a clock of its own — a fixture world
   * pinned to one instant, or a test that must not depend on the day it runs.
   */
  now?: DateOnly | Timestamp | number;
  className?: string;
}

export function DateText({ value, withTime, relative, now, className }: DateTextProps) {
  const absolute = formatDate(value);
  const time = withTime ? formatTime(value) : "";
  const full = `${absolute}${time ? ` · ${time}` : ""}`;

  return (
    <time
      dateTime={value ?? undefined}
      title={relative ? full : undefined}
      className={cn("whitespace-nowrap", className)}
    >
      {relative ? formatRelativeDate(value, now) : full}
    </time>
  );
}
