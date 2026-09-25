import { decodeJwt } from "jose";
import { DomainError } from "../domain/errors";
import { type LinkClaims, verifyToken } from "./magicLinks";

/**
 * `/q/<jwt>` carries either a QUIZ_PRE or a QUIZ_POST link, and the URL does
 * not say which. The purpose claim is read UNVERIFIED only to pick which
 * purpose to verify against; `verifyToken` then checks the signature, the
 * window, the row, the purpose and the participant exactly as for any other
 * link. Any other purpose (a check-in link pasted into /q/) is LINK_INVALID.
 */
export const QUIZ_PURPOSES = ["QUIZ_PRE", "QUIZ_POST"] as const;
export type QuizPurpose = (typeof QUIZ_PURPOSES)[number];

export function quizPurposeOf(token: string): QuizPurpose {
  let purpose: unknown;
  try {
    purpose = decodeJwt(token).pur;
  } catch {
    throw new DomainError("LINK_INVALID", "This link is not valid. Check that you opened the full link from your email.");
  }
  if (purpose === "QUIZ_PRE" || purpose === "QUIZ_POST") return purpose;
  throw new DomainError("LINK_INVALID", "This is not an assessment link.");
}

export async function verifyQuizToken(token: string, opts: { now?: Date } = {}): Promise<LinkClaims & { purpose: QuizPurpose }> {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
    throw new DomainError("LINK_INVALID", "This link is not valid.");
  }
  const purpose = quizPurposeOf(token);
  const claims = await verifyToken(token, purpose, opts);
  if (!claims.participantId) throw new DomainError("LINK_INVALID", "This link is not valid.");
  return { ...claims, purpose };
}
