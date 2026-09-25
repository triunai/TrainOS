import type { PDFFont, PDFPage } from "pdf-lib";
import { formatDate, formatRange } from "@/lib/dates";
import { PDF_COLORS, PdfBuilder, clean, wrap } from "../documents/pdf";
import { type CertificatePayload, HOURS_PER_DAY } from "./payload";

/**
 * Landscape A4 certificate of completion. Every printed fact comes from the
 * canonical payload, so the PDF can never say something the hash does not
 * cover; the payload SHA-256 is printed in the footer integrity line and the
 * QR resolves to the public verification page for the serial.
 *
 * PdfBuilder pins the document dates, so identical payloads render to
 * identical bytes.
 */
const EDGE = 56;

type Color = keyof typeof PDF_COLORS;

function centered(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color: Color = "ink"): void {
  const value = clean(text);
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: (page.getWidth() - width) / 2, y, size, font, color: PDF_COLORS[color] });
}

function rightAligned(page: PDFPage, text: string, font: PDFFont, size: number, right: number, y: number, color: Color = "ink"): void {
  const value = clean(text);
  page.drawText(value, { x: right - font.widthOfTextAtSize(value, size), y, size, font, color: PDF_COLORS[color] });
}

/** Largest size in [min, max] at which `text` fits `width` on one line. */
function fitSize(text: string, font: PDFFont, max: number, min: number, width: number): number {
  let size = max;
  while (size > min && font.widthOfTextAtSize(clean(text), size) > width) size -= 1;
  return size;
}

export async function renderCertificatePdf(
  payload: CertificatePayload,
  opts: { payloadSha256: string; verificationUrl: string },
): Promise<Uint8Array> {
  const b = await PdfBuilder.create({
    title: "Certificate of Completion",
    reference: payload.serial,
    orientation: "landscape",
    author: payload.providerName,
  });
  const page = b.page;
  const { regular, bold, mono } = b.fonts;
  const W = b.pageWidth;
  const H = b.pageHeight;
  const days = Math.round(payload.hours / HOURS_PER_DAY);

  page.drawRectangle({ x: 14, y: 14, width: W - 28, height: H - 28, borderColor: PDF_COLORS.border, borderWidth: 1 });

  // Letterhead (top left) and serial (top right).
  page.drawRectangle({ x: EDGE, y: H - 60, width: 28, height: 4, color: PDF_COLORS.primary });
  page.drawText(clean(payload.providerName), { x: EDGE, y: H - 80, size: 13, font: bold, color: PDF_COLORS.ink });
  page.drawText(clean(`HRD Corp registered training provider · ${payload.providerHrdcId}`), {
    x: EDGE, y: H - 94, size: 8.5, font: regular, color: PDF_COLORS.muted,
  });
  rightAligned(page, "Certificate serial", regular, 8.5, W - EDGE, H - 66, "muted");
  rightAligned(page, payload.serial, mono, 11, W - EDGE, H - 82);

  // The statement.
  let y = H - 170;
  centered(page, "CERTIFICATE OF COMPLETION", bold, 26, y);
  y -= 36;
  centered(page, "This is to certify that", regular, 11, y, "secondary");

  const nameWidth = W - 2 * EDGE - 80;
  const nameSize = fitSize(payload.holderName, bold, 30, 16, nameWidth);
  const nameLines = wrap(clean(payload.holderName), bold, nameSize, nameWidth).slice(0, 2);
  y -= 44;
  nameLines.forEach((line, i) => {
    if (i > 0) y -= nameSize + 6;
    centered(page, line, bold, nameSize, y);
  });
  y -= 22;
  centered(page, `NRIC ${payload.nricMasked}`, mono, 10, y, "muted");
  y -= 32;
  centered(page, "has successfully completed the programme", regular, 11, y, "secondary");

  const titleWidth = W - 2 * EDGE - 120;
  const titleLines = wrap(clean(payload.courseTitle), bold, 17, titleWidth).slice(0, 2);
  y -= 32;
  titleLines.forEach((line, i) => {
    if (i > 0) y -= 22;
    centered(page, line, bold, 17, y);
  });
  y -= 27;
  centered(
    page,
    `${formatRange(payload.startDate, payload.endDate)}  ·  ${days} ${days === 1 ? "day" : "days"}  ·  ${payload.hours} training hours`,
    regular,
    11,
    y,
  );
  y -= 18;
  centered(page, `Conducted under the HRD Corp SBL-Khas scheme  ·  Programme ref. ${payload.packageCode}`, regular, 9, y, "muted");

  // Signature block (bottom left).
  page.drawLine({ start: { x: EDGE, y: 128 }, end: { x: EDGE + 200, y: 128 }, thickness: 0.75, color: PDF_COLORS.secondary });
  page.drawText("Authorised signatory", { x: EDGE, y: 114, size: 8.5, font: regular, color: PDF_COLORS.muted });
  page.drawText(clean(payload.providerName), { x: EDGE, y: 100, size: 9.5, font: bold, color: PDF_COLORS.ink });
  page.drawText(clean(`Issued on ${formatDate(payload.issuedOn)}`), { x: EDGE, y: 86, size: 8.5, font: regular, color: PDF_COLORS.muted });

  // Verification (bottom right): QR plus the URL it encodes, for anyone without a scanner.
  const qrSize = 84;
  const qrX = W - EDGE - qrSize;
  await b.qr(opts.verificationUrl, { size: qrSize, x: qrX, y: 64 });
  rightAligned(page, "Verify this certificate", bold, 9, qrX - 12, 128);
  rightAligned(page, "Scan the code or visit", regular, 8, qrX - 12, 114, "muted");
  rightAligned(page, opts.verificationUrl, regular, 8, qrX - 12, 102, "secondary");

  return b.save({ footer: `Payload SHA-256 ${opts.payloadSha256}` });
}
