import { sql } from "drizzle-orm";
import { daysBetween, todayMY } from "@/lib/dates";
import { type Executor, db, rows } from "../db/client";

/**
 * Read models for the attendance screens (UI lane 1). Pure reads: nothing
 * here writes, decides or re-derives the effective-slot precedence — that is
 * `tpms.v_attendance_effective`, counted exactly the way the package snapshot
 * (and therefore the DELIVERY_VERIFIED_SUCCESS guard) counts it.
 */

/**
 * A Postgres array literal passed as ONE text parameter. (An array
 * interpolated into Drizzle's sql`` expands to a parenthesised list, which
 * `= any(...)` does not accept.) Every element is quoted and escaped.
 */
function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

/** Operational stages the attendance desk covers. */
export const DESK_OPERATIONAL_STAGES = ["READY_FOR_EVENT", "DELIVERY_IN_PROGRESS", "DELIVERY_COMPLETED"] as const;

/**
 * Financial stages that are still before the claim: the attendance evidence
 * can still change the claim. From CLAIM_READY on, the evidence is frozen
 * into the pack and the package belongs to the claims desk.
 */
export const PRE_CLAIM_FINANCIAL_STAGES = ["ESTIMATE", "GRANT_RESERVED", "UPFRONT_CLAIM_SUBMITTED", "CLAIM_NOT_READY"] as const;

export interface AttendanceDeskRow {
  packageId: string;
  packageCode: string;
  title: string;
  clientName: string;
  operationalStage: string;
  financialStage: string;
  deliveryMode: string;
  startDate: string | null;
  endDate: string | null;
  days: number;
  /** 1-based training day that is today; 0 before the first day; days + 1 after the last. Null without dates. */
  dayOfDelivery: number | null;
  participants: number;
  eligible: number;
  /**
   * expected = participants x days x 2; missing = expected - recorded (the guard's count);
   * overdue = unrecorded slots on training days already over (before today), the ones that need chasing.
   */
  slots: { expected: number; recorded: number; missing: number; overdue: number };
  /** Unresolved needs-review records of active participants (the guard's count). */
  openReviews: number;
  /** PENDING ATTENDANCE_EXCEPTION decisions (one per day at most). */
  pendingDecisions: number;
  photos: { total: number; verified: number; flagged: number; pending: number };
  t3: {
    templates: number;
    /** Training days a non-flagged Form T3 (scan or digital) covers. */
    daysCovered: number[];
    scans: number;
    digital: number;
    verified: number;
    pending: number;
    flagged: number;
    /** attendance.ocr_t3 tasks still QUEUED or PROCESSING. */
    ocrInFlight: number;
  };
}

interface DeskPackageRow {
  id: string;
  package_code: string;
  title: string;
  client_name: string;
  operational_stage: string;
  financial_stage: string;
  delivery_mode: string;
  start_date: string | null;
  end_date: string | null;
  days: number;
  participants: number;
  eligible: number;
  recorded: number;
  past_days: number;
  recorded_past: number;
  open_reviews: number;
  pending_decisions: number;
  ocr_in_flight: number;
}

interface DeskDocRow {
  package_id: string;
  document_type: string;
  verification_status: string;
  metadata: Record<string, unknown>;
}

/** Which training day `today` is, relative to the programme dates. */
export function dayOfDelivery(startDate: string | null, days: number, today: string): number | null {
  if (!startDate || days < 1) return null;
  const offset = daysBetween(startDate, today);
  if (offset < 0) return 0;
  return Math.min(offset + 1, days + 1);
}

/** Training days a FORM_T3 vault row covers, from its own metadata (R14: an unknown source covers nothing). */
export function t3DaysCovered(metadata: Record<string, unknown>): number[] {
  const source = metadata.source;
  if (source === "TRACK_A") return typeof metadata.dayIndex === "number" ? [metadata.dayIndex] : [];
  if (source === "TRACK_B_SCAN") {
    const ocr = metadata.ocr as { days?: unknown } | undefined;
    if (ocr && Array.isArray(ocr.days)) return ocr.days.filter((d): d is number => typeof d === "number");
    return typeof metadata.declaredDayIndex === "number" ? [metadata.declaredDayIndex] : [];
  }
  return [];
}

/**
 * Every package in delivery (or about to be) whose claim has not been
 * assembled yet, with the attendance facts an operator triages by.
 * Two queries for the whole desk: the packages with their counts, then the
 * attendance documents of those packages.
 */
export async function attendanceDesk(opts: { today?: string; executor?: Executor } = {}): Promise<AttendanceDeskRow[]> {
  const executor = opts.executor ?? db();
  const today = opts.today ?? todayMY();
  const ops = pgArray(DESK_OPERATIONAL_STAGES);
  const fin = pgArray(PRE_CLAIM_FINANCIAL_STAGES);
  const packages = await rows<DeskPackageRow>(
    executor,
    sql`with pk as (
          select p.id, p.package_code, p.title, c.company_name as client_name, p.operational_stage, p.financial_stage,
                 p.delivery_mode, p.start_date::text as start_date, p.end_date::text as end_date,
                 coalesce(p.duration_days, 0)::int as days,
                 case when p.start_date is null then 0
                      else least(coalesce(p.duration_days, 0), greatest(0, ${today}::date - p.start_date)) end::int as past_days
            from tpms.training_packages p
            join tpms.corporate_clients c on c.id = p.client_id
           where p.operational_stage = any(${ops}::text[])
             and p.financial_stage = any(${fin}::text[])
        )
        select pk.*,
               (select count(*) from tpms.package_participants pp
                 where pp.package_id = pk.id and pp.registration_status <> 'WITHDRAWN')::int as participants,
               (select count(*) from tpms.package_participants pp
                 where pp.package_id = pk.id and pp.registration_status <> 'WITHDRAWN' and pp.hrd_claim_eligible)::int as eligible,
               (select count(*) from tpms.v_attendance_effective e
                  join tpms.package_participants pp on pp.id = e.participant_id
                 where e.package_id = pk.id and pp.registration_status <> 'WITHDRAWN'
                   and e.day_index between 1 and pk.days)::int as recorded,
               (select count(*) from tpms.v_attendance_effective e
                  join tpms.package_participants pp on pp.id = e.participant_id
                 where e.package_id = pk.id and pp.registration_status <> 'WITHDRAWN'
                   and e.day_index between 1 and pk.past_days)::int as recorded_past,
               (select count(*) from tpms.attendance_records r
                  join tpms.package_participants pp on pp.id = r.participant_id
                 where r.package_id = pk.id and r.needs_review and r.resolved_at is null
                   and pp.registration_status <> 'WITHDRAWN')::int as open_reviews,
               (select count(*) from tpms.decisions d
                 where d.package_id = pk.id and d.gate = 'ATTENDANCE_EXCEPTION' and d.status = 'PENDING')::int as pending_decisions,
               (select count(*) from tpms.task_queue t
                 where t.task_type = 'attendance.ocr_t3' and t.status in ('QUEUED', 'PROCESSING')
                   and t.payload ->> 'packageId' = pk.id::text)::int as ocr_in_flight
          from pk
         order by pk.start_date nulls last, pk.package_code`,
  );
  if (packages.length === 0) return [];
  const ids = pgArray(packages.map((p) => p.id));
  const docs = await rows<DeskDocRow>(
    executor,
    sql`select v.package_id, v.document_type, v.verification_status, v.extracted_metadata as metadata
          from tpms.compliance_vault v
         where v.package_id = any(${ids}::uuid[])
           and v.document_type in ('FORM_T3', 'FORM_T3_TEMPLATE', 'PHOTO_EVIDENCE')`,
  );
  const docsBy = new Map<string, DeskDocRow[]>();
  for (const d of docs) docsBy.set(d.package_id, [...(docsBy.get(d.package_id) ?? []), d]);

  return packages.map((p) => {
    const mine = docsBy.get(p.id) ?? [];
    const photos = mine.filter((d) => d.document_type === "PHOTO_EVIDENCE");
    const t3 = mine.filter((d) => d.document_type === "FORM_T3");
    const covered = new Set<number>();
    for (const d of t3) if (d.verification_status !== "FLAGGED") for (const day of t3DaysCovered(d.metadata)) covered.add(day);
    const expected = p.participants * p.days * 2;
    return {
      packageId: p.id,
      packageCode: p.package_code,
      title: p.title,
      clientName: p.client_name,
      operationalStage: p.operational_stage,
      financialStage: p.financial_stage,
      deliveryMode: p.delivery_mode,
      startDate: p.start_date,
      endDate: p.end_date,
      days: p.days,
      dayOfDelivery: dayOfDelivery(p.start_date, p.days, today),
      participants: p.participants,
      eligible: p.eligible,
      slots: {
        expected,
        recorded: p.recorded,
        missing: Math.max(0, expected - p.recorded),
        overdue: Math.max(0, p.participants * p.past_days * 2 - p.recorded_past),
      },
      openReviews: p.open_reviews,
      pendingDecisions: p.pending_decisions,
      photos: {
        total: photos.length,
        verified: photos.filter((d) => d.verification_status === "VERIFIED").length,
        flagged: photos.filter((d) => d.verification_status === "FLAGGED").length,
        pending: photos.filter((d) => d.verification_status === "PENDING").length,
      },
      t3: {
        templates: mine.filter((d) => d.document_type === "FORM_T3_TEMPLATE").length,
        daysCovered: [...covered].filter((d) => d >= 1 && d <= p.days).sort((a, b) => a - b),
        scans: t3.filter((d) => d.metadata.source === "TRACK_B_SCAN").length,
        digital: t3.filter((d) => d.metadata.source === "TRACK_A").length,
        verified: t3.filter((d) => d.verification_status === "VERIFIED").length,
        pending: t3.filter((d) => d.verification_status === "PENDING").length,
        flagged: t3.filter((d) => d.verification_status === "FLAGGED").length,
        ocrInFlight: p.ocr_in_flight,
      },
    };
  });
}

export const EVIDENCE_TASK_TYPES = ["attendance.ocr_t3", "evidence.photo_exif"] as const;
export type EvidenceTaskType = (typeof EVIDENCE_TASK_TYPES)[number];

export interface EvidenceTaskState {
  taskId: string;
  vaultId: string;
  taskType: EvidenceTaskType;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
}

const TASK_STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"] as const;

/**
 * The latest OCR / EXIF task per uploaded document of one package, so the
 * screen can say "queued", "reading" or "failed: <reason>" beside a scan or a
 * photo instead of leaving the operator to guess whether the worker ran.
 */
export async function evidenceTaskStates(packageId: string, executor: Executor = db()): Promise<Map<string, EvidenceTaskState>> {
  const types = pgArray(EVIDENCE_TASK_TYPES);
  const list = await rows<{
    id: string; vault_id: string; task_type: string; status: string; attempts: number; max_attempts: number;
    last_error: string | null; created_at: string; completed_at: string | null;
  }>(
    executor,
    sql`select distinct on (t.payload ->> 'vaultId')
               t.id, t.payload ->> 'vaultId' as vault_id, t.task_type, t.status, t.attempts, t.max_attempts,
               t.last_error, t.created_at, t.completed_at
          from tpms.task_queue t
         where t.task_type = any(${types}::text[])
           and t.payload ->> 'packageId' = ${packageId}
           and t.payload ? 'vaultId'
         order by t.payload ->> 'vaultId', t.created_at desc`,
  );
  const out = new Map<string, EvidenceTaskState>();
  for (const t of list) {
    // R14: a status or type this module does not know is a contract break, not a default.
    if (!(TASK_STATUSES as readonly string[]).includes(t.status)) throw new Error(`Unknown task status ${t.status}`);
    if (!(EVIDENCE_TASK_TYPES as readonly string[]).includes(t.task_type)) throw new Error(`Unexpected task type ${t.task_type}`);
    out.set(t.vault_id, {
      taskId: t.id,
      vaultId: t.vault_id,
      taskType: t.task_type as EvidenceTaskType,
      status: t.status as EvidenceTaskState["status"],
      attempts: t.attempts,
      maxAttempts: t.max_attempts,
      lastError: t.last_error,
      createdAt: new Date(t.created_at).toISOString(),
      completedAt: t.completed_at ? new Date(t.completed_at).toISOString() : null,
    });
  }
  return out;
}

export interface LinkIssuanceSummary {
  /** Live (unrevoked, unexpired) personal links by purpose. One-time session-QR contexts are excluded. */
  live: Record<"CHECKIN" | "QUIZ_PRE" | "QUIZ_POST", number>;
  revoked: number;
  lastIssuedAt: string | null;
  /** CHECKIN links used at least once. */
  used: number;
}

/** What the participants screen says before anyone presses "issue links". */
export async function linkIssuanceSummary(packageId: string, opts: { now?: Date; executor?: Executor } = {}): Promise<LinkIssuanceSummary> {
  const now = opts.now ?? new Date();
  const executor = opts.executor ?? db();
  const list = await rows<{ purpose: string; live: number; revoked: number; used: number; last: string | null }>(
    executor,
    sql`select purpose,
               count(*) filter (where not revoked and expires_at > ${now})::int as live,
               count(*) filter (where revoked)::int as revoked,
               count(*) filter (where used_at is not null)::int as used,
               max(created_at) as last
          from tpms.magic_link_tokens
         where package_id = ${packageId}::uuid and participant_id is not null and day_index is null
         group by purpose`,
  );
  const live: LinkIssuanceSummary["live"] = { CHECKIN: 0, QUIZ_PRE: 0, QUIZ_POST: 0 };
  let revoked = 0;
  let used = 0;
  let last: number | null = null;
  for (const r of list) {
    if (r.purpose === "CHECKIN" || r.purpose === "QUIZ_PRE" || r.purpose === "QUIZ_POST") live[r.purpose] = r.live;
    else throw new Error(`Unexpected personal link purpose ${r.purpose}`);
    revoked += r.revoked;
    if (r.purpose === "CHECKIN") used = r.used;
    if (r.last) last = Math.max(last ?? 0, new Date(r.last).getTime());
  }
  return { live, revoked, used, lastIssuedAt: last === null ? null : new Date(last).toISOString() };
}
