import { eq, sql } from "drizzle-orm";
import {
  type Session,
  generateT3Templates,
  identifyBySessionQr,
  issueSessionQr,
  recordCheckIn,
  renderDigitalT3,
  resolveAttendanceException,
  setManualAttendance,
  uploadT3Scan,
  verifyToken,
} from "@/server/attendance";
import { verifyCertificate, verificationUrl } from "@/server/certificates";
import { verifyEvidence } from "@/server/claims";
import { db, rows, schema } from "@/server/db/client";
import type { VaultDocument } from "@/server/db/schema";
import { env } from "@/server/env";
import { serviceHealth, synthesizeT3Scan } from "@/server/extraction/client";
import { uploadSessionPhoto } from "@/server/extraction/photoExif";
import { completeDelivery } from "@/server/operations/viability";
import { loadSnapshot } from "@/server/packages/snapshot";
import { readDocument } from "@/server/storage/vault";
import { allHandlers } from "../../../../worker/handlers";
import {
  DEMO_ACTORS,
  type GoldenPathContext,
  type Recorder,
  type StepMap,
  USER_AGENT,
  at,
  plusMinutes,
  run,
  sitQuiz,
  vaultOf,
} from "../context";
import { buildExifJpeg, trainingRoomScene } from "../exifJpeg";
import { lastFour, signaturePath } from "../people";
import { GoldenPathError, runAllQueued } from "../tasks";

/**
 * Stage 5 — delivery: Track A check-ins (magic links and the room display's
 * session QR), Track B (the Form T3 scan read by OCR, or the digital T3 when
 * the extraction service is not there), the exception desk, session photos
 * with EXIF, the POST quiz, and the verified completion with certificates
 * and the retention schedule.
 */
export const DELIVERY_STEPS = {
  async "attendance.day1"(ctx: GoldenPathContext, rec: Recorder) {
    await checkInDays(ctx, rec, [1]);
  },

  async "t3.day1"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const templates = await generateT3Templates(packageId, DEMO_ACTORS.ops);
    rec.expect(templates.length === ctx.scenario.days, `expected ${ctx.scenario.days} Form T3 templates, got ${templates.length}`);
    rec.note(`${templates.length} FORM_T3_TEMPLATE(s) printed (QR + fiducials per page)`);
    await probeOcr(ctx);
    if (!ctx.ocr.available) {
      rec.note(`Track B SKIPPED: ${ctx.ocr.detail}; attendance evidence falls back to the digital T3 (Track A)`);
      return;
    }
    const day1 = templates.find((t) => t.extractedMetadata.dayIndex === 1) as VaultDocument;
    const order = day1.extractedMetadata.participantIds as string[];
    const present = await digitalPresence(packageId, 1);
    const signed: Array<[number, Session]> = [];
    order.forEach((participantId, row) => {
      for (const s of ["AM", "PM"] as const) if (present.has(`${participantId}:${s}`)) signed.push([row, s]);
    });
    const template = await readDocument(day1.id);
    const scan = await synthesizeT3Scan(new Uint8Array(template!.bytes), { signed, rotateDeg: 1.2, perspective: 0.006, noise: 0.02, seed: 17 });
    const upload = await uploadT3Scan(packageId, 1, scan, "image/png", `${ctx.packageCode}-T3-D1-scan.png`, DEMO_ACTORS.ops);
    rec.id("t3Scan", upload.vaultId);
    rec.note(`Day 1 paper register synthesised by the dev service to match Track A (${signed.length} of ${order.length * 2} cells signed) and uploaded`);
    const t = rec.task(await run(rec, "attendance.ocr_t3", { packageId, vaultId: upload.vaultId }));
    const r = t.result as { status: string; records: number; present: number; engine: string | null; reviews: Record<string, number>; exceptions: number };
    rec.expect(r.status === "VERIFIED" || r.status === "EXCEPTIONS", `the T3 scan was ${r.status}`, { result: r });
    rec.expect(r.records === order.length * 2, `OCR read ${r.records} cells, expected ${order.length * 2}`);
    const reviews = Object.entries(r.reviews ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k} x${n}`);
    rec.note(`OCR (${r.engine}): ${r.present}/${r.records} present, ${r.status}${reviews.length ? `; exceptions: ${reviews.join(", ")}` : ""}`);
    if (r.status === "VERIFIED") ctx.scannedDays.set(1, upload.vaultId);
  },

  async "t3.resolve"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const open = await rows<{ id: string; participant_id: string; day_index: number; session: Session; review_reason: string }>(
      db(),
      sql`select id, participant_id, day_index, session, review_reason from tpms.attendance_records
           where package_id = ${packageId}::uuid and needs_review and resolved_at is null`,
    );
    if (open.length > 0) {
      const presence = new Map<number, Set<string>>();
      for (const day of new Set(open.map((o) => o.day_index))) presence.set(day, await digitalPresence(packageId, day));
      const yes = open.filter((o) => presence.get(o.day_index)?.has(`${o.participant_id}:${o.session}`));
      const no = open.filter((o) => !presence.get(o.day_index)?.has(`${o.participant_id}:${o.session}`));
      const absentee = ctx.scenario.absentee;
      if (yes.length) {
        await resolveAttendanceException(yes.map((o) => o.id), { present: true, note: "Confirmed present: Track A e-signature for the slot; trainer's register agrees" }, DEMO_ACTORS.ops);
        rec.note(`${yes.length} exception(s) resolved PRESENT (Track A signature on record)`);
      }
      if (no.length) {
        await resolveAttendanceException(no.map((o) => o.id), { present: false, note: absentee?.reason ?? "Confirmed absent with the trainer" }, DEMO_ACTORS.ops);
        rec.note(`${no.length} exception(s) resolved ABSENT: "${absentee?.reason ?? "confirmed absent"}"`);
      }
      const scan = (await vaultOf(packageId, "FORM_T3")).find((d) => d.extractedMetadata.source === "TRACK_B_SCAN");
      if (scan) {
        const [after] = await db().select().from(schema.complianceVault).where(eq(schema.complianceVault.id, scan.id));
        rec.expect(after.verificationStatus === "VERIFIED", `the Day 1 scan should verify once every exception is resolved (${after.verificationStatus})`);
        ctx.scannedDays.set(1, scan.id);
      }
    } else {
      rec.note("no open attendance exceptions");
    }
    const snapshot = await loadSnapshot(db(), packageId);
    rec.expect(snapshot.attendance.openReviews === 0, `${snapshot.attendance.openReviews} attendance exceptions still open`);
  },

  async "attendance.rest"(ctx: GoldenPathContext, rec: Recorder) {
    const days = Array.from({ length: ctx.scenario.days - 1 }, (_, i) => i + 2);
    if (days.length) await checkInDays(ctx, rec, days);
    const packageId = ctx.pkgId(rec.step);
    const a = ctx.scenario.absentee;
    if (a) {
      // A slot no paper sheet covered has no record at all; the operator records the absence
      // by hand so it is "absent", not "missing" (DELIVERY_VERIFIED_SUCCESS refuses missing slots).
      const who = ctx.roster[a.index];
      const [recorded] = await rows<{ n: number }>(
        db(),
        sql`select count(*)::int as n from tpms.v_attendance_effective
             where participant_id = ${who.participantId}::uuid and day_index = ${a.day} and session = ${a.session}`,
      );
      if (recorded.n === 0) {
        await setManualAttendance({ packageId, participantId: who.participantId, dayIndex: a.day, session: a.session, present: false, note: a.reason }, DEMO_ACTORS.ops);
        rec.note(`no Track B sheet for D${a.day}: ${who.fullName}'s absence on D${a.day}-${a.session} recorded by hand ("${a.reason}")`);
      }
    }
    const snapshot = await loadSnapshot(db(), packageId);
    rec.expect(snapshot.attendance.missingSlots === 0, `${snapshot.attendance.missingSlots} AM/PM slots are unrecorded`);
    const rates = await db()
      .select({ id: schema.packageParticipants.id, rate: schema.packageParticipants.attendanceRate, eligible: schema.packageParticipants.hrdClaimEligible })
      .from(schema.packageParticipants)
      .where(eq(schema.packageParticipants.packageId, packageId));
    const below = rates.filter((r) => !r.eligible);
    const expectedBelow = ctx.scenario.absentee ? 1 : 0;
    rec.expect(below.length === expectedBelow, `expected ${expectedBelow} participant(s) below 80%, found ${below.length}`);
    rec.note(`attendance complete: ${rates.length - below.length}/${rates.length} at >= 80%${below.length ? `; ${below.map((b) => `${Number(b.rate)}%`).join(", ")} not claimable` : ""}`);
  },

  async "t3.digital"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    for (let day = 1; day <= ctx.scenario.days; day += 1) {
      if (ctx.scannedDays.has(day)) continue;
      const doc = await renderDigitalT3(packageId, day, DEMO_ACTORS.ops);
      const verdict = await verifyEvidence(doc.id, { status: "VERIFIED", notes: `Digital Form T3 for Day ${day} checked against the Track A register` }, DEMO_ACTORS.ops);
      rec.expect(verdict.doc.verificationStatus === "VERIFIED", `digital T3 day ${day} not verified`);
      rec.id(`t3Day${day}`, doc.id);
      rec.note(`Day ${day}: digital FORM_T3 rendered from ${String(doc.extractedMetadata.signedSlots)} Track A signatures, verified by ${DEMO_ACTORS.ops.id}`);
    }
  },

  async photos(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const [venue] = await rows<{ name: string; latitude: string | null; longitude: string | null }>(
      db(),
      sql`select v.name, v.latitude, v.longitude from tpms.vendor_commitments c join tpms.vendors v on v.id = c.vendor_id
           where c.package_id = ${packageId}::uuid and c.vendor_type = 'VENUE' and c.status <> 'CANCELLED' limit 1`,
    );
    rec.expect(venue?.latitude && venue.longitude, "the booked venue has no coordinates to photograph at");
    const lat = Number(venue.latitude);
    const lng = Number(venue.longitude);
    const shots = [
      { day: 1, time: "10:32:05", dLat: 0.00021, dLng: 0.00022, variant: 0 },
      { day: ctx.scenario.days, time: "15:05:40", dLat: -0.00014, dLng: 0.00031, variant: 1 },
    ];
    for (const [i, shot] of shots.entries()) {
      const date = ctx.dayDate(shot.day);
      const jpeg = buildExifJpeg({ lat: lat + shot.dLat, lng: lng + shot.dLng, takenAt: `${date}T${shot.time}`, offset: "+08:00", scene: trainingRoomScene(shot.variant), model: "Demo session camera" });
      const upload = await uploadSessionPhoto(packageId, jpeg, "image/jpeg", `${ctx.packageCode}-D${shot.day}-session-${i + 1}.jpg`, DEMO_ACTORS.ops);
      const t = rec.task(await run(rec, "evidence.photo_exif", { packageId, vaultId: upload.vaultId }));
      rec.expect(t.result.status === "VERIFIED", `photo ${i + 1} was ${String(t.result.status)} (${JSON.stringify(t.result.reasons)})`);
      rec.id(`photo${i + 1}`, upload.vaultId);
      rec.note(`photo ${i + 1}: EXIF ${date} ${shot.time} +08:00, ${String(t.result.distanceKm)} km from ${venue.name} -> VERIFIED`);
    }
  },

  async "quiz.post"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    let total = 0;
    let deltas = 0;
    const now = at(ctx.endDate, "16:40");
    for (const p of ctx.roster) {
      const link = ctx.links.get(p.participantId);
      rec.expect(link?.quizPost, `no POST quiz link for ${p.fullName}`);
      const claims = await verifyToken(link.quizPost.token, "QUIZ_POST", { now: plusMinutes(now, p.index) });
      rec.expect(claims.participantId === p.participantId, "the POST link resolves to someone else");
      const sat = await sitQuiz(packageId, p.participantId, "POST", 7 + (p.index % 4), 4 + (p.index % 2));
      total += sat.score;
      deltas += sat.delta ?? 0;
    }
    rec.note(`POST quiz on the last day (link valid from ${ctx.endDate} 00:00; submitted with now=${ctx.endDate} 16:40+): mean ${(total / ctx.roster.length).toFixed(1)}%, mean gain +${(deltas / ctx.roster.length).toFixed(1)} pts`);
  },

  async "delivery.complete"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const outcome = await completeDelivery(packageId, DEMO_ACTORS.ops);
    rec.expect(outcome.pkg.operationalStage === "DELIVERY_COMPLETED" && outcome.pkg.financialStage === "CLAIM_NOT_READY", "expected DELIVERY_COMPLETED + CLAIM_NOT_READY");
    if (ctx.scenario.absentee) {
      rec.expect(outcome.warnings.some((w) => w.code === "SOME_BELOW_80"), "a participant below 80% should raise the SOME_BELOW_80 warning");
    }
    const certs = rec.task(await run(rec, "certificates.issue", { packageId }));
    const serials = (certs.result.serials as string[]) ?? [];
    const expected = ctx.roster.length - (ctx.scenario.absentee ? 1 : 0);
    rec.expect(serials.length === expected, `expected ${expected} certificates, issued ${serials.length}`);
    ctx.certificates = [];
    for (const serial of serials) {
      const v = await verifyCertificate(serial);
      rec.expect(v.status === "VALID", `certificate ${serial} verifies as ${v.status}`);
      ctx.certificates.push({ serial, holder: v.holderName, status: v.status, url: verificationUrl(env().TPMS_PUBLIC_BASE_URL, serial) });
    }
    rec.note(`${serials.length} certificates issued and verified VALID (file, payload and ledger anchors); ${String(certs.result.skipped)} skipped below 80%`);
    const retention = rec.task(await run(rec, "retention.schedule", { packageId }));
    const schedules = (retention.result.schedules as Array<{ cadenceType: string; scheduledFor: string }>) ?? [];
    rec.expect(schedules.length === 3, `expected three retention cadences, got ${schedules.length}`);
    rec.note(`retention scheduled: ${schedules.map((s) => `${s.cadenceType} ${s.scheduledFor}`).join(", ")}`);
    const collated = await runAllQueued("claims.collate", { packageId }, { step: rec.step, handlers: allHandlers });
    for (const c of collated) rec.task(c);
    const last = collated.at(-1)?.result as { ready?: boolean; checklist?: { missing: string[] } } | undefined;
    rec.expect(last && last.ready === false, "the first collation should find evidence still missing");
    rec.note(`first collation: not ready, missing ${last.checklist?.missing.join(", ")}`);
  },
} satisfies StepMap;

/** `participantId:SESSION` for every Track A presence on one day. */
async function digitalPresence(packageId: string, day: number): Promise<Set<string>> {
  const list = await rows<{ participant_id: string; session: string }>(
    db(),
    sql`select participant_id, session from tpms.attendance_records
         where package_id = ${packageId}::uuid and day_index = ${day} and track = 'A_DIGITAL' and present`,
  );
  return new Set(list.map((r) => `${r.participant_id}:${r.session}`));
}

/**
 * Track A check-ins, with `now` inside each session's window. One participant
 * uses the room display's session QR instead of their emailed link; the
 * scenario's absentee skips one session.
 */
async function checkInDays(ctx: GoldenPathContext, rec: Recorder, days: number[]): Promise<void> {
  const packageId = ctx.pkgId(rec.step);
  const { absentee, sessionQr } = ctx.scenario;
  let count = 0;
  for (const day of days) {
    const date = ctx.dayDate(day);
    for (const session of ["AM", "PM"] as const) {
      const opens = at(date, session === "AM" ? "08:40" : "14:05");
      let qr: Awaited<ReturnType<typeof issueSessionQr>> | null = null;
      for (const p of ctx.roster) {
        if (absentee && absentee.index === p.index && absentee.day === day && absentee.session === session) continue;
        const now = plusMinutes(opens, 2 + p.index);
        const signatureSvgPath = signaturePath(p.index * 10 + day * 2 + (session === "PM" ? 1 : 0));
        let token = ctx.links.get(p.participantId)?.checkin?.token;
        if (sessionQr && sessionQr.index === p.index && sessionQr.day === day && sessionQr.session === session) {
          qr ??= await issueSessionQr(packageId, day, session, { now: opens });
          const context = await identifyBySessionQr(qr.token, { participantId: p.participantId, nricLast4: lastFour(p) }, { now });
          token = context.token;
          rec.note(`${p.fullName} checked in at the room display: session QR -> name + last 4 of NRIC -> one-time D${day}-${session} link`);
        }
        if (!token) throw new GoldenPathError(rec.step, `no check-in link for ${p.fullName}`);
        const result = await recordCheckIn({ token, dayIndex: day, session, signatureSvgPath, userAgent: USER_AGENT, ip: `10.20.${day}.${p.index + 10}`, now });
        rec.expect(!result.alreadySigned, `${p.fullName} D${day}-${session} was already signed`);
        count += 1;
      }
      if (absentee && absentee.day === day && absentee.session === session) {
        rec.note(`${ctx.roster[absentee.index].fullName} did not sign D${day}-${session} (${absentee.reason})`);
      }
    }
  }
  rec.note(`${count} Track A e-signatures on day${days.length > 1 ? "s" : ""} ${days.join(", ")}, each with now inside its session window (from ${ctx.dayDate(days[0])} 08:42 / 14:07 MYT)`);
}

async function probeOcr(ctx: GoldenPathContext): Promise<void> {
  if (ctx.ocr.probed) return;
  try {
    const health = await serviceHealth();
    ctx.ocr = health.dev
      ? { available: true, detail: `extraction service ${health.version} at ${env().PADDLEOCR_URL} (template grid${health.engines.paddleocr ? " + PaddleOCR" : ""})`, probed: true }
      : { available: false, detail: `extraction service at ${env().PADDLEOCR_URL} is up but not in dev mode (no scan synthesiser)`, probed: true };
  } catch (error) {
    // Unreachable (or refusing /health): Track B is skipped and the log says so.
    ctx.ocr = { available: false, detail: error instanceof Error ? error.message.slice(0, 160) : `extraction service unreachable at ${env().PADDLEOCR_URL}`, probed: true };
  }
}
