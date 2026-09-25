import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "@/server/audit/ledger";
import {
  certificatesBundleZip,
  handlers,
  issueCertificates,
  listCertificates,
  payloadSha256,
  readCertificatePdf,
  revokeCertificate,
  verifyCertificate,
  type CertificatePayload,
} from "@/server/certificates";
import { db, one, rows } from "@/server/db/client";
import type { Task } from "@/server/db/schema";
import { env } from "@/server/env";
import { sha256Hex } from "@/server/lib/crypto";
import { expectRefusal, releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt, fixtureNric, type LifecycleFixture } from "../helpers/lifecycle";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

const code = async (work: Promise<unknown>) =>
  work.then(
    () => "RESOLVED",
    (e: { code?: string }) => e.code ?? String(e),
  );

interface CertRow {
  id: string;
  certificate_serial: string;
  participant_id: string;
  document_vault_id: string;
  payload_sha256: string;
  sha256_hash: string;
  public_verification_url: string;
  payload: CertificatePayload;
}

const certsOf = (packageId: string) =>
  rows<CertRow>(
    db(),
    sql`select id, certificate_serial, participant_id, document_vault_id, payload_sha256, sha256_hash, public_verification_url, payload
          from tpms.certificates where package_id = ${packageId}::uuid order by certificate_serial`,
  );

/** Absolute path of a vault blob in the test storage directory. */
async function blobPath(vaultId: string): Promise<string> {
  const doc = await one<{ file_path: string }>(db(), sql`select file_path from tpms.compliance_vault where id = ${vaultId}::uuid`);
  return path.resolve(process.cwd(), env().TPMS_STORAGE_DIR, doc!.file_path);
}

/** Overwrite a blob for the duration of `fn`, then put the original bytes back (the vault is content-addressed and shared across runs). */
async function withTamperedBlob<T>(vaultId: string, fn: () => Promise<T>): Promise<T> {
  const file = await blobPath(vaultId);
  const original = readFileSync(file);
  const forged = Buffer.from(original);
  forged[forged.length - 20] ^= 0xff;
  writeFileSync(file, forged);
  try {
    return await fn();
  } finally {
    writeFileSync(file, original);
  }
}

let fx: LifecycleFixture;
const pid = (i: number) => fx.participantIds[i];

describe("issuing certificates", () => {
  beforeAll(async () => {
    fx = await buildPackageAt("DELIVERY_COMPLETED");
    // P5 withdraws; P6 attended 75% — below the 80% HRD Corp threshold.
    await db().execute(sql`update tpms.package_participants set registration_status = 'WITHDRAWN' where id = ${pid(4)}::uuid`);
    await db().execute(sql`update tpms.package_participants set attendance_rate = 75 where id = ${pid(5)}::uuid`);
  });

  it("refuses a package that has not completed delivery (NOT_DELIVERED)", async () => {
    const early = await buildPackageAt("DELIVERY_IN_PROGRESS");
    expect(await code(issueCertificates(early.pkg.id))).toBe("NOT_DELIVERED");
    const [run] = await rows<{ status: string; error: string }>(
      db(),
      sql`select status, error from tpms.agent_runs where agent = 'certification.engine' and package_id = ${early.pkg.id}::uuid`,
    );
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(/^NOT_DELIVERED/);
    expect(await code(issueCertificates("00000000-0000-4000-8000-000000000000"))).toBe("PACKAGE_NOT_FOUND");
  });

  it("issues only to active participants at >= 80% attendance, with well-formed unique serials", async () => {
    const result = await issueCertificates(fx.pkg.id);
    const year = fx.pkg.endDate!.slice(0, 4);
    const number = /(\d+)$/.exec(fx.pkg.packageCode)![1];
    expect(result.issued).toEqual([1, 2, 3, 4].map((n) => `CERT-${year}-${number}-00${n}`));
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { participantId: pid(4), reason: "WITHDRAWN" },
        { participantId: pid(5), reason: "ATTENDANCE_BELOW_THRESHOLD", attendanceRate: 75 },
      ]),
    );
    expect(result.skipped).toHaveLength(2);

    const certs = await certsOf(fx.pkg.id);
    expect(certs.map((c) => c.participant_id)).toEqual([pid(0), pid(1), pid(2), pid(3)]);
    expect(new Set(certs.map((c) => c.certificate_serial)).size).toBe(4);
    for (const c of certs) {
      expect(c.certificate_serial).toMatch(/^CERT-\d{4}-\d+-\d{3}$/);
      expect(c.public_verification_url).toBe(`${env().TPMS_PUBLIC_BASE_URL}/verify/${c.certificate_serial}`);
      expect(payloadSha256(c.payload)).toBe(c.payload_sha256);
      expect(c.payload.nricMasked).toMatch(/^\*{6}-\*\*-\d{4}$/);
      expect(c.payload.hours).toBe(14);
    }
  });

  it("files each PDF in the vault as verified evidence and stamps the participant", async () => {
    const [c] = await certsOf(fx.pkg.id);
    const vault = await one<{ document_type: string; participant_id: string; verification_status: string; uploaded_by: string; file_hash_sha256: string }>(
      db(),
      sql`select document_type, participant_id, verification_status, uploaded_by, file_hash_sha256 from tpms.compliance_vault where id = ${c.document_vault_id}::uuid`,
    );
    expect(vault).toMatchObject({
      document_type: "CERTIFICATE",
      participant_id: pid(0),
      verification_status: "VERIFIED",
      uploaded_by: "sys_certification_engine",
      file_hash_sha256: c.sha256_hash,
    });
    const pdf = await readCertificatePdf(c.certificate_serial);
    expect(pdf!.intact).toBe(true);
    expect(sha256Hex(pdf!.bytes)).toBe(c.sha256_hash);
    const doc = await PDFDocument.load(pdf!.bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height); // landscape A4

    const p = await one<{ cert_serial_number: string; cert_issued_at: Date }>(
      db(),
      sql`select cert_serial_number, cert_issued_at from tpms.package_participants where id = ${pid(0)}::uuid`,
    );
    expect(p!.cert_serial_number).toBe(c.certificate_serial);
    expect(p!.cert_issued_at).not.toBeNull();
  });

  it("audits each issue without NRIC, and records an L0 agent run", async () => {
    const audits = await rows<{ entity_type: string; metadata_diff: Record<string, unknown> }>(
      db(),
      sql`select entity_type, metadata_diff from tpms.audit_ledger
           where reason_code = 'CERTIFICATE_ISSUED' and metadata_diff->>'package_id' = ${fx.pkg.id}`,
    );
    expect(audits).toHaveLength(4);
    expect(audits.every((a) => a.entity_type === "CERTIFICATE" && typeof a.metadata_diff.serial === "string")).toBe(true);
    const blob = JSON.stringify(audits);
    for (let i = 0; i < 6; i += 1) {
      const raw = fixtureNric(90, i);
      expect(blob).not.toContain(raw);
      expect(blob).not.toContain(`${raw.slice(0, 6)}-${raw.slice(6, 8)}-${raw.slice(8)}`);
    }
    expect(blob).not.toContain("*-**-");

    const run = await one<{ tier: string; status: string; output: { issued: string[] } }>(
      db(),
      sql`select tier, status, output from tpms.agent_runs where agent = 'certification.engine' and package_id = ${fx.pkg.id}::uuid`,
    );
    expect(run).toMatchObject({ tier: "L0", status: "SUCCEEDED" });
    expect(run!.output.issued).toHaveLength(4);
  });

  it("is idempotent, and picks up a participant whose attendance was corrected", async () => {
    const again = await issueCertificates(fx.pkg.id);
    expect(again.issued).toEqual([]);
    expect(again.skipped.filter((s) => s.reason === "ALREADY_ISSUED")).toHaveLength(4);
    expect(await certsOf(fx.pkg.id)).toHaveLength(4);

    await db().execute(sql`update tpms.package_participants set attendance_rate = 87.5 where id = ${pid(5)}::uuid`);
    const late = await issueCertificates(fx.pkg.id);
    expect(late.issued).toHaveLength(1);
    expect(late.issued[0]).toMatch(/-005$/);
    const vaultCount = await one<{ n: number }>(
      db(),
      sql`select count(*)::int as n from tpms.compliance_vault where package_id = ${fx.pkg.id}::uuid and document_type = 'CERTIFICATE'`,
    );
    expect(vaultCount!.n).toBe(5);
  });

  it("runs as the certificates.issue task handler", async () => {
    const other = await buildPackageAt("DELIVERY_COMPLETED");
    const handler = handlers["certificates.issue"]!;
    const task = { id: null, payload: { packageId: other.pkg.id } } as unknown as Task;
    const ctx = { workerId: "w-test", heartbeat: async () => undefined };
    expect(await handler(task, ctx)).toMatchObject({ issued: 6, skipped: 0 });
    expect(await handler(task, ctx)).toMatchObject({ issued: 0, skipped: 6 });
    expect(await code(handler({ ...task, payload: { packageId: "nope" } } as Task, ctx))).toBe("INVALID_TASK_PAYLOAD");
  });
});

describe("public verification", () => {
  it("reports VALID with the masked NRIC and no internal ids", async () => {
    const [c] = await certsOf(fx.pkg.id);
    const result = await verifyCertificate(c.certificate_serial.toLowerCase());
    expect(result).toMatchObject({
      status: "VALID",
      serial: c.certificate_serial,
      holderName: "Participant 1",
      courseTitle: fx.pkg.title,
      startDate: fx.pkg.startDate,
      endDate: fx.pkg.endDate,
      providerName: env().TPMS_PROVIDER_NAME,
      payloadSha256: c.payload_sha256,
      fileSha256: c.sha256_hash,
      fileIntact: true,
      checks: { file: true, payload: true, ledger: true },
    });
    const masked = await one<{ nric_masked: string }>(db(), sql`select nric_masked from tpms.package_participants where id = ${pid(0)}::uuid`);
    expect(result.status !== "NOT_FOUND" && result.nricMasked).toBe(masked!.nric_masked);
    const json = JSON.stringify(result);
    expect(json).not.toContain(fixtureNric(90, 0));
    expect(json).not.toContain(pid(0));
    expect(json).not.toContain(fx.pkg.id);
    expect(json).not.toContain(c.document_vault_id);
  });

  it("reports NOT_FOUND for unknown or malformed serials", async () => {
    expect(await verifyCertificate("CERT-2099-9999-001")).toEqual({ status: "NOT_FOUND", serial: "CERT-2099-9999-001" });
    expect((await verifyCertificate("'; drop table tpms.certificates; --")).status).toBe("NOT_FOUND");
  });

  it("reports TAMPERED when the stored PDF bytes change on disk", async () => {
    const [c] = await certsOf(fx.pkg.id);
    const tampered = await withTamperedBlob(c.document_vault_id, () => verifyCertificate(c.certificate_serial));
    expect(tampered).toMatchObject({ status: "TAMPERED", fileIntact: false, checks: { file: false, payload: true, ledger: true } });
    expect((await verifyCertificate(c.certificate_serial)).status).toBe("VALID");
  });

  it("reports TAMPERED when the live record drifts from what was certified", async () => {
    const [, c] = await certsOf(fx.pkg.id);
    await db().execute(sql`update tpms.package_participants set full_name = 'Someone Else' where id = ${c.participant_id}::uuid`);
    const drifted = await verifyCertificate(c.certificate_serial);
    expect(drifted).toMatchObject({ status: "TAMPERED", holderName: "Participant 2", checks: { file: true, payload: false } });
    await db().execute(sql`update tpms.package_participants set full_name = 'Participant 2' where id = ${c.participant_id}::uuid`);
    expect((await verifyCertificate(c.certificate_serial)).status).toBe("VALID");
  });

  it("keeps an issued certificate immutable in the database", async () => {
    const [c] = await certsOf(fx.pkg.id);
    await expectRefusal(
      db().execute(sql`update tpms.certificates set sha256_hash = repeat('0', 64) where id = ${c.id}::uuid`),
      /CERTIFICATE_IMMUTABLE/,
    );
    await expectRefusal(
      db().execute(sql`update tpms.certificates set payload = jsonb_set(payload, '{holderName}', '"X"') where id = ${c.id}::uuid`),
      /CERTIFICATE_IMMUTABLE/,
    );
    await expectRefusal(db().execute(sql`delete from tpms.certificates where id = ${c.id}::uuid`), /CERTIFICATE_IMMUTABLE/);
    await expectRefusal(
      db().execute(sql`update tpms.certificates set revoked = true where id = ${c.id}::uuid`),
      /cert_revocation_named/,
    );
  });
});

describe("revocation and the bundle", () => {
  it("revokes with a named human and a reason, one way only", async () => {
    const [, , c] = await certsOf(fx.pkg.id);
    expect(await code(revokeCertificate(c.certificate_serial, "agent thinks so", { type: "AGENT", id: "agent_x" }))).toBe("ACTOR_NOT_ALLOWED");
    expect(await code(revokeCertificate(c.certificate_serial, " ", ALEX))).toBe("REASON_REQUIRED");
    expect(await code(revokeCertificate("CERT-2099-9999-001", "typo in name", ALEX))).toBe("CERTIFICATE_NOT_FOUND");

    const revoked = await revokeCertificate(c.certificate_serial, "Attendance record found to be falsified", ALEX);
    expect(revoked.serial).toBe(c.certificate_serial);
    const result = await verifyCertificate(c.certificate_serial);
    expect(result).toMatchObject({ status: "REVOKED", checks: { file: true, payload: true, ledger: true } });
    expect(result.status !== "NOT_FOUND" && result.revokedAt).toBe(revoked.revokedAt);
    expect(JSON.stringify(result)).not.toContain("falsified");

    expect(await code(revokeCertificate(c.certificate_serial, "again", ALEX))).toBe("ALREADY_REVOKED");
    await expectRefusal(
      db().execute(sql`update tpms.certificates set revoked = false, revoked_at = null, revoked_by = null, revoked_reason = null
                        where id = ${c.id}::uuid`),
      /CERTIFICATE_REVOCATION_FINAL/,
    );
    const audit = await one<{ actor_id: string; reason_details: string }>(
      db(),
      sql`select actor_id, reason_details from tpms.audit_ledger where reason_code = 'CERTIFICATE_REVOKED' and entity_id = ${c.id}::uuid`,
    );
    expect(audit).toEqual({ actor_id: ALEX.id, reason_details: "Attendance record found to be falsified" });

    const rerun = await issueCertificates(fx.pkg.id);
    expect(rerun.issued).toEqual([]);
    expect(rerun.skipped).toContainEqual({ participantId: c.participant_id, reason: "REVOKED" });

    const listed = await listCertificates({ packageId: fx.pkg.id });
    expect(listed).toHaveLength(5);
    expect(listed.find((l) => l.serial === c.certificate_serial)).toMatchObject({ revoked: true, revokedBy: ALEX.id });
    expect(await listCertificates({ packageId: "nope" })).toEqual([]);
  });

  it("bundles live certificates with a manifest the files agree with", async () => {
    const certs = await certsOf(fx.pkg.id);
    const bundle = await certificatesBundleZip(fx.pkg.id);
    expect(bundle.manifest.count).toBe(4);
    expect(bundle.manifest.excludedRevoked).toEqual([certs[2].certificate_serial]);

    const zip = await JSZip.loadAsync(bundle.bytes);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([...certs.filter((_, i) => i !== 2).map((c) => `${c.certificate_serial}.pdf`), "manifest.json"].sort());
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    for (const [serial, hash] of Object.entries(manifest.certificates)) {
      expect(sha256Hex(await zip.file(`${serial}.pdf`)!.async("uint8array"))).toBe(hash);
    }
    expect((await certificatesBundleZip(fx.pkg.id)).bytes).toEqual(bundle.bytes);

    const [c] = certs;
    expect(await withTamperedBlob(c.document_vault_id, () => code(certificatesBundleZip(fx.pkg.id)))).toBe("CERTIFICATE_FILE_TAMPERED");
    expect((await verifyChain()).ok).toBe(true);
  });
});
