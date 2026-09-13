import type { EngagementProjection } from "@trainos/fixtures";
import { daysCovered } from "@/shared/components/kit";

/**
 * Engagements → one entry per delivery DAY.
 *
 * A leaf module, so the screen file exports only a component and stays
 * hot-replaceable, and so this is testable without rendering a grid.
 *
 * `Engagement.dates[]` is the source and `sessions[]` is the decoration. The
 * contract lists delivery days explicitly rather than a start and an end, so a
 * two-day course either side of a public holiday is two entries and not a
 * three-day span — expanding a range here would invent the missing day. Only
 * ENG-0231 carries `sessions` today; every other engagement has an empty array,
 * so a calendar built on `sessions` alone would draw one course and claim the
 * month was otherwise free.
 */

export interface ScheduleDay {
  /** `<engagementRef>::<day>` — unique per cell, which `dates[]` alone is not. */
  id: string;
  engagementRef: string;
  organisationRef: string;
  day: string;
  /** 1-based position within this engagement's own delivery days. */
  dayNumber: number;
  dayCount: number;
  title: string;
  venue: string;
  trainerName: string;
  status: string;
  /** The session's own title, when the engagement publishes sessions. */
  sessionTitle: string | null;
}

export function scheduleDays(engagements: readonly EngagementProjection[]): ScheduleDay[] {
  return engagements.flatMap((engagement) => {
    const days = daysCovered(engagement.dates);

    return days.map((day, index) => {
      const session = engagement.sessions.find((candidate) => candidate.date === day);

      return {
        id: `${engagement.ref}::${day}`,
        engagementRef: engagement.ref,
        organisationRef: engagement.organisationRef,
        day,
        dayNumber: index + 1,
        dayCount: days.length,
        title: engagement.title,
        /* The session's venue is the room; the engagement's is the site. The
           room is the more specific answer, so it wins where it exists. */
        venue: session?.venue ?? engagement.venue,
        trainerName: engagement.metrics.trainer.name,
        status: engagement.status,
        sessionTitle: session?.title ?? null,
      };
    });
  });
}

/** Only the entries inside `[from, to]`, both day keys, both inclusive. */
export function daysWithin(days: readonly ScheduleDay[], from: string, to: string): ScheduleDay[] {
  return days.filter((entry) => entry.day >= from && entry.day <= to);
}

/**
 * The reader's own day, from the LOCAL clock.
 *
 * `toISOString()` would answer in UTC, and a reader in Kuala Lumpur before
 * 08:00 would see yesterday ringed as today. The grid's arithmetic is UTC
 * because a stored date must not move; "today" is the opposite problem and
 * belongs to the reader's calendar.
 */
export function todayKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The month the calendar opens on.
 *
 * Not "this month". The demo seed delivers in May, August, October and November
 * 2026 and January 2027, so a calendar anchored on the real clock opens on an
 * empty grid and looks broken rather than empty. Opening on the next delivery —
 * or, once every delivery is past, on the most recent one — means the first
 * thing a reader sees is the thing they came for. The period controls then take
 * them anywhere, so nothing is hidden by this.
 *
 * Falls back to `today` when there is no schedule at all, which is the only
 * case where an empty grid is the honest answer.
 */
export function openingAnchor(days: readonly ScheduleDay[], today: string): string {
  if (days.length === 0) return today;
  const ordered = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const upcoming = ordered.find((entry) => entry.day >= today);
  return (upcoming ?? ordered[ordered.length - 1])?.day ?? today;
}
