import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * One typed read of the environment. Next.js loads `.env` itself; scripts and
 * the worker call `loadDotEnv()` first so both runtimes see the same values.
 */
export function loadDotEnv(file = ".env"): void {
  const full = path.resolve(process.cwd(), file);
  if (existsSync(full) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(full);
  }
}

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TEST_DATABASE_URL: z.string().optional(),
  TPMS_MASTER_KEY: z.string().min(32, "TPMS_MASTER_KEY must be at least 32 characters"),
  TPMS_NRIC_PEPPER: z.string().min(8),
  TPMS_JWT_SECRET: z.string().min(32, "TPMS_JWT_SECRET must be at least 32 characters"),
  TPMS_PUBLIC_BASE_URL: z.string().default("http://localhost:3100"),
  TPMS_PROVIDER_NAME: z.string().default("Training Provider Sdn Bhd"),
  TPMS_PROVIDER_HRDC_ID: z.string().default("TP-000000"),
  TPMS_OPERATOR_TZ: z.string().default("Asia/Kuala_Lumpur"),
  TPMS_BASIC_AUTH: z.string().optional(),
  TPMS_STORAGE_DIR: z.string().default("./storage"),
  PADDLEOCR_URL: z.string().default("http://localhost:8866"),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
  OPENAI_COMPATIBLE_BASE_URL: z.string().optional(),
  USD_TO_MYR: z.coerce.number().positive().default(4.45),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  INBOUND_MAIL_SECRET: z.string().optional(),
  /** Tax-inclusive SST rate as a fraction (0.08), split out of the claimable total. Confirm with a tax adviser. */
  TPMS_SST_RATE: z.coerce.number().min(0).max(0.5).default(0),
  /** Sales commission as a fraction of the approved grant; 0 drafts no commission voucher. */
  TPMS_COMMISSION_RATE: z.coerce.number().min(0).max(0.5).default(0),
  META_PAGE_ACCESS_TOKEN: z.string().optional(),
  GOOGLE_WEBHOOK_KEY: z.string().optional(),
  /** Shared secret header (x-tpms-webhook-secret) for the LinkedIn and web-form webhooks. */
  LEAD_WEBHOOK_SECRET: z.string().optional(),
  /** The virtual forwarding mailbox (sender is the lead) and the smart-BCC address (recipient is the lead). */
  LEAD_INBOX_ADDRESS: z.string().optional(),
  SMART_BCC_ADDRESS: z.string().optional(),
  /** Comma-separated staff domains, so a BCC'd staff sender is never mistaken for a lead. */
  STAFF_EMAIL_DOMAINS: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v])),
  );
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Tests swap DATABASE_URL between runs; they need the cache cleared. */
export function resetEnvCache(): void {
  cached = undefined;
}
