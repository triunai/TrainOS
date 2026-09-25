import { sql, type SQL } from "drizzle-orm";
import { toSen } from "../../lib/money";
import { type Executor, db, one, schema } from "../db/client";
import { env } from "../env";

/**
 * The spend ledger: every model call writes one `tpms.llm_usage` row, and
 * every budget decision reads month-to-date sums back from the same table.
 * One writer and one reader, so the gate and the Usage page cannot disagree.
 *
 * Rows are written with the pool, never the caller's transaction: the money
 * was spent whether or not the caller later rolls back.
 */
export const USAGE_STATUSES = ["OK", "ERROR", "FALLBACK_TEMPLATE", "BUDGET_BLOCKED"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export interface UsageEntry {
  runId?: string | null;
  agent: string;
  tier: string;
  provider: string;
  model: string;
  keyId?: string | null;
  packageId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
  costMyr?: number;
  costEstimated?: boolean;
  latencyMs?: number;
  status: UsageStatus;
  /**
   * Why the call's output was not used. On an ERROR row it is the provider's
   * error; on an OK row it means the call succeeded but its output failed
   * validation — the Usage page counts only OK rows with no error as answers.
   */
  error?: string | null;
}

export async function recordUsage(entry: UsageEntry, executor: Executor = db()): Promise<void> {
  await executor.insert(schema.llmUsage).values({
    runId: entry.runId ?? null,
    agent: entry.agent.slice(0, 64),
    tier: entry.tier.slice(0, 8),
    provider: entry.provider.slice(0, 32),
    model: entry.model.slice(0, 100),
    keyId: entry.keyId ?? null,
    packageId: entry.packageId ?? null,
    inputTokens: Math.max(0, Math.round(entry.inputTokens ?? 0)),
    outputTokens: Math.max(0, Math.round(entry.outputTokens ?? 0)),
    cacheReadTokens: Math.max(0, Math.round(entry.cacheReadTokens ?? 0)),
    // Column precision (0010): cost_usd numeric(16,10), cost_myr numeric(16,8).
    costUsd: (entry.costUsd ?? 0).toFixed(10),
    costMyr: (entry.costMyr ?? 0).toFixed(8),
    costEstimated: entry.costEstimated ?? true,
    latencyMs: Math.max(0, Math.round(entry.latencyMs ?? 0)),
    status: entry.status,
    error: entry.error ? entry.error.slice(0, 1000) : null,
  });
}

/** Budgets and the Usage page reset on the operator's calendar month (Asia/Kuala_Lumpur by default). */
export function operatorTimeZone(): string {
  return env().TPMS_OPERATOR_TZ;
}

/** The [start, end) of the operator-time-zone month containing `now`, as SQL timestamptz expressions. */
export function monthBounds(now: Date = new Date()): { start: SQL; end: SQL } {
  const tz = operatorTimeZone();
  const at = sql`${now.toISOString()}::timestamptz`;
  return {
    start: sql`(date_trunc('month', ${at} at time zone ${tz}) at time zone ${tz})`,
    end: sql`((date_trunc('month', ${at} at time zone ${tz}) + interval '1 month') at time zone ${tz})`,
  };
}

export type SpendScope = { tier: string } | { keyId: string } | { envProvider: string };

/**
 * Month-to-date MYR as the database's NUMERIC string. An environment key has
 * no row id, so its spend is every row for that provider with no key id.
 */
export async function monthToDateSpend(
  scope: SpendScope,
  opts: { executor?: Executor; now?: Date } = {},
): Promise<string> {
  const { start, end } = monthBounds(opts.now);
  const filter =
    "tier" in scope
      ? sql`tier = ${scope.tier}`
      : "keyId" in scope
        ? sql`key_id = ${scope.keyId}::uuid`
        : sql`key_id is null and provider = ${scope.envProvider}`;
  const row = await one<{ total: string }>(
    opts.executor ?? db(),
    sql`select coalesce(sum(cost_myr), 0)::numeric(14,4)::text as total
          from tpms.llm_usage
         where ${filter} and created_at >= ${start} and created_at < ${end}`,
  );
  return row?.total ?? "0.0000";
}

export type BudgetState = "WITHIN" | "NEAR" | "PAUSED";

/** At or above this share of the cap a budget reports NEAR. */
export const NEAR_THRESHOLD = 0.8;

/**
 * Compared in integer sen. A cap of zero is PAUSED — "no spend allowed" — so
 * an operator can switch a tier's paid calls off without disabling the tier.
 */
export function budgetState(spentMyr: string | number, capMyr: string | number): BudgetState {
  const spent = toSen(spentMyr);
  const cap = toSen(capMyr);
  if (spent >= cap) return "PAUSED";
  if (spent >= cap * NEAR_THRESHOLD) return "NEAR";
  return "WITHIN";
}
