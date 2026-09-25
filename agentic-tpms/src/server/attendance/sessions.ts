import { addDays } from "@/lib/dates";
import { DomainError } from "../domain/errors";

/**
 * Session vocabulary and check-in windows (Malaysia time).
 *
 * Malaysia has been fixed at UTC+8 with no daylight saving since 1982, so a
 * window is built as an ISO instant with a literal `+08:00` offset: no zone
 * database, no host-timezone dependency, identical on every server.
 */
export const SESSIONS = ["AM", "PM"] as const;
export type Session = (typeof SESSIONS)[number];

export const SESSION_WINDOWS: Record<Session, { open: string; close: string }> = {
  AM: { open: "07:00", close: "13:00" },
  PM: { open: "13:00", close: "18:30" },
};

/** R14: an unknown session is an error, not a fall-through to PM. */
export function parseSession(value: unknown): Session {
  if (value === "AM" || value === "PM") return value;
  throw new DomainError("INVALID_SESSION", `Unknown session ${String(value)}; expected AM or PM`);
}

/** The calendar date of training day `dayIndex` (1-based). */
export function trainingDate(startDate: string, dayIndex: number): string {
  return addDays(startDate, dayIndex - 1);
}

export function assertDayIndex(dayIndex: number, durationDays: number | null): void {
  if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > (durationDays ?? 0)) {
    throw new DomainError("INVALID_DAY", `Day ${dayIndex} is outside this programme (1..${durationDays ?? 0})`, {
      dayIndex,
      durationDays,
    });
  }
}

export function sessionWindow(date: string, session: Session): { opensAt: Date; closesAt: Date } {
  const w = SESSION_WINDOWS[session];
  return { opensAt: new Date(`${date}T${w.open}:00+08:00`), closesAt: new Date(`${date}T${w.close}:00+08:00`) };
}

export function isSessionOpen(date: string, session: Session, now: Date): boolean {
  const { opensAt, closesAt } = sessionWindow(date, session);
  return now.getTime() >= opensAt.getTime() && now.getTime() < closesAt.getTime();
}

/** `D1-AM` — the slot label used in exception lists and the audit trail. */
export function slotLabel(dayIndex: number, session: Session): string {
  return `D${dayIndex}-${session}`;
}
