"use server";

import { PDFDocument } from "pdf-lib";
import { act, plain } from "@/server/actions";
import {
  SESSIONS,
  SESSION_QR_TTL_MS,
  type Session,
  attendanceMatrix,
  generateT3Templates,
  issueParticipantLinks,
  issueSessionQr,
  renderDigitalT3,
  resolveAttendanceException,
  revokeToken,
  setManualAttendance,
  uploadT3Scan,
} from "@/server/attendance";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";
import { serviceHealth, synthesizeT3Scan } from "@/server/extraction/client";
import { uploadSessionPhoto } from "@/server/extraction/photoExif";
import { packageIdByCode } from "@/server/packages/queries";
import { readDocument } from "@/server/storage/vault";

/**
 * Attendance tab (and the participants tab's link panel). Every action is a
 * thin binding: validate the input shape, call the attendance / extraction
 * domain, and let `act` turn a DomainError into a visible refusal (R2).
 */
async function idFor(code: string): Promise<string> {
  const id = await packageIdByCode(String(code));
  if (!id) throw new DomainError("PACKAGE_NOT_FOUND", `No package ${code}`);
  return id;
}

function dayOf(value: unknown): number {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1) throw new DomainError("INVALID_DAY", "Choose a training day");
  return day;
}

/** R14: an unknown session is refused, never read as PM. */
function sessionOf(value: unknown): Session {
  if ((SESSIONS as readonly unknown[]).includes(value)) return value as Session;
  throw new DomainError("INVALID_SESSION", `Unknown session ${String(value)}; expected AM or PM`);
}

function fileOf(form: FormData, field: string): File {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new DomainError("FILE_REQUIRED", "Attach a file");
  return file;
}

// ------------------------------------------------------------------ Form T3 (paper)

export async function generateTemplatesAction(code: string) {
  return act(async () => {
    const docs = await generateT3Templates(await idFor(code), currentActor());
    return { days: docs.length };
  }, { message: "Form T3 templates ready — one per training day" });
}

export async function uploadScanAction(form: FormData) {
  return act(async () => {
    const file = fileOf(form, "scan");
    const result = await uploadT3Scan(
      await idFor(String(form.get("code"))),
      dayOf(form.get("dayIndex")),
      new Uint8Array(await file.arrayBuffer()),
      file.type || "application/octet-stream",
      file.name,
      currentActor(),
    );
    if (result.duplicate) throw new DomainError("DUPLICATE_SCAN", "This exact file is already in the vault; it was read when it was first uploaded.");
    return { vaultId: result.vaultId };
  }, { message: "Scan stored — the L2 extractor reads it on the worker's next pass" });
}

/** Which cells a simulated scan signs. `realistic` leaves one blank and one faint cell per page. */
const SIM_VARIANTS = ["realistic", "clean"] as const;
type SimVariant = (typeof SIM_VARIANTS)[number];

function simulatedSpec(rows: number, variant: SimVariant, seed: number) {
  const signed: Array<[number, "AM" | "PM"]> = [];
  const faint: Array<[number, "AM" | "PM"]> = [];
  for (let row = 0; row < rows; row += 1) {
    for (const session of SESSIONS) {
      const blank = variant === "realistic" && rows >= 2 && row === rows - 1 && session === "PM";
      const weak = variant === "realistic" && rows >= 3 && row === 1 && session === "AM";
      if (weak) faint.push([row, session]);
      else if (!blank) signed.push([row, session]);
    }
  }
  return { signed, faint, rotateDeg: 1.5, perspective: 0.008, noise: 0.025, seed };
}

/**
 * DEV ONLY (the extraction service must report `dev`): render a filled-in
 * "scan" of the day's own template and upload it through the real path, so
 * the whole OCR flow can be demonstrated without paper. A multi-page register
 * is assembled into one PDF, exactly as a scanner would deliver it.
 */
export async function simulateScanAction(form: FormData) {
  return act(async () => {
    const health = await serviceHealth();
    if (!health.dev) throw new DomainError("DEV_ONLY", "The extraction service is not running in dev mode (TPMS_OCR_DEV=1)");
    const variant = form.get("variant");
    if (!(SIM_VARIANTS as readonly unknown[]).includes(variant)) throw new DomainError("INVALID_VARIANT", `Unknown simulation ${String(variant)}`);
    const code = String(form.get("code"));
    const day = dayOf(form.get("dayIndex"));
    const id = await idFor(code);
    const actor = currentActor();
    const template = (await generateT3Templates(id, actor)).find((d) => d.extractedMetadata.dayIndex === day);
    if (!template) throw new DomainError("INVALID_DAY", `Day ${day} is outside this programme`);
    const read = await readDocument(template.id);
    if (!read?.intact) throw new DomainError("VAULT_TAMPERED", "The stored template no longer matches its SHA-256");
    const ids = (template.extractedMetadata.participantIds as string[] | undefined) ?? [];
    const perPage = Number(template.extractedMetadata.rowsPerPage ?? 15);
    const pages = Math.max(1, Math.ceil(ids.length / perPage));
    const salt = Date.now() % 997;
    const images: Uint8Array[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const rows = Math.min(perPage, ids.length - (page - 1) * perPage);
      images.push(await synthesizeT3Scan(new Uint8Array(read.bytes), { ...simulatedSpec(rows, variant as SimVariant, day * 31 + page + salt), page }));
    }
    let bytes = images[0];
    let mime = "image/png";
    if (images.length > 1) {
      const pdf = await PDFDocument.create();
      for (const png of images) {
        const image = await pdf.embedPng(png);
        const sheet = pdf.addPage([image.width, image.height]);
        sheet.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      bytes = await pdf.save();
      mime = "application/pdf";
    }
    const result = await uploadT3Scan(id, day, bytes, mime, `${code}-T3-D${day}-simulated-${variant}.${mime === "image/png" ? "png" : "pdf"}`, actor);
    return { vaultId: result.vaultId, pages };
  }, { message: "Simulated scan uploaded — OCR queued for the worker" });
}

// ------------------------------------------------------------------ exception desk

export interface ResolveSelection {
  /** Open review records (from the matrix) — resolved together. */
  recordIds: string[];
  /** Slots with no record at all — each recorded by hand. */
  manual: Array<{ participantId: string; dayIndex: number; session: string }>;
}

export async function resolveSlotsAction(code: string, selection: ResolveSelection, present: boolean, note: string) {
  return act(async () => {
    if (typeof present !== "boolean") throw new DomainError("INVALID_RESOLUTION", "Choose present or absent");
    const id = await idFor(code);
    const actor = currentActor();
    const recordIds = [...new Set(selection.recordIds ?? [])];
    const manual = selection.manual ?? [];
    if (recordIds.length === 0 && manual.length === 0) throw new DomainError("NO_RECORDS", "Select at least one exception");
    if (recordIds.length > 0) {
      // Only this package's open reviews may be resolved from this package's desk.
      const matrix = await attendanceMatrix(id);
      const open = new Set(matrix.participants.flatMap((p) => p.cells.flatMap((c) => c.openRecordIds)));
      const foreign = recordIds.filter((r) => !open.has(r));
      if (foreign.length) throw new DomainError("EXCEPTION_NOT_OPEN", "One or more exceptions were already resolved — the desk has been refreshed", { recordIds: foreign });
      await resolveAttendanceException(recordIds, { present, note }, actor);
    }
    for (const slot of manual) {
      await setManualAttendance(
        { packageId: id, participantId: String(slot.participantId), dayIndex: dayOf(slot.dayIndex), session: sessionOf(slot.session), present, note },
        actor,
      );
    }
    return { resolved: recordIds.length + manual.length };
  }, { message: "Recorded as a manual override — audited under your name" });
}

// ------------------------------------------------------------------ digital T3

export async function renderDigitalT3Action(code: string, dayIndex: number) {
  return act(async () => {
    const doc = await renderDigitalT3(await idFor(code), dayOf(dayIndex), currentActor());
    return { vaultId: doc.id, fileName: doc.fileName };
  }, { message: "Digital Form T3 compiled from the Track A signatures" });
}

// ------------------------------------------------------------------ session photos

export async function uploadPhotosAction(form: FormData) {
  return act(async () => {
    const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new DomainError("FILE_REQUIRED", "Attach at least one photo");
    const id = await idFor(String(form.get("code")));
    const actor = currentActor();
    let stored = 0;
    let duplicates = 0;
    for (const file of files) {
      const result = await uploadSessionPhoto(id, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream", file.name, actor);
      if (result.duplicate) duplicates += 1;
      else stored += 1;
    }
    if (stored === 0) throw new DomainError("DUPLICATE_PHOTO", duplicates === 1 ? "This photo is already in the vault" : "These photos are already in the vault");
    return { stored, duplicates };
  }, { message: "Photos stored — the EXIF check (GPS + date) runs on the worker" });
}

// ------------------------------------------------------------------ Track A links (participants tab)

export interface LinkView {
  jti: string;
  url: string;
  expiresAt: string;
  reused: boolean;
}

export interface ParticipantLinkView {
  participantId: string;
  participantName: string;
  email: string | null;
  nricMasked: string;
  checkin: LinkView | null;
  quizPre: LinkView | null;
  quizPost: LinkView | null;
}

export async function issueLinksAction(code: string) {
  return act(async (): Promise<ParticipantLinkView[]> => {
    const links = await issueParticipantLinks(await idFor(code));
    const view = (l: (typeof links)[number]["checkin"]): LinkView | null =>
      l ? { jti: l.jti, url: l.url, expiresAt: l.expiresAt.toISOString(), reused: l.reused } : null;
    return plain(
      links.map((l) => ({
        participantId: l.participantId,
        participantName: l.participantName,
        email: l.email,
        nricMasked: l.nricMasked,
        checkin: view(l.checkin),
        quizPre: view(l.quizPre),
        quizPost: view(l.quizPost),
      })),
    );
  }, { message: "Links ready — unchanged links keep their URL", revalidate: [] });
}

/** Revoke a participant's live links (a lost phone, a forwarded email). Issuing again mints new URLs. */
export async function revokeLinksAction(code: string, jtis: string[]) {
  return act(async () => {
    await idFor(code);
    const list = [...new Set((jtis ?? []).map(String))];
    if (list.length === 0) throw new DomainError("NO_LINKS", "No live link to revoke");
    for (const jti of list) await revokeToken(jti, currentActor());
    return { revoked: list.length };
  }, { message: "Links revoked — issue links again to give this participant new ones", revalidate: [] });
}

export interface SessionQrView {
  url: string;
  qrDataUrl: string;
  expiresAt: string;
  /** Lifetime from issue; the client counts down from receipt, so a skewed laptop clock does not matter. */
  ttlMs: number;
  dayIndex: number;
  session: Session;
  date: string;
}

export async function issueSessionQrAction(code: string, dayIndex: number, session: string) {
  return act(async (): Promise<SessionQrView> => {
    const qr = await issueSessionQr(await idFor(code), dayOf(dayIndex), sessionOf(session));
    return { url: qr.url, qrDataUrl: qr.qrDataUrl, expiresAt: qr.expiresAt.toISOString(), ttlMs: SESSION_QR_TTL_MS, dayIndex: qr.dayIndex, session: qr.session, date: qr.date };
  }, { message: "Session QR ready — valid for 20 minutes", revalidate: [] });
}
