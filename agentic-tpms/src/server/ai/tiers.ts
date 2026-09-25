import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { fromSen, toSen } from "../../lib/money";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Executor, db, schema, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { PROVIDER_IDS, type ProviderId } from "./providers/types";

/**
 * Tier routing: which vendor and model answers each tier, what it may fall
 * back to, and how much it may spend per calendar month.
 *
 * The defaults below are what runs when nobody has touched Settings — the
 * router reads a missing `tier_config` row as its default, so a fresh
 * database works before `seedTierConfig` has ever run.
 */
export const TIER_KEYS = ["L1", "L3", "L4", "EMBED"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

export interface TierRoute {
  provider: ProviderId;
  model: string;
}

export interface TierSettings {
  tier: TierKey;
  label: string;
  provider: ProviderId;
  model: string;
  fallback: TierRoute[];
  /** NUMERIC string, MYR per calendar month (operator time zone). "0.00" pauses the tier. */
  monthlyCapMyr: string;
  maxTokens: number;
  enabled: boolean;
  /** Null when the row has never been saved and the defaults are in force. */
  updatedAt: Date | null;
}

type TierDefaults = Omit<TierSettings, "tier" | "updatedAt">;

export const DEFAULT_TIERS: Readonly<Record<TierKey, TierDefaults>> = {
  L1: {
    label: "Fast classifier",
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    fallback: [{ provider: "openrouter", model: "google/gemini-2.5-flash-lite" }],
    monthlyCapMyr: "60.00",
    maxTokens: 256,
    enabled: true,
  },
  L3: {
    label: "Domain specialists",
    provider: "deepseek",
    model: "deepseek-chat",
    fallback: [{ provider: "openrouter", model: "deepseek/deepseek-chat" }],
    monthlyCapMyr: "250.00",
    maxTokens: 4096,
    enabled: true,
  },
  L4: {
    label: "Tone specialist",
    provider: "anthropic",
    model: "claude-sonnet-5",
    fallback: [{ provider: "openrouter", model: "anthropic/claude-sonnet-5" }],
    monthlyCapMyr: "400.00",
    maxTokens: 2048,
    enabled: true,
  },
  EMBED: {
    label: "Embeddings",
    provider: "openai-compatible",
    model: "text-embedding-3-small",
    fallback: [],
    monthlyCapMyr: "30.00",
    maxTokens: 2048,
    enabled: true,
  },
};

export function isTierKey(value: unknown): value is TierKey {
  return typeof value === "string" && (TIER_KEYS as readonly string[]).includes(value);
}

function defaultsFor(tier: TierKey): TierSettings {
  const d = DEFAULT_TIERS[tier];
  return { tier, ...d, fallback: d.fallback.map((r) => ({ ...r })), updatedAt: null };
}

const routeSchema = z.object({ provider: z.enum(PROVIDER_IDS), model: z.string().trim().min(1).max(100) });

type TierRow = typeof schema.tierConfig.$inferSelect;

/**
 * R14: the database has no check on `provider` or on the shape of `fallback`,
 * so the read side refuses a value it does not recognise rather than routing
 * to whichever branch happens to be the default.
 */
function fromRow(row: TierRow): TierSettings {
  if (!isTierKey(row.tier)) throw new DomainError("TIER_CONFIG_INVALID", `Unknown tier ${row.tier}`);
  const provider = z.enum(PROVIDER_IDS).safeParse(row.provider);
  const fallback = z.array(routeSchema).safeParse(row.fallback);
  if (!provider.success || !fallback.success) {
    throw new DomainError("TIER_CONFIG_INVALID", `tier_config ${row.tier} names an unknown provider or a malformed fallback`, {
      tier: row.tier,
    });
  }
  return {
    tier: row.tier,
    label: row.label,
    provider: provider.data,
    model: row.model,
    fallback: fallback.data,
    monthlyCapMyr: row.monthlyCapMyr,
    maxTokens: row.maxTokens,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

/** Inserts the default row for every tier that has none. Never overwrites an operator's edit. */
export async function seedTierConfig(executor: Executor = db()): Promise<void> {
  await executor
    .insert(schema.tierConfig)
    .values(TIER_KEYS.map((tier) => ({ tier, ...DEFAULT_TIERS[tier] })))
    .onConflictDoNothing();
}

export async function getTierConfig(tier: TierKey, executor: Executor = db()): Promise<TierSettings> {
  if (!isTierKey(tier)) throw new DomainError("UNKNOWN_TIER", `Unknown tier ${String(tier)}`);
  const [row] = await executor.select().from(schema.tierConfig).where(eq(schema.tierConfig.tier, tier));
  return row ? fromRow(row) : defaultsFor(tier);
}

export async function listTierConfig(executor: Executor = db()): Promise<TierSettings[]> {
  const stored = await executor.select().from(schema.tierConfig);
  const byTier = new Map(stored.map((row) => [row.tier, row]));
  return TIER_KEYS.map((tier) => {
    const row = byTier.get(tier);
    return row ? fromRow(row) : defaultsFor(tier);
  });
}

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    provider: z.enum(PROVIDER_IDS),
    model: z.string().trim().min(1).max(100),
    fallback: z.array(routeSchema).max(4),
    monthlyCapMyr: z.union([z.string(), z.number()]).transform((v, ctx) => {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 99_999_999) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "monthlyCapMyr must be a non-negative amount" });
        return z.NEVER;
      }
      return fromSen(toSen(n));
    }),
    maxTokens: z.number().int().min(1).max(128_000),
    enabled: z.boolean(),
  })
  .partial()
  .strict();

export type TierPatch = z.input<typeof patchSchema>;

/**
 * Audit rows need a uuid entity id and a tier's key is `L1`. A name-based id
 * keeps every change to one tier on one audit trail.
 */
export function tierEntityId(tier: TierKey): string {
  const h = createHash("sha1").update(`tpms.tier_config:${tier}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function updateTierConfig(tier: TierKey, patch: TierPatch, actor: Actor): Promise<TierSettings> {
  if (!isTierKey(tier)) throw new DomainError("UNKNOWN_TIER", `Unknown tier ${String(tier)}`);
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) {
    throw new DomainError("TIER_CONFIG_INVALID", parsed.error.issues.map((i) => `${i.path.join(".") || "patch"}: ${i.message}`).join("; "));
  }
  const changes = parsed.data;

  return withTx(actor, { reasonCode: "TIER_CONFIG_UPDATED" }, async (tx) => {
    const before = await getTierConfig(tier, tx);
    const after: TierSettings = { ...before, ...changes, tier, updatedAt: new Date() };
    if (tier === "EMBED" && [after.provider, ...after.fallback.map((r) => r.provider)].includes("anthropic")) {
      throw new DomainError("TIER_CONFIG_INVALID", "Anthropic has no embeddings endpoint; the EMBED tier needs an OpenAI-compatible provider");
    }
    const values = {
      label: after.label,
      provider: after.provider,
      model: after.model,
      fallback: after.fallback,
      monthlyCapMyr: after.monthlyCapMyr,
      maxTokens: after.maxTokens,
      enabled: after.enabled,
      updatedAt: after.updatedAt ?? new Date(),
    };
    await tx
      .insert(schema.tierConfig)
      .values({ tier, ...values })
      .onConflictDoUpdate({ target: schema.tierConfig.tier, set: values });

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(changes) as Array<keyof typeof changes>) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diff[key] = { from: before[key], to: after[key] };
    }
    await recordAudit(tx, {
      entityType: "tier_config",
      entityId: tierEntityId(tier),
      reasonCode: "TIER_CONFIG_UPDATED",
      details: `Tier ${tier} routing updated`,
      metadata: { tier, changes: diff },
    });
    return after;
  });
}
