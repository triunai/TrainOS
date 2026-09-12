import type { DateOnly, TrainerPoolEntry } from "@trainos/contract";
import type { EngagementProjection, FixtureTrainer } from "@trainos/fixtures";

/**
 * Trainer availability, derived rather than stored.
 *
 * A programme record names its trainer pool but not who is committed when, and
 * a trainer's booked days say nothing about WHICH delivery they belong to. The
 * engagement is where a window and its assigned trainer meet, so both facts are
 * combined here — pure functions, so the rule is testable without a render.
 *
 * This is the state M06-S02 exists to show: a pool trainer already committed
 * across the window, which is the constraint that later makes the delivery
 * approval "medium risk".
 */

export type PoolStatus = "DELIVERING" | "BOOKED" | "AVAILABLE";

export interface PoolRow {
  trainerRef: string;
  name: string;
  tttCertified: boolean;
  rating?: number;
  status: PoolStatus;
  /** The committed days that produced the status, for the sub-line. */
  conflictDates: DateOnly[];
}

/**
 * The window availability is judged against: the engagement for this programme
 * nearest to today, in either direction.
 *
 * "Nearest" rather than "next" because a catalogue record is read both while a
 * delivery is being planned and while one is running, and the pool question is
 * the same in both cases.
 */
export function nearestWindow(
  engagements: readonly EngagementProjection[],
  today: DateOnly,
): EngagementProjection | undefined {
  const distance = (engagement: EngagementProjection): number => {
    if (engagement.dates.length === 0) return Number.MAX_SAFE_INTEGER;
    return Math.min(
      ...engagement.dates.map((day) => Math.abs(Date.parse(day) - Date.parse(today))),
    );
  };
  return [...engagements].sort((left, right) => distance(left) - distance(right))[0];
}

export function poolRows(
  pool: readonly TrainerPoolEntry[],
  trainers: readonly FixtureTrainer[],
  window: EngagementProjection | undefined,
): PoolRow[] {
  const windowDays = new Set(window?.dates ?? []);
  const assignedRef = window?.metrics.trainer?.ref;

  return pool.map((entry) => {
    const trainer = trainers.find((candidate) => candidate.ref === entry.trainerRef);
    const conflictDates = (trainer?.bookedDates ?? []).filter((day) => windowDays.has(day));
    const status: PoolStatus =
      entry.trainerRef === assignedRef
        ? "DELIVERING"
        : conflictDates.length > 0
          ? "BOOKED"
          : "AVAILABLE";
    return {
      trainerRef: entry.trainerRef,
      name: entry.name,
      tttCertified: entry.tttCertified,
      ...(entry.rating === undefined ? {} : { rating: entry.rating }),
      status,
      conflictDates: status === "DELIVERING" ? [...windowDays] : conflictDates,
    };
  });
}

export const POOL_TONE = { DELIVERING: "info", BOOKED: "warning", AVAILABLE: "success" } as const;
export const POOL_LABEL = {
  DELIVERING: "Delivering",
  BOOKED: "Booked",
  AVAILABLE: "Available",
} as const;

/** `2026-11-12 – 2026-11-13`, or the single day when there is only one. */
export function dayRange(dates: readonly DateOnly[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort();
  const first = sorted[0] as DateOnly;
  const last = sorted[sorted.length - 1] as DateOnly;
  return first === last ? first : `${first} – ${last}`;
}
