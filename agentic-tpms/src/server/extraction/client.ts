import { z } from "zod";
import type { T3LayoutPayload } from "../attendance/t3Template";
import { DomainError } from "../domain/errors";
import { env } from "../env";

/**
 * Typed client for the Level 2 extraction microservice (services/paddleocr).
 *
 * Error contract (R2 — a refusal is not a failure):
 *   - the service answered 4xx  -> DomainError("EXTRACTION_REJECTED"): it
 *     understood the file and refuses it (not a T3, unsupported media). The
 *     queue dead-letters it immediately instead of retrying a verdict.
 *   - no answer, a timeout, a 5xx, or a body that breaks the response
 *     schema -> plain Error: transport trouble, retried with backoff.
 * Responses are validated with zod; an unknown enum value from the service
 * is a contract break, not something to guess around (R14).
 */
export const TIMEOUTS_MS = { health: 5_000, parse: 120_000, letter: 60_000, synth: 60_000 } as const;

function baseUrl(): string {
  return env().PADDLEOCR_URL.replace(/\/+$/, "");
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const url = `${baseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Extraction service unreachable at ${url} (${reason})`);
  }
  if (response.status >= 500) {
    throw new Error(`Extraction service error ${response.status} at ${path}: ${(await response.text()).slice(0, 500)}`);
  }
  if (response.status >= 400) {
    const body = await response.json().catch(() => ({}));
    const detail = (body as { detail?: unknown }).detail;
    const parsed = typeof detail === "object" && detail ? (detail as { code?: string; message?: string }) : { message: String(detail ?? "") };
    throw new DomainError("EXTRACTION_REJECTED", parsed.message || `The extraction service refused the file (${response.status})`, {
      status: response.status,
      serviceCode: parsed.code ?? null,
      detail,
    });
  }
  return response;
}

async function json<T>(response: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`Extraction service returned an unexpected ${what} shape: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

function form(bytes: Uint8Array, mimeType: string, fileName: string, fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

// ------------------------------------------------------------------ health

const healthSchema = z.object({
  status: z.string(),
  version: z.string(),
  engines: z.object({ template_grid: z.boolean(), pymupdf: z.boolean(), paddleocr: z.boolean() }),
  paddleocrStatus: z.string().optional(),
  dev: z.boolean().optional(),
});
export type ServiceHealth = z.infer<typeof healthSchema>;

export async function serviceHealth(): Promise<ServiceHealth> {
  return json(await request("/health", { method: "GET" }, TIMEOUTS_MS.health), healthSchema, "health");
}

// ------------------------------------------------------------------ Form T3

const cellSchema = z.object({ signed: z.boolean(), confidence: z.number().min(0).max(1), inkRatio: z.number().min(0).max(1) });
const rowSchema = z.object({
  rowIndex: z.number().int().min(0),
  participantId: z.string().uuid(),
  am: cellSchema,
  pm: cellSchema,
  printedName: z.string().nullable().optional(),
});
const pageSchema = z.object({
  pageIndex: z.number().int().min(1),
  sheetPage: z.number().int().nullable(),
  sheetPageCount: z.number().int().nullable(),
  dayIndex: z.number().int().min(1).nullable(),
  packageId: z.string().uuid().nullable(),
  layoutSource: z.enum(["qr", "param"]).nullable(),
  registration: z.enum(["fiducials", "full_page"]).nullable(),
  rows: z.array(rowSchema),
  warnings: z.array(z.string()),
});
const parseSchema = z.object({
  engine: z.string(),
  source: z.enum(["pdf", "image"]),
  dpi: z.number(),
  thresholds: z.object({ signed: z.number(), ambiguousLow: z.number(), ambiguousHigh: z.number(), reviewConfidence: z.number() }),
  pages: z.array(pageSchema),
});
export type T3CellReading = z.infer<typeof cellSchema>;
export type T3RowReading = z.infer<typeof rowSchema>;
export type T3PageReading = z.infer<typeof pageSchema>;
export type T3ParseResult = z.infer<typeof parseSchema>;

/**
 * Read the AM/PM signature cells of a Form T3 scan (PDF or image). The
 * layout comes from each page's QR code unless one is supplied (one per page).
 */
export async function parseT3(bytes: Uint8Array, mime: string, layout?: T3LayoutPayload | T3LayoutPayload[]): Promise<T3ParseResult> {
  const fields: Record<string, string> = layout ? { layout: JSON.stringify(layout) } : {};
  const response = await request("/v1/t3/parse", { method: "POST", body: form(bytes, mime, "t3-scan", fields) }, TIMEOUTS_MS.parse);
  return json(response, parseSchema, "T3 parse");
}

export interface SynthesizeSpec {
  signed: Array<[number, "AM" | "PM"]>;
  faint?: Array<[number, "AM" | "PM"]>;
  rotateDeg?: number;
  perspective?: number;
  noise?: number;
  blur?: number;
  seed?: number;
  /** 1-based page of the template PDF. */
  page?: number;
}

/** Dev only (service started with TPMS_OCR_DEV=1): a synthetic PNG "scan" of a template page. */
export async function synthesizeT3Scan(templatePdf: Uint8Array, spec: SynthesizeSpec): Promise<Uint8Array> {
  const response = await request(
    "/v1/dev/synthesize-t3",
    { method: "POST", body: form(templatePdf, "application/pdf", "template.pdf", { spec: JSON.stringify(spec) }) },
    TIMEOUTS_MS.synth,
  );
  return new Uint8Array(await response.arrayBuffer());
}

// ------------------------------------------------------------------ e-TRiS approval letter

const field = <T extends z.ZodTypeAny>(value: T) => z.object({ value: value.nullable(), confidence: z.number().min(0).max(1) });
const letterSchema = z.object({
  engine: z.string(),
  text: z.string(),
  pageCount: z.number().int(),
  fields: z.object({
    grantId: field(z.string()),
    approvedPax: field(z.number().int()),
    approvedAmount: field(z.string().regex(/^\d+\.\d{2}$/)),
    startDate: field(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    endDate: field(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    employerName: field(z.string()),
  }),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type GrantLetterDetailed = z.infer<typeof letterSchema>;

export interface GrantLetterExtraction {
  grantId: string | null;
  approvedPax: number | null;
  approvedAmount: string | null;
  startDate: string | null;
  endDate: string | null;
  employerName: string | null;
  confidence: number;
  rawText: string;
  engine: string;
}

/** Full response: per-field confidences and warnings (for a review form that highlights weak fields). */
export async function extractGrantLetterDetailed(bytes: Uint8Array, mimeType: string): Promise<GrantLetterDetailed> {
  const response = await request("/v1/grant-letter/extract", { method: "POST", body: form(bytes, mimeType, "grant-letter") }, TIMEOUTS_MS.letter);
  return json(response, letterSchema, "grant-letter");
}

/**
 * Pre-fill values for the GRANT_VERIFICATION review. Never authoritative:
 * the operator confirms every field before GRANT_CONFIRMED_LOCKED.
 */
export async function extractGrantLetter(bytes: Uint8Array, mimeType: string): Promise<{
  grantId: string | null;
  approvedPax: number | null;
  approvedAmount: string | null;
  startDate: string | null;
  endDate: string | null;
  employerName: string | null;
  confidence: number;
  rawText: string;
  engine: string;
}> {
  const detailed = await extractGrantLetterDetailed(bytes, mimeType);
  const f = detailed.fields;
  return {
    grantId: f.grantId.value,
    approvedPax: f.approvedPax.value,
    approvedAmount: f.approvedAmount.value,
    startDate: f.startDate.value,
    endDate: f.endDate.value,
    employerName: f.employerName.value,
    confidence: detailed.confidence,
    rawText: detailed.text,
    engine: detailed.engine,
  };
}
