import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rows, schema } from "@/server/db/client";
import type { Task } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { loadSnapshot } from "@/server/packages/snapshot";
import { claimDue } from "@/server/queue/queue";
import { readDocument } from "@/server/storage/vault";
import {
  attendanceMatrix,
  generateT3Templates,
  recordCheckIn,
  renderDigitalT3,
  resolveAttendanceException,
  setManualAttendance,
  issueParticipantLinks,
  uploadT3Scan,
  handlers,
} from "@/server/attendance";
import { parseT3, synthesizeT3Scan } from "@/server/extraction/client";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt, fixtureNric, type LifecycleFixture } from "../helpers/lifecycle";
import { MISSING_VENV_MESSAGE, hasServiceVenv, startExtractionService, stopExtractionService } from "../helpers/extraction-service";

if (!hasServiceVenv) console.warn(`[attendance-t3] SKIPPED: ${MISSING_VENV_MESSAGE}`);
const suite = hasServiceVenv ? describe : describe.skip;

const ctx = { workerId: "test-worker", heartbeat: async () => undefined };
const SIGNATURE = "M 10 40 C 30 5, 60 5, 80 40 S 130 75, 150 40 L 170 30 L 190 45 M 20 60 L 180 58";

async function runOcrTask(vaultId: string) {
  const leased = await claimDue("test-worker", 20, 300, ["attendance.ocr_t3"]);
  const task = leased.find((t) => (t.payload as { vaultId: string }).vaultId === vaultId) as Task;
  expect(task, "an attendance.ocr_t3 task for the upload").toBeDefined();
  return handlers["attendance.ocr_t3"]!(task, ctx);
}

async function records(packageId: string, dayIndex: number) {
  return db()
    .select()
    .from(schema.attendanceRecords)
    .where(and(eq(schema.attendanceRecords.packageId, packageId), eq(schema.attendanceRecords.dayIndex, dayIndex)));
}

async function rates(packageId: string) {
  const list = await db().select().from(schema.packageParticipants).where(eq(schema.packageParticipants.packageId, packageId));
  return new Map(list.map((p) => [p.id, Number(p.attendanceRate)]));
}

async function pendingDecision(subjectRef: string) {
  const [d] = await db()
    .select()
    .from(schema.decisions)
    .where(and(eq(schema.decisions.gate, "ATTENDANCE_EXCEPTION"), eq(schema.decisions.subjectRef, subjectRef)));
  return d;
}

suite("Track B — Form T3 template, scan, OCR, exceptions (live extraction service)", () => {
  let fx: LifecycleFixture;
  let order: string[]; // participant ids in sheet row order
  let templates: Awaited<ReturnType<typeof generateT3Templates>>;
  let day1VaultId: string;

  beforeAll(async () => {
    await useTestDatabase();
    await startExtractionService();
    fx = await buildPackageAt("DELIVERY_IN_PROGRESS", { participants: 6 });
  }, 120_000);

  afterAll(async () => {
    await stopExtractionService();
    await releaseTestDatabase();
  });

  it("generates one FORM_T3_TEMPLATE per training day, idempotently", async () => {
    templates = await generateT3Templates(fx.pkg.id, ALEX);
    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.documentType)).toEqual(["FORM_T3_TEMPLATE", "FORM_T3_TEMPLATE"]);
    expect(templates.map((t) => t.extractedMetadata.dayIndex)).toEqual([1, 2]);
    order = templates[0].extractedMetadata.participantIds as string[];
    expect(new Set(order)).toEqual(new Set(fx.participantIds));

    const again = await generateT3Templates(fx.pkg.id, ALEX);
    expect(again.map((t) => t.id)).toEqual(templates.map((t) => t.id));
    const [{ n }] = await rows<{ n: number }>(db(), sql`select count(*)::int as n from tpms.compliance_vault
      where package_id = ${fx.pkg.id}::uuid and document_type = 'FORM_T3_TEMPLATE'`);
    expect(n).toBe(2);
  });

  it("reads a synthesized Day 1 scan into B_OCR records and raises one exception decision", async () => {
    // Participant in row 2 checks in digitally for Day 1 AM, then does not sign the paper sheet.
    const links = await issueParticipantLinks(fx.pkg.id);
    const row2 = links.find((l) => l.participantId === order[2]);
    await recordCheckIn({
      token: row2!.checkin!.token, dayIndex: 1, session: "AM", signatureSvgPath: SIGNATURE,
      userAgent: "vitest", ip: "203.0.113.9", now: new Date(`${fx.pkg.startDate}T09:05:00+08:00`),
    });

    const template = await readDocument(templates[0].id);
    const scan = await synthesizeT3Scan(new Uint8Array(template!.bytes), {
      signed: [[0, "AM"], [1, "AM"], [3, "AM"], [4, "AM"], [5, "AM"], [0, "PM"], [1, "PM"], [3, "PM"], [4, "PM"]],
      faint: [[5, "PM"]],
      rotateDeg: 2,
      perspective: 0.01,
      noise: 0.03,
      seed: 21,
    });
    const upload = await uploadT3Scan(fx.pkg.id, 1, scan, "image/png", "day1-scan.png", ALEX);
    day1VaultId = upload.vaultId;
    expect(upload.taskId).not.toBeNull();

    const summary = (await runOcrTask(upload.vaultId)) as Record<string, unknown>;
    expect(summary.status).toBe("EXCEPTIONS");
    expect(summary.records).toBe(12);
    expect(summary.reviews).toEqual({ UNSIGNED: 1, LOW_CONFIDENCE: 1, TRACK_DISAGREEMENT: 1 });

    const day1 = (await records(fx.pkg.id, 1)).filter((r) => r.track === "B_OCR");
    expect(day1).toHaveLength(12);
    const at = (row: number, session: "AM" | "PM") => day1.find((r) => r.participantId === order[row] && r.session === session)!;
    for (const [row, session] of [[0, "AM"], [0, "PM"], [1, "AM"], [3, "PM"], [4, "AM"]] as const) {
      expect(at(row, session)).toMatchObject({ present: true, needsReview: false, sourceVaultId: upload.vaultId });
      expect(Number(at(row, session).ocrConfidence)).toBeGreaterThanOrEqual(0.75);
    }
    expect(at(2, "AM")).toMatchObject({ present: false, needsReview: true, reviewReason: "TRACK_DISAGREEMENT" });
    expect(at(2, "PM")).toMatchObject({ present: false, needsReview: true, reviewReason: "UNSIGNED" });
    expect(at(5, "PM")).toMatchObject({ needsReview: true, reviewReason: "LOW_CONFIDENCE" });
    expect(Number(at(5, "PM").ocrConfidence)).toBeLessThan(0.75);

    // Rates over 2 days x 2 sessions: OCR beats the digital record for row 2 AM.
    const r = await rates(fx.pkg.id);
    expect(r.get(order[0])).toBe(50);
    expect(r.get(order[2])).toBe(0);

    const decision = await pendingDecision(`${fx.pkg.packageCode}:T3:D1`);
    expect(decision).toMatchObject({ status: "PENDING", raisedByTier: "L2", packageId: fx.pkg.id });
    const exceptions = (decision.payload as { exceptions: Array<Record<string, unknown>> }).exceptions;
    expect(exceptions.map((e) => `${e.slot}:${e.reason}`).sort()).toEqual(["D1-AM:TRACK_DISAGREEMENT", "D1-PM:LOW_CONFIDENCE", "D1-PM:UNSIGNED"]);
    for (const e of exceptions) expect(e.nricMasked).toMatch(/^\*{6}-\*\*-\d{4}$/);
    const serialised = JSON.stringify(decision);
    for (let i = 0; i < 6; i += 1) expect(serialised).not.toContain(fixtureNric(90, i));

    const vault = await readDocument(upload.vaultId);
    expect(vault!.doc.verificationStatus).toBe("PENDING");
    expect((vault!.doc.extractedMetadata.ocr as { status: string }).status).toBe("EXCEPTIONS");

    const [run] = await rows<{ tier: string; status: string }>(db(), sql`select tier, status from tpms.agent_runs
      where agent = 'attendance.t3_extractor' and package_id = ${fx.pkg.id}::uuid order by started_at desc limit 1`);
    expect(run).toEqual({ tier: "L2", status: "SUCCEEDED" });
  });

  it("refuses a resolution without a named human or a note", async () => {
    const open = (await records(fx.pkg.id, 1)).filter((r) => r.needsReview && !r.resolvedAt);
    await expect(resolveAttendanceException([open[0].id], { present: true, note: "x" }, { type: "AGENT", id: "bot" }))
      .rejects.toMatchObject({ code: "HUMAN_REQUIRED" });
    await expect(resolveAttendanceException([open[0].id], { present: true, note: "  " }, ALEX)).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
  });

  it("resolves exceptions by manual override, closing the decision and verifying the sheet", async () => {
    const open = (await records(fx.pkg.id, 1)).filter((r) => r.needsReview && !r.resolvedAt);
    const row2 = open.filter((r) => r.participantId === order[2]).map((r) => r.id);
    const first = await resolveAttendanceException(row2, { present: true, note: "Trainer confirms attendance; forgot to sign" }, ALEX);
    expect(first.overrides).toHaveLength(2);
    expect(first.decisions).toEqual([expect.objectContaining({ dayIndex: 1, status: "RAISED" })]);
    expect(first.verifiedSheets).toEqual([]);

    await expect(resolveAttendanceException(row2, { present: true, note: "again" }, ALEX)).rejects.toMatchObject({ code: "EXCEPTION_NOT_OPEN" });

    const row5 = open.filter((r) => r.participantId === order[5]).map((r) => r.id);
    const second = await resolveAttendanceException(row5, { present: false, note: "Stray mark; left after lunch" }, ALEX);
    expect(second.decisions).toEqual([expect.objectContaining({ dayIndex: 1, status: "RESOLVED" })]);
    expect(second.verifiedSheets).toEqual([day1VaultId]);

    const decision = await pendingDecision(`${fx.pkg.packageCode}:T3:D1`);
    expect(decision).toMatchObject({ status: "RESOLVED", resolvedBy: ALEX.id });
    expect((await readDocument(day1VaultId))!.doc.verificationStatus).toBe("VERIFIED");

    const r = await rates(fx.pkg.id);
    expect(r.get(order[2])).toBe(50);
    expect(r.get(order[5])).toBe(25);
    const [{ n }] = await rows<{ n: number }>(db(), sql`select count(*)::int as n from tpms.audit_ledger
      where reason_code = 'ATTENDANCE_OVERRIDE' and metadata_diff ->> 'package_id' = ${fx.pkg.id}`);
    expect(n).toBe(3);
    const overrides = (await records(fx.pkg.id, 1)).filter((x) => x.track === "MANUAL_OVERRIDE");
    expect(overrides.every((o) => o.resolvedBy === ALEX.id && o.resolvedAt)).toBe(true);
  });

  it("a clean Day 2 scan verifies itself with no decision", async () => {
    const template = await readDocument(templates[1].id);
    const all = [0, 1, 2, 3, 4, 5].flatMap((row) => [[row, "AM"], [row, "PM"]] as Array<[number, "AM" | "PM"]>);
    const scan = await synthesizeT3Scan(new Uint8Array(template!.bytes), { signed: all, rotateDeg: -1.5, noise: 0.02, seed: 5 });
    const upload = await uploadT3Scan(fx.pkg.id, 2, scan, "image/png", "day2.png", ALEX);
    const summary = (await runOcrTask(upload.vaultId)) as Record<string, unknown>;
    expect(summary).toMatchObject({ status: "VERIFIED", records: 12, present: 12, exceptions: 0 });
    expect(await pendingDecision(`${fx.pkg.packageCode}:T3:D2`)).toBeUndefined();
    expect((await readDocument(upload.vaultId))!.doc.verificationStatus).toBe("VERIFIED");

    const r = await rates(fx.pkg.id);
    expect(r.get(order[0])).toBe(100);
    expect(r.get(order[2])).toBe(100);
    expect(r.get(order[5])).toBe(75);

    const snapshot = await loadSnapshot(db(), fx.pkg.id);
    expect(snapshot.attendance).toMatchObject({ missingSlots: 0, openReviews: 0, complete: 6 });
  });

  it("attendanceMatrix shows the effective state, track and open reviews per slot", async () => {
    const matrix = await attendanceMatrix(fx.pkg.id);
    expect(matrix.totals).toEqual({ slots: 24, recorded: 24, missing: 0, openReviews: 0 });
    expect(matrix.dates).toEqual([fx.pkg.startDate, fx.pkg.endDate]);
    const p2 = matrix.participants.find((p) => p.id === order[2])!;
    const d1am = p2.cells.find((c) => c.slot === "D1-AM")!;
    expect(d1am).toMatchObject({ present: true, track: "MANUAL_OVERRIDE", needsReview: false, tracks: { A_DIGITAL: true, B_OCR: false, MANUAL_OVERRIDE: true } });
    expect(p2.cells.find((c) => c.slot === "D2-PM")).toMatchObject({ present: true, track: "B_OCR" });
    expect(matrix.decisions).toEqual([expect.objectContaining({ subjectRef: `${fx.pkg.packageCode}:T3:D1`, status: "RESOLVED" })]);
  });

  it("renders a digital Form T3 from Track A signatures that the OCR engine reads back", async () => {
    const doc = await renderDigitalT3(fx.pkg.id, 1, ALEX);
    expect(doc).toMatchObject({ documentType: "FORM_T3", verificationStatus: "PENDING" });
    expect(doc.extractedMetadata).toMatchObject({ source: "TRACK_A", dayIndex: 1, signedSlots: 1 });
    const again = await renderDigitalT3(fx.pkg.id, 1, ALEX);
    expect(again.id).toBe(doc.id);

    const pdf = await readDocument(doc.id);
    const parsed = await parseT3(new Uint8Array(pdf!.bytes), "application/pdf");
    const [page] = parsed.pages;
    expect(page.packageId).toBe(fx.pkg.id);
    const signed = page.rows.flatMap((r) => (["am", "pm"] as const).filter((k) => r[k].signed).map((k) => `${r.participantId}:${k}`));
    expect(signed).toEqual([`${order[2]}:am`]);
  });

  it("flags an unreadable upload and surfaces it without retrying", async () => {
    const other = await buildPackageAt("DELIVERY_IN_PROGRESS", { participants: 5 });
    const junk = new Uint8Array(await (await import("node:fs/promises")).readFile("tests/fixtures/photos/no-exif.jpg"));
    const upload = await uploadT3Scan(other.pkg.id, 1, junk, "image/jpeg", "not-a-t3.jpg", ALEX);
    const summary = (await runOcrTask(upload.vaultId)) as Record<string, unknown>;
    expect(summary.status).toBe("UNREADABLE");
    expect((await readDocument(upload.vaultId))!.doc.verificationStatus).toBe("FLAGGED");
    const decision = await pendingDecision(`${other.pkg.packageCode}:T3:D1`);
    const reasons = (decision.payload as { exceptions: Array<{ reason: string }> }).exceptions.map((e) => e.reason);
    expect(reasons).toContain("PAGE_UNREADABLE");
    expect(reasons.filter((r) => r === "NOT_RECORDED")).toHaveLength(10); // 5 participants x AM/PM still unrecorded

    // A participant missing from the sheet is fixed by hand, and that settles the day.
    for (const participantId of other.participantIds) {
      for (const session of ["AM", "PM"] as const) {
        await setManualAttendance({ packageId: other.pkg.id, participantId, dayIndex: 1, session, present: true, note: "Paper sheet illegible; trainer register" }, ALEX);
      }
    }
    expect((await pendingDecision(`${other.pkg.packageCode}:T3:D1`)).status).toBe("RESOLVED");
  });

  it("a check-in after the scan turns an unsigned reading into a Track disagreement", async () => {
    const late = await buildPackageAt("DELIVERY_IN_PROGRESS", { participants: 5 });
    const [template] = await generateT3Templates(late.pkg.id, ALEX);
    const rowOrder = template.extractedMetadata.participantIds as string[];
    const everyoneButRow0Am = [0, 1, 2, 3, 4].flatMap((row) => [[row, "AM"], [row, "PM"]] as Array<[number, "AM" | "PM"]>).filter(([r, s]) => !(r === 0 && s === "AM"));
    const scan = await synthesizeT3Scan(new Uint8Array((await readDocument(template.id))!.bytes), { signed: everyoneButRow0Am, seed: 8 });
    const upload = await uploadT3Scan(late.pkg.id, 1, scan, "image/png", "late.png", ALEX);
    await runOcrTask(upload.vaultId);
    const subject = `${late.pkg.packageCode}:T3:D1`;
    const before = (await pendingDecision(subject)).payload as { exceptions: Array<{ reason: string }> };
    expect(before.exceptions.map((e) => e.reason)).toEqual(["UNSIGNED"]);

    const link = (await issueParticipantLinks(late.pkg.id)).find((l) => l.participantId === rowOrder[0])!;
    await recordCheckIn({ token: link.checkin!.token, dayIndex: 1, session: "AM", signatureSvgPath: SIGNATURE, now: new Date(`${late.pkg.startDate}T11:00:00+08:00`) });
    const after = (await pendingDecision(subject)).payload as { exceptions: Array<{ reason: string; trackAPresent: boolean }> };
    expect(after.exceptions).toEqual([expect.objectContaining({ reason: "TRACK_DISAGREEMENT", trackAPresent: true })]);

    // The operator sides with the signature; the day settles and the sheet verifies.
    const open = (await records(late.pkg.id, 1)).filter((r) => r.needsReview && !r.resolvedAt);
    const outcome = await resolveAttendanceException(open.map((r) => r.id), { present: true, note: "Signed on phone; paper cell missed" }, ALEX);
    expect(outcome.decisions).toEqual([expect.objectContaining({ status: "RESOLVED" })]);
    expect(outcome.verifiedSheets).toEqual([upload.vaultId]);
  });

  it("refuses uploads it cannot accept", async () => {
    await expect(uploadT3Scan(fx.pkg.id, 3, new Uint8Array([1]), "image/png", "x.png", ALEX)).rejects.toMatchObject({ code: "INVALID_DAY" });
    await expect(uploadT3Scan(fx.pkg.id, 1, new Uint8Array([1]), "text/plain", "x.txt", ALEX)).rejects.toBeInstanceOf(DomainError);
    const early = await buildPackageAt("GRANT_APPROVED");
    await expect(uploadT3Scan(early.pkg.id, 1, new Uint8Array([1]), "image/png", "x.png", ALEX)).rejects.toMatchObject({ code: "T3_UPLOAD_NOT_ALLOWED" });
  });
});
