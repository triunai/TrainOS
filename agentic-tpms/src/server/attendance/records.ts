import { and, eq, sql } from "drizzle-orm";
import { type Executor, rows, schema } from "../db/client";
import type { DecisionOption } from "../db/schema";
import { raiseDecision, resolvePendingFor } from "../decisions/service";
import { setVerification } from "../storage/vault";
import { type Session, slotLabel } from "./sessions";

/**
 * Shared attendance bookkeeping for both tracks.
 *
 * The effective state of a slot is `tpms.v_attendance_effective` (override >
 * OCR > digital) — this module never re-implements that precedence in
 * TypeScript. An "open review" is a record with `needs_review` and no
 * `resolved_at`; the DELIVERY_VERIFIED_SUCCESS guard counts exactly those.
 */
export const REVIEW_CONFIDENCE = 0.75;

/** Why a slot needs a human. R14: the exception desk switches on these. */
export const REVIEW_REASONS = ["UNSIGNED", "LOW_CONFIDENCE", "TRACK_DISAGREEMENT"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/**
 * A slot with no effective record at all (not on the sheet, an unreadable or
 * missing page, a participant added after printing). Fixed by a manual entry
 * or a re-scan; it keeps the day's decision open exactly like a review.
 */
export const NOT_RECORDED = "NOT_RECORDED" as const;

/** Scan-level findings with no slot to resolve; informational in the decision. */
export const SHEET_ISSUES = [
  "PAGE_UNREADABLE",
  "FOREIGN_PACKAGE",
  "DAY_OUT_OF_RANGE",
  "UNKNOWN_PARTICIPANT",
  "MISSING_SHEET_PAGES",
  "NAME_MISMATCH",
] as const;
export type SheetIssue = (typeof SHEET_ISSUES)[number];

export interface ExceptionEntry {
  recordId: string | null;
  participantId: string | null;
  participantName: string | null;
  nricMasked: string | null;
  dayIndex: number | null;
  session: Session | null;
  slot: string | null;
  reason: ReviewReason | typeof NOT_RECORDED | SheetIssue;
  confidence: number | null;
  ocrPresent: boolean | null;
  trackAPresent: boolean | null;
  detail?: string;
}

export const T3_SUBJECT = (packageCode: string, dayIndex: number) => `${packageCode}:T3:D${dayIndex}`;

export const EXCEPTION_OPTIONS: DecisionOption[] = [
  { id: "CONFIRM_AS_READ", label: "Confirm as read", description: "Accept the reading for each slot (an unsigned slot stays absent)." },
  { id: "MARK_PRESENT", label: "Mark present", description: "The trainer attests the participant attended; recorded as a manual override.", consequence: "Counts toward the 80% HRD Corp eligibility threshold." },
  { id: "RESCAN", label: "Re-scan the sheet", description: "Upload a clearer scan; a clean re-read settles the exceptions automatically." },
];

/**
 * Re-derive every active participant's attendance rate from the effective
 * view over (duration_days x 2) slots. A slot awaiting review still counts
 * as its best reading; the review gate is separate (openReviews must be 0
 * before delivery can be verified).
 */
export async function recomputeAttendance(
  executor: Executor,
  packageId: string,
): Promise<Array<{ participantId: string; attendanceRate: string; eligible: boolean }>> {
  return rows(
    executor,
    sql`update tpms.package_participants p
           set attendance_rate = case when d.days > 0 then least(100, round(100.0 * (
                 select count(*) from tpms.v_attendance_effective e
                  where e.participant_id = p.id and e.present and e.day_index between 1 and d.days
               ) / (d.days * 2), 2)) else 0 end
          from (select coalesce(duration_days, 0) as days from tpms.training_packages where id = ${packageId}::uuid) d
         where p.package_id = ${packageId}::uuid and p.registration_status <> 'WITHDRAWN'
     returning p.id as "participantId", p.attendance_rate as "attendanceRate", p.hrd_claim_eligible as "eligible"`,
  );
}

/**
 * What still needs a human for one day: every unresolved review, plus every
 * active participant's slot with no effective record. Masked NRIC only.
 */
export async function openExceptionsForDay(executor: Executor, packageId: string, dayIndex: number): Promise<ExceptionEntry[]> {
  const open = await rows<{
    id: string; participant_id: string; full_name: string; nric_masked: string; session: Session;
    review_reason: string | null; ocr_confidence: string | null; present: boolean; track_a: boolean | null;
  }>(
    executor,
    sql`select r.id, r.participant_id, p.full_name, p.nric_masked, r.session, r.review_reason, r.ocr_confidence, r.present,
               (select a.present from tpms.attendance_records a
                 where a.participant_id = r.participant_id and a.day_index = r.day_index
                   and a.session = r.session and a.track = 'A_DIGITAL') as track_a
          from tpms.attendance_records r
          join tpms.package_participants p on p.id = r.participant_id
         where r.package_id = ${packageId}::uuid and r.day_index = ${dayIndex}
           and r.needs_review and r.resolved_at is null
           and p.registration_status <> 'WITHDRAWN'
         order by p.full_name, p.id, r.session`,
  );
  const missing = await rows<{ participant_id: string; full_name: string; nric_masked: string; session: Session }>(
    executor,
    sql`select p.id as participant_id, p.full_name, p.nric_masked, s.session
          from tpms.package_participants p
          cross join (values ('AM'), ('PM')) as s(session)
         where p.package_id = ${packageId}::uuid and p.registration_status <> 'WITHDRAWN'
           and not exists (select 1 from tpms.v_attendance_effective e
                            where e.participant_id = p.id and e.day_index = ${dayIndex} and e.session = s.session)
         order by p.full_name, p.id, s.session`,
  );
  const reviews: ExceptionEntry[] = open.map((r) => ({
    recordId: r.id,
    participantId: r.participant_id,
    participantName: r.full_name,
    nricMasked: r.nric_masked,
    dayIndex,
    session: r.session,
    slot: slotLabel(dayIndex, r.session),
    reason: parseReviewReason(r.review_reason),
    confidence: r.ocr_confidence === null ? null : Number(r.ocr_confidence),
    ocrPresent: r.present,
    trackAPresent: r.track_a,
  }));
  const gaps: ExceptionEntry[] = missing.map((m) => ({
    recordId: null,
    participantId: m.participant_id,
    participantName: m.full_name,
    nricMasked: m.nric_masked,
    dayIndex,
    session: m.session,
    slot: slotLabel(dayIndex, m.session),
    reason: NOT_RECORDED,
    confidence: null,
    ocrPresent: null,
    trackAPresent: null,
  }));
  return [...reviews, ...gaps];
}

/** R14: a stored reason this module does not know is a data error, not a default. */
export function parseReviewReason(value: string | null): ReviewReason {
  if ((REVIEW_REASONS as readonly string[]).includes(value ?? "")) return value as ReviewReason;
  throw new Error(`Unknown attendance review reason: ${String(value)}`);
}

export interface SettleResult {
  decisionId: string | null;
  status: "RAISED" | "RESOLVED" | "CLEAR";
  /** Unresolved reviews plus unrecorded slots for the day. */
  open: number;
  /** Everything the decision lists (open + this scan's sheet issues). */
  exceptions: number;
}

/**
 * Make the day's ATTENDANCE_EXCEPTION decision match the database: raise
 * (or refresh) it while anything is open or the latest scan had sheet-level
 * issues; resolve it once nothing is. The payload is rebuilt from the
 * records every time, so it can never list an exception already settled.
 */
export async function settleDay(
  executor: Executor,
  pkg: { id: string; packageCode: string },
  dayIndex: number,
  opts: { sheetIssues?: ExceptionEntry[]; vaultId?: string | null; resolvedBy: string; note: string; raisedBy?: string },
): Promise<SettleResult> {
  const open = await openExceptionsForDay(executor, pkg.id, dayIndex);
  const issues = opts.sheetIssues ?? [];
  const subjectRef = T3_SUBJECT(pkg.packageCode, dayIndex);
  if (open.length === 0 && issues.length === 0) {
    const resolved = await resolvePendingFor(executor, "ATTENDANCE_EXCEPTION", subjectRef, { status: "RESOLVED", by: opts.resolvedBy, note: opts.note });
    return { decisionId: resolved?.id ?? null, status: resolved ? "RESOLVED" : "CLEAR", open: 0, exceptions: 0 };
  }
  const exceptions = [...open, ...issues];
  const byReason = exceptions.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.reason]: (acc[e.reason] ?? 0) + 1 }), {});
  const decision = await raiseDecision(executor, {
    gate: "ATTENDANCE_EXCEPTION",
    packageId: pkg.id,
    subjectRef,
    title: `Form T3 Day ${dayIndex}: ${exceptions.length} attendance exception${exceptions.length === 1 ? "" : "s"}`,
    summary: `${Object.entries(byReason).map(([reason, n]) => `${n} ${reason.toLowerCase().replace(/_/g, " ")}`).join(", ")}. ` +
      "Confirm each reading or record a manual override; the decision closes when no slot is left open.",
    payload: { dayIndex, vaultId: opts.vaultId ?? null, exceptions, byReason },
    options: EXCEPTION_OPTIONS,
    raisedBy: opts.raisedBy ?? "attendance.t3_extractor",
    raisedByTier: "L2",
    slaHours: 24,
  });
  return { decisionId: decision.id, status: "RAISED", open: open.length, exceptions: exceptions.length };
}

/**
 * A scanned T3 becomes VERIFIED once nothing it produced awaits review and
 * every day it covers is complete. Only PENDING documents are promoted; a
 * FLAGGED one (unreadable, foreign) stays flagged until a human looks at it.
 */
export async function promoteSettledSheets(executor: Executor, packageId: string, by: string, note: string): Promise<string[]> {
  const candidates = await rows<{ id: string; days: number[] | null; open: number }>(
    executor,
    sql`select v.id, v.extracted_metadata -> 'ocr' -> 'days' as days,
               (select count(*) from tpms.attendance_records r
                 where r.source_vault_id = v.id and r.needs_review and r.resolved_at is null)::int as open
          from tpms.compliance_vault v
         where v.package_id = ${packageId}::uuid and v.document_type = 'FORM_T3'
           and v.verification_status = 'PENDING' and v.extracted_metadata ? 'ocr'`,
  );
  const promoted: string[] = [];
  for (const doc of candidates) {
    if (doc.open > 0 || !doc.days?.length) continue;
    let complete = true;
    for (const day of doc.days) {
      if ((await openExceptionsForDay(executor, packageId, day)).length > 0) complete = false;
    }
    if (!complete) continue;
    await setVerification(executor, doc.id, "VERIFIED", by, note);
    promoted.push(doc.id);
  }
  return promoted;
}

export async function loadPackageBrief(executor: Executor, packageId: string) {
  const [pkg] = await executor
    .select({
      id: schema.trainingPackages.id,
      packageCode: schema.trainingPackages.packageCode,
      title: schema.trainingPackages.title,
      operationalStage: schema.trainingPackages.operationalStage,
      deliveryMode: schema.trainingPackages.deliveryMode,
      startDate: schema.trainingPackages.startDate,
      endDate: schema.trainingPackages.endDate,
      durationDays: schema.trainingPackages.durationDays,
    })
    .from(schema.trainingPackages)
    .where(eq(schema.trainingPackages.id, packageId));
  return pkg;
}

export async function activeParticipant(executor: Executor, packageId: string, participantId: string) {
  const [p] = await executor
    .select()
    .from(schema.packageParticipants)
    .where(and(eq(schema.packageParticipants.id, participantId), eq(schema.packageParticipants.packageId, packageId)));
  return p && p.registrationStatus !== "WITHDRAWN" ? p : undefined;
}
