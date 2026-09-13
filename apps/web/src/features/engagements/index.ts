/**
 * The `engagements` feature — M09-S02 (engagement detail) and M10-S06
 * (attendance capture).
 *
 * Everything another module may reach is re-exported here;
 * `.dependency-cruiser.cjs` forbids importing a feature's internals from
 * outside it.
 */
export {
  ATTENDANCE_CAPTURE_PATTERN,
  ENGAGEMENTS_LIST_PATH,
  ENGAGEMENT_DETAIL_PATTERN,
  PARTICIPANTS_LIST_PATH,
  attendancePath,
  engagementPath,
} from "./paths";

export { EngagementDetailPage } from "./EngagementDetailPage";
export { EngagementsListPage } from "./EngagementsListPage";
export { ParticipantsListPage } from "./ParticipantsListPage";
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
  useAllParticipants,
  useEngagement,
  useEngagementParticipants,
  useEngagements,
  useExportAttendance,
  useOrganisation,
  useEngagementAction,
  usePipelineConfig,
} from "./api";
