import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfBuilder } from "@/server/documents/pdf";
import { DomainError } from "@/server/domain/errors";
import { loadDotEnv, resetEnvCache } from "@/server/env";
import { extractGrantLetter, extractGrantLetterDetailed, serviceHealth } from "@/server/extraction/client";
import { MISSING_VENV_MESSAGE, hasServiceVenv, startExtractionService, stopExtractionService, pointAtTestService } from "../helpers/extraction-service";

if (!hasServiceVenv) console.warn(`[extraction-grant-letter] SKIPPED: ${MISSING_VENV_MESSAGE}`);
const suite = hasServiceVenv ? describe : describe.skip;

/** A text PDF of the fixture letter, built with the app's own PDF toolkit. */
async function letterPdf(): Promise<Uint8Array> {
  const text = readFileSync("tests/fixtures/letters/etris-approval.txt", "utf8");
  const pdf = await PdfBuilder.create({ title: "Grant approval" });
  for (const line of text.split("\n")) pdf.text(line || " ", { size: 10 });
  return pdf.save();
}

suite("e-TRiS approval letter extraction (live extraction service)", () => {
  beforeAll(async () => {
    loadDotEnv();
    await startExtractionService();
  }, 60_000);
  afterAll(stopExtractionService);

  it("reports its engines", async () => {
    const health = await serviceHealth();
    expect(health.status).toBe("ok");
    expect(health.engines).toMatchObject({ template_grid: true, pymupdf: true });
  });

  it("extracts every field from a text PDF (the exact contract lane B codes against)", async () => {
    const result = await extractGrantLetter(await letterPdf(), "application/pdf");
    expect(result).toEqual({
      grantId: "ETRIS-2026-001234",
      approvedPax: 20,
      approvedAmount: "16000.00",
      startDate: "2026-10-20",
      endDate: "2026-10-21",
      employerName: "Kenanga Retail Group Berhad",
      confidence: expect.any(Number),
      rawText: expect.stringContaining("Grant ID"),
      engine: "pymupdf",
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    const detailed = await extractGrantLetterDetailed(await letterPdf(), "application/pdf");
    expect(detailed.fields.grantId.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("returns engine-specific empty text for an image when OCR is unavailable", async () => {
    const health = await serviceHealth();
    const png = new Uint8Array(readFileSync("tests/fixtures/photos/no-exif.jpg"));
    const result = await extractGrantLetter(png, "image/jpeg");
    if (!health.engines.paddleocr) {
      expect(result).toMatchObject({ engine: "none", rawText: "", grantId: null, confidence: 0 });
    } else {
      expect(result.engine).toBe("paddleocr");
    }
  });

  it("maps a service refusal to DomainError(EXTRACTION_REJECTED)", async () => {
    const error = await extractGrantLetter(new TextEncoder().encode("\u0000\u0001 not a document"), "application/octet-stream").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "EXTRACTION_REJECTED", details: { status: 415, serviceCode: "UNSUPPORTED_MEDIA" } });
  });

  it("maps no answer to a plain (retryable) Error", async () => {
    process.env.PADDLEOCR_URL = "http://127.0.0.1:9";
    resetEnvCache();
    try {
      const error = await serviceHealth().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DomainError);
      expect((error as Error).message).toContain("unreachable");
    } finally {
      pointAtTestService();
    }
  });
});
