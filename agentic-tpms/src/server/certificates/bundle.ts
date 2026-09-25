import { sql } from "drizzle-orm";
import JSZip from "jszip";
import { db, one, rows } from "../db/client";
import { DomainError } from "../domain/errors";
import { readDocument } from "../storage/vault";
import { isUuid } from "./payload";

/**
 * All of a package's live certificates as one ZIP for the executive pack,
 * with `manifest.json` mapping each serial to its file SHA-256 so the
 * recipient can check every PDF without trusting the ZIP.
 *
 * A file that no longer matches its recorded hash stops the bundle: shipping
 * it alongside a manifest that contradicts it would hand the client evidence
 * of tampering and no explanation.
 */
export interface CertificateBundle {
  fileName: string;
  bytes: Uint8Array;
  manifest: {
    packageCode: string;
    algorithm: "SHA-256";
    count: number;
    certificates: Record<string, string>;
    excludedRevoked: string[];
  };
}

export async function certificatesBundleZip(packageId: string): Promise<CertificateBundle> {
  if (!isUuid(packageId)) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const pkg = await one<{ package_code: string }>(
    db(),
    sql`select package_code from tpms.training_packages where id = ${packageId}::uuid`,
  );
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);

  const certs = await rows<{ certificate_serial: string; document_vault_id: string; sha256_hash: string; revoked: boolean; issued_at: Date }>(
    db(),
    sql`select certificate_serial, document_vault_id, sha256_hash, revoked, issued_at
          from tpms.certificates where package_id = ${packageId}::uuid order by certificate_serial`,
  );
  const live = certs.filter((c) => !c.revoked);
  if (live.length === 0) throw new DomainError("NO_CERTIFICATES", `Package ${pkg.package_code} has no issued certificates`);

  // Entry timestamps come from the data, so the same certificates zip to the same bytes.
  const stamp = new Date(Math.max(...live.map((c) => new Date(c.issued_at).getTime())));
  const zip = new JSZip();
  const manifest: CertificateBundle["manifest"] = {
    packageCode: pkg.package_code,
    algorithm: "SHA-256",
    count: live.length,
    certificates: {},
    excludedRevoked: certs.filter((c) => c.revoked).map((c) => c.certificate_serial),
  };
  for (const cert of live) {
    const read = await readDocument(cert.document_vault_id).catch(() => undefined);
    if (!read || !read.intact || read.doc.fileHashSha256 !== cert.sha256_hash) {
      throw new DomainError("CERTIFICATE_FILE_TAMPERED", `The stored file for ${cert.certificate_serial} does not match its recorded SHA-256`, {
        serial: cert.certificate_serial,
      });
    }
    zip.file(`${cert.certificate_serial}.pdf`, read.bytes, { date: stamp, binary: true });
    manifest.certificates[cert.certificate_serial] = cert.sha256_hash;
  }
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, { date: stamp });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { fileName: `${pkg.package_code}-certificates.zip`, bytes, manifest };
}
