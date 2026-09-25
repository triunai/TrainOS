import { sql } from "drizzle-orm";
import { todayMY } from "@/lib/dates";
import { db, one } from "../db/client";
import { DomainError } from "../domain/errors";
import { sha256Hex } from "../lib/crypto";
import { readDocument } from "../storage/vault";
import { type CertificatePayload, HOURS_PER_DAY, canonicalJson, normaliseSerial, payloadSchema } from "./payload";

/**
 * Public verification (`/verify/[serial]`). Three independent anchors must
 * agree before a certificate reads VALID:
 *
 *   file    — the vault bytes still hash to the recorded SHA-256
 *   payload — the issued snapshot AND the payload re-derived from today's
 *             participant/package rows both hash to `payload_sha256`, so a
 *             renamed holder or an edited programme is caught, not echoed
 *   ledger  — the CERTIFICATE_ISSUED entry in the hash-chained audit ledger
 *             carries the same serial and hashes
 *
 * Revocation outranks integrity (a revoked certificate is REVOKED whatever
 * its bytes say). The result carries masked NRIC only and no internal ids.
 */
export type VerificationStatus = "VALID" | "REVOKED" | "NOT_FOUND" | "TAMPERED";

export interface VerifiedCertificate {
  status: "VALID" | "REVOKED" | "TAMPERED";
  serial: string;
  holderName: string;
  nricMasked: string;
  courseTitle: string;
  startDate: string;
  endDate: string;
  hours: number;
  providerName: string;
  providerHrdcId: string;
  issuedAt: string;
  revokedAt: string | null;
  payloadSha256: string;
  fileSha256: string;
  fileIntact: boolean;
  checks: { file: boolean; payload: boolean; ledger: boolean };
}

export type VerificationResult = { status: "NOT_FOUND"; serial: string } | VerifiedCertificate;

interface Row {
  id: string;
  certificate_serial: string;
  document_vault_id: string;
  payload_sha256: string;
  sha256_hash: string;
  revoked: boolean;
  revoked_at: Date | null;
  issued_at: Date;
  payload: unknown;
  full_name: string;
  nric_masked: string;
  title: string;
  package_code: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
}

async function fileMatches(vaultId: string, expected: string): Promise<boolean> {
  try {
    const read = await readDocument(vaultId);
    return Boolean(read && read.intact && read.doc.fileHashSha256 === expected);
  } catch {
    // A missing or unreadable blob is not an intact certificate.
    return false;
  }
}

async function ledgerMatches(row: Row): Promise<boolean> {
  const entry = await one<{ metadata_diff: Record<string, unknown> }>(
    db(),
    sql`select metadata_diff from tpms.audit_ledger
         where entity_type = 'CERTIFICATE' and entity_id = ${row.id}::uuid and reason_code = 'CERTIFICATE_ISSUED'
         order by seq limit 1`,
  );
  const m = entry?.metadata_diff;
  return Boolean(m && m.serial === row.certificate_serial && m.payload_sha256 === row.payload_sha256 && m.sha256 === row.sha256_hash);
}

function payloadMatches(row: Row, snapshot: CertificatePayload | null): boolean {
  if (!snapshot) return false;
  if (sha256Hex(canonicalJson(snapshot)) !== row.payload_sha256) return false;
  if (!row.start_date || !row.end_date || !row.duration_days) return false;
  // Provider identity is taken from the snapshot: it is configuration, not a
  // record, and a rename must not void every certificate already issued.
  const live: CertificatePayload = {
    serial: row.certificate_serial,
    holderName: row.full_name.trim(),
    nricMasked: row.nric_masked,
    courseTitle: row.title.trim(),
    packageCode: row.package_code,
    startDate: row.start_date,
    endDate: row.end_date,
    hours: row.duration_days * HOURS_PER_DAY,
    providerName: snapshot.providerName,
    providerHrdcId: snapshot.providerHrdcId,
    issuedOn: todayMY(new Date(row.issued_at)),
  };
  return sha256Hex(canonicalJson(live)) === row.payload_sha256;
}

export async function verifyCertificate(rawSerial: string): Promise<VerificationResult> {
  const serial = normaliseSerial(rawSerial);
  if (!serial) return { status: "NOT_FOUND", serial: String(rawSerial ?? "").slice(0, 64) };

  const row = await one<Row>(
    db(),
    sql`select c.id, c.certificate_serial, c.document_vault_id, c.payload_sha256, c.sha256_hash, c.revoked, c.revoked_at,
               c.issued_at, c.payload, p.full_name, p.nric_masked,
               pk.title, pk.package_code, pk.start_date, pk.end_date, pk.duration_days
          from tpms.certificates c
          join tpms.package_participants p on p.id = c.participant_id
          join tpms.training_packages pk on pk.id = c.package_id
         where c.certificate_serial = ${serial}`,
  );
  if (!row) return { status: "NOT_FOUND", serial };

  const parsed = payloadSchema.safeParse(row.payload);
  const snapshot = parsed.success ? parsed.data : null;
  const checks = {
    file: await fileMatches(row.document_vault_id, row.sha256_hash),
    payload: payloadMatches(row, snapshot),
    ledger: await ledgerMatches(row),
  };
  const intact = checks.file && checks.payload && checks.ledger;
  // What the certificate says is the snapshot; without one, fall back to the
  // live rows (the status is TAMPERED either way). NRIC is the masked column.
  const shown = snapshot ?? {
    holderName: row.full_name,
    nricMasked: row.nric_masked,
    courseTitle: row.title,
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? "",
    hours: (row.duration_days ?? 0) * HOURS_PER_DAY,
    providerName: "",
    providerHrdcId: "",
  };
  return {
    status: row.revoked ? "REVOKED" : intact ? "VALID" : "TAMPERED",
    serial,
    holderName: shown.holderName,
    nricMasked: shown.nricMasked,
    courseTitle: shown.courseTitle,
    startDate: shown.startDate,
    endDate: shown.endDate,
    hours: shown.hours,
    providerName: shown.providerName,
    providerHrdcId: shown.providerHrdcId,
    issuedAt: new Date(row.issued_at).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    payloadSha256: row.payload_sha256,
    fileSha256: row.sha256_hash,
    fileIntact: checks.file,
    checks,
  };
}

/** The stored PDF for download (certificates screen, verification page). */
export async function readCertificatePdf(
  rawSerial: string,
): Promise<{ serial: string; fileName: string; bytes: Buffer; intact: boolean; revoked: boolean } | undefined> {
  const serial = normaliseSerial(rawSerial);
  if (!serial) return undefined;
  const row = await one<{ document_vault_id: string; sha256_hash: string; revoked: boolean }>(
    db(),
    sql`select document_vault_id, sha256_hash, revoked from tpms.certificates where certificate_serial = ${serial}`,
  );
  if (!row) return undefined;
  const read = await readDocument(row.document_vault_id).catch(() => undefined);
  if (!read) throw new DomainError("CERTIFICATE_FILE_MISSING", `The stored file for ${serial} cannot be read`);
  return {
    serial,
    fileName: `${serial}.pdf`,
    bytes: read.bytes,
    intact: read.intact && read.doc.fileHashSha256 === row.sha256_hash,
    revoked: row.revoked,
  };
}
