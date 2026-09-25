import { headers } from "next/headers";
import type { PublicResult } from "@/components/attendance/publicCopy";
import { act } from "@/server/actions";

/**
 * Server-action results for the participant pages (/c, /c/s, /q). Same R2
 * split as `act` — a DomainError is a refusal with a code the page explains in
 * plain language; anything else is "something went wrong" — but nothing
 * internal crosses to a public client: no transport message, and from a
 * refusal's details only the fields the copy uses.
 */
export type { PublicResult };

const PUBLIC_DETAILS = ["opensAt", "closesAt", "retryAfterMinutes"] as const;

export async function publicAct<T>(work: () => Promise<T>): Promise<PublicResult<T>> {
  const result = await act(work, { revalidate: [] });
  if (result.ok) return { ok: true, data: result.data };
  if (result.kind === "domain") {
    const details = Object.fromEntries(PUBLIC_DETAILS.filter((k) => result.details?.[k] !== undefined).map((k) => [k, result.details?.[k]]));
    return { ok: false, code: result.code, details };
  }
  return { ok: false, code: "TRANSPORT" };
}

/** The caller's IP as the proxy reports it (first X-Forwarded-For hop), for hashing and rate limits only. */
export function clientIp(): string {
  const h = headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

export function userAgent(): string | null {
  return headers().get("user-agent");
}
