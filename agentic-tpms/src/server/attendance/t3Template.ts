import { and, asc, eq, ne, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { formatDate } from "@/lib/dates";
import { type Actor, type Executor, rows, schema, withTx } from "../db/client";
import type { TrainingPackage, VaultDocument } from "../db/schema";
import { clean, PDF_COLORS, PDF_MIME } from "../documents/pdf";
import { DomainError } from "../domain/errors";
import { env } from "../env";
import { sha256Hex } from "../lib/crypto";
import { storeDocument } from "../storage/vault";
import { analyseSignaturePath } from "./signature";
import { type Session, trainingDate } from "./sessions";

/**
 * Form PSMB/SBL-KHAS/T3/01 — the attendance register HRD Corp audits.
 *
 * We generate the sheet, so the OCR engine never has to *find* the table: it
 * registers a KNOWN page. Each page carries four solid corner fiducials at
 * exact positions and a QR code holding the page's layout — package, day,
 * page, participant ids in row order, and the grid geometry in PDF points
 * (top-left origin). `services/paddleocr/app/layout.py` is the other half of
 * this contract; change the two together (the QR carries `v`, so an old
 * sheet stays readable only while its version is still accepted there).
 *
 * pdf-lib is used directly (not PdfBuilder) because the geometry must be
 * exact and stable, not flowed.
 */
export const T3_LAYOUT_VERSION = 1;
export const T3_MAX_ROWS = 15;
export const T3_PAGE = { width: 841.89, height: 595.28 } as const; // A4 landscape

/** All values in PDF points, measured from the TOP-LEFT of the page. */
export const T3_GEOMETRY = {
  fiducials: [
    [30, 30],
    [812, 30],
    [30, 565],
    [812, 565],
  ] as Array<[number, number]>,
  fiducialSize: 20,
  qr: { left: 650, top: 44, size: 144 },
  table: { left: 44, top: 196, right: 794 },
  headerHeight: 16,
  rowHeight: 21,
  columns: {
    no: [44, 30] as [number, number],
    name: [74, 210] as [number, number],
    nric: [284, 110] as [number, number],
    am: [394, 200] as [number, number],
    pm: [594, 200] as [number, number],
  },
} as const;

export interface T3Participant {
  id: string;
  name: string;
  nricMasked: string;
}

export interface T3Signature {
  path: string;
  signedAt: Date | null;
}

export interface T3TemplateInput {
  pkg: Pick<TrainingPackage, "id" | "packageCode" | "title" | "etrisGrantId" | "durationDays">;
  clientName: string;
  trainerName: string;
  venueName: string;
  dayIndex: number;
  /** YYYY-MM-DD */
  date: string;
  participants: T3Participant[];
  /** Track A variant: signatures drawn into the cells, keyed by participant id. */
  signatures?: Map<string, Partial<Record<Session, T3Signature>>>;
}

export interface T3LayoutPayload {
  v: 1;
  p: string;
  d: number;
  pg: number;
  pc: number;
  r: string[];
  g: {
    s: [number, number];
    f: Array<[number, number]>;
    fz: number;
    t: [number, number];
    hh: number;
    rh: number;
    am: [number, number];
    pm: [number, number];
    nm: [number, number];
  };
}

// ------------------------------------------------------------------ id codec

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 16 UUID bytes as unpadded base64url (22 chars): keeps the QR large-moduled. */
export function uuidToB64(id: string): string {
  if (!UUID_RE.test(id)) throw new Error(`Not a UUID: ${id}`);
  return Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url");
}

export function b64ToUuid(value: string): string {
  if (UUID_RE.test(value)) return value.toLowerCase();
  const hex = Buffer.from(value, "base64url").toString("hex");
  if (hex.length !== 32) throw new Error(`Not a compact UUID: ${value}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildLayoutPayload(packageId: string, dayIndex: number, page: number, pageCount: number, participantIds: string[]): T3LayoutPayload {
  const g = T3_GEOMETRY;
  return {
    v: T3_LAYOUT_VERSION,
    p: uuidToB64(packageId),
    d: dayIndex,
    pg: page,
    pc: pageCount,
    r: participantIds.map(uuidToB64),
    g: {
      s: [T3_PAGE.width, T3_PAGE.height],
      f: g.fiducials.map(([x, y]) => [x, y] as [number, number]),
      fz: g.fiducialSize,
      t: [g.table.left, g.table.top],
      hh: g.headerHeight,
      rh: g.rowHeight,
      am: [...g.columns.am],
      pm: [...g.columns.pm],
      nm: [...g.columns.name],
    },
  };
}

// ------------------------------------------------------------------ drawing

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

const INK = PDF_COLORS.ink;
const RULE = rgb(0.55, 0.57, 0.6); // ruling lines must survive a scan; the border token is too light
const H = T3_PAGE.height;

/** pdf-lib's origin is bottom-left; the layout's is top-left. */
const yOf = (top: number) => H - top;

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let value = clean(text);
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}...`, size) > width) value = value.slice(0, -1);
  return `${value}...`;
}

function label(page: PDFPage, fonts: Fonts, x: number, top: number, key: string, value: string, keyWidth: number, valueWidth: number) {
  page.drawText(clean(key), { x, y: yOf(top), size: 8, font: fonts.regular, color: PDF_COLORS.muted });
  page.drawText(fit(value || "-", fonts.bold, 8.5, valueWidth), { x: x + keyWidth, y: yOf(top), size: 8.5, font: fonts.bold, color: INK });
}

/** Vector QR: one rectangle per horizontal run of dark modules, crisp at any scan resolution. */
function drawQr(page: PDFPage, text: string) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  const { left, top, size } = T3_GEOMETRY.qr;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x: left, y: yOf(top + size), width: size, height: size, color: rgb(1, 1, 1) });
  for (let row = 0; row < n; row += 1) {
    let col = 0;
    while (col < n) {
      if (!qr.modules.get(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < n && qr.modules.get(row, col)) col += 1;
      page.drawRectangle({
        x: left + (quiet + start) * cell,
        y: yOf(top + (quiet + row + 1) * cell),
        width: (col - start) * cell + 0.02,
        height: cell + 0.02,
        color: rgb(0, 0, 0),
      });
    }
  }
  return { version: qr.version, modules: n, modulePt: cell };
}

function drawSignature(page: PDFPage, signature: T3Signature, cell: { x: number; top: number; w: number; h: number }, fonts: Fonts) {
  const { bbox } = analyseSignaturePath(signature.path);
  const innerW = cell.w * 0.8;
  const innerH = cell.h * 0.62;
  const scale = Math.min(innerW / Math.max(bbox.width, 1), innerH / Math.max(bbox.height, 1));
  const drawnW = bbox.width * scale;
  const drawnH = bbox.height * scale;
  const x = cell.x + (cell.w - drawnW) / 2 - bbox.minX * scale;
  const y = yOf(cell.top + (cell.h - drawnH) / 2) + bbox.minY * scale;
  page.drawSvgPath(signature.path, { x, y, scale, borderColor: rgb(0.08, 0.16, 0.45), borderWidth: 1.1 / scale });
  if (signature.signedAt) {
    const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false }).format(signature.signedAt);
    page.drawText(stamp, { x: cell.x + cell.w - 26, y: yOf(cell.top + cell.h - 3), size: 5.5, font: fonts.regular, color: PDF_COLORS.muted });
  }
}

function drawPage(page: PDFPage, fonts: Fonts, input: T3TemplateInput, rowsOnPage: T3Participant[], offset: number, pageNo: number, pageCount: number) {
  const g = T3_GEOMETRY;
  const digital = Boolean(input.signatures);
  const days = input.pkg.durationDays ?? 1;

  // Fiducials: solid, square, identical — the registration anchors.
  for (const [cx, cy] of g.fiducials) {
    const s = g.fiducialSize;
    page.drawRectangle({ x: cx - s / 2, y: yOf(cy + s / 2), width: s, height: s, color: rgb(0, 0, 0) });
  }

  // Header
  page.drawRectangle({ x: 44, y: yOf(44), width: 28, height: 4, color: PDF_COLORS.primary });
  page.drawText(clean(env().TPMS_PROVIDER_NAME), { x: 44, y: yOf(60), size: 10.5, font: fonts.bold, color: INK });
  const providerWidth = fonts.bold.widthOfTextAtSize(clean(env().TPMS_PROVIDER_NAME), 10.5);
  page.drawText(clean(`  ·  HRD Corp registered training provider ${env().TPMS_PROVIDER_HRDC_ID}`), {
    x: 44 + providerWidth, y: yOf(60), size: 8, font: fonts.regular, color: PDF_COLORS.muted,
  });
  page.drawText(clean("Form PSMB/SBL-KHAS/T3/01 — Attendance Register"), { x: 44, y: yOf(80), size: 15, font: fonts.bold, color: INK });
  page.drawText(
    clean(digital
      ? `Track A digital register — compiled from participant e-signatures · Day ${input.dayIndex} of ${days}`
      : `Borang Kehadiran Peserta · Participant attendance · Day ${input.dayIndex} of ${days}`),
    { x: 44, y: yOf(95), size: 9, font: fonts.regular, color: PDF_COLORS.secondary },
  );

  const left: Array<[string, string]> = [
    ["Programme", input.pkg.title],
    ["Package code", input.pkg.packageCode],
    ["e-TRiS grant ID", input.pkg.etrisGrantId ?? "-"],
    ["Employer", input.clientName],
  ];
  const right: Array<[string, string]> = [
    ["Venue", input.venueName],
    ["Date", formatDate(input.date)],
    ["Training day", `Day ${input.dayIndex} of ${days}`],
    ["Trainer", input.trainerName],
  ];
  left.forEach(([k, v], i) => label(page, fonts, 44, 116 + i * 14, k, v, 72, 240));
  right.forEach(([k, v], i) => label(page, fonts, 366, 116 + i * 14, k, v, 62, 210));
  page.drawText(
    clean(digital
      ? "Each signature below was captured on the participant's own device via a personal check-in link; the time of signing is printed in the cell."
      : "Sign once in each session you attend: Morning before 13:00, Afternoon after lunch. Keep inside the box. Do not mark the corner squares or the QR code."),
    { x: 44, y: yOf(184), size: 7.5, font: fonts.regular, color: PDF_COLORS.muted, maxWidth: 596 },
  );

  // Layout QR
  const payload = buildLayoutPayload(input.pkg.id, input.dayIndex, pageNo, pageCount, rowsOnPage.map((p) => p.id));
  drawQr(page, JSON.stringify(payload));

  // Table header
  const { table, headerHeight, rowHeight, columns } = g;
  const width = table.right - table.left;
  page.drawRectangle({ x: table.left, y: yOf(table.top + headerHeight), width, height: headerHeight, color: PDF_COLORS.surface });
  const headers: Array<[[number, number], string]> = [
    [columns.no, "No"],
    [columns.name, "Name"],
    [columns.nric, "NRIC (masked)"],
    [columns.am, "Morning signature (AM)"],
    [columns.pm, "Afternoon signature (PM)"],
  ];
  for (const [[x], text] of headers) {
    page.drawText(clean(text), { x: x + 4, y: yOf(table.top + 11), size: 8, font: fonts.bold, color: PDF_COLORS.secondary });
  }

  // Rows and ruling
  const bottom = table.top + headerHeight + rowsOnPage.length * rowHeight;
  const hline = (top: number, thickness = 0.6) =>
    page.drawLine({ start: { x: table.left, y: yOf(top) }, end: { x: table.right, y: yOf(top) }, thickness, color: RULE });
  hline(table.top, 0.8);
  hline(table.top + headerHeight, 0.8);
  rowsOnPage.forEach((participant, i) => {
    const top = table.top + headerHeight + i * rowHeight;
    const baseline = top + rowHeight / 2 + 3;
    page.drawText(String(offset + i + 1), { x: columns.no[0] + 4, y: yOf(baseline), size: 8.5, font: fonts.regular, color: INK });
    page.drawText(fit(participant.name, fonts.regular, 8.5, columns.name[1] - 8), { x: columns.name[0] + 4, y: yOf(baseline), size: 8.5, font: fonts.regular, color: INK });
    page.drawText(clean(participant.nricMasked), { x: columns.nric[0] + 4, y: yOf(baseline), size: 8, font: fonts.mono, color: INK });
    const signed = input.signatures?.get(participant.id);
    for (const session of ["AM", "PM"] as const) {
      const signature = signed?.[session];
      const [x, w] = session === "AM" ? columns.am : columns.pm;
      if (signature) drawSignature(page, signature, { x, top, w, h: rowHeight }, fonts);
    }
    hline(top + rowHeight);
  });
  for (const x of [table.left, columns.name[0], columns.nric[0], columns.am[0], columns.pm[0], table.right]) {
    page.drawLine({ start: { x, y: yOf(table.top) }, end: { x, y: yOf(bottom) }, thickness: 0.6, color: RULE });
  }

  // Trainer certification and footer (clear of the bottom fiducials)
  page.drawText(
    clean(`Trainer's certification: I confirm the participants above attended as signed.   Name: ${input.trainerName}   Signature: ____________________   Date: ____________`),
    { x: 60, y: yOf(548), size: 8, font: fonts.regular, color: PDF_COLORS.secondary },
  );
  page.drawText(
    clean(`${input.pkg.packageCode}  ·  Day ${input.dayIndex} of ${days}  ·  Sheet ${pageNo} of ${pageCount}  ·  Rows ${offset + 1}-${offset + rowsOnPage.length}  ·  Scan flat at 200 dpi or more  ·  Agentic TPMS`),
    { x: 60, y: yOf(569), size: 7, font: fonts.regular, color: PDF_COLORS.muted },
  );
}

/**
 * Render the register for one training day: one page per 15 participants,
 * each page carrying its own fiducials and layout QR. Deterministic: the
 * same input produces the same bytes, so a regenerated template dedupes.
 */
export async function renderT3TemplatePdf(input: T3TemplateInput): Promise<Uint8Array> {
  if (input.participants.length === 0) throw new DomainError("NO_PARTICIPANTS", "Form T3 needs at least one active participant");
  const doc = await PDFDocument.create();
  doc.setTitle(`Form T3 ${input.pkg.packageCode} Day ${input.dayIndex}`);
  doc.setAuthor(env().TPMS_PROVIDER_NAME);
  doc.setProducer("Agentic TPMS");
  doc.setCreator("Agentic TPMS");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const pageCount = Math.ceil(input.participants.length / T3_MAX_ROWS);
  for (let p = 0; p < pageCount; p += 1) {
    const slice = input.participants.slice(p * T3_MAX_ROWS, (p + 1) * T3_MAX_ROWS);
    const page = doc.addPage([T3_PAGE.width, T3_PAGE.height]);
    drawPage(page, fonts, input, slice, p * T3_MAX_ROWS, p + 1, pageCount);
  }
  return doc.save({ useObjectStreams: false });
}

// ------------------------------------------------------------------ package context

export interface T3Context {
  pkg: TrainingPackage;
  clientName: string;
  trainerName: string;
  venueName: string;
  participants: T3Participant[];
}

/** Everything a T3 needs about a package; active participants in a stable (name, id) order. */
export async function loadT3Context(executor: Executor, packageId: string): Promise<T3Context> {
  const [pkg] = await executor.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const [client] = await executor
    .select({ name: schema.corporateClients.companyName })
    .from(schema.corporateClients)
    .where(eq(schema.corporateClients.id, pkg.clientId));
  const [trainer] = await executor
    .select({ name: schema.trainers.fullName })
    .from(schema.trainerEngagements)
    .innerJoin(schema.trainers, eq(schema.trainers.id, schema.trainerEngagements.trainerId))
    .where(and(eq(schema.trainerEngagements.packageId, packageId), ne(schema.trainerEngagements.status, "RELEASED")));
  const [venue] = await rows<{ name: string; city: string | null }>(
    executor,
    sql`select v.name, v.city from tpms.vendor_commitments c join tpms.vendors v on v.id = c.vendor_id
         where c.package_id = ${packageId}::uuid and c.vendor_type = 'VENUE' and c.status <> 'CANCELLED'
         order by c.created_at desc limit 1`,
  );
  const venueName =
    pkg.deliveryMode === "ROT_VIRTUAL"
      ? "Remote Online Training (ROT)"
      : venue
        ? [venue.name, venue.city].filter(Boolean).join(", ")
        : pkg.venueByClient
          ? "Client premises"
          : "-";
  const participants = await executor
    .select({ id: schema.packageParticipants.id, name: schema.packageParticipants.fullName, nricMasked: schema.packageParticipants.nricMasked })
    .from(schema.packageParticipants)
    .where(and(eq(schema.packageParticipants.packageId, packageId), ne(schema.packageParticipants.registrationStatus, "WITHDRAWN")))
    .orderBy(asc(schema.packageParticipants.fullName), asc(schema.packageParticipants.id));
  return { pkg, clientName: client?.name ?? "-", trainerName: trainer?.name ?? "-", venueName, participants };
}

/** Store `bytes` unless this exact file is already in the package's vault as `documentType`. */
export async function storeOnce(
  executor: Executor,
  input: Parameters<typeof storeDocument>[1] & { packageId: string },
): Promise<{ doc: VaultDocument; created: boolean }> {
  const hash = sha256Hex(input.bytes);
  const [existing] = await executor
    .select()
    .from(schema.complianceVault)
    .where(and(
      eq(schema.complianceVault.packageId, input.packageId),
      eq(schema.complianceVault.documentType, input.documentType),
      eq(schema.complianceVault.fileHashSha256, hash),
    ));
  if (existing) return { doc: existing, created: false };
  return { doc: await storeDocument(executor, input), created: true };
}

/**
 * Generate and vault one FORM_T3_TEMPLATE per training day. Idempotent: an
 * unchanged roster produces identical bytes and returns the existing rows.
 */
export async function generateT3Templates(packageId: string, actor: Actor): Promise<VaultDocument[]> {
  return withTx(actor, { reasonCode: "T3_TEMPLATES_GENERATED" }, async (tx) => {
    const ctx = await loadT3Context(tx, packageId);
    const { pkg } = ctx;
    if (pkg.operationalStage === "CANCELLED") throw new DomainError("PACKAGE_CANCELLED", "The package is cancelled");
    if (!pkg.startDate || !pkg.endDate || !pkg.durationDays) {
      throw new DomainError("DATES_MISSING", "Training dates are required before printing Form T3");
    }
    const docs: VaultDocument[] = [];
    for (let day = 1; day <= pkg.durationDays; day += 1) {
      const date = trainingDate(pkg.startDate, day);
      const bytes = await renderT3TemplatePdf({ ...ctx, dayIndex: day, date });
      const { doc } = await storeOnce(tx, {
        packageId,
        documentType: "FORM_T3_TEMPLATE",
        fileName: `${pkg.packageCode}-T3-D${day}.pdf`,
        mimeType: PDF_MIME,
        bytes,
        uploadedBy: actor.id,
        extractedMetadata: {
          kind: "T3_TEMPLATE",
          layoutVersion: T3_LAYOUT_VERSION,
          dayIndex: day,
          date,
          pages: Math.ceil(ctx.participants.length / T3_MAX_ROWS),
          rowsPerPage: T3_MAX_ROWS,
          participantIds: ctx.participants.map((p) => p.id),
        },
      });
      docs.push(doc);
    }
    return docs;
  });
}
