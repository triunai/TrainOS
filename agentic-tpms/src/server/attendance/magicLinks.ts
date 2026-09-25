import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import QRCode from "qrcode";
import { z } from "zod";
import { addDays, startOfDayMY } from "@/lib/dates";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Executor, db, rows, schema, withTx } from "../db/client";
import type { Task } from "../db/schema";
import { DomainError } from "../domain/errors";
import { env } from "../env";
import { sendMail } from "../messaging/mail";
import { outboundMessages } from "../messaging/schema";
import { safeEqual, sha256Hex } from "../lib/crypto";
import { parsePayload } from "./payload";
import { T3_SUBJECT, loadPackageBrief, promoteSettledSheets, recomputeAttendance, settleDay } from "./records";
import { SESSIONS, type Session, assertDayIndex, isSessionOpen, parseSession, sessionWindow, trainingDate } from "./sessions";
import { validateSignaturePath } from "./signature";

export { renderDigitalT3 } from "./digitalT3";

/**
 * Track A — zero-auth participant links (HS256 JWTs, `TPMS_JWT_SECRET`).
 *
 * The JWT proves the link was issued by us; the `tpms.magic_link_tokens` row
 * (keyed by `jti`) is what makes it revocable and lets a link be bound to one
 * slot. A token is accepted only when the signature, the expiry, the row, the
 * purpose and the package all agree — each failure is a typed DomainError the
 * public page can explain (LINK_EXPIRED, LINK_REVOKED, LINK_NOT_YET_VALID,
 * LINK_INVALID), never a 500.
 *
 * Windows (Malaysia time):
 *   CHECKIN     00:00 on start-1d .. 24:00 on end+1d   (one link, every session)
 *   QUIZ_PRE    issue .. 24:00 on day 1
 *   QUIZ_POST   00:00 on the last day .. 24:00 on end+7d
 *   SESSION_QR  20 minutes (the room display refreshes it)
 *   one-time CHECKIN from a session QR: 15 minutes, bound to that day+session
 */
export const LINK_PURPOSES = ["CHECKIN", "QUIZ_PRE", "QUIZ_POST", "SESSION_QR"] as const;
export type LinkPurpose = (typeof LINK_PURPOSES)[number];

export const SESSION_QR_TTL_MS = 20 * 60_000;
export const SESSION_CONTEXT_TTL_MS = 15 * 60_000;
const ISSUER = "agentic-tpms";
const AUDIENCE = "tpms-participant";
const LINK_ACTOR: Actor = { type: "SYSTEM", id: "sys_magic_links" };
const CHECKIN_ACTOR: Actor = { type: "SYSTEM", id: "public_checkin" };

// Every participant page lives under /c or /q, the routes TPMS_BASIC_AUTH leaves public.
const PATHS: Record<LinkPurpose, string> = { CHECKIN: "/c/", QUIZ_PRE: "/q/", QUIZ_POST: "/q/", SESSION_QR: "/c/s/" };

export interface LinkClaims {
  jti: string;
  packageId: string;
  participantId: string | null;
  purpose: LinkPurpose;
  /** Set for a SESSION_QR and for a one-time check-in context. */
  dayIndex: number | null;
  session: Session | null;
  expiresAt: Date;
}

export interface IssuedLink {
  jti: string;
  token: string;
  url: string;
  expiresAt: Date;
  reused: boolean;
}

function key(): Uint8Array {
  return new TextEncoder().encode(env().TPMS_JWT_SECRET);
}

export function linkUrl(purpose: LinkPurpose, token: string): string {
  return `${env().TPMS_PUBLIC_BASE_URL.replace(/\/+$/, "")}${PATHS[purpose]}${token}`;
}

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

async function sign(input: {
  jti: string; packageId: string; participantId: string | null; purpose: LinkPurpose;
  dayIndex?: number | null; session?: Session | null; issuedAt: Date; notBefore?: Date | null; expiresAt: Date;
}): Promise<string> {
  const jwt = new SignJWT({
    pid: input.packageId,
    pur: input.purpose,
    ...(input.dayIndex ? { d: input.dayIndex } : {}),
    ...(input.session ? { s: input.session } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setJti(input.jti)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(seconds(input.issuedAt))
    .setExpirationTime(seconds(input.expiresAt));
  if (input.participantId) jwt.setSubject(input.participantId);
  if (input.notBefore) jwt.setNotBefore(seconds(input.notBefore));
  return jwt.sign(key());
}

function linkWindow(purpose: "CHECKIN" | "QUIZ_PRE" | "QUIZ_POST", start: string, end: string): { notBefore: Date | null; expiresAt: Date } {
  switch (purpose) {
    case "CHECKIN":
      return { notBefore: startOfDayMY(addDays(start, -1)), expiresAt: startOfDayMY(addDays(end, 2)) };
    case "QUIZ_PRE":
      return { notBefore: null, expiresAt: startOfDayMY(addDays(start, 1)) };
    case "QUIZ_POST":
      return { notBefore: startOfDayMY(end), expiresAt: startOfDayMY(addDays(end, 8)) };
    default: {
      const unknown: never = purpose;
      throw new Error(`No window for purpose ${String(unknown)}`);
    }
  }
}

// ------------------------------------------------------------------ issue

export interface ParticipantLinks {
  participantId: string;
  participantName: string;
  email: string | null;
  nricMasked: string;
  checkin: IssuedLink | null;
  quizPre: IssuedLink | null;
  quizPost: IssuedLink | null;
}

async function issueOne(
  executor: Executor,
  pkg: { id: string; startDate: string; endDate: string },
  participantId: string,
  purpose: "CHECKIN" | "QUIZ_PRE" | "QUIZ_POST",
  now: Date,
): Promise<IssuedLink | null> {
  const window = linkWindow(purpose, pkg.startDate, pkg.endDate);
  if (window.expiresAt.getTime() <= now.getTime()) return null; // that window has already closed
  const [existing] = await executor
    .select()
    .from(schema.magicLinkTokens)
    .where(and(
      eq(schema.magicLinkTokens.packageId, pkg.id),
      eq(schema.magicLinkTokens.participantId, participantId),
      eq(schema.magicLinkTokens.purpose, purpose),
      eq(schema.magicLinkTokens.revoked, false),
      isNull(schema.magicLinkTokens.dayIndex),
      gt(schema.magicLinkTokens.expiresAt, now),
    ));
  if (existing && existing.expiresAt.getTime() === window.expiresAt.getTime()) {
    // Same claims, same key, HS256 -> the same token string that was emailed.
    const token = await sign({ jti: existing.jti, packageId: pkg.id, participantId, purpose, issuedAt: existing.createdAt, notBefore: window.notBefore, expiresAt: existing.expiresAt });
    return { jti: existing.jti, token, url: linkUrl(purpose, token), expiresAt: existing.expiresAt, reused: true };
  }
  if (existing) {
    // The programme was rescheduled: the old window is wrong, so the old link dies.
    await executor.update(schema.magicLinkTokens).set({ revoked: true }).where(eq(schema.magicLinkTokens.jti, existing.jti));
  }
  const jti = randomUUID();
  const issuedAt = new Date(seconds(now) * 1000);
  const token = await sign({ jti, packageId: pkg.id, participantId, purpose, issuedAt, notBefore: window.notBefore, expiresAt: window.expiresAt });
  await executor.insert(schema.magicLinkTokens).values({
    jti, packageId: pkg.id, participantId, purpose, expiresAt: window.expiresAt, createdAt: issuedAt,
  });
  return { jti, token, url: linkUrl(purpose, token), expiresAt: window.expiresAt, reused: false };
}

/**
 * One CHECKIN, QUIZ_PRE and QUIZ_POST link per active participant.
 * Idempotent: an unexpired, unrevoked link whose window still matches the
 * programme dates is re-signed to the identical URL rather than re-issued.
 */
export async function issueParticipantLinks(packageId: string, opts: { now?: Date } = {}): Promise<ParticipantLinks[]> {
  const now = opts.now ?? new Date();
  return withTx(LINK_ACTOR, { reasonCode: "MAGIC_LINKS_ISSUED" }, async (tx) => {
    const pkg = await loadPackageBrief(tx, packageId);
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    if (pkg.operationalStage === "CANCELLED") throw new DomainError("PACKAGE_CANCELLED", "The package is cancelled");
    if (!pkg.startDate || !pkg.endDate) throw new DomainError("DATES_MISSING", "Training dates are required before issuing links");
    const dated = { id: pkg.id, startDate: pkg.startDate, endDate: pkg.endDate };
    const participants = await tx
      .select()
      .from(schema.packageParticipants)
      .where(and(eq(schema.packageParticipants.packageId, packageId), sql`${schema.packageParticipants.registrationStatus} <> 'WITHDRAWN'`))
      .orderBy(schema.packageParticipants.fullName, schema.packageParticipants.id);
    const out: ParticipantLinks[] = [];
    for (const p of participants) {
      out.push({
        participantId: p.id,
        participantName: p.fullName,
        email: p.workEmail,
        nricMasked: p.nricMasked,
        checkin: await issueOne(tx, dated, p.id, "CHECKIN", now),
        quizPre: await issueOne(tx, dated, p.id, "QUIZ_PRE", now),
        quizPost: await issueOne(tx, dated, p.id, "QUIZ_POST", now),
      });
    }
    return out;
  });
}

// ------------------------------------------------------------------ verify / revoke

const claimsSchema = z.object({
  jti: z.string().uuid(),
  pid: z.string().uuid(),
  pur: z.enum(LINK_PURPOSES),
  sub: z.string().uuid().optional(),
  d: z.number().int().min(1).optional(),
  s: z.enum(SESSIONS).optional(),
  exp: z.number(),
});

function linkError(error: unknown): DomainError {
  const code = (error as { code?: string }).code;
  const claim = (error as { claim?: string }).claim;
  if (code === "ERR_JWT_EXPIRED") return new DomainError("LINK_EXPIRED", "This link has expired. Ask your training coordinator for a new one.");
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && claim === "nbf") {
    return new DomainError("LINK_NOT_YET_VALID", "This link is not open yet; it opens the day before your training.");
  }
  return new DomainError("LINK_INVALID", "This link is not valid. Check that you opened the full link from your email.");
}

/**
 * Signature, expiry, row (exists, not revoked, not expired), purpose,
 * package and participant must all agree. Returns the verified claims.
 */
export async function verifyToken(token: string, purpose: LinkPurpose, opts: { now?: Date; executor?: Executor } = {}): Promise<LinkClaims> {
  const now = opts.now ?? new Date();
  const executor = opts.executor ?? db();
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
    throw new DomainError("LINK_INVALID", "This link is not valid.");
  }
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE, currentDate: now }));
  } catch (error) {
    throw linkError(error);
  }
  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) throw new DomainError("LINK_INVALID", "This link is not valid.");
  const claims = parsed.data;
  if (claims.pur !== purpose) throw new DomainError("LINK_INVALID", `This is not a ${purpose.toLowerCase().replace("_", "-")} link.`);

  const [row] = await executor.select().from(schema.magicLinkTokens).where(eq(schema.magicLinkTokens.jti, claims.jti));
  if (!row) throw new DomainError("LINK_INVALID", "This link is not valid.");
  if (row.revoked) throw new DomainError("LINK_REVOKED", "This link has been withdrawn. Ask your training coordinator for a new one.");
  if (row.expiresAt.getTime() <= now.getTime()) throw new DomainError("LINK_EXPIRED", "This link has expired.");
  if (row.purpose !== purpose || row.packageId !== claims.pid || (row.participantId ?? null) !== (claims.sub ?? null)) {
    throw new DomainError("LINK_INVALID", "This link is not valid.");
  }
  if ((row.dayIndex ?? null) !== (claims.d ?? null) || (row.session ?? null) !== (claims.s ?? null)) {
    throw new DomainError("LINK_INVALID", "This link is not valid.");
  }
  if (row.participantId) {
    const [p] = await executor
      .select({ status: schema.packageParticipants.registrationStatus })
      .from(schema.packageParticipants)
      .where(eq(schema.packageParticipants.id, row.participantId));
    if (!p || p.status === "WITHDRAWN") throw new DomainError("LINK_REVOKED", "This registration was withdrawn.");
  }
  return {
    jti: row.jti,
    packageId: row.packageId,
    participantId: row.participantId,
    purpose,
    dayIndex: row.dayIndex,
    session: row.session === null ? null : parseSession(row.session),
    expiresAt: row.expiresAt,
  };
}

export async function revokeToken(jti: string, actor: Actor): Promise<void> {
  await withTx(actor, { reasonCode: "MAGIC_LINK_REVOKED" }, async (tx) => {
    const [row] = await tx
      .update(schema.magicLinkTokens)
      .set({ revoked: true })
      .where(eq(schema.magicLinkTokens.jti, jti))
      .returning();
    if (!row) throw new DomainError("LINK_INVALID", `No link with id ${jti}`);
    await recordAudit(tx, {
      entityType: "MAGIC_LINK",
      entityId: jti,
      reasonCode: "MAGIC_LINK_REVOKED",
      details: `${row.purpose} link revoked`,
      metadata: { package_id: row.packageId, participant_id: row.participantId, purpose: row.purpose },
    });
  });
}

// ------------------------------------------------------------------ session QR (room display)

export interface SessionQr {
  jti: string;
  token: string;
  url: string;
  expiresAt: Date;
  dayIndex: number;
  session: Session;
  date: string;
  /** PNG data URL of `url`, ready for an <img>. */
  qrDataUrl: string;
}

export async function issueSessionQr(packageId: string, dayIndex: number, session: Session, opts: { now?: Date } = {}): Promise<SessionQr> {
  const now = opts.now ?? new Date();
  const s = parseSession(session);
  return withTx(LINK_ACTOR, { reasonCode: "SESSION_QR_ISSUED" }, async (tx) => {
    const pkg = await loadPackageBrief(tx, packageId);
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    if (!["READY_FOR_EVENT", "DELIVERY_IN_PROGRESS"].includes(pkg.operationalStage) || !pkg.startDate) {
      throw new DomainError("SESSION_CLOSED", `Check-in is not open for a package at ${pkg.operationalStage}`);
    }
    assertDayIndex(dayIndex, pkg.durationDays);
    const jti = randomUUID();
    const issuedAt = new Date(seconds(now) * 1000);
    const expiresAt = new Date(issuedAt.getTime() + SESSION_QR_TTL_MS);
    const token = await sign({ jti, packageId, participantId: null, purpose: "SESSION_QR", dayIndex, session: s, issuedAt, expiresAt });
    await tx.insert(schema.magicLinkTokens).values({ jti, packageId, participantId: null, purpose: "SESSION_QR", dayIndex, session: s, expiresAt, createdAt: issuedAt });
    const url = linkUrl("SESSION_QR", token);
    const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 480 });
    return { jti, token, url, expiresAt, dayIndex, session: s, date: trainingDate(pkg.startDate, dayIndex), qrDataUrl };
  });
}

/** For the session-QR page: who can pick their name (names only — never NRIC). */
export async function sessionQrRoster(token: string, opts: { now?: Date } = {}) {
  const claims = await verifyToken(token, "SESSION_QR", opts);
  const pkg = await loadPackageBrief(db(), claims.packageId);
  const participants = await db()
    .select({ id: schema.packageParticipants.id, name: schema.packageParticipants.fullName })
    .from(schema.packageParticipants)
    .where(and(eq(schema.packageParticipants.packageId, claims.packageId), sql`${schema.packageParticipants.registrationStatus} <> 'WITHDRAWN'`))
    .orderBy(schema.packageParticipants.fullName);
  return {
    packageTitle: pkg.title,
    packageCode: pkg.packageCode,
    dayIndex: claims.dayIndex as number,
    session: claims.session as Session,
    date: pkg.startDate ? trainingDate(pkg.startDate, claims.dayIndex as number) : null,
    expiresAt: claims.expiresAt,
    participants,
  };
}

/**
 * A participant at the room display picks their name and types the last
 * four characters of their NRIC/passport; a match returns a one-time CHECKIN
 * context bound to that day and session. The same refusal is used for every
 * mismatch so the endpoint does not reveal which part was wrong.
 */
export async function identifyBySessionQr(
  token: string,
  identity: { participantId: string; nricLast4: string },
  opts: { now?: Date } = {},
): Promise<{ token: string; url: string; participantName: string; dayIndex: number; session: Session; expiresAt: Date }> {
  const now = opts.now ?? new Date();
  const claims = await verifyToken(token, "SESSION_QR", { now });
  const mismatch = () => new DomainError("IDENTITY_MISMATCH", "We could not match that name and NRIC. Check the last four digits or ask the trainer.");
  if (!z.string().uuid().safeParse(identity.participantId).success) throw mismatch();
  const last4 = String(identity.nricLast4 ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(last4)) throw mismatch();
  return withTx(LINK_ACTOR, { reasonCode: "SESSION_QR_IDENTIFIED" }, async (tx) => {
    const [p] = await tx.select().from(schema.packageParticipants).where(eq(schema.packageParticipants.id, identity.participantId));
    if (!p || p.packageId !== claims.packageId || p.registrationStatus === "WITHDRAWN") throw mismatch();
    if (!safeEqual(p.nricMasked.slice(-4).toUpperCase(), last4)) throw mismatch();
    const jti = randomUUID();
    const issuedAt = new Date(seconds(now) * 1000);
    const expiresAt = new Date(issuedAt.getTime() + SESSION_CONTEXT_TTL_MS);
    const dayIndex = claims.dayIndex as number;
    const session = claims.session as Session;
    const oneTime = await sign({ jti, packageId: claims.packageId, participantId: p.id, purpose: "CHECKIN", dayIndex, session, issuedAt, expiresAt });
    await tx.insert(schema.magicLinkTokens).values({
      jti, packageId: claims.packageId, participantId: p.id, purpose: "CHECKIN", dayIndex, session, expiresAt, createdAt: issuedAt,
    });
    return { token: oneTime, url: linkUrl("CHECKIN", oneTime), participantName: p.fullName, dayIndex, session, expiresAt };
  });
}

// ------------------------------------------------------------------ check-in

export interface CheckInContext {
  participantName: string;
  packageTitle: string;
  packageCode: string;
  expiresAt: Date;
  /** Set when the link is a one-time context bound to one slot. */
  boundTo: { dayIndex: number; session: Session } | null;
  /** The slot whose window is open right now, if any. */
  current: { dayIndex: number; session: Session } | null;
  days: Array<{ dayIndex: number; date: string; sessions: Array<{ session: Session; opensAt: Date; closesAt: Date; open: boolean; signed: boolean }> }>;
}

/** What the /c/[token] page shows before the participant signs. */
export async function checkInContext(token: string, opts: { now?: Date } = {}): Promise<CheckInContext> {
  const now = opts.now ?? new Date();
  const claims = await verifyToken(token, "CHECKIN", { now });
  const pkg = await loadPackageBrief(db(), claims.packageId);
  const [participant] = await db().select().from(schema.packageParticipants).where(eq(schema.packageParticipants.id, claims.participantId as string));
  const signed = await rows<{ day_index: number; session: Session }>(
    db(),
    sql`select day_index, session from tpms.attendance_records
         where participant_id = ${claims.participantId}::uuid and track = 'A_DIGITAL'`,
  );
  const signedSet = new Set(signed.map((r) => `${r.day_index}:${r.session}`));
  const boundTo = claims.dayIndex && claims.session ? { dayIndex: claims.dayIndex, session: claims.session } : null;
  const days: CheckInContext["days"] = [];
  let current: CheckInContext["current"] = null;
  for (let d = 1; pkg.startDate && d <= (pkg.durationDays ?? 0); d += 1) {
    const date = trainingDate(pkg.startDate, d);
    const sessions = SESSIONS.map((s) => {
      const { opensAt, closesAt } = sessionWindow(date, s);
      const open = isSessionOpen(date, s, now) && (!boundTo || (boundTo.dayIndex === d && boundTo.session === s));
      if (open) current = { dayIndex: d, session: s };
      return { session: s, opensAt, closesAt, open, signed: signedSet.has(`${d}:${s}`) };
    });
    days.push({ dayIndex: d, date, sessions });
  }
  return { participantName: participant.fullName, packageTitle: pkg.title, packageCode: pkg.packageCode, expiresAt: claims.expiresAt, boundTo, current, days };
}

export interface CheckInInput {
  token: string;
  dayIndex: number;
  session: Session;
  signatureSvgPath: string;
  userAgent?: string | null;
  ip?: string | null;
  now?: Date;
}

export interface CheckInResult {
  participantName: string;
  dayIndex: number;
  session: Session;
  alreadySigned: boolean;
  signedAt: Date;
}

/**
 * One A_DIGITAL record per participant/day/session, only while that
 * session's window is open. A second attempt returns `alreadySigned` instead
 * of a duplicate. The IP is stored only as sha256(pepper + ip).
 */
export async function recordCheckIn(input: CheckInInput): Promise<CheckInResult> {
  const now = input.now ?? new Date();
  const session = parseSession(input.session);
  const claims = await verifyToken(input.token, "CHECKIN", { now });
  if (claims.dayIndex !== null && (claims.dayIndex !== input.dayIndex || claims.session !== session)) {
    throw new DomainError("LINK_INVALID", `This check-in link is for Day ${claims.dayIndex} ${claims.session}.`);
  }
  validateSignaturePath(input.signatureSvgPath);
  return withTx(CHECKIN_ACTOR, { reasonCode: "ATTENDANCE_CHECKIN" }, async (tx) => {
    const pkg = await loadPackageBrief(tx, claims.packageId);
    if (!pkg || !pkg.startDate || !["READY_FOR_EVENT", "DELIVERY_IN_PROGRESS"].includes(pkg.operationalStage)) {
      throw new DomainError("SESSION_CLOSED", "Check-in is closed for this programme.");
    }
    assertDayIndex(input.dayIndex, pkg.durationDays);
    const date = trainingDate(pkg.startDate, input.dayIndex);
    if (!isSessionOpen(date, session, now)) {
      const { opensAt, closesAt } = sessionWindow(date, session);
      throw new DomainError("SESSION_CLOSED", `Day ${input.dayIndex} ${session} check-in is open ${date} ${session === "AM" ? "07:00-13:00" : "13:00-18:30"} (Malaysia time).`, {
        opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString(),
      });
    }
    const participantId = claims.participantId as string;
    const [participant] = await tx.select().from(schema.packageParticipants).where(eq(schema.packageParticipants.id, participantId));
    if (!participant || participant.registrationStatus === "WITHDRAWN") throw new DomainError("LINK_REVOKED", "This registration was withdrawn.");

    const ipHash = input.ip ? sha256Hex(`${env().TPMS_NRIC_PEPPER}${input.ip}`) : null;
    // Raw results carry timestamps as strings (Drizzle's pg type parsers); convert explicitly.
    const inserted = await rows<{ signed_at: string }>(
      tx,
      sql`insert into tpms.attendance_records
            (package_id, participant_id, day_index, session, track, present, signed_at, signature_data, user_agent, ip_hash)
          values (${pkg.id}::uuid, ${participantId}::uuid, ${input.dayIndex}, ${session}, 'A_DIGITAL', true, ${now},
                  ${input.signatureSvgPath}, ${(input.userAgent ?? "").slice(0, 512) || null}, ${ipHash})
          on conflict (participant_id, day_index, session, track) do nothing
          returning signed_at`,
    );
    const alreadySigned = inserted.length === 0;
    let signedAt = inserted[0] ? new Date(inserted[0].signed_at) : now;
    if (alreadySigned) {
      const [prior] = await rows<{ signed_at: string | null }>(
        tx,
        sql`select signed_at from tpms.attendance_records where participant_id = ${participantId}::uuid
             and day_index = ${input.dayIndex} and session = ${session} and track = 'A_DIGITAL'`,
      );
      signedAt = prior?.signed_at ? new Date(prior.signed_at) : now;
    } else {
      // A paper reading of "absent" that a signature now contradicts is a
      // disagreement for a human — unless an operator already decided the slot.
      const flagged = await rows<{ id: string }>(
        tx,
        sql`update tpms.attendance_records r set needs_review = true, review_reason = 'TRACK_DISAGREEMENT', resolved_by = null, resolved_at = null
             where r.participant_id = ${participantId}::uuid and r.day_index = ${input.dayIndex} and r.session = ${session}
               and r.track = 'B_OCR' and r.present = false
               and not exists (select 1 from tpms.attendance_records o where o.participant_id = r.participant_id
                                and o.day_index = r.day_index and o.session = r.session and o.track = 'MANUAL_OVERRIDE')
         returning r.id`,
      );
      const [pending] = await rows<{ id: string }>(
        tx,
        sql`select id from tpms.decisions where gate = 'ATTENDANCE_EXCEPTION' and status = 'PENDING'
             and subject_ref = ${T3_SUBJECT(pkg.packageCode, input.dayIndex)}`,
      );
      if (flagged.length > 0 || pending) {
        const settled = await settleDay(tx, pkg, input.dayIndex, { resolvedBy: "attendance.t3_extractor", note: "Track A check-in completed the day", raisedBy: "attendance.t3_extractor" });
        if (settled.status === "RESOLVED") await promoteSettledSheets(tx, pkg.id, "attendance.t3_extractor", "Track A check-in completed the day");
      }
    }
    await tx
      .update(schema.magicLinkTokens)
      .set({ usedAt: now })
      .where(and(eq(schema.magicLinkTokens.jti, claims.jti), isNull(schema.magicLinkTokens.usedAt)));
    await recomputeAttendance(tx, pkg.id);
    return { participantName: participant.fullName, dayIndex: input.dayIndex, session, alreadySigned, signedAt };
  });
}

// ------------------------------------------------------------------ task handler

/**
 * `delivery.issue_magic_links`: issue, then email each participant whose link
 * is new OR who has no delivered PARTICIPANT_LINKS message for this package.
 * The second clause is what makes a retry after a mid-loop SMTP failure finish
 * the job: the links are already issued (so no longer "new"), but the
 * participants the failed run never reached still have no delivered message.
 */
export const issueLinksPayload = z.object({ packageId: z.string().uuid() });

export async function handleIssueMagicLinks(task: Pick<Task, "payload">): Promise<Record<string, unknown>> {
  const { packageId } = parsePayload(issueLinksPayload, task.payload, "delivery.issue_magic_links");
  const links = await issueParticipantLinks(packageId);
  const pkg = await loadPackageBrief(db(), packageId);
  const delivered = new Set(
    (
      await db()
        .select({ to: outboundMessages.toAddress })
        .from(outboundMessages)
        .where(and(eq(outboundMessages.packageId, packageId), eq(outboundMessages.kind, "PARTICIPANT_LINKS"), inArray(outboundMessages.status, ["SENT", "LOGGED"])))
    ).map((r) => r.to.toLowerCase()),
  );
  const fresh = links.filter((l) => [l.checkin, l.quizPre, l.quizPost].some((x) => x && !x.reused) || (l.email && !delivered.has(l.email.toLowerCase())));
  let emailed = 0;
  let skipped = 0;
  for (const link of fresh) {
    if (!link.email) {
      skipped += 1;
      continue;
    }
    const lines = [
      `Dear ${link.participantName},`,
      "",
      `You are registered for "${pkg.title}" (${pkg.packageCode}), ${pkg.startDate} to ${pkg.endDate}.`,
      "",
      link.checkin ? `Check in and sign for each session (morning and afternoon) here:\n${link.checkin.url}` : "",
      link.quizPre ? `\nBefore the programme starts, please complete the short pre-assessment:\n${link.quizPre.url}` : "",
      link.quizPost ? `\nOn the last day, complete the post-assessment:\n${link.quizPost.url}` : "",
      "",
      "These links are personal to you. Please do not forward them.",
      env().TPMS_PROVIDER_NAME,
    ];
    await sendMail({ to: link.email, subject: `Your attendance links: ${pkg.title}`, text: lines.filter((l) => l !== "").join("\n"), packageId, kind: "PARTICIPANT_LINKS" });
    emailed += 1;
  }
  return { participants: links.length, toEmail: fresh.length, emailed, skippedNoEmail: skipped };
}
