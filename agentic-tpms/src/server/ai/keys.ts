import { and, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { fromSen, toSen } from "../../lib/money";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Executor, SYSTEM_ACTOR, db, rows, schema, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { type Env, env } from "../env";
import { decryptSecret, encryptSecret, maskKey } from "../lib/crypto";
import { usdToMyr } from "./pricing";
import {
  EMBEDDING_DIMENSIONS,
  PROVIDER_IDS,
  ProviderError,
  callChat,
  isProviderId,
  openAiEmbeddings,
  type ProviderCredential,
  type ProviderId,
} from "./providers";
import { type BudgetState, budgetState, monthBounds, monthToDateSpend, recordUsage } from "./spend";
import { TIER_KEYS, listTierConfig } from "./tiers";

/**
 * Bring-your-own-key credentials.
 *
 * A key comes from `tpms.provider_keys` (entered in Settings, AES-256-GCM
 * sealed under the master key) or from the environment. The database wins:
 * a key an operator pasted is a deliberate choice, an env var may be a
 * leftover. Plaintext exists only in memory for the length of a call; it is
 * never returned, logged, or written to the audit ledger.
 */
export type KeyStatus = "UNTESTED" | "VALID" | "INVALID" | "DISABLED";

export interface ResolvedCredential extends ProviderCredential {
  provider: ProviderId;
  /** Null for an environment key, which has no row. */
  keyId: string | null;
  source: "db" | "env";
  label: string;
  monthlyCapMyr: string | null;
}

const ENV_KEY: Readonly<Record<ProviderId, keyof Env>> = {
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  "openai-compatible": "OPENAI_COMPATIBLE_API_KEY",
};

const ENV_ID_PREFIX = "env:";

export function envCredential(provider: ProviderId): ResolvedCredential | null {
  const e = env();
  const raw = e[ENV_KEY[provider]];
  const apiKey = typeof raw === "string" ? raw.trim() : "";
  if (!apiKey) return null;
  return {
    provider,
    apiKey,
    baseUrl: provider === "openai-compatible" ? (e.OPENAI_COMPATIBLE_BASE_URL ?? null) : null,
    keyId: null,
    source: "env",
    label: `${ENV_KEY[provider]} (environment)`,
    monthlyCapMyr: null,
  };
}

type KeyRow = typeof schema.providerKeys.$inferSelect;

/** VALID before UNTESTED, a key scoped to named tiers before a catch-all, newest first. */
function rank(a: KeyRow, b: KeyRow): number {
  const valid = Number(b.status === "VALID") - Number(a.status === "VALID");
  if (valid) return valid;
  const scoped = Number(b.tiers.length > 0) - Number(a.tiers.length > 0);
  if (scoped) return scoped;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

/**
 * Every usable credential for `provider` on `tier`, best first: stored keys
 * that are not INVALID or DISABLED and whose `tiers` is empty (all tiers) or
 * names this tier, then the environment key. A sealed key that no longer
 * decrypts (the master key changed) is skipped, not fatal.
 */
export async function resolveCredentials(provider: ProviderId, tier: string, executor: Executor = db()): Promise<ResolvedCredential[]> {
  const stored = await executor
    .select()
    .from(schema.providerKeys)
    .where(and(eq(schema.providerKeys.provider, provider), notInArray(schema.providerKeys.status, ["INVALID", "DISABLED"])));
  const out: ResolvedCredential[] = [];
  for (const row of stored.filter((r) => r.tiers.length === 0 || r.tiers.includes(tier)).sort(rank)) {
    let apiKey: string;
    try {
      apiKey = decryptSecret(row.keyCiphertext);
    } catch {
      console.warn(`[ai] provider key ${row.id} (${row.maskedKey}) does not decrypt under the current master key; skipped`);
      continue;
    }
    out.push({
      provider,
      apiKey,
      baseUrl: row.baseUrl,
      keyId: row.id,
      source: "db",
      label: row.label,
      monthlyCapMyr: row.monthlyCapMyr,
    });
  }
  const fromEnv = envCredential(provider);
  if (fromEnv) out.push(fromEnv);
  return out;
}

/** Replaces the key, and anything shaped like a key, in text headed for a column or the ledger. */
export function scrubSecret(text: string, secret?: string): string {
  let out = text;
  if (secret && secret.length >= 6) out = out.split(secret).join(maskKey(secret));
  return out.replace(/\b(?:sk-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z_-]{10,})/g, (match) => maskKey(match));
}

// ---------------------------------------------------------------- Settings services

export interface ProviderKeyView {
  /** A row uuid, or `env:<provider>` for a key read from the environment. */
  id: string;
  source: "db" | "env";
  provider: ProviderId;
  label: string;
  maskedKey: string;
  baseUrl: string | null;
  tiers: string[];
  monthlyCapMyr: string | null;
  status: KeyStatus;
  lastTestedAt: Date | null;
  lastTestResult: string | null;
  createdBy: string | null;
  createdAt: Date | null;
  monthToDateMyr: string;
  /** Null when the key has no cap of its own. */
  capState: BudgetState | null;
  /** Environment keys are managed in the deployment, not in Settings. */
  readOnly: boolean;
}

function toView(row: KeyRow, monthToDateMyr: string): ProviderKeyView {
  return {
    id: row.id,
    source: "db",
    provider: row.provider as ProviderId,
    label: row.label,
    maskedKey: row.maskedKey,
    baseUrl: row.baseUrl,
    tiers: row.tiers,
    monthlyCapMyr: row.monthlyCapMyr,
    status: row.status as KeyStatus,
    lastTestedAt: row.lastTestedAt,
    lastTestResult: row.lastTestResult,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    monthToDateMyr,
    capState: row.monthlyCapMyr === null ? null : budgetState(monthToDateMyr, row.monthlyCapMyr),
    readOnly: false,
  };
}

const moneyInput = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a non-negative amount" });
    return z.NEVER;
  }
  return fromSen(toSen(n));
});

const addKeySchema = z
  .object({
    provider: z.enum(PROVIDER_IDS),
    label: z.string().trim().min(1).max(100),
    key: z
      .string()
      .trim()
      .min(8, "key is too short")
      .max(500)
      .refine((k) => !/\s/.test(k), "key must not contain whitespace"),
    baseUrl: z
      .string()
      .trim()
      .max(300)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), "baseUrl must be an http(s) URL"),
    tiers: z.array(z.enum(TIER_KEYS)).max(TIER_KEYS.length).default([]),
    monthlyCapMyr: moneyInput.optional().nullable(),
  })
  .strict();

export type AddProviderKeyInput = z.input<typeof addKeySchema>;

function refuse(code: string, error: z.ZodError): DomainError {
  return new DomainError(code, error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
}

/** The origin only: a gateway URL can carry a token in its path or query. */
function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export async function addProviderKey(input: AddProviderKeyInput, actor: Actor): Promise<ProviderKeyView> {
  const parsed = addKeySchema.safeParse(input);
  if (!parsed.success) throw refuse("PROVIDER_KEY_INVALID", parsed.error);
  const data = parsed.data;
  const masked = maskKey(data.key);

  const row = await withTx(actor, { reasonCode: "PROVIDER_KEY_ADDED" }, async (tx) => {
    const [inserted] = await tx
      .insert(schema.providerKeys)
      .values({
        provider: data.provider,
        label: data.label,
        baseUrl: data.baseUrl,
        keyCiphertext: encryptSecret(data.key),
        maskedKey: masked,
        tiers: [...new Set(data.tiers)],
        monthlyCapMyr: data.monthlyCapMyr ?? null,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      entityType: "provider_key",
      entityId: inserted.id,
      reasonCode: "PROVIDER_KEY_ADDED",
      details: `Added ${data.provider} key "${data.label}"`,
      // Masked form only. Never the key, never the ciphertext.
      metadata: {
        provider: data.provider,
        label: data.label,
        masked_key: masked,
        tiers: inserted.tiers,
        monthly_cap_myr: inserted.monthlyCapMyr,
        base_url_origin: originOf(inserted.baseUrl),
      },
    });
    return inserted;
  });
  return toView(row, "0.0000");
}

/** Masked keys with this month's spend, stored keys first, then read-only environment keys. */
export async function listProviderKeys(opts: { executor?: Executor; now?: Date } = {}): Promise<ProviderKeyView[]> {
  const executor = opts.executor ?? db();
  const { start, end } = monthBounds(opts.now);
  const stored = await executor.select().from(schema.providerKeys);
  const spend = await rows<{ key_id: string | null; provider: string; total: string }>(
    executor,
    sql`select key_id::text as key_id, provider, coalesce(sum(cost_myr), 0)::numeric(14,4)::text as total
          from tpms.llm_usage
         where created_at >= ${start} and created_at < ${end} and provider <> 'template'
         group by key_id, provider`,
  );
  const byKey = new Map(spend.filter((s) => s.key_id).map((s) => [s.key_id as string, s.total]));
  const byEnvProvider = new Map(spend.filter((s) => !s.key_id).map((s) => [s.provider, s.total]));

  const views = stored.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((row) => toView(row, byKey.get(row.id) ?? "0.0000"));
  for (const provider of PROVIDER_IDS) {
    const cred = envCredential(provider);
    if (!cred) continue;
    views.push({
      id: `${ENV_ID_PREFIX}${provider}`,
      source: "env",
      provider,
      label: cred.label,
      maskedKey: maskKey(cred.apiKey),
      baseUrl: cred.baseUrl ?? null,
      tiers: [],
      monthlyCapMyr: null,
      status: "UNTESTED",
      lastTestedAt: null,
      lastTestResult: null,
      createdBy: null,
      createdAt: null,
      monthToDateMyr: byEnvProvider.get(provider) ?? "0.0000",
      capState: null,
      readOnly: true,
    });
  }
  return views;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findKey(id: string, executor: Executor = db()): Promise<KeyRow> {
  if (!UUID.test(id)) throw new DomainError("PROVIDER_KEY_NOT_FOUND", `No provider key ${id}`);
  const [row] = await executor.select().from(schema.providerKeys).where(eq(schema.providerKeys.id, id));
  if (!row) throw new DomainError("PROVIDER_KEY_NOT_FOUND", `No provider key ${id}`);
  return row;
}

/** Cheapest sensible model per vendor when no tier routes to it yet. */
const PROBE_DEFAULTS: Readonly<Record<ProviderId, { kind: "chat" | "embed"; model: string }>> = {
  anthropic: { kind: "chat", model: "claude-haiku-4-5" },
  openrouter: { kind: "chat", model: "google/gemini-2.5-flash-lite" },
  deepseek: { kind: "chat", model: "deepseek-chat" },
  gemini: { kind: "chat", model: "gemini-2.5-flash-lite" },
  "openai-compatible": { kind: "embed", model: "text-embedding-3-small" },
};

/** Probe with a model the key will actually serve: the first route to this vendor on a tier the key covers. */
async function probePlan(provider: ProviderId, keyTiers: string[]): Promise<{ kind: "chat" | "embed"; model: string }> {
  for (const tier of await listTierConfig()) {
    if (keyTiers.length > 0 && !keyTiers.includes(tier.tier)) continue;
    const route = [{ provider: tier.provider, model: tier.model }, ...tier.fallback].find((r) => r.provider === provider);
    if (route) return { kind: tier.tier === "EMBED" ? "embed" : "chat", model: route.model };
  }
  return PROBE_DEFAULTS[provider];
}

export interface KeyTestResult {
  ok: boolean;
  /** The key's status after the test. Environment keys are not persisted and report UNTESTED. */
  status: KeyStatus;
  httpStatus: number | null;
  message: string;
  model: string;
  latencyMs: number;
}

/**
 * One tiny real call. Success marks the key VALID; a 401/403 marks it
 * INVALID. Anything else (a 429, a 5xx, a timeout) says nothing about the key,
 * so its status is left alone and only the result text is recorded. A
 * DISABLED key stays disabled whatever the probe says.
 */
export async function testProviderKey(id: string, actor: Actor = SYSTEM_ACTOR): Promise<KeyTestResult> {
  let credential: ResolvedCredential;
  let row: KeyRow | null = null;
  if (id.startsWith(ENV_ID_PREFIX)) {
    const provider = id.slice(ENV_ID_PREFIX.length);
    const cred = isProviderId(provider) ? envCredential(provider) : null;
    if (!cred) throw new DomainError("PROVIDER_KEY_NOT_FOUND", `No environment key for ${provider}`);
    credential = cred;
  } else {
    row = await findKey(id);
    let apiKey: string;
    try {
      apiKey = decryptSecret(row.keyCiphertext);
    } catch {
      throw new DomainError("PROVIDER_KEY_UNREADABLE", "This key was sealed under a different master key; add it again");
    }
    credential = {
      provider: row.provider as ProviderId,
      apiKey,
      baseUrl: row.baseUrl,
      keyId: row.id,
      source: "db",
      label: row.label,
      monthlyCapMyr: row.monthlyCapMyr,
    };
  }

  const plan = await probePlan(credential.provider, row?.tiers ?? []);
  const started = Date.now();
  let httpStatus: number | null = null;
  let message: string;
  let ok = false;
  try {
    if (plan.kind === "embed") {
      if (credential.provider === "anthropic") throw new ProviderError("anthropic", "Anthropic has no embeddings endpoint", { retryable: false });
      const result = await openAiEmbeddings(credential.provider, credential, plan.model, ["ping"], {
        dimensions: EMBEDDING_DIMENSIONS,
        timeoutMs: 15_000,
      });
      await recordProbe(credential, plan.model, result.usage.in, 0, result.costUsd, result.costEstimated, result.latencyMs, null);
    } else {
      const result = await callChat(
        credential.provider,
        credential,
        { model: plan.model, messages: [{ role: "user", content: "Reply with the single word OK." }], maxTokens: 16 },
        { timeoutMs: 15_000 },
      );
      await recordProbe(credential, plan.model, result.usage.in, result.usage.out, result.costUsd, result.costEstimated, result.latencyMs, null);
    }
    ok = true;
    httpStatus = 200;
    message = `OK — ${plan.model} answered in ${Date.now() - started}ms`;
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    httpStatus = error.status ?? null;
    message = scrubSecret(error.message, credential.apiKey).slice(0, 500);
    await recordProbe(credential, plan.model, 0, 0, 0, true, Date.now() - started, message);
  }
  const latencyMs = Date.now() - started;

  if (!row) return { ok, status: "UNTESTED", httpStatus, message, model: plan.model, latencyMs };

  const verdict: KeyStatus =
    row.status === "DISABLED" ? "DISABLED" : ok ? "VALID" : httpStatus === 401 || httpStatus === 403 ? "INVALID" : (row.status as KeyStatus);
  const keyRow = row;
  await withTx(actor, { reasonCode: "PROVIDER_KEY_TESTED" }, async (tx) => {
    await tx
      .update(schema.providerKeys)
      .set({ status: verdict, lastTestedAt: new Date(), lastTestResult: message })
      .where(eq(schema.providerKeys.id, keyRow.id));
    await recordAudit(tx, {
      entityType: "provider_key",
      entityId: keyRow.id,
      reasonCode: "PROVIDER_KEY_TESTED",
      details: `${keyRow.provider} key "${keyRow.label}" tested: ${ok ? "OK" : `failed (${httpStatus ?? "no response"})`}`,
      metadata: { provider: keyRow.provider, masked_key: keyRow.maskedKey, ok, http_status: httpStatus, status: verdict, model: plan.model },
    });
  });
  return { ok, status: verdict, httpStatus, message, model: plan.model, latencyMs };
}

/** A key test is real spend on a real key; it lands in the ledger under its own tier so no budget pays for it. */
async function recordProbe(
  credential: ResolvedCredential,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  costEstimated: boolean,
  latencyMs: number,
  error: string | null,
): Promise<void> {
  await recordUsage({
    agent: "settings.key_test",
    tier: "TEST",
    provider: credential.provider,
    model,
    keyId: credential.keyId,
    inputTokens,
    outputTokens,
    costUsd,
    costMyr: usdToMyr(costUsd),
    costEstimated,
    latencyMs,
    status: error ? "ERROR" : "OK",
    error,
  });
}

export async function disableProviderKey(id: string, actor: Actor): Promise<ProviderKeyView> {
  if (id.startsWith(ENV_ID_PREFIX)) {
    throw new DomainError("PROVIDER_KEY_READ_ONLY", "This key is set in the environment; remove it from the deployment's configuration");
  }
  const updated = await withTx(actor, { reasonCode: "PROVIDER_KEY_DISABLED" }, async (tx) => {
    const row = await findKey(id, tx);
    const [next] = await tx
      .update(schema.providerKeys)
      .set({ status: "DISABLED" })
      .where(eq(schema.providerKeys.id, row.id))
      .returning();
    await recordAudit(tx, {
      entityType: "provider_key",
      entityId: row.id,
      reasonCode: "PROVIDER_KEY_DISABLED",
      details: `Disabled ${row.provider} key "${row.label}"`,
      metadata: { provider: row.provider, masked_key: row.maskedKey, previous_status: row.status },
    });
    return next;
  });
  return toView(updated, await monthToDateSpend({ keyId: updated.id }));
}
