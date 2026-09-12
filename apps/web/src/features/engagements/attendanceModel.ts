import type { AttendanceMark, AttendanceRow, AttendanceSheet } from "@trainos/contract";

/**
 * Read-only derivations over attendance sheets.
 *
 * Kept out of the components so the same rule cannot be written twice with two
 * different answers — M09-S02's participant table and M10-S06's day sheet both
 * describe the same marks and must agree.
 *
 * Nothing here decides whether capture is allowed. That is `captureModes` on
 * the sheet, set by the server: §8 is explicit that the UI disables from the
 * response rather than from its own logic, so a lock rule invented here would
 * be a second, quieter source of truth.
 */

export type ParticipantAttendanceStatus = "COMPLETE" | "PARTIAL" | "ABSENT";

export interface ParticipantDay {
  day: number;
  am: AttendanceMark;
  pm: AttendanceMark;
}

export interface ParticipantAttendance {
  participantRef: string;
  name: string;
  department: string;
  days: ParticipantDay[];
  status: ParticipantAttendanceStatus;
}

const HALF_DAYS = (day: ParticipantDay): AttendanceMark[] => [day.am, day.pm];

/** Present for every half-day is COMPLETE; none is ABSENT; anything else PARTIAL. */
export function statusOf(days: ParticipantDay[]): ParticipantAttendanceStatus {
  const marks = days.flatMap(HALF_DAYS);
  if (marks.length === 0) return "ABSENT";
  const present = marks.filter((mark) => mark.present).length;
  if (present === marks.length) return "COMPLETE";
  if (present === 0) return "ABSENT";
  return "PARTIAL";
}

/** Join the day sheets into one row per participant, in roster order. */
export function joinAttendance(sheets: AttendanceSheet[]): ParticipantAttendance[] {
  const ordered = [...sheets].sort((a, b) => a.day - b.day);
  const byParticipant = new Map<string, ParticipantAttendance>();

  for (const sheet of ordered) {
    for (const row of sheet.rows) {
      const existing = byParticipant.get(row.participantRef);
      const entry: ParticipantDay = { day: sheet.day, am: row.am, pm: row.pm };
      if (existing) {
        existing.days.push(entry);
      } else {
        byParticipant.set(row.participantRef, {
          participantRef: row.participantRef,
          name: row.name,
          department: row.department,
          days: [entry],
          status: "ABSENT",
        });
      }
    }
  }

  return [...byParticipant.values()].map((entry) => ({ ...entry, status: statusOf(entry.days) }));
}

/** `✓ 09:02` for a present mark, the recorded reason for an absent one. */
export function markLabel(mark: AttendanceMark): string {
  if (mark.present) {
    const time = mark.at ? new Date(mark.at) : null;
    if (!time || Number.isNaN(time.getTime())) return "Present";
    return `✓ ${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  }
  return mark.reason ? mark.reason.replace(/_/g, " ").toLowerCase() : "absent";
}

/** Rows whose attendance is not complete — the exception the screens surface. */
export function absentees(rows: AttendanceRow[]): AttendanceRow[] {
  return rows.filter((row) => !row.am.present || !row.pm.present);
}
