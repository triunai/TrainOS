import { sql } from "drizzle-orm";
import { todayMY } from "@/lib/dates";
import { finishAgentRun, startAgentRun, type Provenance } from "../ai";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Executor, type Tx, db, one, rows, withTx } from "../db/client";
import { DomainError, isDomainError } from "../domain/errors";
import { PDF_MIME } from "../documents/pdf";
import { env } from "../env";
import { sha256Hex } from "../lib/crypto";
import { storeDocument } from "../storage/vault";
import {
  type CertificatePayload,
  HOURS_PER_DAY,
  assertPayload,
  canonicalJson,
  certificateSerial,
  isUuid,
  serialSequence,
  verificationUrl,
} from "./payload";
import { renderCertificatePdf } from "./pdf";

/**
 * Level 0 certification engine (task `certificates.issue`).
 *
 * Rules, all deterministic:
 *   - the package must be DELIVERY_COMPLETED (NOT_DELIVERED otherwise)
 *   - a participant qualifies when not WITHDRAWN and `hrd_claim_eligible`
 *     (the generated column: attendance >= 80%) — the same threshold the
 *     claim uses, read from the one place it is defined
 *   - one certificate per participant, ever: a re-run issues only the missing
 *     ones, and a revoked certificate is not silently replaced
 *
 * One transaction per run under a per-package advisory lock, so two workers
 * (or a retry racing a manual trigger) cannot hand out the same NNN.
 */
export const CERT_ACTOR: Actor = { type: "SYSTEM", id: "sys_certification_engine" };
export const CERT_AGENT = "certification.engine";

export type SkipReason = "ALREADY_ISSUED" | "REVOKED" | "WITHDRAWN" | "ATTENDANCE_BELOW_THRESHOLD";

export interface IssueResult {
  packageId: string;
  issued: string[];
  skipped: Array<{ participantId: string; reason: SkipReason; attendanceRate?: number }>;
}

interface PackageRow {
  id: string;
  package_code: string;
  title: string;
  operational_stage: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
}

interface ParticipantRow {
  id: string;
  full_name: string;
  nric_masked: string;
  registration_status: string;
  attendance_rate: string;
  hrd_claim_eligible: boolean;
  certificate_id: string | null;
  revoked: boolean | null;
}

async function loadPackage(executor: Executor, packageId: string): Promise<PackageRow | undefined> {
  return one<PackageRow>(
    executor,
    sql`select id, package_code, title, operational_stage, start_date, end_date, duration_days
          from tpms.training_packages where id = ${packageId}::uuid`,
  );
}

/** Build the canonical payload for one participant of a delivered package. */
export function buildPayload(input: {
  serial: string;
  holderName: string;
  nricMasked: string;
  pkg: Pick<PackageRow, "title" | "package_code" | "start_date" | "end_date" | "duration_days">;
  providerName: string;
  providerHrdcId: string;
  issuedAt: Date;
}): CertificatePayload {
  const { pkg } = input;
  if (!pkg.start_date || !pkg.end_date || !pkg.duration_days) {
    throw new DomainError("PACKAGE_DATES_MISSING", "The package has no delivery dates");
  }
  return assertPayload({
    serial: input.serial,
    holderName: input.holderName.trim(),
    nricMasked: input.nricMasked,
    courseTitle: pkg.title.trim(),
    packageCode: pkg.package_code,
    startDate: pkg.start_date,
    endDate: pkg.end_date,
    hours: pkg.duration_days * HOURS_PER_DAY,
    providerName: input.providerName,
    providerHrdcId: input.providerHrdcId,
    issuedOn: todayMY(input.issuedAt),
  });
}

async function issueInTx(tx: Tx, packageId: string): Promise<IssueResult> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`certificates:${packageId}`}, 0))`);
  const pkg = await loadPackage(tx, packageId);
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  if (pkg.operational_stage !== "DELIVERY_COMPLETED") {
    throw new DomainError("NOT_DELIVERED", `Certificates are issued once delivery is completed; the package is ${pkg.operational_stage}`, {
      stage: pkg.operational_stage,
    });
  }
  if (!pkg.end_date) throw new DomainError("PACKAGE_DATES_MISSING", "The package has no end date");

  const participants = await rows<ParticipantRow>(
    tx,
    sql`select p.id, p.full_name, p.nric_masked, p.registration_status, p.attendance_rate, p.hrd_claim_eligible,
               c.id as certificate_id, c.revoked
          from tpms.package_participants p
          left join tpms.certificates c on c.participant_id = p.id
         where p.package_id = ${packageId}::uuid
         order by p.full_name, p.id`,
  );
  const existing = await rows<{ certificate_serial: string }>(
    tx,
    sql`select certificate_serial from tpms.certificates where package_id = ${packageId}::uuid`,
  );
  let sequence = existing.reduce((max, r) => Math.max(max, serialSequence(r.certificate_serial)), 0);

  const { TPMS_PROVIDER_NAME, TPMS_PROVIDER_HRDC_ID, TPMS_PUBLIC_BASE_URL } = env();
  // One instant for the whole run: every certificate in a batch carries the same issue date.
  const issuedAt = new Date();
  const result: IssueResult = { packageId, issued: [], skipped: [] };

  for (const p of participants) {
    if (p.certificate_id) {
      result.skipped.push({ participantId: p.id, reason: p.revoked ? "REVOKED" : "ALREADY_ISSUED" });
      continue;
    }
    if (p.registration_status === "WITHDRAWN") {
      result.skipped.push({ participantId: p.id, reason: "WITHDRAWN" });
      continue;
    }
    if (!p.hrd_claim_eligible) {
      result.skipped.push({ participantId: p.id, reason: "ATTENDANCE_BELOW_THRESHOLD", attendanceRate: Number(p.attendance_rate) });
      continue;
    }

    sequence += 1;
    const serial = certificateSerial(pkg.end_date, pkg.package_code, sequence);
    const payload = buildPayload({
      serial,
      holderName: p.full_name,
      nricMasked: p.nric_masked,
      pkg,
      providerName: TPMS_PROVIDER_NAME,
      providerHrdcId: TPMS_PROVIDER_HRDC_ID,
      issuedAt,
    });
    const payloadHash = sha256Hex(canonicalJson(payload));
    const url = verificationUrl(TPMS_PUBLIC_BASE_URL, serial);
    const bytes = await renderCertificatePdf(payload, { payloadSha256: payloadHash, verificationUrl: url });

    const doc = await storeDocument(tx, {
      packageId,
      participantId: p.id,
      documentType: "CERTIFICATE",
      fileName: `${serial}.pdf`,
      mimeType: PDF_MIME,
      bytes,
      uploadedBy: CERT_ACTOR.id,
      verificationStatus: "VERIFIED",
      verifiedBy: CERT_ACTOR.id,
      verificationNotes: "Issued by the certification engine",
      extractedMetadata: { serial, payload_sha256: payloadHash },
    });

    const [cert] = await rows<{ id: string }>(
      tx,
      sql`insert into tpms.certificates (package_id, participant_id, certificate_serial, document_vault_id,
                                         payload_sha256, sha256_hash, public_verification_url, issued_at, payload)
          values (${packageId}::uuid, ${p.id}::uuid, ${serial}, ${doc.id}::uuid, ${payloadHash}, ${doc.fileHashSha256},
                  ${url}, ${issuedAt}, ${JSON.stringify(payload)}::jsonb)
          returning id`,
    );
    await tx.execute(sql`update tpms.package_participants
                            set cert_serial_number = ${serial}, cert_issued_at = ${issuedAt}
                          where id = ${p.id}::uuid`);
    // The hashes go into the hash-chained ledger too: a later edit of the
    // certificates row would then disagree with an entry that cannot change.
    await recordAudit(tx, {
      entityType: "CERTIFICATE",
      entityId: cert.id,
      reasonCode: "CERTIFICATE_ISSUED",
      details: `Certificate ${serial} issued`,
      metadata: { package_id: packageId, serial, payload_sha256: payloadHash, sha256: doc.fileHashSha256 },
    });
    result.issued.push(serial);
  }
  return result;
}

export async function issueCertificates(packageId: string, opts: { taskId?: string | null } = {}): Promise<IssueResult> {
  if (!isUuid(packageId)) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const pkg = await loadPackage(db(), packageId);
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);

  const started = Date.now();
  const runId = await startAgentRun(db(), {
    agent: CERT_AGENT,
    tier: "L0",
    packageId,
    taskId: opts.taskId ?? null,
    inputSummary: `Issue certificates for ${pkg.package_code}`,
  });
  const provenance = (): Provenance => ({
    tier: "L0",
    agent: CERT_AGENT,
    mode: "RULE",
    provider: "rules",
    model: "certification-engine-v1",
    costMyr: 0,
    latencyMs: Date.now() - started,
    runId,
  });

  try {
    const result = await withTx(CERT_ACTOR, { reasonCode: "CERTIFICATE_ISSUED" }, (tx) => issueInTx(tx, packageId));
    await finishAgentRun(db(), runId, {
      status: "SUCCEEDED",
      output: { issued: result.issued, skipped: result.skipped },
      provenance: provenance(),
    });
    return result;
  } catch (error) {
    await finishAgentRun(db(), runId, {
      status: "FAILED",
      provenance: provenance(),
      error: isDomainError(error) ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
