import { eq } from "drizzle-orm";
import { type Actor, db, schema, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { enqueue } from "../queue/queue";
import { storeDocument } from "../storage/vault";
import type { VaultDocument } from "../db/schema";

/**
 * Operator uploads of evidence that no extraction lane owns (JD/14, BEO, DO,
 * trainer agreements). T3 scans and session photos go through their own lanes
 * (OCR and EXIF). Every upload lands PENDING; verification is a separate,
 * named act. If the claim is being collated, collation is re-run.
 */
const ALLOWED = ["FORM_JD14", "BEO", "DO", "TRAINER_AGREEMENT", "TRAINER_CV", "OTHER"] as const;
export type UploadableType = (typeof ALLOWED)[number];
const MAX_BYTES = 15 * 1024 * 1024;
const MIME = /^(application\/pdf|image\/(png|jpe?g|webp|heic))$/;

export async function uploadEvidence(
  packageId: string,
  input: { documentType: string; fileName: string; mimeType: string; bytes: Uint8Array },
  actor: Actor,
): Promise<VaultDocument> {
  if (!(ALLOWED as readonly string[]).includes(input.documentType)) {
    throw new DomainError("DOCUMENT_TYPE_NOT_UPLOADABLE", `${input.documentType} is produced by the system, not uploaded`);
  }
  if (input.bytes.byteLength === 0) throw new DomainError("EMPTY_FILE", "The file is empty");
  if (input.bytes.byteLength > MAX_BYTES) throw new DomainError("FILE_TOO_LARGE", "Evidence files are limited to 15 MB");
  if (!MIME.test(input.mimeType)) throw new DomainError("FILE_TYPE_REFUSED", "Upload a PDF or an image");
  const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", "Package not found");
  return withTx(actor, { reasonCode: "EVIDENCE_UPLOADED" }, async (tx) => {
    const doc = await storeDocument(tx, {
      packageId,
      documentType: input.documentType,
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: input.bytes,
      uploadedBy: actor.id,
    });
    if (pkg.financialStage === "CLAIM_NOT_READY") {
      await enqueue(tx, { type: "claims.collate", payload: { packageId }, idempotencyKey: `collate:${packageId}:upload:${doc.id}` });
    }
    return doc;
  });
}
