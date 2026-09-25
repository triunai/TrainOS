import { sql } from "drizzle-orm";
import { vi } from "vitest";
import { db } from "@/server/db/client";
import { resetEnvCache } from "@/server/env";

/**
 * Every BYOK variable the AI layer reads. A test states the full set it runs
 * under — anything not named is blanked — so a key exported in a developer's
 * shell can never turn a "no keys" test into a real vendor call.
 */
export const AI_ENV_VARS = [
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_COMPATIBLE_API_KEY",
  "OPENAI_COMPATIBLE_BASE_URL",
  "USD_TO_MYR",
] as const;

export type AiEnv = Partial<Record<(typeof AI_ENV_VARS)[number], string>>;

export function useAiEnv(values: AiEnv = {}): void {
  for (const name of AI_ENV_VARS) vi.stubEnv(name, values[name] ?? "");
  resetEnvCache();
}

export function restoreAiEnv(): void {
  vi.unstubAllEnvs();
  resetEnvCache();
}

/** The AI tables only; the rest of the lane's database is left as the migrations built it. */
export async function clearAiTables(): Promise<void> {
  await db().execute(sql`delete from tpms.llm_usage`);
  await db().execute(sql`delete from tpms.provider_keys`);
  await db().execute(sql`delete from tpms.tier_config`);
}

export interface UsageRow {
  tier: string;
  agent: string;
  provider: string;
  model: string;
  status: string;
  key_id: string | null;
  package_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: string;
  cost_myr: string;
  cost_estimated: boolean;
  error: string | null;
}

export async function usageRows(): Promise<UsageRow[]> {
  const result = await db().execute(sql`select tier, agent, provider, model, status, key_id::text as key_id, package_id::text as package_id,
                                               input_tokens, output_tokens, cache_read_tokens, cost_usd, cost_myr, cost_estimated, error
                                          from tpms.llm_usage order by created_at, id`);
  return result.rows as unknown as UsageRow[];
}
