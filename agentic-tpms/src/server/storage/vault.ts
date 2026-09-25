import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { env } from "../env";
import { type Executor, db, schema } from "../db/client";
import { sha256Hex } from "../lib/crypto";
import type { VaultDocument } from "../db/schema";

/**
 * The compliance evidence vault. Files are content-addressed on disk
 * (`vault/ab/<sha256>`), so the path IS the hash and a byte changed on disk is
 * detectable on every read. The database row is immutable except for its
 * verification fields (trigger `vault_guard`), and every insert and verdict
 * lands in the audit ledger (trigger `vault_audit`).
 *
 * Storage is the local filesystem behind this one module; an S3 or Supabase
 * Storage adapter replaces `writeBlob`/`readBlob` without touching callers.
 */
export type DocumentType = VaultDocument["documentType"];

export interface StoreInput {
  packageId?: string | null;
  trainerId?: string | null;
  participantId?: string | null;
  documentType: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  uploadedBy: string;
  extractedMetadata?: Record<string, unknown>;
  verificationStatus?: "PENDING" | "VERIFIED" | "FLAGGED";
  verifiedBy?: string;
  verificationNotes?: string;
}

function root(): string {
  return path.resolve(process.cwd(), env().TPMS_STORAGE_DIR);
}

function writeBlob(hash: string, bytes: Uint8Array): string {
  const relative = path.posix.join("vault", hash.slice(0, 2), hash);
  const full = path.join(root(), relative);
  // Content-addressed: an existing file with the right hash is already correct.
  // One whose bytes no longer hash to its name was corrupted or tampered with —
  // storing the genuine bytes again repairs it rather than trusting the path.
  if (!existsSync(full) || sha256Hex(readFileSync(full)) !== hash) {
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
  return relative;
}

function readBlob(relative: string): Buffer {
  return readFileSync(path.join(root(), relative));
}

export async function storeDocument(executor: Executor, input: StoreInput): Promise<VaultDocument> {
  const hash = sha256Hex(input.bytes);
  const filePath = writeBlob(hash, input.bytes);
  const verified = input.verificationStatus === "VERIFIED";
  const [row] = await executor
    .insert(schema.complianceVault)
    .values({
      packageId: input.packageId ?? null,
      trainerId: input.trainerId ?? null,
      participantId: input.participantId ?? null,
      documentType: input.documentType,
      fileName: input.fileName.slice(0, 255),
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      filePath,
      fileHashSha256: hash,
      verificationStatus: input.verificationStatus ?? "PENDING",
      extractedMetadata: input.extractedMetadata ?? {},
      verificationNotes: input.verificationNotes ?? null,
      verifiedBy: verified ? (input.verifiedBy ?? input.uploadedBy) : null,
      verifiedAt: verified ? new Date() : null,
      uploadedBy: input.uploadedBy,
    })
    .returning();
  return row;
}

export interface ReadResult {
  doc: VaultDocument;
  bytes: Buffer;
  /** False when the bytes on disk no longer hash to the recorded SHA-256. */
  intact: boolean;
}

export async function readDocument(id: string, executor: Executor = db()): Promise<ReadResult | undefined> {
  const [doc] = await executor.select().from(schema.complianceVault).where(eq(schema.complianceVault.id, id));
  if (!doc) return undefined;
  const bytes = readBlob(doc.filePath);
  return { doc, bytes, intact: sha256Hex(bytes) === doc.fileHashSha256 };
}

export async function setVerification(
  executor: Executor,
  id: string,
  status: "VERIFIED" | "FLAGGED" | "PENDING",
  by: string,
  notes?: string,
  extracted?: Record<string, unknown>,
): Promise<VaultDocument> {
  const [row] = await executor
    .update(schema.complianceVault)
    .set({
      verificationStatus: status,
      verifiedBy: status === "PENDING" ? null : by,
      verifiedAt: status === "PENDING" ? null : new Date(),
      verificationNotes: notes ?? null,
      ...(extracted ? { extractedMetadata: extracted } : {}),
    })
    .where(eq(schema.complianceVault.id, id))
    .returning();
  return row;
}
