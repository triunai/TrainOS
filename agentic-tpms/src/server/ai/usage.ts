import { sql } from "drizzle-orm";
import { fromSen, toSen } from "../../lib/money";
import { type Executor, db, one, rows } from "../db/client";
import { type BudgetState, budgetState, monthBounds, operatorTimeZone } from "./spend";
import { listTierConfig, type TierKey } from "./tiers";

/**
 * Read side of the spend ledger for the Usage page (the TrainOS Settings ›
 * Usage layout): this month's spend, where it went, where it is heading, and
 * which tiers are close to their caps. Months are calendar months in the
 * operator's time zone (Asia/Kuala_Lumpur unless TPMS_OPERATOR_TZ says
 * otherwise) — the same boundary the router's budget gate uses.
 *
 * Money leaves as NUMERIC strings; the forecast arithmetic runs in sen.
 */
export interface CostSlice {
  key: string;
  costMyr: string;
  calls: number;
  /** Share of this month's MYR total, 0–1. */
  share: number;
}

export interface ModelSlice {
  provider: string;
  model: string;
  costMyr: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface PackageSlice {
  packageId: string;
  packageCode: string;
  title: string;
  costMyr: string;
  calls: number;
}

export interface DailyPoint {
  date: string;
  costMyr: string;
  calls: number;
}

export interface TierBudget {
  tier: TierKey;
  label: string;
  capMyr: string;
  spentMyr: string;
  /** Spend over cap, 0–1+ (a zero cap reads as 1: fully spent). */
  ratio: number;
  state: BudgetState;
}

export interface UsageSummary {
  /** `YYYY-MM` in the operator's time zone. */
  month: string;
  timeZone: string;
  totalMyr: string;
  totalUsd: string;
  /** Model calls made (answers and errors), not counting template fallbacks. */
  calls: number;
  byTier: CostSlice[];
  byAgent: CostSlice[];
  byModel: ModelSlice[];
  topPackages: PackageSlice[];
  /** Every day of the month so far, zero-filled. */
  daily: DailyPoint[];
  forecast: {
    projectedMyr: string;
    trailing7DayAverageMyr: string;
    remainingDays: number;
    /** Always true: a straight line through the last week, not a commitment. */
    isEstimate: true;
  };
  /**
   * Of the agent invocations on the LLM tiers, how many were answered by the
   * deterministic template instead of a model (no key, cap hit, outage, bad output).
   */
  templateFallback: { share: number; fallbacks: number; answers: number };
  /** Cached input tokens over all input tokens on successful calls. */
  cacheHitRatio: number;
  budgets: TierBudget[];
}

const LLM_TIERS = sql`('L1', 'L3', 'L4')`;

export async function getUsageSummary(opts: { now?: Date; executor?: Executor; topPackages?: number } = {}): Promise<UsageSummary> {
  const executor = opts.executor ?? db();
  const now = opts.now ?? new Date();
  const tz = operatorTimeZone();
  const at = sql`${now.toISOString()}::timestamptz`;
  const { start, end } = monthBounds(now);
  const inMonth = sql`created_at >= ${start} and created_at < ${end}`;

  const totals = await one<{
    month: string;
    myr: string;
    usd: string;
    calls: number;
    fallbacks: number;
    answers: number;
    cache_read: number;
    input: number;
    day_of_month: number;
    days_in_month: number;
  }>(
    executor,
    sql`select to_char(${at} at time zone ${tz}, 'YYYY-MM') as month,
               coalesce(sum(cost_myr), 0)::numeric(14,4)::text as myr,
               coalesce(sum(cost_usd), 0)::numeric(14,6)::text as usd,
               (count(*) filter (where status in ('OK', 'ERROR')))::int as calls,
               (count(*) filter (where status in ('FALLBACK_TEMPLATE', 'BUDGET_BLOCKED') and tier in ${LLM_TIERS}))::int as fallbacks,
               (count(*) filter (where status = 'OK' and error is null and tier in ${LLM_TIERS}))::int as answers,
               coalesce(sum(cache_read_tokens) filter (where status = 'OK'), 0)::float8 as cache_read,
               coalesce(sum(input_tokens) filter (where status = 'OK'), 0)::float8 as input,
               extract(day from ${at} at time zone ${tz})::int as day_of_month,
               extract(day from date_trunc('month', ${at} at time zone ${tz}) + interval '1 month - 1 day')::int as days_in_month
          from tpms.llm_usage
         where ${inMonth}`,
  );
  if (!totals) throw new Error("usage totals query returned no row");
  const totalSen = toSen(totals.myr);
  const share = (myr: string) => (totalSen === 0 ? 0 : toSen(myr) / totalSen);

  const grouped = async (column: "tier" | "agent"): Promise<CostSlice[]> => {
    const result = await rows<{ key: string; cost: string; calls: number }>(
      executor,
      sql`select ${sql.raw(column)} as key, coalesce(sum(cost_myr), 0)::numeric(14,4)::text as cost, count(*)::int as calls
            from tpms.llm_usage
           where ${inMonth}
           group by ${sql.raw(column)}
           order by sum(cost_myr) desc, count(*) desc, ${sql.raw(column)}`,
    );
    return result.map((r) => ({ key: r.key, costMyr: r.cost, calls: r.calls, share: share(r.cost) }));
  };
  const byTier = await grouped("tier");
  const byAgent = await grouped("agent");

  const byModel = (
    await rows<{ provider: string; model: string; cost: string; calls: number; input: number; output: number; cache_read: number }>(
      executor,
      sql`select provider, model, coalesce(sum(cost_myr), 0)::numeric(14,4)::text as cost, count(*)::int as calls,
                 coalesce(sum(input_tokens), 0)::float8 as input, coalesce(sum(output_tokens), 0)::float8 as output,
                 coalesce(sum(cache_read_tokens), 0)::float8 as cache_read
            from tpms.llm_usage
           where ${inMonth} and status in ('OK', 'ERROR')
           group by provider, model
           order by sum(cost_myr) desc, count(*) desc, provider, model`,
    )
  ).map((r) => ({
    provider: r.provider,
    model: r.model,
    costMyr: r.cost,
    calls: r.calls,
    inputTokens: r.input,
    outputTokens: r.output,
    cacheReadTokens: r.cache_read,
  }));

  const topPackages = (
    await rows<{ package_id: string; package_code: string; title: string; cost: string; calls: number }>(
      executor,
      sql`select u.package_id::text as package_id, p.package_code, p.title,
                 coalesce(sum(u.cost_myr), 0)::numeric(14,4)::text as cost, count(*)::int as calls
            from tpms.llm_usage u
            join tpms.training_packages p on p.id = u.package_id
           where u.created_at >= ${start} and u.created_at < ${end}
           group by u.package_id, p.package_code, p.title
           order by sum(u.cost_myr) desc, count(*) desc
           limit ${opts.topPackages ?? 10}`,
    )
  ).map((r) => ({ packageId: r.package_id, packageCode: r.package_code, title: r.title, costMyr: r.cost, calls: r.calls }));

  // Days are the operator's calendar days; each is bounded as a timestamptz
  // range so the created_at index still serves the join.
  const daily = (
    await rows<{ day: string; cost: string; calls: number }>(
      executor,
      sql`select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(u.cost_myr), 0)::numeric(14,4)::text as cost, count(u.id)::int as calls
            from generate_series(date_trunc('month', ${at} at time zone ${tz}), date_trunc('day', ${at} at time zone ${tz}), interval '1 day') as d
            left join tpms.llm_usage u
              on u.created_at >= (d at time zone ${tz}) and u.created_at < ((d + interval '1 day') at time zone ${tz})
           group by d
           order by d`,
    )
  ).map((r) => ({ date: r.day, costMyr: r.cost, calls: r.calls }));

  const trailing = await one<{ total: string }>(
    executor,
    sql`select coalesce(sum(cost_myr), 0)::numeric(14,4)::text as total
          from tpms.llm_usage
         where created_at >= ((date_trunc('day', ${at} at time zone ${tz}) - interval '6 days') at time zone ${tz})
           and created_at <= ${at}`,
  );
  const averageSen = Math.round(toSen(trailing?.total ?? "0.0000") / 7);
  const remainingDays = Math.max(0, totals.days_in_month - totals.day_of_month);

  const fallbackDenominator = totals.fallbacks + totals.answers;
  const spentByTier = new Map(byTier.map((slice) => [slice.key, slice.costMyr]));

  return {
    month: totals.month,
    timeZone: tz,
    totalMyr: totals.myr,
    totalUsd: totals.usd,
    calls: totals.calls,
    byTier,
    byAgent,
    byModel,
    topPackages,
    daily,
    forecast: {
      projectedMyr: fromSen(totalSen + averageSen * remainingDays),
      trailing7DayAverageMyr: fromSen(averageSen),
      remainingDays,
      isEstimate: true,
    },
    templateFallback: {
      share: fallbackDenominator === 0 ? 0 : totals.fallbacks / fallbackDenominator,
      fallbacks: totals.fallbacks,
      answers: totals.answers,
    },
    cacheHitRatio: totals.input === 0 ? 0 : totals.cache_read / totals.input,
    budgets: await budgetsFrom(spentByTier, executor),
  };
}

/** Each tier's cap against its month-to-date spend: WITHIN, NEAR (≥80%) or PAUSED (≥100%). */
export async function getBudgetStates(opts: { now?: Date; executor?: Executor } = {}): Promise<TierBudget[]> {
  const executor = opts.executor ?? db();
  const { start, end } = monthBounds(opts.now);
  const spend = await rows<{ tier: string; total: string }>(
    executor,
    sql`select tier, coalesce(sum(cost_myr), 0)::numeric(14,4)::text as total
          from tpms.llm_usage
         where created_at >= ${start} and created_at < ${end}
         group by tier`,
  );
  return budgetsFrom(new Map(spend.map((r) => [r.tier, r.total])), executor);
}

async function budgetsFrom(spentByTier: Map<string, string>, executor: Executor): Promise<TierBudget[]> {
  return (await listTierConfig(executor)).map((tier) => {
    const spent = spentByTier.get(tier.tier) ?? "0.0000";
    const capSen = toSen(tier.monthlyCapMyr);
    return {
      tier: tier.tier,
      label: tier.label,
      capMyr: tier.monthlyCapMyr,
      spentMyr: spent,
      ratio: capSen === 0 ? 1 : toSen(spent) / capSen,
      state: budgetState(spent, tier.monthlyCapMyr),
    };
  });
}
