import { and, eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { db, rows, schema } from "@/server/db/client";
import type { Task } from "@/server/db/schema";
import { claimDue } from "@/server/queue/queue";
import {
  checkInContext,
  handlers,
  identifyBySessionQr,
  issueParticipantLinks,
  issueSessionQr,
  recordCheckIn,
  revokeToken,
  sessionQrRoster,
  verifyToken,
} from "@/server/attendance";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt, type LifecycleFixture } from "../helpers/lifecycle";

const SIGNATURE = "M 10 40 C 30 5, 60 5, 80 40 S 130 75, 150 40 L 170 30 L 190 45";
const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);

describe("Track A — magic links, session QR and digital check-in", () => {
  let fx: LifecycleFixture;
  let links: Awaited<ReturnType<typeof issueParticipantLinks>>;
  let start: string;
  let end: string;

  beforeAll(async () => {
    await useTestDatabase();
    fx = await buildPackageAt("DELIVERY_IN_PROGRESS", { participants: 5 });
    start = fx.pkg.startDate as string;
    end = fx.pkg.endDate as string;
  });
  afterAll(releaseTestDatabase);

  const digitalCount = async (participantId: string) => {
    const [{ n }] = await rows<{ n: number }>(db(), sql`select count(*)::int as n from tpms.attendance_records
      where participant_id = ${participantId}::uuid and track = 'A_DIGITAL'`);
    return n;
  };
  const rate = async (participantId: string) => {
    const [p] = await db().select().from(schema.packageParticipants).where(eq(schema.packageParticipants.id, participantId));
    return Number(p.attendanceRate);
  };

  it("issues CHECKIN, QUIZ_PRE and QUIZ_POST links per active participant, idempotently", async () => {
    links = await issueParticipantLinks(fx.pkg.id);
    expect(links).toHaveLength(5);
    for (const l of links) {
      expect(l.checkin?.url).toMatch(/^http:\/\/localhost:3100\/c\/[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(l.quizPre?.url).toContain("/q/");
      expect(l.quizPost?.url).toContain("/q/");
      expect(l.checkin?.expiresAt.toISOString()).toBe(at(addDays(end, 2), "00:00").toISOString());
    }
    const again = await issueParticipantLinks(fx.pkg.id);
    expect(again.map((l) => l.checkin?.url)).toEqual(links.map((l) => l.checkin?.url));
    expect(again.every((l) => l.checkin?.reused && l.quizPre?.reused && l.quizPost?.reused)).toBe(true);
    const [{ n }] = await rows<{ n: number }>(db(), sql`select count(*)::int as n from tpms.magic_link_tokens where package_id = ${fx.pkg.id}::uuid`);
    expect(n).toBe(15);
  });

  it("verifies a valid link and refuses not-yet-valid, expired, tampered, foreign and wrong-purpose ones", async () => {
    const token = links[0].checkin!.token;
    const claims = await verifyToken(token, "CHECKIN", { now: at(start, "09:00") });
    expect(claims).toMatchObject({ packageId: fx.pkg.id, participantId: links[0].participantId, purpose: "CHECKIN", dayIndex: null });

    await expect(verifyToken(token, "CHECKIN", { now: at(addDays(start, -3), "09:00") })).rejects.toMatchObject({ code: "LINK_NOT_YET_VALID" });
    await expect(verifyToken(token, "CHECKIN", { now: at(addDays(end, 3), "09:00") })).rejects.toMatchObject({ code: "LINK_EXPIRED" });

    const [header, payload, signature] = token.split(".");
    const flipped = `${signature.slice(0, -2)}${signature.slice(-2) === "AA" ? "BB" : "AA"}`;
    await expect(verifyToken(`${header}.${payload}.${flipped}`, "CHECKIN")).rejects.toMatchObject({ code: "LINK_INVALID" });
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), sub: links[1].participantId })).toString("base64url");
    await expect(verifyToken(`${header}.${forged}.${signature}`, "CHECKIN")).rejects.toMatchObject({ code: "LINK_INVALID" });
    await expect(verifyToken("not-a-jwt-at-all-just-text", "CHECKIN")).rejects.toMatchObject({ code: "LINK_INVALID" });
    await expect(verifyToken(links[0].quizPre!.token, "CHECKIN")).rejects.toMatchObject({ code: "LINK_INVALID" });

    // Right shape, wrong key.
    const foreign = await new SignJWT({ pid: fx.pkg.id, pur: "CHECKIN" })
      .setProtectedHeader({ alg: "HS256" }).setJti(links[0].checkin!.jti).setSubject(links[0].participantId)
      .setIssuer("agentic-tpms").setAudience("tpms-participant").setIssuedAt().setExpirationTime("1d")
      .sign(new TextEncoder().encode("some-other-secret-that-is-long-enough-0000"));
    await expect(verifyToken(foreign, "CHECKIN")).rejects.toMatchObject({ code: "LINK_INVALID" });
  });

  it("revokes a link (audited) and issues a fresh one on the next run", async () => {
    const victim = links[4];
    await revokeToken(victim.checkin!.jti, ALEX);
    await expect(verifyToken(victim.checkin!.token, "CHECKIN", { now: at(start, "09:00") })).rejects.toMatchObject({ code: "LINK_REVOKED" });
    const [audit] = await rows<{ actor_id: string }>(db(), sql`select actor_id from tpms.audit_ledger
      where reason_code = 'MAGIC_LINK_REVOKED' and entity_id = ${victim.checkin!.jti}::uuid`);
    expect(audit.actor_id).toBe(ALEX.id);
    const reissued = (await issueParticipantLinks(fx.pkg.id)).find((l) => l.participantId === victim.participantId)!;
    expect(reissued.checkin!.reused).toBe(false);
    expect(reissued.checkin!.jti).not.toBe(victim.checkin!.jti);
    await expect(revokeToken("00000000-0000-4000-8000-000000000000", ALEX)).rejects.toMatchObject({ code: "LINK_INVALID" });
  });

  it("records one A_DIGITAL check-in per slot, only while the session is open", async () => {
    const p = links[0];
    const input = { token: p.checkin!.token, dayIndex: 1, session: "AM" as const, signatureSvgPath: SIGNATURE, userAgent: "Mozilla/5.0 test", ip: "198.51.100.7" };
    const first = await recordCheckIn({ ...input, now: at(start, "09:12") });
    expect(first).toMatchObject({ participantName: p.participantName, dayIndex: 1, session: "AM", alreadySigned: false });
    const second = await recordCheckIn({ ...input, now: at(start, "09:40") });
    expect(second.alreadySigned).toBe(true);
    expect(second.signedAt.toISOString()).toBe(at(start, "09:12").toISOString());
    expect(await digitalCount(p.participantId)).toBe(1);
    expect(await rate(p.participantId)).toBe(25); // 1 of 2 days x 2 sessions

    const [record] = await db().select().from(schema.attendanceRecords)
      .where(and(eq(schema.attendanceRecords.participantId, p.participantId), eq(schema.attendanceRecords.track, "A_DIGITAL")));
    expect(record.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.ipHash).not.toContain("198.51");
    expect(record.userAgent).toBe("Mozilla/5.0 test");
    expect(record.signatureData).toBe(SIGNATURE);

    await expect(recordCheckIn({ ...input, now: at(start, "13:05") })).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    await expect(recordCheckIn({ ...input, dayIndex: 2, now: at(start, "09:00") })).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    await expect(recordCheckIn({ ...input, session: "PM", now: at(start, "06:59") })).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    await expect(recordCheckIn({ ...input, dayIndex: 3, now: at(start, "09:00") })).rejects.toMatchObject({ code: "INVALID_DAY" });

    const pm = await recordCheckIn({ ...input, session: "PM", now: at(start, "13:30") });
    expect(pm.alreadySigned).toBe(false);
    expect(await rate(p.participantId)).toBe(50);
  });

  it("refuses a trivial or oversized signature", async () => {
    const base = { token: links[1].checkin!.token, dayIndex: 1, session: "AM" as const, now: at(start, "10:00") };
    await expect(recordCheckIn({ ...base, signatureSvgPath: "M 5 5 L 6 6" })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    await expect(recordCheckIn({ ...base, signatureSvgPath: "<script>alert(1)</script>" })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    const huge = `M 0 0 ${Array.from({ length: 3000 }, (_, i) => `L ${i % 300} ${(i * 7) % 90}`).join(" ")}`;
    await expect(recordCheckIn({ ...base, signatureSvgPath: huge })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    expect(await digitalCount(links[1].participantId)).toBe(0);
  });

  it("shows the check-in page context with the open slot", async () => {
    const context = await checkInContext(links[0].checkin!.token, { now: at(start, "13:45") });
    expect(context.current).toEqual({ dayIndex: 1, session: "PM" });
    expect(context.days).toHaveLength(2);
    expect(context.days[0].sessions.map((s) => s.signed)).toEqual([true, true]);
    expect(context.days[1].sessions.map((s) => s.open)).toEqual([false, false]);
  });

  it("identifies a participant at the room display by the last 4 NRIC digits", async () => {
    const now = at(start, "10:00");
    const qr = await issueSessionQr(fx.pkg.id, 1, "AM", { now });
    expect(qr.url).toMatch(/\/c\/s\/[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(qr.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(qr.expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(20 * 60_000);

    const roster = await sessionQrRoster(qr.token, { now });
    expect(roster.participants).toHaveLength(5);
    expect(JSON.stringify(roster)).not.toMatch(/\*{6}/); // names only, never NRIC

    const target = links[2];
    const last4 = target.nricMasked.slice(-4);
    const wrong = last4 === "0000" ? "1111" : "0000";
    await expect(identifyBySessionQr(qr.token, { participantId: target.participantId, nricLast4: wrong }, { now })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await expect(identifyBySessionQr(qr.token, { participantId: "not-a-uuid", nricLast4: last4 }, { now })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });

    const context = await identifyBySessionQr(qr.token, { participantId: target.participantId, nricLast4: last4 }, { now });
    expect(context).toMatchObject({ participantName: target.participantName, dayIndex: 1, session: "AM" });
    // The one-time context is bound to Day 1 AM.
    await expect(recordCheckIn({ token: context.token, dayIndex: 1, session: "PM", signatureSvgPath: SIGNATURE, now: at(start, "10:01") }))
      .rejects.toMatchObject({ code: "LINK_INVALID" });
    const done = await recordCheckIn({ token: context.token, dayIndex: 1, session: "AM", signatureSvgPath: SIGNATURE, now: at(start, "10:02") });
    expect(done.alreadySigned).toBe(false);
    expect(await digitalCount(target.participantId)).toBe(1);

    await expect(verifyToken(qr.token, "SESSION_QR", { now: new Date(now.getTime() + 21 * 60_000) })).rejects.toMatchObject({ code: "LINK_EXPIRED" });
  });

  it("treats a withdrawn participant's link as revoked", async () => {
    const leaver = links[3];
    await db().update(schema.packageParticipants).set({ registrationStatus: "WITHDRAWN" }).where(eq(schema.packageParticipants.id, leaver.participantId));
    await expect(verifyToken(leaver.checkin!.token, "CHECKIN", { now: at(start, "09:00") })).rejects.toMatchObject({ code: "LINK_REVOKED" });
  });

  it("runs the delivery.issue_magic_links task enqueued at READY_FOR_EVENT", async () => {
    const [task] = (await claimDue("test-worker", 10, 300, ["delivery.issue_magic_links"])).filter(
      (t) => (t.payload as { packageId: string }).packageId === fx.pkg.id,
    ) as Task[];
    expect(task).toBeDefined();
    const result = await handlers["delivery.issue_magic_links"]!(task, { workerId: "test-worker", heartbeat: async () => undefined });
    expect(result.participants).toBe(4); // one withdrew
    expect(result.emailed).toBe(result.toEmail);

    // A second run (the queue retrying after a worker crash) finds every
    // participant already mailed and sends nothing twice.
    const again = await handlers["delivery.issue_magic_links"]!(task, { workerId: "test-worker", heartbeat: async () => undefined });
    expect(again.toEmail).toBe(0);
  });
});
