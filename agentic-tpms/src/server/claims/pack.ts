import { sql } from "drizzle-orm";
import JSZip from "jszip";
import { formatDate, formatRange } from "@/lib/dates";
import { formatRM, fromSen, type Sen } from "@/lib/money";
import { type Executor, rows } from "../db/client";
import type { VaultDocument } from "../db/schema";
import { PDF_MIME, PdfBuilder } from "../documents/pdf";
import { sha256Hex } from "../lib/crypto";
import type { PackageSnapshot, TaxInvoice } from "../packages/snapshot";
import { readDocument } from "../storage/vault";
import { safeFileName } from "../finance/common";
import type { ClaimChecklist, EvidenceSelection } from "./checklist";
import { deliveryLabel } from "./invoice";

/**
 * The SBL-Khas claim pack: one ZIP an operator uploads to e-TRiS.
 *
 *   00_Cover.pdf               checklist + every other file's SHA-256
 *   01_Tax_Invoice.pdf
 *   02_Form_T3/*               every verified T3
 *   03_Form_JD14.<ext>         the latest verified JD/14
 *   04_Photos/*                verified session photos
 *   05_BEO_DO/*                venue BEO / DO (when a venue was used)
 *   06_Kirkpatrick_Report.pdf  when lane D has put one in the vault
 *   07_Attendance_Summary.pdf  generated: participants, masked NRIC, %, eligible
 *   manifest.json              path -> sha256, package code, grant ref, amount
 *
 * Evidence bytes are re-read from the vault and re-hashed on the way in: a
 * file whose bytes no longer match its recorded SHA-256 is refused rather than
 * shipped to HRD Corp. The ZIP is byte-deterministic for a given day (fixed
 * entry dates, no folder entries), so a re-run dedupes in the vault.
 */
export type PackFile = { path: string; sha256: string; bytes: Uint8Array; vaultId: string | null };

export type ClaimManifest = {
  packageCode: string;
  grantReference: string;
  invoiceNumber: string;
  claimableAmount: string;
  currency: "MYR";
  compiledOn: string;
  files: Record<string, string>;
};

export type CompiledPack = {
  zip: Uint8Array;
  sha256: string;
  fileName: string;
  manifest: ClaimManifest;
  files: Array<{ path: string; sha256: string; bytes: number; vaultId: string | null }>;
};

export type EvidenceRead = { files: PackFile[]; corrupted: Array<{ vaultId: string; fileName: string; reason: string }> };

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};

function extensionOf(doc: VaultDocument): string {
  const fromName = /\.([A-Za-z0-9]{2,5})$/.exec(doc.fileName)?.[1]?.toLowerCase();
  return fromName ?? EXT_BY_MIME[doc.mimeType] ?? "bin";
}

const nn = (i: number) => String(i + 1).padStart(2, "0");

/** Read and re-hash every selected evidence file. Missing or altered bytes are reported, not packed. */
export async function readEvidence(executor: Executor, sel: EvidenceSelection, invoice: TaxInvoice): Promise<EvidenceRead> {
  const corrupted: EvidenceRead["corrupted"] = [];
  const plan: Array<{ path: string; id: string; fileName: string }> = [];
  const add = (path: string, d: VaultDocument) => plan.push({ path, id: d.id, fileName: d.fileName });

  if (invoice.vaultId) plan.push({ path: "01_Tax_Invoice.pdf", id: invoice.vaultId, fileName: `${invoice.invoiceNumber}.pdf` });
  else corrupted.push({ vaultId: "", fileName: `${invoice.invoiceNumber}.pdf`, reason: "the invoice has no PDF in the vault" });
  sel.t3.forEach((d, i) => add(`02_Form_T3/${nn(i)}_${safeFileName(d.fileName, `t3.${extensionOf(d)}`)}`, d));
  if (sel.jd14) add(`03_Form_JD14.${extensionOf(sel.jd14)}`, sel.jd14);
  sel.photos.forEach((d, i) => add(`04_Photos/${nn(i)}_${safeFileName(d.fileName, `photo.${extensionOf(d)}`)}`, d));
  sel.beoDo.forEach((d, i) => add(`05_BEO_DO/${d.documentType}_${nn(i)}_${safeFileName(d.fileName, `${d.documentType.toLowerCase()}.${extensionOf(d)}`)}`, d));
  if (sel.kirkpatrick) add("06_Kirkpatrick_Report.pdf", sel.kirkpatrick);

  const files: PackFile[] = [];
  for (const item of plan) {
    try {
      const read = await readDocument(item.id, executor);
      if (!read) corrupted.push({ vaultId: item.id, fileName: item.fileName, reason: "vault row missing" });
      else if (!read.intact) corrupted.push({ vaultId: item.id, fileName: item.fileName, reason: "bytes no longer match the recorded SHA-256" });
      else files.push({ path: item.path, sha256: read.doc.fileHashSha256, bytes: new Uint8Array(read.bytes), vaultId: item.id });
    } catch (error) {
      // A blob missing from disk is an integrity failure of the evidence, not a transient fault.
      corrupted.push({ vaultId: item.id, fileName: item.fileName, reason: `unreadable: ${(error as Error).message}` });
    }
  }
  return { files, corrupted };
}

type AttendanceRow = { full_name: string; nric_masked: string; attendance_rate: string; hrd_claim_eligible: boolean; registration_status: string };

export async function attendanceRows(executor: Executor, packageId: string): Promise<AttendanceRow[]> {
  return rows<AttendanceRow>(
    executor,
    sql`select full_name, nric_masked, attendance_rate::text as attendance_rate, hrd_claim_eligible, registration_status
          from tpms.package_participants
         where package_id = ${packageId}::uuid and registration_status <> 'WITHDRAWN'
         order by full_name, id`,
  );
}

/** 07 — generated from the roster. Masked NRIC only (PDPA); the raw number is never decrypted for a document. */
export async function renderAttendanceSummary(s: PackageSnapshot, roster: AttendanceRow[]): Promise<Uint8Array> {
  const b = await PdfBuilder.create({ title: "Attendance Summary", reference: s.pkg.packageCode });
  b.letterhead(`${s.pkg.title} · ${formatRange(s.pkg.startDate, s.pkg.endDate)}`);
  b.keyValues([
    ["Employer", s.client.companyName],
    ["e-TRiS grant", s.pkg.etrisGrantId ?? "-"],
    ["Delivery", deliveryLabel(s.pkg.deliveryMode)],
    ["Sessions per participant", `${s.attendance.slotsPerParticipant} (AM + PM x ${s.pkg.durationDays ?? 0} day(s))`],
    ["Participants", `${s.participants.active} active, ${s.participants.eligible} eligible (>= 80%)`],
  ]);
  b.heading("Participants");
  b.table(
    [
      { label: "#", width: 0.6 },
      { label: "Name", width: 4 },
      { label: "NRIC / passport", width: 2.4 },
      { label: "Attendance", width: 1.6, align: "right" },
      { label: "Claim eligible", width: 1.6 },
    ],
    roster.map((r, i) => [String(i + 1), r.full_name, r.nric_masked, `${Number(r.attendance_rate).toFixed(2)}%`, r.hrd_claim_eligible ? "Yes" : "No"]),
    { zebra: true },
  );
  b.spacer(8);
  b.text("Eligibility follows the HRD Corp rule: a participant is claimable at 80% attendance or above.", { size: 8.5, color: "muted" });
  return b.save({ footer: "Attendance summary" });
}

async function renderCover(input: {
  s: PackageSnapshot;
  invoice: TaxInvoice;
  claimableSen: Sen;
  checklist: ClaimChecklist;
  files: PackFile[];
  compiledOn: string;
  reviewerNote: string;
}): Promise<Uint8Array> {
  const { s, invoice } = input;
  const b = await PdfBuilder.create({ title: "SBL-Khas Claim Pack", reference: `${s.pkg.packageCode} · ${invoice.invoiceNumber}` });
  b.letterhead(`${s.client.companyName} · ${s.pkg.title}`);
  b.keyValues([
    ["Package", s.pkg.packageCode],
    ["Employer", s.client.companyName],
    ["Employer MyCoID", s.client.hrdcorpMycoid ?? "Not recorded"],
    ["e-TRiS grant reference", s.pkg.etrisGrantId ?? "-"],
    ["Training dates", formatRange(s.pkg.startDate, s.pkg.endDate)],
    ["Tax invoice", invoice.invoiceNumber],
    ["Claimable amount", formatRM(fromSen(input.claimableSen))],
    ["Compiled", formatDate(input.compiledOn)],
  ]);
  b.heading("Evidence checklist");
  b.table(
    [
      { label: "Check", width: 4 },
      { label: "Status", width: 1.4 },
      { label: "Detail", width: 4.6 },
    ],
    input.checklist.items.map((i) => [i.label, i.ok ? "OK" : i.required ? "MISSING" : "Optional", i.detail]),
  );
  b.heading("Contents");
  b.table(
    [
      { label: "File", width: 3.2 },
      { label: "SHA-256", width: 6.8 },
    ],
    input.files.map((f) => [f.path, f.sha256]),
    { size: 7 },
  );
  if (input.reviewerNote) {
    b.caption("COLLATOR NOTES");
    b.text(input.reviewerNote, { size: 9, color: "secondary" });
  }
  b.spacer(6);
  b.text("manifest.json carries the same path -> SHA-256 map, plus this cover's own hash.", { size: 8, color: "muted" });
  return b.save({ footer: "Claim pack cover" });
}

/** Assemble the ZIP. Pure over its inputs apart from the PDF builders. */
export async function buildClaimPack(input: {
  s: PackageSnapshot;
  invoice: TaxInvoice;
  claimableSen: Sen;
  checklist: ClaimChecklist;
  evidence: PackFile[];
  roster: AttendanceRow[];
  compiledOn: string;
  reviewerNote: string;
}): Promise<CompiledPack> {
  const attendance = await renderAttendanceSummary(input.s, input.roster);
  const body: PackFile[] = [
    ...input.evidence,
    { path: "07_Attendance_Summary.pdf", sha256: sha256Hex(attendance), bytes: attendance, vaultId: null },
  ].sort((a, b) => a.path.localeCompare(b.path));
  const coverBytes = await renderCover({ ...input, files: body });
  const cover: PackFile = { path: "00_Cover.pdf", sha256: sha256Hex(coverBytes), bytes: coverBytes, vaultId: null };
  const all = [cover, ...body];

  const manifest: ClaimManifest = {
    packageCode: input.s.pkg.packageCode,
    grantReference: input.s.pkg.etrisGrantId ?? "",
    invoiceNumber: input.invoice.invoiceNumber,
    claimableAmount: fromSen(input.claimableSen),
    currency: "MYR",
    compiledOn: input.compiledOn,
    files: Object.fromEntries(all.map((f) => [f.path, f.sha256])),
  };

  const zip = new JSZip();
  // Entry dates are the compile day at 00:00 UTC: deterministic bytes per day.
  const date = new Date(`${input.compiledOn}T00:00:00Z`);
  for (const f of all) zip.file(f.path, f.bytes, { binary: true, date, createFolders: false });
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, { date, createFolders: false });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "UNIX" });

  return {
    zip: bytes,
    sha256: sha256Hex(bytes),
    fileName: `ClaimPack_${input.s.pkg.packageCode}.zip`,
    manifest,
    files: all.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes.byteLength, vaultId: f.vaultId })),
  };
}

export const ZIP_MIME = "application/zip";
export { PDF_MIME };
