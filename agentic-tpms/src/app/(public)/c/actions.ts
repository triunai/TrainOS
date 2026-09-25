"use server";

import { identifyBySessionQr, recordCheckIn } from "@/server/attendance";
import { DomainError, isDomainError } from "@/server/domain/errors";
import { clientIp, publicAct, userAgent } from "./_lib/publicAct";
import { blockedFor, recordFailure } from "./_lib/rateLimit";

/**
 * Participant-facing actions (no operator session; the token is the
 * credential and is re-verified by the domain on every call).
 */
export async function checkInAction(token: string, dayIndex: number, session: string, signature: string) {
  return publicAct(async () => {
    const r = await recordCheckIn({
      token: String(token),
      dayIndex: Number(dayIndex),
      // recordCheckIn parses the session itself and refuses anything but AM/PM (INVALID_SESSION).
      session: session as "AM" | "PM",
      signatureSvgPath: String(signature ?? ""),
      userAgent: userAgent(),
      ip: clientIp(),
    });
    return { participantName: r.participantName, dayIndex: r.dayIndex, session: r.session, alreadySigned: r.alreadySigned, signedAt: r.signedAt.toISOString() };
  });
}

/**
 * Session-QR identification: name + last 4 IC characters -> a one-time check-in
 * path bound to the QR's day and session. Failed attempts are rate-limited
 * per token + IP (+ chosen name); see _lib/rateLimit.ts.
 */
export async function identifyAction(token: string, participantId: string, nricLast4: string) {
  return publicAct(async () => {
    const qr = String(token);
    const pid = String(participantId);
    const ip = clientIp();
    const wait = blockedFor(qr, ip, pid);
    if (wait !== null) throw new DomainError("RATE_LIMITED", "Too many identity attempts", { retryAfterMinutes: Math.max(1, Math.ceil(wait / 60_000)) });
    try {
      const r = await identifyBySessionQr(qr, { participantId: pid, nricLast4: String(nricLast4 ?? "") });
      return { path: `/c/${r.token}` };
    } catch (error) {
      if (isDomainError(error) && error.code === "IDENTITY_MISMATCH") recordFailure(qr, ip, pid);
      throw error;
    }
  });
}
