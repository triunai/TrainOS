import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { formatRM, fromSen, type Sen } from "@/lib/money";
import type { Provenance } from "../ai";
import { type Actor, type Executor, schema } from "../db/client";
import type { TrainingPackage, VaultDocument } from "../db/schema";
import { DomainError } from "../domain/errors";
import { sha256Hex } from "../lib/crypto";
import { storeDocument, type StoreInput } from "../storage/vault";

/**
 * Helpers shared by the claims, finance and retention modules (lane E). Kept
 * here rather than in `src/server/lib` because they encode finance policy:
 * who may act, how an amount typed by an operator is parsed, and how a
 * regenerated document avoids piling duplicates into an immutable vault.
 */

// ---------------------------------------------------------------- configuration

export interface FinanceConfig {
  /** SST rate in basis points of a basis point (1e-4): 800 = 8%. */
  sstRateE4: number;
  /** The same rate as the NUMERIC(5,4) text `tax_invoices.tax_rate` stores. */
  sstRateText: string;
  /** Sales commission, fraction of the HRD Corp approved amount, in 1e-4 units. 0 = no commission voucher. */
  commissionRateE4: number;
}

const FRACTION = /^0(\.\d{1,4})?$/;

/**
 * Rates are fractions with at most four decimals ("0.08"), read on every call
 * so a test or an operator changing the environment is picked up. Anything
 * else is a configuration error rather than a silent zero (R14): "8" meaning
 * 8% would otherwise bill 800%.
 */
function parseRate(name: string, raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const value = raw.trim();
  if (!FRACTION.test(value)) {
    throw new Error(`${name} must be a fraction below 1 with at most 4 decimals, e.g. 0.08 (got "${raw}")`);
  }
  return Math.round(Number(value) * 10_000);
}

export function financeConfig(): FinanceConfig {
  const sstRateE4 = parseRate("TPMS_SST_RATE", process.env.TPMS_SST_RATE);
  return {
    sstRateE4,
    sstRateText: (sstRateE4 / 10_000).toFixed(4),
    commissionRateE4: parseRate("TPMS_COMMISSION_RATE", process.env.TPMS_COMMISSION_RATE),
  };
}

/** "16,000.00" — a printed amount column (the column header carries the currency). */
export function amountText(sen: Sen): string {
  return formatRM(fromSen(sen)).replace(/^RM\s/, "");
}

export function applyRate(amount: Sen, rateE4: number): Sen {
  return Math.round((amount * rateE4) / 10_000);
}

// ---------------------------------------------------------------- actors and ids

/** Agents propose; a named operator disposes. Every Gate 3 action is a human act. */
export function requireOperator(actor: Actor, action: string): void {
  if (actor.type !== "USER" || !actor.id) {
    throw new DomainError("OPERATOR_REQUIRED", `${action} needs a named operator; a ${actor.type} actor cannot do it`);
  }
}

const Uuid = z.string().uuid();

export function assertUuid(value: string, field: string): string {
  if (!Uuid.safeParse(value).success) throw new DomainError("INVALID_ID", `${field} is not a valid id`);
  return value;
}

/** Row-locks the aggregate so two writers (a task and an operator) serialise on it. */
export async function lockPackage(executor: Executor, packageId: string): Promise<TrainingPackage> {
  assertUuid(packageId, "packageId");
  const locked = await executor.execute(sql`select id from tpms.training_packages where id = ${packageId}::uuid for update`);
  if (locked.rows.length === 0) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
  const [pkg] = await executor.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
  return pkg;
}

// ---------------------------------------------------------------- money input

const MONEY_TEXT = /^-?\d{1,8}(\.\d{1,2})?$/;

/**
 * Parses an operator-entered ringgit amount to sen. Strings must be plain
 * decimals ("16000.00"); numbers must carry at most two decimals. A value
 * that would need rounding is refused — a claim or a payment is never
 * silently nudged by a sub-sen amount.
 */
export function parseAmount(value: string | number, field: string, opts: { allowNegative?: boolean; allowZero?: boolean } = {}): Sen {
  let sen: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DomainError("INVALID_AMOUNT", `${field} is not a number`);
    sen = Math.round(value * 100);
    if (Math.abs(sen - value * 100) > 1e-6) throw new DomainError("INVALID_AMOUNT", `${field} has more than two decimals`);
  } else {
    const text = value.trim().replace(/,/g, "");
    if (!MONEY_TEXT.test(text)) throw new DomainError("INVALID_AMOUNT", `${field} must be an amount like 1234.50`);
    const negative = text.startsWith("-");
    const [whole, cents = ""] = text.replace("-", "").split(".");
    sen = (Number(whole) * 100 + Number(cents.padEnd(2, "0"))) * (negative ? -1 : 1);
  }
  if (sen < 0 && !opts.allowNegative) throw new DomainError("INVALID_AMOUNT", `${field} cannot be negative`);
  if (sen === 0 && !opts.allowZero) throw new DomainError("INVALID_AMOUNT", `${field} must be greater than zero`);
  return sen;
}

// ---------------------------------------------------------------- uploads

const UPLOAD_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** An operator upload (remittance advice, bank receipt): PDF or image, non-empty, bounded. */
export function assertUpload(bytes: Uint8Array | null | undefined, mime: string, code: string, label: string): void {
  if (!bytes || bytes.byteLength === 0) throw new DomainError(code, `${label} is required`);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new DomainError("UPLOAD_TOO_LARGE", `${label} exceeds 20 MB`);
  if (!UPLOAD_MIME.has(mime)) throw new DomainError("UNSUPPORTED_FILE", `${label} must be a PDF, PNG or JPEG (got ${mime})`);
}

// ---------------------------------------------------------------- vault

/**
 * Store a generated document unless the vault already holds these exact bytes
 * for this package and type. The vault is append-only, so a re-run of a
 * drafter (the tasks are re-runnable) must not add a duplicate row each time;
 * because generated PDFs are byte-deterministic, same inputs = same hash.
 */
export async function storeOnce(executor: Executor, input: StoreInput): Promise<VaultDocument> {
  const hash = sha256Hex(input.bytes);
  if (input.packageId) {
    const [existing] = await executor
      .select()
      .from(schema.complianceVault)
      .where(
        and(
          eq(schema.complianceVault.packageId, input.packageId),
          eq(schema.complianceVault.documentType, input.documentType),
          eq(schema.complianceVault.fileHashSha256, hash),
          ne(schema.complianceVault.verificationStatus, "FLAGGED"),
        ),
      )
      .orderBy(desc(schema.complianceVault.createdAt))
      .limit(1);
    if (existing) return existing;
  }
  return storeDocument(executor, input);
}

/** Stable JSON (sorted keys): jsonb reorders keys, so a plain stringify cannot compare a round-tripped value. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Filesystem- and zip-safe file name that keeps the extension. */
export function safeFileName(name: string, fallback = "file"): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-80);
  return cleaned || fallback;
}

const RUN_STATUS: Record<Provenance["mode"], "SUCCEEDED" | "FALLBACK"> = {
  LLM: "SUCCEEDED",
  RULE: "SUCCEEDED",
  EXTRACTION: "SUCCEEDED",
  TEMPLATE: "FALLBACK",
};

/**
 * Agent-run status for work whose prose came from `runTier`: a deterministic
 * template standing in for the model is recorded as FALLBACK, so the Agents
 * screen shows which runs never reached a model. No prose step = SUCCEEDED.
 */
export function runStatus(mode: Provenance["mode"] | undefined): "SUCCEEDED" | "FALLBACK" {
  if (mode === undefined) return "SUCCEEDED";
  const status = RUN_STATUS[mode];
  if (!status) throw new Error(`Unknown provenance mode: ${String(mode)}`);
  return status;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
