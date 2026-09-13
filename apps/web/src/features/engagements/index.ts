/**
 * The `engagements` feature — M09-S02 (engagement detail) and M10-S06
 * (attendance capture).
 *
 * Everything another module may reach is re-exported here;
 * `.dependency-cruiser.cjs` forbids importing a feature's internals from
 * outside it.
 */
/** The record paths, owned here so `routes/engagements.routes.tsx` cannot drift. */
export const ENGAGEMENT_DETAIL_PATTERN = "/training/engagements/:id";
export const ATTENDANCE_CAPTURE_PATTERN = "/training/participants/:id/attendance";

/** Build a link to one engagement, so no screen concatenates the path itself. */
export const engagementPath = (ref: string) => `/training/engagements/${ref}`;
export const attendancePath = (ref: string, day?: number) =>
  `/training/participants/${ref}/attendance${day === undefined ? "" : `?day=${day}`}`;

export { EngagementDetailPage } from "./EngagementDetailPage";
export { AttendanceCapturePage } from "./AttendanceCapturePage";
export {
  absentees,
  joinAttendance,
  markLabel,
  statusOf,
  type ParticipantAttendance,
  type ParticipantAttendanceStatus,
  type ParticipantDay,
} from "./attendanceModel";
export {
  engagementKeys,
  useAttendance,
  useAttendanceDays,
  useCaptureAttendance,
  useComplianceChecks,
  useEngagement,
  useEngagementParticipants,
  useExportAttendance,
  useOrganisation,
  useEngagementAction,
  usePipelineConfig,
} from "./api";
