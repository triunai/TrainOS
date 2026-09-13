import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_ATTENDANCE_TONE,
  statusOf,
  type ParticipantAttendanceStatus,
  type ParticipantDay,
} from "../attendanceModel";

/**
 * R14 · the participant-status tone map, and the reason it lives here.
 *
 * `ParticipantAttendanceStatus` is not a contract enum: `statusOf` derives it
 * from the marks. So the totality assertion has to be against what `statusOf`
 * can actually RETURN, not against a value list the server publishes — and
 * that is a thing only this feature knows. The kit's own `statusTone.test.ts`
 * covers the four contract-backed maps; `src/shared` may not import
 * `src/features`, which is the second reason this is not in that file.
 */

const mark = (present: boolean) => ({ present, method: "MANUAL" as const });
const day = (n: number, am: boolean, pm: boolean): ParticipantDay => ({
  day: n,
  am: mark(am),
  pm: mark(pm),
});

describe("PARTICIPANT_ATTENDANCE_TONE", () => {
  it("has a tone for every status statusOf can produce", () => {
    const produced = new Set<ParticipantAttendanceStatus>([
      statusOf([day(1, true, true)]),
      statusOf([day(1, true, false)]),
      statusOf([day(1, false, false)]),
      statusOf([]),
    ]);

    expect([...produced].sort()).toEqual(["ABSENT", "COMPLETE", "PARTIAL"]);
    for (const status of produced) {
      expect(PARTICIPANT_ATTENDANCE_TONE[status]).toBeDefined();
    }
  });

  it("treats a partial sheet and an absent one as the same problem to chase", () => {
    /* An HRD Corp claim needs a COMPLETE sheet, so both shortfalls are one
       fact to the reader: somebody has to be chased. The ternary this replaced
       said the same thing by accident, via an `else`; it now says it on
       purpose, and a fourth status would not compile. */
    expect(PARTICIPANT_ATTENDANCE_TONE.PARTIAL).toBe("warning");
    expect(PARTICIPANT_ATTENDANCE_TONE.ABSENT).toBe("warning");
    expect(PARTICIPANT_ATTENDANCE_TONE.COMPLETE).toBe("neutral");
  });
});
