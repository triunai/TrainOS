import { z } from "zod";
import { DomainError } from "../domain/errors";
import { sha256Hex } from "../lib/crypto";

/**
 * The canonical certificate payload and its hash.
 *
 * A certificate attests to exactly these eleven fields. They are serialised
 * as JSON with sorted keys and no whitespace, so the same facts always hash
 * to the same `payload_sha256` regardless of how an object was assembled —
 * which is what lets the verifier recompute it from the live records and
 * compare. The key set is closed (R14): an extra or missing key is an error,
 * not a silently different hash.
 */
export const HOURS_PER_DAY = 7;

export const payloadSchema = z
  .object({
    serial: z.string().regex(/^CERT-\d{4}-\d+-\d{3,}$/),
    holderName: z.string().min(1),
    // Masked only. A raw NRIC or passport number can never reach a certificate.
    nricMasked: z.string().regex(/^\*+(-\*\*-)?[A-Z0-9]{4}$/, "nricMasked must be a masked identity"),
    courseTitle: z.string().min(1),
    packageCode: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hours: z.number().int().positive(),
    providerName: z.string().min(1),
    providerHrdcId: z.string().min(1),
    issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export type CertificatePayload = z.infer<typeof payloadSchema>;

export function assertPayload(value: unknown): CertificatePayload {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "CERTIFICATE_PAYLOAD_INVALID",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}

/** JSON with object keys sorted at every depth. Refuses values JSON cannot represent faithfully. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => {
        if (v === undefined) throw new Error(`canonicalJson: undefined at key ${k}`);
        return `${JSON.stringify(k)}:${canonicalJson(v)}`;
      })
      .join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported ${typeof value}`);
}

export function payloadSha256(payload: CertificatePayload): string {
  return sha256Hex(canonicalJson(assertPayload(payload)));
}

// ------------------------------------------------------------------ serials

/** `PKG-2026-0042` → `0042`. The serial carries the package's running number. */
export function packageCodeNumber(packageCode: string): string {
  const match = /(\d+)$/.exec(packageCode.trim());
  if (!match) {
    throw new DomainError("PACKAGE_CODE_UNSUPPORTED", `Package code ${packageCode} has no running number for a certificate serial`);
  }
  return match[1];
}

/** `CERT-{YYYY}-{package number}-{NNN}`; YYYY is the programme's end year. */
export function certificateSerial(endDate: string, packageCode: string, sequence: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new DomainError("PACKAGE_DATES_MISSING", "The package has no end date");
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`certificate sequence must be a positive integer, got ${sequence}`);
  return `CERT-${endDate.slice(0, 4)}-${packageCodeNumber(packageCode)}-${String(sequence).padStart(3, "0")}`;
}

export const SERIAL_PATTERN = /^CERT-\d{4}-\d+-\d{3,}$/;

/** Uppercased and trimmed; `undefined` for anything that is not serial-shaped. */
export function normaliseSerial(raw: string): string | undefined {
  const serial = String(raw ?? "").trim().toUpperCase();
  return SERIAL_PATTERN.test(serial) ? serial : undefined;
}

export function serialSequence(serial: string): number {
  const match = /-(\d+)$/.exec(serial);
  return match ? Number(match[1]) : 0;
}

export function verificationUrl(baseUrl: string, serial: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/verify/${encodeURIComponent(serial)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids reach this module from task payloads and routes; a malformed one is "not found", not a SQL cast error. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
