import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { finishAgentRun, startAgentRun } from "../ai/runs";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Executor, type Tx, db, rows, schema, withTx } from "../db/client";
import type { Task } from "../db/schema";
import { DomainError } from "../domain/errors";
import { type T3ParseResult, parseT3 } from "../extraction/client";
import { enqueue } from "../queue/queue";
import { parsePayload } from "./payload";
import { readDocument, setVerification } from "../storage/vault";
import {
  type ExceptionEntry,
  REVIEW_CONFIDENCE,
  type ReviewReason,
  activeParticipant,
  loadPackageBrief,
  promoteSettledSheets,
  recomputeAttendance,
  settleDay,
  T3_SUBJECT,
} from "./records";
import { SESSIONS, type Session, assertDayIndex, parseSession, slotLabel, trainingDate } from "./sessions";
import { storeOnce } from "./t3Template";

export { recomputeAttendance } from "./records";

/**
 * Track B — the paper Form T3, scanned and read by the L2 extraction service.
 *
 *   uploadT3Scan  -> vault FORM_T3 (PENDING) + task attendance.ocr_t3, one tx
 *   handleOcrT3   -> parse (outside any transaction), then in ONE transaction:
 *                    upsert a B_OCR record per participant/day/session, flag
 *                    what needs a human, recompute rates, write the parse
 *                    summary onto the vault row, raise or settle the day's
 *                    ATTENDANCE_EXCEPTION decision, and VERIFY a clean sheet
 *   resolveAttendanceException / setManualAttendance -> MANUAL_OVERRIDE
 *                    records by a named operator, audited, then re-settle
 *
 * A reading needs review when its confidence is below 0.75, when the cell
 * is confidently blank (an absence costs the client its HRD Corp claim for
 * that participant, so a human confirms it), or when Track A says present
 * and the sheet says not. Agents propose, humans dispose: the extractor
 * never overrides an operator's MANUAL_OVERRIDE.
 */
export const T3_AGENT = "attendance.t3_extractor";
const EXTRACTOR: Actor = { type: "SYSTEM", id: T3_AGENT };
const MAX_SCAN_BYTES = 25 * 1024 * 1024;
const SCAN_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/tiff", "image/webp"]);
const UPLOAD_STAGES = new Set(["READY_FOR_EVENT", "DELIVERY_IN_PROGRESS", "DELIVERY_COMPLETED"]);

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const slotKey = (participantId: string, dayIndex: number, session: Session) => `${participantId}:${dayIndex}:${session}`;

// ------------------------------------------------------------------ upload

export interface UploadT3Result {
  vaultId: string;
  taskId: string | null;
  duplicate: boolean;
}

export async function uploadT3Scan(
  packageId: string,
  dayIndex: number,
  bytes: Uint8Array,
  mime: string,
  fileName: string,
  actor: Actor,
): Promise<UploadT3Result> {
  if (!SCAN_MIME.has(mime)) throw new DomainError("UNSUPPORTED_MEDIA", `Form T3 scans must be PDF, PNG, JPEG, TIFF or WebP (got ${mime})`);
  if (bytes.byteLength === 0) throw new DomainError("EMPTY_FILE", "The uploaded scan is empty");
  if (bytes.byteLength > MAX_SCAN_BYTES) throw new DomainError("FILE_TOO_LARGE", "Form T3 scans are limited to 25 MB");
  return withTx(actor, { reasonCode: "T3_SCAN_UPLOADED" }, async (tx) => {
    const pkg = await loadPackageBrief(tx, packageId);
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    if (!UPLOAD_STAGES.has(pkg.operationalStage)) {
      throw new DomainError("T3_UPLOAD_NOT_ALLOWED", `Form T3 scans are accepted from READY_FOR_EVENT onward (package is ${pkg.operationalStage})`);
    }
    assertDayIndex(dayIndex, pkg.durationDays);
    const { doc, created } = await storeOnce(tx, {
      packageId,
      documentType: "FORM_T3",
      fileName,
      mimeType: mime,
      bytes,
      uploadedBy: actor.id,
      extractedMetadata: { source: "TRACK_B_SCAN", declaredDayIndex: dayIndex },
    });
    const taskId = await enqueue(tx, {
      type: "attendance.ocr_t3",
      payload: { packageId, vaultId: doc.id },
      idempotencyKey: `t3ocr:${doc.id}`,
      maxAttempts: 4,
    });
    return { vaultId: doc.id, taskId, duplicate: !created };
  });
}

// ------------------------------------------------------------------ OCR handler

export const ocrTaskPayload = z.object({ packageId: z.string().uuid(), vaultId: z.string().uuid() });

export interface T3IngestSummary {
  status: "VERIFIED" | "EXCEPTIONS" | "UNREADABLE";
  vaultId: string;
  engine: string | null;
  days: number[];
  records: number;
  present: number;
  absent: number;
  reviews: Record<ReviewReason, number>;
  sheetIssues: number;
  exceptions: number;
  decisions: Array<{ dayIndex: number; decisionId: string | null; status: string }>;
  warnings: string[];
}

export async function handleOcrT3(task: Pick<Task, "id" | "payload">): Promise<T3IngestSummary> {
  const { packageId, vaultId } = parsePayload(ocrTaskPayload, task.payload, "attendance.ocr_t3");
  const read = await readDocument(vaultId);
  if (!read) throw new DomainError("VAULT_DOCUMENT_NOT_FOUND", `Vault document ${vaultId} not found`);
  if (read.doc.packageId !== packageId || read.doc.documentType !== "FORM_T3") {
    throw new DomainError("T3_DOCUMENT_MISMATCH", "The task does not point at this package's Form T3");
  }
  if (!read.intact) throw new DomainError("VAULT_TAMPERED", "The stored scan no longer matches its SHA-256; refusing to read it");

  const runId = await startAgentRun(db(), {
    agent: T3_AGENT, tier: "L2", packageId, taskId: task.id,
    inputSummary: `FORM_T3 ${read.doc.fileName} (${read.doc.mimeType}, ${read.doc.sizeBytes} bytes)`,
  });
  const started = Date.now();
  let parsed: T3ParseResult;
  try {
    parsed = await parseT3(new Uint8Array(read.bytes), read.doc.mimeType);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishAgentRun(db(), runId, { status: "FAILED", error: message.slice(0, 2000) });
    if (!(error instanceof DomainError)) throw error; // transport: retried by the queue
    return markUnreadable(packageId, vaultId, read.doc.extractedMetadata, error);
  }

  try {
    // A verdict an operator already gave the document stands; the readings are still recorded.
    const humanVerdict = read.doc.verificationStatus !== "PENDING" && Boolean(read.doc.verifiedBy) && read.doc.verifiedBy !== T3_AGENT;
    const summary = await withTx(EXTRACTOR, { reasonCode: "T3_OCR_INGESTED" }, (tx) =>
      ingestParsed(tx, packageId, vaultId, read.doc.extractedMetadata, parsed, humanVerdict ? (read.doc.verificationStatus as "VERIFIED" | "FLAGGED") : null));
    const cells = parsed.pages.flatMap((p) => p.rows.flatMap((r) => [r.am.confidence, r.pm.confidence]));
    await finishAgentRun(db(), runId, {
      status: "SUCCEEDED",
      output: { ...summary },
      provenance: {
        tier: "L2", agent: T3_AGENT, mode: "EXTRACTION", provider: "paddleocr-service", model: parsed.engine,
        costMyr: 0, latencyMs: Date.now() - started,
        confidence: cells.length ? round3(cells.reduce((a, b) => a + b, 0) / cells.length) : 0,
      },
    });
    return summary;
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) });
    throw error;
  }
}

async function markUnreadable(packageId: string, vaultId: string, metadata: Record<string, unknown>, error: DomainError): Promise<T3IngestSummary> {
  return withTx(EXTRACTOR, { reasonCode: "T3_OCR_UNREADABLE" }, async (tx) => {
    const pkg = await loadPackageBrief(tx, packageId);
    const day = typeof metadata.declaredDayIndex === "number" ? metadata.declaredDayIndex : 1;
    await setVerification(tx, vaultId, "FLAGGED", T3_AGENT, `Unreadable scan: ${error.message}`.slice(0, 1000), {
      ...metadata,
      ocr: { status: "UNREADABLE", error: error.message, serviceCode: error.details.serviceCode ?? null, days: [] },
    });
    const issue: ExceptionEntry = {
      recordId: null, participantId: null, participantName: null, nricMasked: null, dayIndex: day, session: null, slot: null,
      reason: "PAGE_UNREADABLE", confidence: null, ocrPresent: null, trackAPresent: null, detail: error.message,
    };
    const settled = await settleDay(tx, pkg, day, { sheetIssues: [issue], vaultId, resolvedBy: T3_AGENT, note: "Unreadable scan" });
    return {
      status: "UNREADABLE", vaultId, engine: null, days: [], records: 0, present: 0, absent: 0,
      reviews: { UNSIGNED: 0, LOW_CONFIDENCE: 0, TRACK_DISAGREEMENT: 0 }, sheetIssues: 1, exceptions: 1,
      decisions: [{ dayIndex: day, decisionId: settled.decisionId, status: settled.status }], warnings: [error.message],
    };
  });
}

async function ingestParsed(
  tx: Tx,
  packageId: string,
  vaultId: string,
  metadata: Record<string, unknown>,
  parsed: T3ParseResult,
  keepStatus: "VERIFIED" | "FLAGGED" | null,
): Promise<T3IngestSummary> {
  const pkg = await loadPackageBrief(tx, packageId);
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const participants = await tx
    .select({ id: schema.packageParticipants.id, name: schema.packageParticipants.fullName, nricMasked: schema.packageParticipants.nricMasked, status: schema.packageParticipants.registrationStatus })
    .from(schema.packageParticipants)
    .where(eq(schema.packageParticipants.packageId, packageId));
  const byId = new Map(participants.map((p) => [p.id, p]));
  const existing = await rows<{ participant_id: string; day_index: number; session: Session; track: string; present: boolean }>(
    tx,
    sql`select participant_id, day_index, session, track, present from tpms.attendance_records
         where package_id = ${packageId}::uuid and track in ('A_DIGITAL', 'MANUAL_OVERRIDE')`,
  );
  const trackA = new Map<string, boolean>();
  const overrides = new Map<string, boolean>();
  for (const r of existing) (r.track === "A_DIGITAL" ? trackA : overrides).set(slotKey(r.participant_id, r.day_index, r.session), r.present);

  const declared = typeof metadata.declaredDayIndex === "number" ? metadata.declaredDayIndex : null;
  const warnings: string[] = [];
  const issuesByDay = new Map<number, ExceptionEntry[]>();
  const issue = (day: number, reason: ExceptionEntry["reason"], detail: string, participantId: string | null = null) => {
    const p = participantId ? byId.get(participantId) : undefined;
    const list = issuesByDay.get(day) ?? [];
    list.push({
      recordId: null, participantId, participantName: p?.name ?? null, nricMasked: p?.nricMasked ?? null, dayIndex: day,
      session: null, slot: null, reason, confidence: null, ocrPresent: null, trackAPresent: null, detail,
    });
    issuesByDay.set(day, list);
  };
  const fallbackDay = declared ?? 1;
  const reviews: Record<ReviewReason, number> = { UNSIGNED: 0, LOW_CONFIDENCE: 0, TRACK_DISAGREEMENT: 0 };
  const pagesByDay = new Map<number, { seen: Set<number>; count: number }>();
  let records = 0;
  let present = 0;

  const pageSummaries = [];
  for (const page of parsed.pages) {
    pageSummaries.push({ pageIndex: page.pageIndex, dayIndex: page.dayIndex, sheetPage: page.sheetPage, rows: page.rows.length, registration: page.registration, warnings: page.warnings });
    if (!page.packageId || !page.dayIndex) {
      issue(fallbackDay, "PAGE_UNREADABLE", `Page ${page.pageIndex}: ${page.warnings.join(", ") || "no layout"}`);
      continue;
    }
    if (page.packageId !== packageId) {
      issue(fallbackDay, "FOREIGN_PACKAGE", `Page ${page.pageIndex} belongs to another package`);
      continue;
    }
    const day = page.dayIndex;
    if (day > (pkg.durationDays ?? 0)) {
      issue(fallbackDay, "DAY_OUT_OF_RANGE", `Page ${page.pageIndex} is for day ${day}; the programme has ${pkg.durationDays ?? 0}`);
      continue;
    }
    if (declared !== null && day !== declared) warnings.push(`DAY_MISMATCH: page ${page.pageIndex} is Day ${day}, uploaded as Day ${declared}`);
    const pages = pagesByDay.get(day) ?? { seen: new Set<number>(), count: page.sheetPageCount ?? 1 };
    pages.seen.add(page.sheetPage ?? 1);
    pagesByDay.set(day, pages);
    if (page.registration === "full_page") warnings.push(`UNREGISTERED: page ${page.pageIndex} had no fiducials; every reading was sent to review`);

    for (const row of page.rows) {
      const participant = byId.get(row.participantId);
      if (!participant) {
        issue(day, "UNKNOWN_PARTICIPANT", `Row ${row.rowIndex + 1} on page ${page.pageIndex} is not on this package's roster`);
        continue;
      }
      if (participant.status === "WITHDRAWN") {
        warnings.push(`WITHDRAWN: row ${row.rowIndex + 1} (${participant.nricMasked}) withdrew; reading ignored`);
        continue;
      }
      if (row.printedName && !namesAgree(row.printedName, participant.name)) {
        issue(day, "NAME_MISMATCH", `Row ${row.rowIndex + 1}: printed name reads "${row.printedName.slice(0, 60)}"`, participant.id);
      }
      for (const session of SESSIONS) {
        const reading = session === "AM" ? row.am : row.pm;
        const key = slotKey(participant.id, day, session);
        const confidence = round3(reading.confidence);
        const override = overrides.get(key);
        const reason: ReviewReason | null =
          trackA.get(key) === true && !reading.signed ? "TRACK_DISAGREEMENT"
            : confidence < REVIEW_CONFIDENCE ? "LOW_CONFIDENCE"
              : !reading.signed ? "UNSIGNED"
                : null;
        // An operator's override is final; a new reading is recorded beside it, never re-opened.
        const needsReview = override === undefined && reason !== null;
        const storedReason = override === undefined ? reason : override !== reading.signed ? "SUPERSEDED_BY_OVERRIDE" : null;
        await tx.execute(sql`
          insert into tpms.attendance_records
            (package_id, participant_id, day_index, session, track, present, ocr_confidence, source_vault_id, needs_review, review_reason)
          values (${packageId}::uuid, ${participant.id}::uuid, ${day}, ${session}, 'B_OCR', ${reading.signed}, ${confidence},
                  ${vaultId}::uuid, ${needsReview}, ${storedReason})
          on conflict (participant_id, day_index, session, track) do update
             set present = excluded.present, ocr_confidence = excluded.ocr_confidence,
                 source_vault_id = excluded.source_vault_id, needs_review = excluded.needs_review,
                 review_reason = excluded.review_reason, resolved_by = null, resolved_at = null`);
        records += 1;
        if (reading.signed) present += 1;
        if (needsReview && reason) reviews[reason] += 1;
      }
    }
  }
  for (const [day, pages] of pagesByDay) {
    if (pages.seen.size < pages.count) {
      issue(day, "MISSING_SHEET_PAGES", `Sheet pages ${[...Array(pages.count).keys()].map((i) => i + 1).filter((n) => !pages.seen.has(n)).join(", ")} of ${pages.count} were not in this upload`);
    }
  }

  await recomputeAttendance(tx, packageId);

  const days = [...new Set([...pagesByDay.keys(), ...issuesByDay.keys()])].sort((a, b) => a - b);
  const decisions: T3IngestSummary["decisions"] = [];
  let exceptions = 0;
  for (const day of days) {
    const settled = await settleDay(tx, pkg, day, {
      sheetIssues: issuesByDay.get(day) ?? [], vaultId, resolvedBy: T3_AGENT, note: "A re-scan read every slot cleanly",
    });
    decisions.push({ dayIndex: day, decisionId: settled.decisionId, status: settled.status });
    exceptions += settled.exceptions;
  }
  const sheetIssues = [...issuesByDay.values()].reduce((n, list) => n + list.length, 0);
  const usable = pagesByDay.size > 0;
  const status: T3IngestSummary["status"] = !usable ? "UNREADABLE" : exceptions === 0 ? "VERIFIED" : "EXCEPTIONS";
  const summary: T3IngestSummary = {
    status, vaultId, engine: parsed.engine, days: [...pagesByDay.keys()].sort((a, b) => a - b), records, present,
    absent: records - present, reviews, sheetIssues, exceptions, decisions, warnings,
  };
  const note =
    status === "VERIFIED" ? `Every slot read with confidence >= ${REVIEW_CONFIDENCE}; no exceptions`
      : status === "UNREADABLE" ? "No page of this upload belongs to this package's register"
        : `${exceptions} attendance exception(s) await review`;
  const docStatus = keepStatus ?? (status === "VERIFIED" ? "VERIFIED" : status === "UNREADABLE" ? "FLAGGED" : "PENDING");
  await setVerification(tx, vaultId, docStatus, T3_AGENT, keepStatus ? `Operator verdict kept; OCR: ${note}` : note, {
    ...metadata,
    ocr: { ...summary, parsedAt: new Date().toISOString(), pages: pageSummaries, thresholds: parsed.thresholds },
  });
  return summary;
}

/** Loose printed-name check: most name tokens of the roster appear in the OCR text. */
function namesAgree(printed: string, roster: string): boolean {
  const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1);
  const read = new Set(tokens(printed));
  const expected = tokens(roster);
  if (expected.length === 0) return true;
  return expected.filter((t) => read.has(t)).length / expected.length >= 0.5;
}

// ------------------------------------------------------------------ operator resolution

export interface OverrideOutcome {
  overrides: Array<{ recordId: string; participantId: string; dayIndex: number; session: Session; present: boolean }>;
  decisions: Array<{ dayIndex: number; decisionId: string | null; status: string }>;
  verifiedSheets: string[];
  rates: Array<{ participantId: string; attendanceRate: string; eligible: boolean }>;
}

function requireHuman(actor: Actor, note: string): string {
  if (actor.type !== "USER") throw new DomainError("HUMAN_REQUIRED", "Attendance exceptions are resolved by a named operator");
  const trimmed = note.trim();
  if (!trimmed) throw new DomainError("NOTE_REQUIRED", "Record why (e.g. trainer confirmed attendance, participant absent)");
  return trimmed;
}

async function applyOverride(
  tx: Tx,
  pkg: { id: string; packageCode: string },
  slot: { participantId: string; nricMasked: string; dayIndex: number; session: Session },
  present: boolean,
  note: string,
  actor: Actor,
): Promise<string> {
  const [override] = await rows<{ id: string }>(
    tx,
    sql`insert into tpms.attendance_records
          (package_id, participant_id, day_index, session, track, present, signed_at, needs_review, review_reason, resolved_by, resolved_at)
        values (${pkg.id}::uuid, ${slot.participantId}::uuid, ${slot.dayIndex}, ${slot.session}, 'MANUAL_OVERRIDE', ${present},
                null, false, ${note.slice(0, 100)}, ${actor.id}, now())
        on conflict (participant_id, day_index, session, track) do update
           set present = excluded.present, review_reason = excluded.review_reason,
               resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at
        returning id`,
  );
  // The override settles the slot: every open flag on it is closed by the same hand.
  const closed = await rows<{ id: string; track: string; present: boolean }>(
    tx,
    sql`update tpms.attendance_records set resolved_by = ${actor.id}, resolved_at = now()
         where participant_id = ${slot.participantId}::uuid and day_index = ${slot.dayIndex} and session = ${slot.session}
           and track <> 'MANUAL_OVERRIDE' and needs_review and resolved_at is null
     returning id, track, present`,
  );
  await recordAudit(tx, {
    entityType: "ATTENDANCE_RECORD",
    entityId: override.id,
    reasonCode: "ATTENDANCE_OVERRIDE",
    details: note,
    metadata: {
      package_id: pkg.id,
      participant_id: slot.participantId,
      nric_masked: slot.nricMasked,
      slot: slotLabel(slot.dayIndex, slot.session),
      present,
      resolved: closed.map((c) => ({ record_id: c.id, track: c.track, read_as_present: c.present })),
    },
  });
  return override.id;
}

async function settleAfterOverride(tx: Tx, pkg: { id: string; packageCode: string }, days: number[], actor: Actor, note: string) {
  const rates = await recomputeAttendance(tx, pkg.id);
  const decisions: OverrideOutcome["decisions"] = [];
  for (const day of [...new Set(days)].sort((a, b) => a - b)) {
    // Only a day that has (or had) an exception decision is settled here;
    // a Track-A-only day never had one to close.
    const [pending] = await rows<{ id: string }>(
      tx,
      sql`select id from tpms.decisions where gate = 'ATTENDANCE_EXCEPTION' and subject_ref = ${T3_SUBJECT(pkg.packageCode, day)} and status = 'PENDING'`,
    );
    if (!pending) continue;
    const settled = await settleDay(tx, pkg, day, { resolvedBy: actor.id, note, raisedBy: T3_AGENT });
    decisions.push({ dayIndex: day, decisionId: settled.decisionId, status: settled.status });
  }
  const verifiedSheets = await promoteSettledSheets(tx, pkg.id, actor.id, "All attendance exceptions on this sheet were resolved by an operator");
  return { rates, decisions, verifiedSheets };
}

/**
 * Settle flagged records: writes a MANUAL_OVERRIDE per slot (present or
 * absent, as the operator decided), closes the flags, recomputes rates,
 * resolves the day's decision once nothing is open, and verifies the sheet.
 */
export async function resolveAttendanceException(
  recordIds: string[],
  resolution: { present: boolean; note: string },
  actor: Actor,
): Promise<OverrideOutcome> {
  const note = requireHuman(actor, resolution.note);
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) throw new DomainError("NO_RECORDS", "Select at least one attendance exception");
  return withTx(actor, { reasonCode: "ATTENDANCE_OVERRIDE", reasonDetails: note }, async (tx) => {
    const flagged = await tx
      .select()
      .from(schema.attendanceRecords)
      .where(inArray(schema.attendanceRecords.id, ids))
      .for("update");
    if (flagged.length !== ids.length) throw new DomainError("RECORD_NOT_FOUND", "One or more attendance records no longer exist");
    const packageIds = new Set(flagged.map((r) => r.packageId));
    if (packageIds.size !== 1) throw new DomainError("MIXED_PACKAGES", "Resolve one package's exceptions at a time");
    const stale = flagged.find((r) => !r.needsReview || r.resolvedAt);
    if (stale) throw new DomainError("EXCEPTION_NOT_OPEN", "This exception was already resolved", { recordId: stale.id });
    const pkg = await loadPackageBrief(tx, flagged[0].packageId);

    const overrides: OverrideOutcome["overrides"] = [];
    const seen = new Set<string>();
    for (const record of flagged) {
      const session = parseSession(record.session);
      const key = slotKey(record.participantId, record.dayIndex, session);
      if (seen.has(key)) continue;
      seen.add(key);
      // A flag on someone who has since withdrawn must still be closable, or it
      // would block DELIVERY_VERIFIED_SUCCESS forever; their rate is not recomputed.
      const [participant] = await tx
        .select({ nricMasked: schema.packageParticipants.nricMasked })
        .from(schema.packageParticipants)
        .where(and(eq(schema.packageParticipants.id, record.participantId), eq(schema.packageParticipants.packageId, pkg.id)));
      if (!participant) throw new DomainError("RECORD_NOT_FOUND", "The participant is not on this package");
      const recordId = await applyOverride(tx, pkg, { participantId: record.participantId, nricMasked: participant.nricMasked, dayIndex: record.dayIndex, session }, resolution.present, note, actor);
      overrides.push({ recordId, participantId: record.participantId, dayIndex: record.dayIndex, session, present: resolution.present });
    }
    const settled = await settleAfterOverride(tx, pkg, overrides.map((o) => o.dayIndex), actor, note);
    return { overrides, ...settled };
  });
}

/**
 * Record a slot by hand — for a slot with no record at all (not on the
 * sheet, a page missing) or to correct any slot from the exception desk.
 */
export async function setManualAttendance(
  input: { packageId: string; participantId: string; dayIndex: number; session: Session; present: boolean; note: string },
  actor: Actor,
): Promise<OverrideOutcome> {
  const note = requireHuman(actor, input.note);
  const session = parseSession(input.session);
  return withTx(actor, { reasonCode: "ATTENDANCE_OVERRIDE", reasonDetails: note }, async (tx) => {
    const pkg = await loadPackageBrief(tx, input.packageId);
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${input.packageId} not found`);
    assertDayIndex(input.dayIndex, pkg.durationDays);
    const participant = await activeParticipant(tx, pkg.id, input.participantId);
    if (!participant) throw new DomainError("PARTICIPANT_NOT_ACTIVE", "Not an active participant of this package");
    const recordId = await applyOverride(tx, pkg, { participantId: participant.id, nricMasked: participant.nricMasked, dayIndex: input.dayIndex, session }, input.present, note, actor);
    const settled = await settleAfterOverride(tx, pkg, [input.dayIndex], actor, note);
    return { overrides: [{ recordId, participantId: participant.id, dayIndex: input.dayIndex, session, present: input.present }], ...settled };
  });
}

// ------------------------------------------------------------------ exception desk grid

export interface MatrixCell {
  dayIndex: number;
  session: Session;
  slot: string;
  /** Effective state (override > OCR > digital); null when nothing is recorded. */
  present: boolean | null;
  track: "A_DIGITAL" | "B_OCR" | "MANUAL_OVERRIDE" | null;
  needsReview: boolean;
  reviewReasons: string[];
  /** Pass these to resolveAttendanceException. */
  openRecordIds: string[];
  confidence: number | null;
  tracks: Partial<Record<"A_DIGITAL" | "B_OCR" | "MANUAL_OVERRIDE", boolean>>;
}

export interface AttendanceMatrix {
  packageId: string;
  packageCode: string;
  durationDays: number;
  dates: string[];
  participants: Array<{
    id: string;
    name: string;
    nricMasked: string;
    registrationStatus: string;
    attendanceRate: string;
    eligible: boolean;
    cells: MatrixCell[];
  }>;
  totals: { slots: number; recorded: number; missing: number; openReviews: number };
  decisions: Array<{ id: string; subjectRef: string; title: string; status: string }>;
}

export async function attendanceMatrix(packageId: string, executor: Executor = db()): Promise<AttendanceMatrix> {
  const pkg = await loadPackageBrief(executor, packageId);
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const days = pkg.durationDays ?? 0;
  const participants = await executor
    .select()
    .from(schema.packageParticipants)
    .where(and(eq(schema.packageParticipants.packageId, packageId), sql`${schema.packageParticipants.registrationStatus} <> 'WITHDRAWN'`))
    .orderBy(schema.packageParticipants.fullName, schema.packageParticipants.id);
  const records = await executor.select().from(schema.attendanceRecords).where(eq(schema.attendanceRecords.packageId, packageId));
  const effective = await rows<{ participant_id: string; day_index: number; session: Session; track: MatrixCell["track"]; present: boolean }>(
    executor,
    sql`select participant_id, day_index, session, track, present from tpms.v_attendance_effective where package_id = ${packageId}::uuid`,
  );
  const effectiveBy = new Map(effective.map((e) => [slotKey(e.participant_id, e.day_index, e.session), e]));
  const recordsBy = new Map<string, typeof records>();
  for (const r of records) {
    const key = slotKey(r.participantId, r.dayIndex, parseSession(r.session));
    recordsBy.set(key, [...(recordsBy.get(key) ?? []), r]);
  }
  const decisions = await executor
    .select({ id: schema.decisions.id, subjectRef: schema.decisions.subjectRef, title: schema.decisions.title, status: schema.decisions.status })
    .from(schema.decisions)
    .where(and(eq(schema.decisions.packageId, packageId), eq(schema.decisions.gate, "ATTENDANCE_EXCEPTION")));

  let recorded = 0;
  let openReviews = 0;
  const out = participants.map((p) => {
    const cells: MatrixCell[] = [];
    for (let day = 1; day <= days; day += 1) {
      for (const session of SESSIONS) {
        const key = slotKey(p.id, day, session);
        const eff = effectiveBy.get(key);
        const slotRecords = recordsBy.get(key) ?? [];
        const open = slotRecords.filter((r) => r.needsReview && !r.resolvedAt);
        const ocr = slotRecords.find((r) => r.track === "B_OCR");
        if (eff) recorded += 1;
        openReviews += open.length;
        cells.push({
          dayIndex: day,
          session,
          slot: slotLabel(day, session),
          present: eff ? eff.present : null,
          track: eff ? eff.track : null,
          needsReview: open.length > 0,
          reviewReasons: open.map((r) => r.reviewReason ?? "LOW_CONFIDENCE"),
          openRecordIds: open.map((r) => r.id),
          confidence: ocr?.ocrConfidence ? Number(ocr.ocrConfidence) : null,
          tracks: Object.fromEntries(slotRecords.map((r) => [r.track, r.present])),
        });
      }
    }
    return {
      id: p.id,
      name: p.fullName,
      nricMasked: p.nricMasked,
      registrationStatus: p.registrationStatus,
      attendanceRate: p.attendanceRate,
      eligible: Boolean(p.hrdClaimEligible),
      cells,
    };
  });
  const slots = participants.length * days * 2;
  return {
    packageId,
    packageCode: pkg.packageCode,
    durationDays: days,
    dates: pkg.startDate ? Array.from({ length: days }, (_, i) => trainingDate(pkg.startDate as string, i + 1)) : [],
    participants: out,
    totals: { slots, recorded, missing: slots - recorded, openReviews },
    decisions,
  };
}
