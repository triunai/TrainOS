/**
 * Public surface of the dual-track attendance module (lane C).
 *
 * Track A (digital): issueParticipantLinks, verifyToken, revokeToken,
 *   issueSessionQr, sessionQrRoster, identifyBySessionQr, checkInContext,
 *   recordCheckIn, renderDigitalT3.
 * Track B (paper):   generateT3Templates, renderT3TemplatePdf, uploadT3Scan,
 *   handleOcrT3.
 * Exception desk:    attendanceMatrix, resolveAttendanceException,
 *   setManualAttendance, recomputeAttendance.
 */
export {
  type LinkClaims,
  type LinkPurpose,
  type IssuedLink,
  type ParticipantLinks,
  type SessionQr,
  type CheckInContext,
  type CheckInInput,
  type CheckInResult,
  LINK_PURPOSES,
  SESSION_QR_TTL_MS,
  SESSION_CONTEXT_TTL_MS,
  issueParticipantLinks,
  verifyToken,
  revokeToken,
  linkUrl,
  issueSessionQr,
  sessionQrRoster,
  identifyBySessionQr,
  checkInContext,
  recordCheckIn,
  handleIssueMagicLinks,
} from "./magicLinks";
export { renderDigitalT3 } from "./digitalT3";
export {
  type T3TemplateInput,
  type T3Participant,
  type T3LayoutPayload,
  T3_GEOMETRY,
  T3_MAX_ROWS,
  T3_PAGE,
  T3_LAYOUT_VERSION,
  renderT3TemplatePdf,
  generateT3Templates,
  buildLayoutPayload,
} from "./t3Template";
export {
  type UploadT3Result,
  type T3IngestSummary,
  type OverrideOutcome,
  type AttendanceMatrix,
  type MatrixCell,
  T3_AGENT,
  uploadT3Scan,
  handleOcrT3,
  resolveAttendanceException,
  setManualAttendance,
  attendanceMatrix,
  recomputeAttendance,
} from "./ingestT3";
export {
  type ExceptionEntry,
  type ReviewReason,
  REVIEW_REASONS,
  REVIEW_CONFIDENCE,
  NOT_RECORDED,
  SHEET_ISSUES,
  T3_SUBJECT,
  openExceptionsForDay,
} from "./records";
export {
  type Session,
  SESSIONS,
  SESSION_WINDOWS,
  sessionWindow,
  isSessionOpen,
  trainingDate,
  slotLabel,
} from "./sessions";
export { analyseSignaturePath, validateSignaturePath, SIGNATURE_MAX_BYTES } from "./signature";
export { handlers } from "./tasks";
// UI lane 1 read models (screens only; no writes, no new policy).
export {
  type AttendanceDeskRow,
  type EvidenceTaskState,
  type EvidenceTaskType,
  type LinkIssuanceSummary,
  DESK_OPERATIONAL_STAGES,
  PRE_CLAIM_FINANCIAL_STAGES,
  EVIDENCE_TASK_TYPES,
  attendanceDesk,
  dayOfDelivery,
  evidenceTaskStates,
  linkIssuanceSummary,
  t3DaysCovered,
} from "./desk";
export {
  type AttendanceWorkbook,
  ATTENDANCE_SHEET_ID,
  TRACK_LETTER,
  buildAttendanceWorkbook,
  cellText,
  columnLetter,
  shortDay,
} from "./workbook";
export { type QuizPurpose, QUIZ_PURPOSES, quizPurposeOf, verifyQuizToken } from "./quizLink";
