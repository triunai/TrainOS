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
  PipelineObject,
  StageOutcome,
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
  /**
   * Deliberately `string`, not an enum over the pipeline vocabularies.
   *
   * `LifecycleStepper` is a kit component and its rows are not always a
   * server pipeline: the automation-policies ladder and the kit showcase draw
   * their own steps through it. Closing this union would make the stepper
   * refuse every caller that is not an engagement.
   *
   * The vocabulary that IS closed is per pipeline — `ENGAGEMENT_STAGE_KEYS`
   * for §8, `DEAL_CHAIN_STAGE_KEYS` for §5 — and a screen that names a stage
   * declares its constant with that type, so a rename is a compile error at
   * the screen and a test failure at the seam (W-15 remainder).
   */
  key: string;
  label?: string;
  state: LifecycleState;
  at?: DateOnly | Timestamp;
  note?: string;
  ref?: Ref;
}

/** §5 / §13 `GET /v1/config/pipelines?object=` — the stage definitions. */
export interface PipelineConfig {
  object: PipelineObject;
  stages: PipelineStage[];
}

/**
 * §5 one configured stage.
 *
 * `label` and `order` are the configuration: a screen renders the word this
 * carries, in the sequence this gives, and never its own. `key` is only the
 * identity the two sides agree on.
 */
export interface PipelineStage {
  key: string;
  label: string;
  order: number;
  /**
   * Ruling R16: this stage ends the pipeline. Nothing follows it.
   *
   * Without it a screen has to infer an ending from `order`, and the highest
   * order is simply the last row — which is how a computed chain puts LOST
   * after WON rather than beside it.
   */
  terminal: boolean;
  /**
   * Ruling R16: which way a terminal stage ended, when it ended at all.
   *
   * Absent on every non-terminal stage, and absent on a terminal stage that is
   * neither a win nor a loss — the engagement pipeline's last rung is `PAID`,
   * which completes delivery rather than winning or losing anything. Present
   * exactly where a screen needs to say "in play" instead of "across the
   * book": a pipeline's open work is the stages with no outcome.
   */
  outcome?: StageOutcome;
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
  /**
   * Ruling R17: when the certificate was issued.
   *
   * `certificateId` alone says a certificate exists and not when it was
   * awarded, and the date is the half HRD Corp cares about — a claim packet
   * cites the participant records, and a certificate dated after the claim
   * window closed is a different conversation from one dated inside it.
   *
   * A `DateOnly`, not a timestamp: a certificate is issued on a day and the
   * document prints a day. Absent wherever `certificateId` is absent.
   */
  certificateIssuedAt?: DateOnly | null;
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
  /**
   * The exported engagement's LATEST attendance day status at export time
   * (`core.attendance_days`, highest `day`), so a consumer can tell whether
   * the export was taken while still OPEN or after the day LOCKED. `null`
   * when no attendance day has ever been opened for the engagement yet.
   * Optional: older callers (and the fixture client) do not send it.
   */
  status?: AttendanceStatus | null;
  /** The moment this export was generated, distinct from `expiresAt`. */
  snapshotAt?: Timestamp;
}
