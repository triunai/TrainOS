import { eq } from "drizzle-orm";
import { z } from "zod";
import { formatRM, toSen } from "@/lib/money";
import { finishAgentRun, startAgentRun } from "@/server/ai";
import { type Actor, db, schema, withTx, SYSTEM_ACTOR } from "../db/client";
import type { TrainingPackage, VaultDocument } from "../db/schema";
import { raiseDecision } from "../decisions/service";
import { DomainError } from "../domain/errors";
import { enqueue } from "../queue/queue";
import { readDocument, setVerification, storeDocument } from "../storage/vault";
import { lockPackage } from "@/server/commercial";

/**
 * Stage 3: the e-TRiS approval letter.
 *
 * The operator uploads the letter; `grant.extract_letter` (L2) reads it and
 * raises a GRANT_VERIFICATION decision pre-filled with what it found. Nothing
 * the extractor says reaches the package: only `confirmGrant`, with values a
 * named operator typed or accepted, moves GRANT_PENDING → GRANT_APPROVED.
 *
 * WHY extraction failure is not a task failure: when the OCR service (or the
 * module) is unavailable the operator can still read the letter. The decision
 * is raised with empty fields for manual entry instead of a retry loop that
 * leaves the desk empty.
 */
export const LETTER_AGENT = "grant.letter_extractor";
const LETTER_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
const RAW_TEXT_LIMIT = 4000;

export const extractionSchema = z.object({
  grantId: z.string().nullable(),
  approvedPax: z.number().int().nullable(),
  approvedAmount: z.string().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  employerName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  rawText: z.string(),
  engine: z.string(),
});
export type GrantLetterExtraction = z.infer<typeof extractionSchema>;
export type Extractor = (bytes: Uint8Array, mimeType: string) => Promise<unknown>;

/**
 * Lane C's extraction client, loaded lazily so a worker without the OCR
 * dependencies still boots; its result is re-validated by `extractionSchema`
 * (R14) rather than trusted by type.
 */
async function loadExtractor(): Promise<{ fn: Extractor | null; reason?: string }> {
  try {
    const mod = await import("@/server/extraction/client");
    return typeof mod.extractGrantLetter === "function" ? { fn: mod.extractGrantLetter } : { fn: null, reason: "EXTRACTOR_EXPORT_MISSING" };
  } catch (error) {
    return { fn: null, reason: `EXTRACTION_MODULE_UNAVAILABLE: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
  }
}

export async function recordApprovalLetter(
  packageId: string,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
  actor: Actor,
): Promise<{ document: VaultDocument; taskId: string | null }> {
  if (actor.type === "AGENT") throw new DomainError("AGENT_CANNOT_COMMIT", "An operator uploads the e-TRiS approval letter");
  if (!LETTER_MIME.has(mimeType)) throw new DomainError("UNSUPPORTED_FILE_TYPE", `The approval letter must be a PDF or an image, not ${mimeType}`);
  if (!bytes || bytes.byteLength === 0) throw new DomainError("EMPTY_FILE", "The approval letter file is empty");
  return withTx(actor, { reasonCode: "ETRIS_APPROVAL_UPLOADED" }, async (tx) => {
    const pkg = await lockPackage(tx, packageId);
    if (pkg.operationalStage !== "GRANT_PENDING") {
      throw new DomainError("PACKAGE_NOT_GRANT_PENDING", `${pkg.packageCode} is ${pkg.operationalStage}; the approval letter is recorded while the grant is pending`);
    }
    const document = await storeDocument(tx, {
      packageId,
      documentType: "ETRIS_APPROVAL",
      fileName,
      mimeType,
      bytes,
      uploadedBy: actor.id,
      verificationStatus: "PENDING",
    });
    const taskId = await enqueue(tx, {
      type: "grant.extract_letter",
      payload: { packageId, vaultId: document.id },
      idempotencyKey: `extract-letter:${document.id}`,
    });
    return { document, taskId };
  });
}

interface Check {
  field: string;
  ok: boolean;
  message: string;
}

/** L0 comparison of what the letter says against what was quoted — shown on the decision, never auto-applied. */
function crossCheck(pkg: TrainingPackage, clientName: string, x: GrantLetterExtraction | null): Check[] {
  if (!x) return [];
  const checks: Check[] = [];
  if (x.approvedAmount !== null) {
    const ok = toSen(x.approvedAmount) <= toSen(pkg.quotedAmount);
    checks.push({ field: "approvedAmount", ok, message: ok ? `${formatRM(x.approvedAmount)} is within the quotation` : `${formatRM(x.approvedAmount)} exceeds the quoted ${formatRM(pkg.quotedAmount)}` });
  }
  if (x.approvedPax !== null) {
    const ok = x.approvedPax <= pkg.paxEstimate;
    checks.push({ field: "approvedPax", ok, message: ok ? `${x.approvedPax} pax approved` : `${x.approvedPax} pax approved but ${pkg.paxEstimate} were quoted` });
  }
  if (x.startDate !== null) {
    const ok = x.startDate === pkg.startDate;
    checks.push({ field: "startDate", ok, message: ok ? "Start date matches" : `Letter says ${x.startDate}, package says ${pkg.startDate ?? "unset"}` });
  }
  if (x.endDate !== null) {
    const ok = x.endDate === pkg.endDate;
    checks.push({ field: "endDate", ok, message: ok ? "End date matches" : `Letter says ${x.endDate}, package says ${pkg.endDate ?? "unset"}` });
  }
  if (x.employerName !== null) {
    const norm = (s: string) => s.toLowerCase().replace(/sdn\.?\s*bhd\.?|berhad|bhd\.?|[^a-z0-9]/g, "");
    const ok = norm(x.employerName) === norm(clientName) || norm(clientName).includes(norm(x.employerName)) || norm(x.employerName).includes(norm(clientName));
    checks.push({ field: "employerName", ok, message: ok ? "Employer matches" : `Letter names "${x.employerName}", client is "${clientName}"` });
  }
  return checks;
}

function withoutRawText(x: GrantLetterExtraction): Omit<GrantLetterExtraction, "rawText"> {
  const { grantId, approvedPax, approvedAmount, startDate, endDate, employerName, confidence, engine } = x;
  return { grantId, approvedPax, approvedAmount, startDate, endDate, employerName, confidence, engine };
}

export interface ExtractLetterResult {
  vaultId: string;
  decisionId: string | null;
  available: boolean;
  reason?: string;
  extraction: Omit<GrantLetterExtraction, "rawText"> | null;
  skipped?: string;
}

export async function extractApprovalLetter(
  vaultId: string,
  opts: { taskId?: string | null; extractor?: Extractor } = {},
): Promise<ExtractLetterResult> {
  const read = await readDocument(vaultId);
  if (!read) throw new DomainError("DOCUMENT_NOT_FOUND", `Vault document ${vaultId} not found`);
  const { doc } = read;
  if (doc.documentType !== "ETRIS_APPROVAL") throw new DomainError("NOT_AN_APPROVAL_LETTER", `Vault document ${vaultId} is ${doc.documentType}`);
  if (!doc.packageId) throw new DomainError("DOCUMENT_WITHOUT_PACKAGE", "The approval letter is not attached to a package");
  if (doc.verificationStatus !== "PENDING") {
    return { vaultId, decisionId: null, available: false, extraction: null, skipped: `ALREADY_${doc.verificationStatus}` };
  }
  if (!read.intact) throw new DomainError("VAULT_INTEGRITY", `${doc.fileName} no longer matches its recorded SHA-256`);

  const runId = await startAgentRun(db(), { agent: LETTER_AGENT, tier: "L2", packageId: doc.packageId, taskId: opts.taskId ?? null, inputSummary: `Extract e-TRiS approval letter ${doc.fileName}` });
  try {
    let extraction: GrantLetterExtraction | null = null;
    let reason: string | undefined;
    const loaded = opts.extractor ? { fn: opts.extractor } : await loadExtractor();
    if (!loaded.fn) {
      reason = loaded.reason;
    } else {
      try {
        const raw = await loaded.fn(new Uint8Array(read.bytes), doc.mimeType);
        const parsed = extractionSchema.safeParse(raw);
        if (parsed.success) extraction = parsed.data;
        else reason = `EXTRACTION_SHAPE_REJECTED: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`;
      } catch (error) {
        reason = `EXTRACTION_FAILED: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500);
      }
    }

    const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, doc.packageId));
    const [client] = await db().select().from(schema.corporateClients).where(eq(schema.corporateClients.id, pkg.clientId));
    const checks = crossCheck(pkg, client.companyName, extraction);
    const values = {
      grantId: extraction?.grantId ?? null,
      approvedAmount: extraction?.approvedAmount ?? null,
      approvedPax: extraction?.approvedPax ?? null,
      startDate: extraction?.startDate ?? null,
      endDate: extraction?.endDate ?? null,
      employerName: extraction?.employerName ?? null,
    };
    const metadata = {
      ...doc.extractedMetadata,
      extraction: extraction ? { ...extraction, rawText: extraction.rawText.slice(0, RAW_TEXT_LIMIT) } : null,
      available: Boolean(extraction),
      reason: reason ?? null,
      checks,
      extractedAt: new Date().toISOString(),
    };

    const decision = await withTx(SYSTEM_ACTOR, { reasonCode: "ETRIS_LETTER_EXTRACTED" }, async (tx) => {
      await setVerification(tx, doc.id, "PENDING", LETTER_AGENT, extraction ? `Extracted by ${extraction.engine} (confidence ${extraction.confidence.toFixed(2)})` : `Manual entry required: ${reason}`, metadata);
      const failing = checks.filter((c) => !c.ok);
      return raiseDecision(tx, {
        gate: "GRANT_VERIFICATION",
        packageId: pkg.id,
        subjectRef: pkg.packageCode,
        title: `Verify e-TRiS approval · ${pkg.title}`,
        summary: extraction
          ? `Letter read by ${extraction.engine} at ${(extraction.confidence * 100).toFixed(0)}% confidence: grant ${values.grantId ?? "?"}, ` +
            `${values.approvedAmount ? formatRM(values.approvedAmount) : "amount ?"}, ${values.approvedPax ?? "?"} pax.` +
            (failing.length ? ` Check: ${failing.map((c) => c.message).join("; ")}.` : " All fields match the quotation.")
          : `Automatic extraction was unavailable (${reason}). Read the letter and enter the grant reference, amount and headcount.`,
        payload: { vaultId: doc.id, extracted: values, confidence: extraction?.confidence ?? 0, engine: extraction?.engine ?? null, available: Boolean(extraction), reason: reason ?? null, checks },
        options: [
          { id: "CONFIRM", label: "Confirm grant", description: "Verify the letter and move the package to Grant approved with these values", consequence: "The T-14 viability check is scheduled" },
          { id: "FLAG", label: "Flag the letter", description: "The letter is wrong or unreadable; ask HR for the correct approval" },
        ],
        raisedBy: LETTER_AGENT,
        raisedByTier: "L2",
        slaHours: 24,
      });
    });

    const summary = extraction ? withoutRawText(extraction) : null;
    await finishAgentRun(db(), runId, {
      status: extraction ? "SUCCEEDED" : "FALLBACK",
      output: { vaultId, decisionId: decision.id, available: Boolean(extraction), reason: reason ?? null, values },
      provenance: { tier: "L2", mode: "EXTRACTION", agent: LETTER_AGENT, engine: extraction?.engine ?? null, confidence: extraction?.confidence ?? null },
    });
    return { vaultId, decisionId: decision.id, available: Boolean(extraction), reason, extraction: summary };
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    throw error;
  }
}
