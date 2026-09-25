import { and, desc, eq, ne } from "drizzle-orm";
import JSZip from "jszip";
import { formatDate, formatRange, todayMY } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { finishAgentRun, startAgentRun } from "@/server/ai";
import { type Executor, db, schema, withTx, SYSTEM_ACTOR } from "../db/client";
import type { Client, Quotation, TrainingPackage, Trainer, VaultDocument } from "../db/schema";
import { PdfBuilder } from "../documents/pdf";
import { DomainError } from "../domain/errors";
import { DELIVERY_MODE_LABEL, type DeliveryMode } from "../domain/stages";
import { sha256Hex } from "../lib/crypto";
import { readDocument, storeDocument } from "../storage/vault";
import { renderOutlinePdf, renderQuotationPdf, type CourseOutline } from "@/server/commercial";

/**
 * Task `grant.compile_dossier` — the e-TRiS application pack the employer's
 * HR uploads when applying for the SBL-Khas grant.
 *
 * WHY a manifest with a SHA-256 per file: the dossier is assembled from vault
 * evidence, and the manifest lets anyone later prove the pack HR submitted is
 * byte-for-byte what the vault holds. The ZIP is deterministic (fixed file
 * dates, fixed order), so recompiling unchanged inputs yields the same hash and
 * the vault row is reused rather than duplicated.
 */
export const DOSSIER_AGENT = "grant.dossier_compiler";
const ZIP_DATE = new Date(Date.UTC(2026, 0, 1));

export interface DossierEntry {
  file: string;
  kind: "COVER_CHECKLIST" | "FORM_HRD_LD" | "QUOTATION" | "TRAINER_CV" | "TTT_CERT";
  source: "VAULT" | "GENERATED";
  vaultId: string | null;
  sha256: string;
  bytes: number;
}

export interface DossierResult {
  vaultId: string;
  sha256: string;
  files: DossierEntry[];
  missing: string[];
  reused: boolean;
  runId: string;
}

const extensionFor = (mime: string): string =>
  mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "bin";

async function latestDoc(executor: Executor, where: ReturnType<typeof and>): Promise<VaultDocument | undefined> {
  const [row] = await executor.select().from(schema.complianceVault).where(where).orderBy(desc(schema.complianceVault.createdAt)).limit(1);
  return row;
}

async function vaultBytes(doc: VaultDocument, executor: Executor): Promise<Uint8Array> {
  const read = await readDocument(doc.id, executor);
  if (!read) throw new Error(`Vault row ${doc.id} vanished while compiling`);
  if (!read.intact) throw new DomainError("VAULT_INTEGRITY", `${doc.documentType} ${doc.fileName} no longer matches its recorded SHA-256`);
  return new Uint8Array(read.bytes);
}

export async function renderTrainerProfilePdf(trainer: Trainer): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create({ title: "Trainer Profile", reference: `TP-${trainer.tttCertNumber}` });
  pdf.letterhead(trainer.fullName);
  pdf.keyValues([
    ["Name", trainer.fullName],
    ["HRD Corp TTT certificate", trainer.tttCertNumber],
    ["TTT valid until", trainer.tttCertExpiryDate ? formatDate(trainer.tttCertExpiryDate) : "—"],
    ["TTT verified by provider", trainer.tttVerified ? "Yes" : "No"],
    ["Specialties", trainer.specialties.join(", ") || "—"],
    ["Contact", `${trainer.email} · ${trainer.phone}`],
  ]);
  pdf.heading("Profile");
  pdf.text(trainer.bioSummary?.trim() || "Profile summary not yet provided; the trainer's full CV should replace this page.", { size: 9.5 });
  pdf.caption("Generated from the provider's trainer register because no CV was on file.");
  return pdf.save({ footer: "Trainer profile" });
}

async function renderChecklistPdf(input: {
  pkg: TrainingPackage;
  client: Client;
  quotation: Quotation;
  outline: CourseOutline;
  trainer: Trainer | null;
  entries: Array<{ label: string; file: string | null; status: string }>;
}): Promise<Uint8Array> {
  const { pkg, client, quotation, outline } = input;
  const pdf = await PdfBuilder.create({ title: "e-TRiS Grant Application Dossier", reference: `DOS-${pkg.packageCode}` });
  pdf.letterhead(pkg.title);
  pdf.caption("For the employer's HR to submit an SBL-Khas grant application in e-TRiS before the first training day.");
  pdf.heading("Application details");
  pdf.keyValues([
    ["Employer", client.companyName],
    ["MyCoID", client.hrdcorpMycoid ?? "— (employer to enter)"],
    ["SSM registration", client.ssmRegistration ?? "—"],
    ["Programme title", pkg.title],
    ["Course", `${outline.courseTitle} (${outline.courseCode})`],
    ["Delivery mode", DELIVERY_MODE_LABEL[pkg.deliveryMode as DeliveryMode] ?? pkg.deliveryMode],
    ["Training dates", formatRange(pkg.startDate, pkg.endDate)],
    ["Duration", `${outline.durationDays} day(s) · ${outline.totalHours} hours`],
    ["Participants", `${pkg.paxEstimate} pax`],
    ["Venue", outline.venue],
    ["Course fee", `${formatRM(quotation.quotedAmount)} (Allowable Cost Matrix ${quotation.costPolicyVersion} cap ${formatRM(quotation.allowableCap)})`],
    ["Trainer", input.trainer ? `${input.trainer.fullName} (TTT ${input.trainer.tttCertNumber})` : "To be assigned"],
  ]);
  pdf.heading("Checklist");
  pdf.table(
    [
      { label: "Document", width: 4 },
      { label: "File in this pack", width: 4 },
      { label: "Status", width: 2 },
    ],
    input.entries.map((e) => [e.label, e.file ?? "—", e.status]),
    { zebra: true },
  );
  pdf.caption("manifest.json lists the SHA-256 of every file in this pack.");
  return pdf.save({ footer: `Compiled ${formatDate(todayMY())}` });
}

export async function compileDossier(packageId: string, opts: { taskId?: string | null } = {}): Promise<DossierResult> {
  const runId = await startAgentRun(db(), { agent: DOSSIER_AGENT, tier: "L0", packageId, taskId: opts.taskId ?? null, inputSummary: `Compile e-TRiS dossier for ${packageId}` });
  try {
    const executor = db();
    const [pkg] = await executor.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    const [client] = await executor.select().from(schema.corporateClients).where(eq(schema.corporateClients.id, pkg.clientId));
    const [quotation] = await executor
      .select()
      .from(schema.quotations)
      .where(and(eq(schema.quotations.packageId, packageId), eq(schema.quotations.status, "APPROVED")))
      .orderBy(desc(schema.quotations.version))
      .limit(1);
    if (!quotation) throw new DomainError("NO_APPROVED_QUOTATION", `${pkg.packageCode} has no approved quotation to build a dossier from`);
    const outline = quotation.courseOutline as unknown as CourseOutline;
    if (!Array.isArray(outline.days)) throw new DomainError("OUTLINE_MISSING", "The approved quotation has no course outline");

    const [engagement] = await executor
      .select({ e: schema.trainerEngagements, t: schema.trainers })
      .from(schema.trainerEngagements)
      .innerJoin(schema.trainers, eq(schema.trainers.id, schema.trainerEngagements.trainerId))
      .where(and(eq(schema.trainerEngagements.packageId, packageId), ne(schema.trainerEngagements.status, "RELEASED")));
    const trainer = engagement?.t ?? null;

    const notFlagged = ne(schema.complianceVault.verificationStatus, "FLAGGED");
    const files: Array<{ entry: Omit<DossierEntry, "sha256" | "bytes">; bytes: Uint8Array; label: string }> = [];
    const missing: string[] = [];

    const outlineDoc = await latestDoc(executor, and(eq(schema.complianceVault.packageId, packageId), eq(schema.complianceVault.documentType, "FORM_HRD_LD"), notFlagged));
    files.push({
      label: "Form HRD-L&D course outline",
      entry: { file: "02-form-hrd-ld.pdf", kind: "FORM_HRD_LD", source: outlineDoc ? "VAULT" : "GENERATED", vaultId: outlineDoc?.id ?? null },
      bytes: outlineDoc ? await vaultBytes(outlineDoc, executor) : await renderOutlinePdf({ pkg, client, outline }),
    });

    const quotationDoc = await latestDoc(executor, and(eq(schema.complianceVault.packageId, packageId), eq(schema.complianceVault.documentType, "QUOTATION"), notFlagged));
    files.push({
      label: "Quotation",
      entry: { file: "03-quotation.pdf", kind: "QUOTATION", source: quotationDoc ? "VAULT" : "GENERATED", vaultId: quotationDoc?.id ?? null },
      bytes: quotationDoc ? await vaultBytes(quotationDoc, executor) : await renderQuotationPdf({ pkg, client, quotation, outline }),
    });

    if (trainer) {
      const cv = await latestDoc(executor, and(eq(schema.complianceVault.trainerId, trainer.id), eq(schema.complianceVault.documentType, "TRAINER_CV"), notFlagged));
      files.push({
        label: "Trainer CV",
        entry: { file: `04-trainer-cv.${cv ? extensionFor(cv.mimeType) : "pdf"}`, kind: "TRAINER_CV", source: cv ? "VAULT" : "GENERATED", vaultId: cv?.id ?? null },
        bytes: cv ? await vaultBytes(cv, executor) : await renderTrainerProfilePdf(trainer),
      });
      const ttt = await latestDoc(executor, and(eq(schema.complianceVault.trainerId, trainer.id), eq(schema.complianceVault.documentType, "TTT_CERT"), notFlagged));
      if (ttt) {
        files.push({
          label: "HRD Corp TTT certificate",
          entry: { file: `05-ttt-certificate.${extensionFor(ttt.mimeType)}`, kind: "TTT_CERT", source: "VAULT", vaultId: ttt.id },
          bytes: await vaultBytes(ttt, executor),
        });
      } else {
        missing.push("TTT_CERT");
      }
    } else {
      missing.push("TRAINER_CV", "TTT_CERT");
    }

    const checklistEntries = [
      ...files.map((f) => ({ label: f.label, file: f.entry.file, status: f.entry.source === "VAULT" ? "Included" : "Included (generated)" })),
      ...missing.map((m) => ({ label: m === "TTT_CERT" ? "HRD Corp TTT certificate" : "Trainer CV", file: null, status: "MISSING" })),
    ];
    const cover = await renderChecklistPdf({ pkg, client, quotation, outline, trainer, entries: checklistEntries });
    files.unshift({ label: "Cover and checklist", entry: { file: "01-cover-checklist.pdf", kind: "COVER_CHECKLIST", source: "GENERATED", vaultId: null }, bytes: cover });

    const entries: DossierEntry[] = files.map((f) => ({ ...f.entry, sha256: sha256Hex(f.bytes), bytes: f.bytes.byteLength }));
    const manifest = {
      dossier: `DOS-${pkg.packageCode}`,
      packageCode: pkg.packageCode,
      quotation: { id: quotation.id, version: quotation.version, quotedAmount: quotation.quotedAmount },
      files: entries,
      missing,
    };

    const zip = new JSZip();
    for (const f of files) zip.file(f.entry.file, f.bytes, { date: ZIP_DATE, binary: true });
    zip.file("manifest.json", JSON.stringify(manifest, null, 2), { date: ZIP_DATE });
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", platform: "UNIX" });
    const sha256 = sha256Hex(bytes);

    const { doc, reused } = await withTx(SYSTEM_ACTOR, { reasonCode: "ETRIS_DOSSIER_COMPILED" }, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.complianceVault)
        .where(and(eq(schema.complianceVault.packageId, packageId), eq(schema.complianceVault.documentType, "ETRIS_DOSSIER"), eq(schema.complianceVault.fileHashSha256, sha256)));
      if (existing) return { doc: existing, reused: true };
      const stored = await storeDocument(tx, {
        packageId,
        documentType: "ETRIS_DOSSIER",
        fileName: `DOS-${pkg.packageCode}-v${quotation.version}.zip`,
        mimeType: "application/zip",
        bytes,
        uploadedBy: DOSSIER_AGENT,
        extractedMetadata: { manifest },
      });
      return { doc: stored, reused: false };
    });

    const result: DossierResult = { vaultId: doc.id, sha256, files: entries, missing, reused, runId };
    await finishAgentRun(db(), runId, { status: "SUCCEEDED", output: { vaultId: doc.id, sha256, missing, reused, files: entries.length }, provenance: { tier: "L0", mode: "RULE", agent: DOSSIER_AGENT } });
    return result;
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    throw error;
  }
}
