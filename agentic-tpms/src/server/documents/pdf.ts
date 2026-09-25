import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import { env } from "../env";

/**
 * Shared PDF toolkit. Every generated artefact (quotation, Form HRD-L&D,
 * Form T3 template, certificates, tax invoice, payment vouchers, claim-pack
 * cover, executive pack) is built with this one builder so they share a
 * letterhead, a type scale and a footer that prints the document reference.
 *
 * Colours are the TrainOS tokens (styles/tokens.css) as PDF RGB values — the
 * PDF has no CSS, so these five constants are the token file's print mirror.
 *
 * pdf-lib's standard fonts are WinAnsi-only; `clean()` maps the characters we
 * use in the UI (✦, ≥, ×, curly quotes, …) to printable equivalents so a stray
 * glyph cannot crash a claim pack at 2am.
 */
export const PDF_COLORS = {
  ink: rgb(24 / 255, 26 / 255, 31 / 255), // --ink #181A1F
  secondary: rgb(80 / 255, 86 / 255, 95 / 255), // --ink-secondary #50565F
  muted: rgb(105 / 255, 113 / 255, 124 / 255), // --ink-muted #69717C
  primary: rgb(31 / 255, 91 / 255, 255 / 255), // --primary #1F5BFF
  border: rgb(227 / 255, 231 / 255, 236 / 255), // --border #E3E7EC
  surface: rgb(244 / 255, 246 / 255, 249 / 255), // --surface #F4F6F9
  white: rgb(1, 1, 1),
} as const;

export const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 48;

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/✦/g, "*"],
  [/≥/g, ">="],
  [/≤/g, "<="],
  [/×/g, "x"],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/→/g, "->"],
  [/…/g, "..."],
  [/•/g, "-"],
  [/[^\x09\x0A\x0D\x20-\x7E -ÿ–—]/g, "?"],
];

export function clean(text: string): string {
  return REPLACEMENTS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

export interface TableColumn {
  label: string;
  width: number;
  align?: "left" | "right";
}

export class PdfBuilder {
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  page: PDFPage;
  y: number;
  private readonly title: string;
  private readonly reference: string;
  private readonly orientation: "portrait" | "landscape";

  private constructor(doc: PDFDocument, fonts: Fonts, title: string, reference: string, orientation: "portrait" | "landscape") {
    this.doc = doc;
    this.fonts = fonts;
    this.title = title;
    this.reference = reference;
    this.orientation = orientation;
    this.page = this.addPage();
    this.y = this.pageHeight - MARGIN;
  }

  static async create(opts: { title: string; reference?: string; orientation?: "portrait" | "landscape"; author?: string }): Promise<PdfBuilder> {
    const doc = await PDFDocument.create();
    doc.setTitle(opts.title);
    doc.setAuthor(opts.author ?? env().TPMS_PROVIDER_NAME);
    doc.setProducer("Agentic TPMS");
    doc.setCreator("Agentic TPMS");
    // Deterministic metadata: the same inputs produce the same bytes (and hash).
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));
    const fonts: Fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      mono: await doc.embedFont(StandardFonts.Courier),
    };
    return new PdfBuilder(doc, fonts, opts.title, opts.reference ?? "", opts.orientation ?? "portrait");
  }

  get pageWidth(): number {
    return this.orientation === "portrait" ? A4.width : A4.height;
  }

  get pageHeight(): number {
    return this.orientation === "portrait" ? A4.height : A4.width;
  }

  get contentWidth(): number {
    return this.pageWidth - MARGIN * 2;
  }

  get left(): number {
    return MARGIN;
  }

  addPage(): PDFPage {
    const page = this.doc.addPage([this.pageWidth, this.pageHeight]);
    this.page = page;
    this.y = this.pageHeight - MARGIN;
    return page;
  }

  /** Break to a new page when fewer than `height` points remain. */
  ensure(height: number): void {
    if (this.y - height < MARGIN + 24) this.addPage();
  }

  /** Provider letterhead: name, HRD Corp registration, and the document reference. */
  letterhead(subtitle?: string): this {
    const provider = env().TPMS_PROVIDER_NAME;
    this.page.drawRectangle({ x: this.left, y: this.y - 4, width: 28, height: 4, color: PDF_COLORS.primary });
    this.y -= 18;
    this.text(provider, { size: 13, font: "bold" });
    this.text(`HRD Corp registered training provider · ${env().TPMS_PROVIDER_HRDC_ID}`, { size: 8.5, color: "muted" });
    this.y -= 10;
    this.text(this.title, { size: 18, font: "bold" });
    if (subtitle) this.text(subtitle, { size: 10, color: "secondary" });
    if (this.reference) this.text(this.reference, { size: 8.5, font: "mono", color: "muted" });
    this.y -= 6;
    this.rule();
    return this;
  }

  text(
    value: string,
    opts: { size?: number; font?: keyof Fonts; color?: keyof typeof PDF_COLORS; x?: number; maxWidth?: number; lineGap?: number } = {},
  ): this {
    const size = opts.size ?? 10;
    const font = this.fonts[opts.font ?? "regular"];
    const maxWidth = opts.maxWidth ?? this.contentWidth - ((opts.x ?? this.left) - this.left);
    const lines = wrap(clean(value), font, size, maxWidth);
    for (const line of lines) {
      this.ensure(size + 4);
      this.y -= size + (opts.lineGap ?? 3);
      this.page.drawText(line, { x: opts.x ?? this.left, y: this.y, size, font, color: PDF_COLORS[opts.color ?? "ink"] });
    }
    return this;
  }

  heading(value: string): this {
    this.y -= 10;
    this.ensure(30);
    return this.text(value, { size: 12, font: "bold" });
  }

  /** Small muted caption above a block, TrainOS SECTION_LABEL style. */
  caption(value: string): this {
    this.y -= 6;
    return this.text(value, { size: 8.5, color: "muted" });
  }

  spacer(points = 8): this {
    this.y -= points;
    return this;
  }

  rule(color: RGB = PDF_COLORS.border): this {
    this.ensure(8);
    this.y -= 6;
    this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: this.left + this.contentWidth, y: this.y }, thickness: 0.75, color });
    return this;
  }

  keyValues(pairs: Array<[string, string]>, opts: { labelWidth?: number; size?: number } = {}): this {
    const labelWidth = opts.labelWidth ?? 150;
    const size = opts.size ?? 9.5;
    for (const [label, value] of pairs) {
      const lines = wrap(clean(value), this.fonts.regular, size, this.contentWidth - labelWidth);
      this.ensure((size + 4) * lines.length + 2);
      this.y -= size + 4;
      this.page.drawText(clean(label), { x: this.left, y: this.y, size, font: this.fonts.regular, color: PDF_COLORS.muted });
      lines.forEach((line, i) => {
        if (i > 0) this.y -= size + 3;
        this.page.drawText(line, { x: this.left + labelWidth, y: this.y, size, font: this.fonts.regular, color: PDF_COLORS.ink });
      });
    }
    return this;
  }

  /** A simple ruled table with a surface-coloured header row. Widths are fractions or points. */
  table(columns: TableColumn[], rows: string[][], opts: { size?: number; zebra?: boolean; boldLastRow?: boolean } = {}): this {
    const size = opts.size ?? 9;
    const total = columns.reduce((acc, c) => acc + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.contentWidth);
    const rowHeight = size + 9;

    const drawRow = (cells: string[], header: boolean, index: number, bold: boolean) => {
      const wrapped = cells.map((cell, i) => wrap(clean(cell ?? ""), header || bold ? this.fonts.bold : this.fonts.regular, size, widths[i] - 8));
      const height = Math.max(...wrapped.map((w) => w.length)) * (size + 3) + 6;
      this.ensure(height + 2);
      const top = this.y;
      if (header) {
        this.page.drawRectangle({ x: this.left, y: top - height, width: this.contentWidth, height, color: PDF_COLORS.surface });
      } else if (opts.zebra && index % 2 === 1) {
        this.page.drawRectangle({ x: this.left, y: top - height, width: this.contentWidth, height, color: rgb(0.985, 0.988, 0.992) });
      }
      let x = this.left;
      wrapped.forEach((lines, i) => {
        const font = header || bold ? this.fonts.bold : this.fonts.regular;
        lines.forEach((line, li) => {
          const lineWidth = font.widthOfTextAtSize(line, size);
          const tx = columns[i].align === "right" ? x + widths[i] - 4 - lineWidth : x + 4;
          this.page.drawText(line, {
            x: tx,
            y: top - 4 - (li + 1) * (size + 3) + 3,
            size,
            font,
            color: header ? PDF_COLORS.secondary : PDF_COLORS.ink,
          });
        });
        x += widths[i];
      });
      this.y = top - height;
      this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: this.left + this.contentWidth, y: this.y }, thickness: 0.5, color: PDF_COLORS.border });
    };

    this.y -= 4;
    drawRow(columns.map((c) => c.label), true, 0, false);
    rows.forEach((row, index) => drawRow(row, false, index, Boolean(opts.boldLastRow && index === rows.length - 1)));
    void rowHeight;
    return this;
  }

  /** A QR code image at the given position (defaults to the current cursor, left). */
  async qr(data: string, opts: { size?: number; x?: number; y?: number } = {}): Promise<this> {
    const size = opts.size ?? 96;
    const png = await QRCode.toBuffer(data, { errorCorrectionLevel: "M", margin: 1, width: size * 3 });
    const image = await this.doc.embedPng(png);
    const x = opts.x ?? this.left;
    let y = opts.y;
    if (y === undefined) {
      this.ensure(size + 4);
      this.y -= size;
      y = this.y;
    }
    this.page.drawImage(image, { x, y, width: size, height: size });
    return this;
  }

  /** Stamp every page with the reference, page n/m and an optional integrity line. */
  private footers(extra?: string): void {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      const line = clean(
        [this.reference, extra, `Page ${index + 1} of ${pages.length}`].filter(Boolean).join("  ·  "),
      );
      page.drawText(line, { x: MARGIN, y: 26, size: 7.5, font: this.fonts.regular, color: PDF_COLORS.muted });
    });
  }

  async save(opts: { footer?: string } = {}): Promise<Uint8Array> {
    this.footers(opts.footer);
    return this.doc.save({ useObjectStreams: false });
  }
}

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        // A single word wider than the column is hard-broken.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
          out.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export const PDF_MIME = "application/pdf";
