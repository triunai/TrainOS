/**
 * §8 · Engagements, participants, attendance.
 *
 * Screens M09-S02 (engagement detail) and M10-S06 (attendance capture).
 */

import type {
  Actor,
  AnyActor,
  DateOnly,
  EntityEnvelope,
  Money,
  Rate,
  Ref,
  Timestamp,
} from '../envelope';
import type {
  AbsenceReason,
  AttendanceStatus,
  CaptureMethod,
  EngagementStatus,
  LifecycleState,
  SyncState,
} from '../enums';

/* ------------------------------------------------------------------ *
 * §5 / §8 · Lifecycle — rendered from pipeline configuration
 * ------------------------------------------------------------------ */

/**
 * §8 one step of the LifecycleStepper.
 *
 * Stage names and order come from `GET /v1/config/pipelines?object=ENGAGEMENT`,
 * never from the client. The stepper renders whatever the server sends, in
 * order — including `BLOCKED`, which §17 sets from a failing compliance check
 * rather than from a document count.
 */
export interface LifecycleStep {
  key: string;
  label?: string;
  state: LifecycleState;
  at?: DateOnly | Timestamp;
  note?: string;
  ref?: Ref;
}

/** §5 / §13 `GET /v1/config/pipelines?object=` — the stage definitions. */
export interface PipelineConfig {
  object: string;
  stages: PipelineStage[];
}

/** §5 one configured stage. */
export interface PipelineStage {
  key: string;
  label: string;
  order: number;
}

/* ------------------------------------------------------------------ *
 * §8 · GET /v1/engagements/{id} — M09-S02
 * ------------------------------------------------------------------ */

/** §8 the engagement metric strip. */
export interface EngagementMetrics {
  participants: number;
  attended: number;
  attendanceRate: Rate;
  trainer: { ref: Ref; name: string };
  claimCompleteness: Rate;
}

/** §8 one checklist item on the engagement. */
export interface EngagementChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

/** §8 one delivery day. */
export interface EngagementSession {
  ref: Ref;
  day: number;
  date: DateOnly;
  title: string;
  venue: string;
  trainerRef: Ref;
  present: number;
  total: number;
}

/** §8 the finance rollup on the engagement. */
export interface EngagementFinance {
  invoiceRef: Ref | null;
  syncState: SyncState;
  trainerPayable: Money;
  realisedMarginRate: Rate;
}

/** §8 the engagement record. */
export interface Engagement extends EntityEnvelope {
  title: string;
  organisationRef: Ref;
  programmeRef: Ref;
  opportunityRef?: Ref;
  status: EngagementStatus;
  venue: string;
  dates: DateOnly[];
  owner: Actor;
  value: Money;
  metrics: EngagementMetrics;
  lifecycle: LifecycleStep[];
  checklist: EngagementChecklistItem[];
  sessions: EngagementSession[];
  /**
   * Ruling R7: made optional. Tenancy CD-1 withholds `quotation:read` (and
   * margin generally) from OPS, so the OPS projection of an engagement drops
   * this block entirely rather than zeroing it — a missing field is honest,
   * a zeroed one would lie about margin. Before this ruling the field was
   * required and the fixture package had to type its OPS-safe projection as
   * `Omit<Engagement, 'finance'> & { finance?: EngagementFinance }` instead
   * of `Engagement` itself.
   */
  finance?: EngagementFinance;
  /** §18 — the rule-set version stored at grant submission. */
  ruleSetVersion?: string;
}

/**
 * §8 `POST /v1/actions` `type: ENGAGEMENT_CLOSE_OUT` returns `422` with
 * `details.blockers[]` while the claim is incomplete.
 */
export interface EngagementCloseOutBlockers {
  blockers: string[];
}

/* ------------------------------------------------------------------ *
 * §8 · Participants
 * ------------------------------------------------------------------ */

/** §8 / REPORT a registered participant. */
export interface Participant extends EntityEnvelope {
  engagementRef: Ref;
  name: string;
  department: string;
  email?: string | null;
  phone?: string | null;
  certificateId?: string | null;
}

/* ------------------------------------------------------------------ *
 * §8 · Attendance — M10-S06
 * ------------------------------------------------------------------ */

/** §8 one half-day mark on a participant row. */
export interface AttendanceMark {
  present: boolean;
  at?: Timestamp;
  method?: CaptureMethod;
  reason?: AbsenceReason;
}

/** §8 one participant's day. */
export interface AttendanceRow {
  participantRef: Ref;
  name: string;
  department: string;
  am: AttendanceMark;
  pm: AttendanceMark;
  signatureRef?: string;
}

/**
 * §8 the day's totals.
 *
 * §15 item 2: `signaturesExpected` (58 / 60) is derived as
 * `registered × sessionsInDay` and is currently computed client-side. The
 * contract's proposal is to return it here so the rule lives server-side.
 */
export interface AttendanceSummary {
  registered: number;
  presentAm: number;
  presentPm: number;
  signatures: number;
  signaturesExpected: number;
}

/**
 * §8 which capture modes the UI may offer.
 *
 * All `false` while locked — the UI disables from the response, not from its
 * own logic.
 */
export interface AttendanceCaptureModes {
  qr: boolean;
  signature: boolean;
  manual: boolean;
}

/**
 * §8 one day's attendance sheet.
 *
 * Approved attendance is immutable (HRD Corp rule): capture returns
 * `409 ATTENDANCE_LOCKED` once approved, and the lock is one-way.
 */
export interface AttendanceSheet {
  engagementRef: Ref;
  day: number;
  date: DateOnly;
  status: AttendanceStatus;
  immutable: boolean;
  approvedBy: AnyActor | null;
  approvedAt: Timestamp | null;
  summary: AttendanceSummary;
  rows: AttendanceRow[];
  captureModes: AttendanceCaptureModes;
}

/** §8 `POST /v1/engagements/{id}/attendance/{day}/capture`. */
export interface AttendanceCaptureRequest {
  participantRef: Ref;
  session: 'AM' | 'PM';
  present: boolean;
  method: CaptureMethod;
  reason?: AbsenceReason;
}

/** §8 the `409 ATTENDANCE_LOCKED` detail, which names its own escape hatch. */
export interface AttendanceLockedDetails {
  approvedAt: Timestamp;
  unlockPath: string;
  unlockActionType: 'ATTENDANCE_UNLOCK';
}

/**
 * §8 `POST /v1/actions` `type: ATTENDANCE_UNLOCK`.
 *
 * Requires a reason, voids the claim packet (`effects[]` says so explicitly),
 * notifies OPS and FINANCE, always audited.
 * TODO(contract §16 Q5): should the API refuse outright once a claim reference
 * exists, rather than allowing the void?
 */
export interface AttendanceUnlockPayload {
  reason: string;
  day: number;
}

/** §8 `POST /v1/actions` `type: ATTENDANCE_APPROVE`. Lock is one-way. Emits `AttendanceLocked`. */
export interface AttendanceApprovePayload {
  day: number;
}

/** §8 `GET /v1/engagements/{id}/attendance/export?format=HRDC`. */
export interface AttendanceExport {
  url: string;
  expiresAt: Timestamp;
}
