import { clockMY, dayTimeMY } from "@/lib/dates";

/**
 * What a participant reads when a public page (/c, /c/s, /q) refuses. Plain
 * language, no codes in the headline, no stack traces. Server-safe: server
 * pages and client components both import it. An unknown code gets the
 * generic explanation, never another code's copy (R14).
 */
/** What a public server action returns: data, or a refusal code the page explains with `explain`. */
export type PublicResult<T> = { ok: true; data: T } | { ok: false; code: string; details?: Record<string, unknown> };

export interface Explanation {
  title: string;
  body: string;
  /** Can the participant fix it on this page (re-sign, retype), or do they need a person? */
  retry: boolean;
}


function instant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const COORDINATOR = "Please ask your training coordinator or the trainer for a new link.";

const COPY: Record<string, Explanation> = {
  LINK_EXPIRED: { title: "This link has expired", body: `Links stop working after the programme. ${COORDINATOR}`, retry: false },
  LINK_REVOKED: { title: "This link has been withdrawn", body: `The organiser replaced or cancelled it. ${COORDINATOR}`, retry: false },
  LINK_NOT_YET_VALID: { title: "This link is not open yet", body: "Check-in links open the day before your training; the post-assessment opens on the last training day. Please try again then.", retry: false },
  LINK_INVALID: { title: "We could not read this link", body: "Make sure you opened the complete link from your email or message — some apps cut long links short. If it still fails, ask your coordinator.", retry: false },
  SESSION_CLOSED: { title: "Sign-in is closed for this session", body: "You can only sign in while the session is running.", retry: false },
  SIGNATURE_INVALID: { title: "Please sign again", body: "We need your full signature, not a dot or a short line. Clear the box and sign with your finger.", retry: true },
  INVALID_DAY: { title: "That training day is not part of this programme", body: "Reload the page to see the programme's days.", retry: false },
  INVALID_SESSION: { title: "That session does not exist", body: "Sessions are morning (AM) and afternoon (PM). Reload the page and try again.", retry: false },
  IDENTITY_MISMATCH: { title: "The name and IC digits do not match", body: "Check the last 4 digits of your IC (or passport) and try again, or ask the trainer.", retry: true },
  RATE_LIMITED: { title: "Too many attempts", body: "For your privacy, this device has to wait a few minutes before trying again. The trainer can sign you in meanwhile.", retry: false },
  ALREADY_SUBMITTED: { title: "You have already submitted this assessment", body: "Each assessment can be taken once. Your first answers were recorded.", retry: false },
  PRE_AFTER_POST: { title: "The pre-assessment has closed", body: "You have already taken the post-assessment, so the pre-assessment cannot be taken any more.", retry: false },
  QUIZ_VERSION_MISMATCH: { title: "The questions changed while you were answering", body: "Reload the page to get the current questions, then answer again.", retry: false },
  NO_COURSE_LINKED: { title: "There is no assessment for this programme", body: "Your coordinator has not set one up. Nothing is needed from you.", retry: false },
  PARTICIPANT_WITHDRAWN: { title: "Your registration was withdrawn", body: "If this is a mistake, please contact your training coordinator.", retry: false },
  PARTICIPANT_NOT_FOUND: { title: "We could not find your registration", body: "Please contact your training coordinator.", retry: false },
  PACKAGE_CANCELLED: { title: "This programme was cancelled", body: "There is nothing to sign or answer. Your coordinator will be in touch.", retry: false },
  EMPTY_SUBMISSION: { title: "No answers were selected", body: "Answer the questions, then submit.", retry: true },
  INCOMPLETE_SUBMISSION: { title: "Some questions are unanswered", body: "Answer every question before you submit.", retry: true },
};

const GENERIC: Explanation = { title: "Something went wrong on our side", body: "Please try again in a moment. If it keeps happening, tell the trainer — your attendance can also be recorded by hand.", retry: true };

/** Room-QR wording: its code lives 20 minutes, so "expired" means "scan the wall again", not "ask for a link". */
const ROOM_COPY: Record<string, Explanation> = {
  LINK_EXPIRED: { title: "This room code has expired", body: "The code on the screen refreshes every 20 minutes. Scan the code on the screen again.", retry: false },
  LINK_INVALID: { title: "We could not read this room code", body: "Scan the code on the screen again, holding the phone steady until it opens.", retry: false },
  LINK_REVOKED: { title: "This room code was replaced", body: "Scan the code on the screen again.", retry: false },
};

export function explain(code: string | null | undefined, details?: Record<string, unknown>, context?: "room"): Explanation {
  const base = (code && context === "room" && ROOM_COPY[code]) || (code && COPY[code]) || GENERIC;
  if (code === "SESSION_CLOSED") {
    const opens = instant(details?.opensAt);
    const closes = instant(details?.closesAt);
    if (opens && closes) {
      return { ...base, body: `This session's sign-in is open ${dayTimeMY(opens)} to ${clockMY(closes)} (Malaysia time). Please sign in during that time.` };
    }
  }
  if (code === "RATE_LIMITED" && typeof details?.retryAfterMinutes === "number") {
    return { ...base, body: `For your privacy, this device has to wait ${details.retryAfterMinutes} minute${details.retryAfterMinutes === 1 ? "" : "s"} before trying again. The trainer can sign you in meanwhile.` };
  }
  return base;
}

/** `Sat 26 Sep, 10:31` in Malaysia time (hydration-safe). */
export const whenMY = dayTimeMY;

/** `10:31` in Malaysia time (hydration-safe). */
export const timeOfDayMY = clockMY;
