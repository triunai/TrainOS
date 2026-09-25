import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayMY } from "@/lib/dates";
import {
  attendanceDesk,
  attendanceMatrix,
  buildAttendanceWorkbook,
  cellText,
  columnLetter,
  dayOfDelivery,
  shortDay,
  evidenceTaskStates,
  issueParticipantLinks,
  linkIssuanceSummary,
  revokeToken,
  t3DaysCovered,
  verifyQuizToken,
} from "@/server/attendance";
import { db, schema } from "@/server/db/client";
import { enqueue } from "@/server/queue/queue";
import { storeDocument } from "@/server/storage/vault";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt, type LifecycleFixture } from "../helpers/lifecycle";

/**
 * UI lane 1 read models: the cross-package attendance desk, the per-package
 * evidence task states, the link issuance summary, the Univer exception-grid
 * snapshot and the /q/ token resolver.
 */
const bytes = (label: string) => new TextEncoder().encode(`%PDF-1.4\n% ui-1 ${label} ${Math.random()}\n%%EOF\n`);

async function doc(packageId: string, documentType: string, status: "PENDING" | "VERIFIED" | "FLAGGED", metadata: Record<string, unknown> = {}) {
  return storeDocument(db(), {
    packageId, documentType, fileName: `${documentType.toLowerCase()}.pdf`, mimeType: "application/pdf",
    bytes: bytes(documentType), uploadedBy: ALEX.id, verificationStatus: status, extractedMetadata: metadata,
  });
}

let live: LifecycleFixture;
let completed: LifecycleFixture;
let claimReady: LifecycleFixture;
let locked: LifecycleFixture;
let scanId: string;
let flaggedPhotoId: string;

beforeAll(async () => {
  await useTestDatabase();
  live = await buildPackageAt("DELIVERY_IN_PROGRESS", { participants: 5 });
  completed = await buildPackageAt("DELIVERY_COMPLETED", { participants: 5 });
  claimReady = await buildPackageAt("CLAIM_READY", { participants: 5 });
  locked = await buildPackageAt("OPERATIONS_LOCKED");

  const [p0, p1, p2] = live.participantIds;
  // Day 1: p0 AM+PM digital, p1 AM digital, p2 AM read by OCR with low confidence (open review).
  for (const [participantId, session] of [[p0, "AM"], [p0, "PM"], [p1, "AM"]] as const) {
    await db().insert(schema.attendanceRecords).values({ packageId: live.pkg.id, participantId, dayIndex: 1, session, track: "A_DIGITAL", present: true, signedAt: new Date() });
  }
  await db().insert(schema.attendanceRecords).values({
    packageId: live.pkg.id, participantId: p2, dayIndex: 1, session: "AM", track: "B_OCR", present: true,
    ocrConfidence: "0.520", needsReview: true, reviewReason: "LOW_CONFIDENCE",
  });
  await doc(live.pkg.id, "FORM_T3_TEMPLATE", "PENDING", { kind: "T3_TEMPLATE", dayIndex: 1 });
  await doc(live.pkg.id, "FORM_T3_TEMPLATE", "PENDING", { kind: "T3_TEMPLATE", dayIndex: 2 });
  const scan = await doc(live.pkg.id, "FORM_T3", "PENDING", { source: "TRACK_B_SCAN", declaredDayIndex: 1, ocr: { status: "EXCEPTIONS", days: [1] } });
  scanId = scan.id;
  await doc(live.pkg.id, "FORM_T3", "FLAGGED", { source: "TRACK_B_SCAN", declaredDayIndex: 2, ocr: { status: "UNREADABLE", days: [] } });
  await doc(live.pkg.id, "PHOTO_EVIDENCE", "VERIFIED", { reasons: [] });
  flaggedPhotoId = (await doc(live.pkg.id, "PHOTO_EVIDENCE", "FLAGGED", { reasons: ["TOO_FAR"] })).id;
  await enqueue(db(), { type: "attendance.ocr_t3", payload: { packageId: live.pkg.id, vaultId: scan.id }, idempotencyKey: `ui1:${scan.id}` });
  await enqueue(db(), { type: "evidence.photo_exif", payload: { packageId: live.pkg.id, vaultId: flaggedPhotoId }, idempotencyKey: `ui1:${flaggedPhotoId}` });
}, 120_000);

afterAll(releaseTestDatabase);

describe("attendanceDesk", () => {
  it("lists delivery-stage packages whose claim is not assembled yet, and nothing else", async () => {
    const desk = await attendanceDesk();
    const codes = desk.map((r) => r.packageCode);
    expect(codes).toContain(live.pkg.packageCode);
    expect(codes).toContain(completed.pkg.packageCode); // DELIVERY_COMPLETED + CLAIM_NOT_READY
    expect(codes).not.toContain(claimReady.pkg.packageCode); // CLAIM_READY belongs to the claims desk
    expect(codes).not.toContain(locked.pkg.packageCode); // not yet in delivery
  });

  it("counts slots, reviews, photos and Form T3 coverage the way the guard does", async () => {
    const row = (await attendanceDesk()).find((r) => r.packageCode === live.pkg.packageCode)!;
    expect(row).toMatchObject({
      operationalStage: "DELIVERY_IN_PROGRESS",
      financialStage: "GRANT_RESERVED",
      days: 2,
      participants: 5,
      slots: { expected: 20, recorded: 4, missing: 16, overdue: 0 },
      openReviews: 1,
      photos: { total: 2, verified: 1, flagged: 1, pending: 0 },
      t3: { templates: 2, daysCovered: [1], scans: 2, digital: 0, verified: 0, pending: 1, flagged: 1, ocrInFlight: 1 },
    });
    const done = (await attendanceDesk()).find((r) => r.packageCode === completed.pkg.packageCode)!;
    expect(done.slots).toEqual({ expected: 20, recorded: 20, missing: 0, overdue: 0 });
    expect(done.openReviews).toBe(0);
  });

  it("counts a slot overdue only once its training day is over", async () => {
    const start = live.pkg.startDate!;
    const at = async (today: string) => (await attendanceDesk({ today })).find((r) => r.packageCode === live.pkg.packageCode)!;
    expect((await at(start)).slots.overdue).toBe(0); // day 1 still running
    expect((await at(addDays(start, 1))).slots.overdue).toBe(10 - 4); // day 1 over: 5 pax x 2 sessions, 4 recorded
    expect((await at(addDays(start, 9))).slots.overdue).toBe(16); // both days over
    expect((await at(addDays(start, 1))).dayOfDelivery).toBe(2);
  });

  it("places today on the delivery calendar", () => {
    expect(dayOfDelivery("2026-09-25", 3, "2026-09-24")).toBe(0);
    expect(dayOfDelivery("2026-09-25", 3, "2026-09-25")).toBe(1);
    expect(dayOfDelivery("2026-09-25", 3, "2026-09-27")).toBe(3);
    expect(dayOfDelivery("2026-09-25", 3, "2026-10-02")).toBe(4);
    expect(dayOfDelivery(null, 3, "2026-09-25")).toBeNull();
    expect(dayOfDelivery(todayMY(), 2, addDays(todayMY(), 1))).toBe(2);
  });

  it("reads the days a Form T3 covers from its own metadata, and nothing from an unknown source", () => {
    expect(t3DaysCovered({ source: "TRACK_A", dayIndex: 2 })).toEqual([2]);
    expect(t3DaysCovered({ source: "TRACK_B_SCAN", declaredDayIndex: 1 })).toEqual([1]);
    expect(t3DaysCovered({ source: "TRACK_B_SCAN", declaredDayIndex: 1, ocr: { days: [1, 2] } })).toEqual([1, 2]);
    expect(t3DaysCovered({ source: "SOMETHING_NEW", dayIndex: 1 })).toEqual([]);
  });
});

describe("evidenceTaskStates", () => {
  it("returns the latest OCR / EXIF task per uploaded document", async () => {
    const states = await evidenceTaskStates(live.pkg.id);
    expect(states.get(scanId)).toMatchObject({ taskType: "attendance.ocr_t3", status: "QUEUED", attempts: 0 });
    expect(states.get(flaggedPhotoId)).toMatchObject({ taskType: "evidence.photo_exif", status: "QUEUED" });
    expect((await evidenceTaskStates(completed.pkg.id)).size).toBe(0);
  });
});

describe("linkIssuanceSummary", () => {
  it("counts live personal links by purpose and follows revocation", async () => {
    expect(await linkIssuanceSummary(locked.pkg.id)).toMatchObject({ live: { CHECKIN: 0, QUIZ_PRE: 0, QUIZ_POST: 0 }, lastIssuedAt: null });
    const links = await issueParticipantLinks(live.pkg.id);
    const summary = await linkIssuanceSummary(live.pkg.id);
    expect(summary.live).toEqual({ CHECKIN: 5, QUIZ_PRE: 5, QUIZ_POST: 5 });
    expect(summary.lastIssuedAt).not.toBeNull();
    await revokeToken(links[0].checkin!.jti, ALEX);
    const after = await linkIssuanceSummary(live.pkg.id);
    expect(after.live.CHECKIN).toBe(4);
    expect(after.revoked).toBe(1);
  });
});

describe("verifyQuizToken", () => {
  it("resolves a pre- or post-quiz link to its verified claims and refuses anything else", async () => {
    const links = await issueParticipantLinks(live.pkg.id);
    const pre = await verifyQuizToken(links[1].quizPre!.token);
    expect(pre).toMatchObject({ purpose: "QUIZ_PRE", packageId: live.pkg.id, participantId: links[1].participantId });
    // The post-quiz window opens on the last training day (30 days out in this fixture).
    await expect(verifyQuizToken(links[1].quizPost!.token)).rejects.toMatchObject({ code: "LINK_NOT_YET_VALID" });
    const onLastDay = await verifyQuizToken(links[1].quizPost!.token, { now: new Date(`${live.pkg.endDate}T10:00:00+08:00`) });
    expect(onLastDay.purpose).toBe("QUIZ_POST");
    await expect(verifyQuizToken(links[1].checkin!.token)).rejects.toMatchObject({ code: "LINK_INVALID" });
    await expect(verifyQuizToken("not-a-jwt-at-all-but-long-enough")).rejects.toMatchObject({ code: "LINK_INVALID" });
    const tampered = `${links[1].quizPre!.token.slice(0, -4)}AAAA`;
    await expect(verifyQuizToken(tampered)).rejects.toMatchObject({ code: "LINK_INVALID" });
  });
});

describe("buildAttendanceWorkbook", () => {
  it("lays participants down and day x session across, flagging the slots under review", async () => {
    const matrix = await attendanceMatrix(live.pkg.id);
    const book = buildAttendanceWorkbook(matrix);
    expect(book.rows).toBe(6);
    expect(book.columns).toBe(3 + 4 + 1);
    const sheet = (book.snapshot.sheets as Record<string, { cellData: Record<number, Record<number, { v: string }>> }>).attendance;
    expect(sheet.cellData[0][1].v).toBe("Rate");
    expect(sheet.cellData[0][3].v).toMatch(/^D1 AM/);
    expect(sheet.cellData[0][6].v).toBe("D2 PM");
    expect(sheet.cellData[0][7].v).toBe("NRIC");

    const p2 = live.participantIds[2];
    const address = book.cellOf[`${p2}:1:AM`];
    expect(book.flaggedCells).toEqual([address]);
    const rowIndex = matrix.participants.findIndex((p) => p.id === p2) + 1;
    expect(address).toBe(`D${rowIndex + 1}`);
    expect(sheet.cellData[rowIndex][3].v).toBe("⚑ ✓ B 52%");
    const p0Row = matrix.participants.findIndex((p) => p.id === live.participantIds[0]) + 1;
    expect(sheet.cellData[p0Row][4].v).toBe("✓ A");
    expect(sheet.cellData[p0Row][5].v).toBe("—");
    expect(sheet.cellData[p0Row][7].v).toMatch(/^\*{6}-\*\*-\d{4}$/);
  });

  it("spells every cell state and column the same way", () => {
    const base = { dayIndex: 1, session: "AM" as const, slot: "D1-AM", reviewReasons: [], openRecordIds: [], tracks: {} };
    expect(cellText({ ...base, present: false, track: "MANUAL_OVERRIDE", needsReview: false, confidence: 0.4 })).toBe("✗ M");
    expect(cellText({ ...base, present: false, track: "B_OCR", needsReview: true, confidence: 0.91 })).toBe("⚑ ✗ B 91%");
    expect(cellText({ ...base, present: null, track: null, needsReview: false, confidence: null })).toBe("—");
    expect([0, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA"]);
    expect(shortDay("2026-09-05")).toBe("5 Sep");
  });
});
