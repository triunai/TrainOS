import { sql } from "drizzle-orm";
import { recordAudit } from "../audit/ledger";
import { type Actor, db, one, rows, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { isUuid, normaliseSerial } from "./payload";

/**
 * Operator-side certificate registry: the list behind the certificates screen
 * and revocation. Revocation is one-way (the DB guard refuses an un-revoke)
 * and is a human decision — an AGENT actor is refused, per "agents propose,
 * humans and rules dispose".
 */
export interface CertificateListItem {
  id: string;
  serial: string;
  packageId: string;
  packageCode: string;
  participantId: string;
  holderName: string;
  nricMasked: string;
  issuedAt: string;
  revoked: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
  revokedBy: string | null;
  publicVerificationUrl: string;
  payloadSha256: string;
  fileSha256: string;
  documentVaultId: string;
}

interface ListRow {
  id: string;
  certificate_serial: string;
  package_id: string;
  package_code: string;
  participant_id: string;
  full_name: string;
  nric_masked: string;
  issued_at: Date;
  revoked: boolean;
  revoked_at: Date | null;
  revoked_reason: string | null;
  revoked_by: string | null;
  public_verification_url: string;
  payload_sha256: string;
  sha256_hash: string;
  document_vault_id: string;
}

export async function listCertificates(opts: { packageId?: string } = {}): Promise<CertificateListItem[]> {
  if (opts.packageId !== undefined && !isUuid(opts.packageId)) return [];
  const filter = opts.packageId ? sql`where c.package_id = ${opts.packageId}::uuid` : sql``;
  const list = await rows<ListRow>(
    db(),
    sql`select c.id, c.certificate_serial, c.package_id, pk.package_code, c.participant_id, p.full_name, p.nric_masked,
               c.issued_at, c.revoked, c.revoked_at, c.revoked_reason, c.revoked_by, c.public_verification_url,
               c.payload_sha256, c.sha256_hash, c.document_vault_id
          from tpms.certificates c
          join tpms.package_participants p on p.id = c.participant_id
          join tpms.training_packages pk on pk.id = c.package_id
          ${filter}
         order by c.issued_at desc, c.certificate_serial`,
  );
  return list.map((r) => ({
    id: r.id,
    serial: r.certificate_serial,
    packageId: r.package_id,
    packageCode: r.package_code,
    participantId: r.participant_id,
    holderName: r.full_name,
    nricMasked: r.nric_masked,
    issuedAt: new Date(r.issued_at).toISOString(),
    revoked: r.revoked,
    revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
    revokedReason: r.revoked_reason,
    revokedBy: r.revoked_by,
    publicVerificationUrl: r.public_verification_url,
    payloadSha256: r.payload_sha256,
    fileSha256: r.sha256_hash,
    documentVaultId: r.document_vault_id,
  }));
}

export async function revokeCertificate(rawSerial: string, reason: string, actor: Actor): Promise<{ serial: string; revokedAt: string }> {
  if (actor.type === "AGENT") {
    throw new DomainError("ACTOR_NOT_ALLOWED", "Revoking a certificate is a human decision; agents may only propose it");
  }
  const why = (reason ?? "").trim();
  if (why.length < 3) throw new DomainError("REASON_REQUIRED", "A revocation needs a reason");
  const serial = normaliseSerial(rawSerial);
  if (!serial) throw new DomainError("CERTIFICATE_NOT_FOUND", `Certificate ${rawSerial} not found`);

  return withTx(actor, { reasonCode: "CERTIFICATE_REVOKED", reasonDetails: why }, async (tx) => {
    const cert = await one<{ id: string; package_id: string; revoked: boolean }>(
      tx,
      sql`select id, package_id, revoked from tpms.certificates where certificate_serial = ${serial} for update`,
    );
    if (!cert) throw new DomainError("CERTIFICATE_NOT_FOUND", `Certificate ${serial} not found`);
    if (cert.revoked) throw new DomainError("ALREADY_REVOKED", `Certificate ${serial} is already revoked`);

    const [updated] = await rows<{ revoked_at: Date }>(
      tx,
      sql`update tpms.certificates
             set revoked = true, revoked_at = now(), revoked_reason = ${why}, revoked_by = ${actor.id}
           where id = ${cert.id}::uuid
       returning revoked_at`,
    );
    await recordAudit(tx, {
      entityType: "CERTIFICATE",
      entityId: cert.id,
      reasonCode: "CERTIFICATE_REVOKED",
      details: why,
      metadata: { package_id: cert.package_id, serial },
    });
    return { serial, revokedAt: new Date(updated.revoked_at).toISOString() };
  });
}
