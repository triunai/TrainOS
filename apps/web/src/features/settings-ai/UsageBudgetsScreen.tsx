import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Budget, TierKey, UsageBreakdownRow } from "@trainos/contract";
import {
  BudgetBar,
  Breadcrumb,
  ContentCard,
  DataTable,
  ErrorState,
  ExceptionBanner,
  formatMoney,
  GhostButton,
  LoadingState,
  MiniBar,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  humanise,
  tierLabel,
  type Column,
  type PillTab,
} from "@/shared/components/kit";
import { RefusalBanner } from "./RefusalBanner";
import { useBudgets, usePutBudget, useUsage, type UsageGroupBy } from "./api";
import { AI_MODELS_PATH, PROVIDERS_PATH } from "./paths";

/**
 * M20-S16 · Usage, cost and budgets.
 *
 * Primary user: System Admin; Finance and the MD read it, and the MD is the one
 * who can raise a cap. Primary button: "Raise SPECIAL cap".
 *
 * Every number drills to the runs behind it — that is the screen's whole claim,
 * and the drill route is DATA. `UsageBreakdownRow.drillTo` arrives from the
 * server as a filtered runs query, so the page never constructs a route from a
 * key it happens to know the shape of. A number nobody can trace back to the
 * runs that produced it is a number nobody should act on.
 *
 * States rendered (§4): SPECIAL paused by cap with a one-click raise, rule
 * extraction at 98% of its cap, and a forecast still inside the cap.
 */

const PERIOD = "2026-11";

const GROUPS: { id: UsageGroupBy; label: string }[] = [
  { id: "TIER", label: "By tier" },
  { id: "AGENT", label: "By agent" },
  { id: "ACTION_TYPE", label: "By action type" },
];

/**
 * How a budget's key reads.
 *
 * A TIER budget is keyed by a `TierKey`, which is a routing token and renders
 * as `SPECIAL`, not as the word "Special". An AGENT or ACTION_TYPE budget is
 * keyed by an id or an enum, which does read as a sentence.
 */
function budgetLabel(budget: Pick<Budget, "scope" | "key">): string {
  return budget.scope === "TIER" ? tierLabel(budget.key as TierKey) : humanise(budget.key);
}

const BUDGET_TONE = {
  WITHIN: "neutral",
  NEAR: "warning",
  PAUSED: "danger",
} as const;

const BUDGET_LABEL = {
  WITHIN: "Within cap",
  NEAR: "Near cap",
  PAUSED: "Paused by cap",
} as const;

/** A paused cap raised by a quarter is the pack's "one-click raise". */
function proposedCap(budget: Budget) {
  return { amount: Math.round(budget.cap.amount * 1.25), currency: budget.cap.currency };
}

export function UsageBudgetsScreen() {
  const navigate = useNavigate();
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("TIER");
  const usage = useUsage(PERIOD, groupBy);
  const budgets = useBudgets();
  const raise = usePutBudget();

  const budgetRows = useMemo(() => budgets.data?.data ?? [], [budgets.data]);
  const paused = budgetRows.find((budget) => budget.state === "PAUSED");
  const near = budgetRows.find((budget) => budget.state === "NEAR");

  const tabs = useMemo<PillTab[]>(
    () => GROUPS.map((group) => ({ id: group.id, label: group.label })),
    [],
  );

  const budgetColumns = useMemo<Column<Budget>[]>(
    () => [
      {
        key: "key",
        label: "Scope",
        accessor: (budget) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] text-ink">{budgetLabel(budget)}</span>
            <span className="text-[11px] text-ink-muted">{humanise(budget.scope)}</span>
          </div>
        ),
      },
      {
        key: "cap",
        label: "Cap",
        align: "right",
        accessor: (budget) => <MoneyText value={budget.cap} />,
        width: "110px",
      },
      {
        key: "spend",
        label: "Spent",
        align: "right",
        accessor: (budget) => <MoneyText value={budget.spend} />,
        width: "110px",
      },
      {
        key: "progress",
        label: "Progress",
        accessor: (budget) => <BudgetBar label={budgetLabel(budget)} budget={budget} />,
        width: "230px",
      },
      {
        key: "state",
        label: "Status",
        accessor: (budget) => (
          <StatusChip tone={BUDGET_TONE[budget.state]}>{BUDGET_LABEL[budget.state]}</StatusChip>
        ),
        width: "140px",
      },
      {
        key: "action",
        label: "Action",
        accessor: (budget) =>
          budget.state === "PAUSED" ? (
            <SecondaryButton
              disabled={raise.isPending}
              onClick={() =>
                raise.mutate({
                  scope: budget.scope,
                  key: budget.key,
                  body: { cap: proposedCap(budget) },
                })
              }
            >
              Raise cap
            </SecondaryButton>
          ) : (
            <span className="text-[12px] text-ink-muted">—</span>
          ),
        width: "130px",
      },
    ],
    [raise],
  );

  if (usage.isPending || budgets.isPending) {
    return <LoadingState rows={10} label="Loading usage and budgets" />;
  }
  if (usage.isError) {
    return (
      <ErrorState
        title="Usage could not be loaded"
        error={usage.error}
        onRetry={() => void usage.refetch()}
      />
    );
  }
  if (budgets.isError) {
    return (
      <ErrorState
        title="Budgets could not be loaded"
        error={budgets.error}
        onRetry={() => void budgets.refetch()}
      />
    );
  }

  const { totals, forecast, cap, breakdown } = usage.data;
  const forecastInsideCap = forecast.amount <= cap.amount;
  const maxSpend = Math.max(...breakdown.map((row) => row.spend.amount), 1);

  return (
    <div className="flex flex-col gap-4 pb-10">
      <div className="px-5 pt-4">
        <Breadcrumb
          items={[{ label: "Settings" }, { label: "Usage" }, { label: "November 2026" }]}
        />
      </div>

      <RecordHeader
        withoutCondensed
        title="Usage"
        meta={["November 2026", `forecast ${forecastInsideCap ? "inside" : "over"} cap`]}
        actions={
          <>
            <SecondaryButton onClick={() => navigate(AI_MODELS_PATH)}>Tiers</SecondaryButton>
            <SecondaryButton onClick={() => navigate(PROVIDERS_PATH)}>
              Provider keys
            </SecondaryButton>
          </>
        }
        primaryAction={
          paused ? (
            <PrimaryButton
              disabled={raise.isPending}
              onClick={() =>
                raise.mutate({
                  scope: paused.scope,
                  key: paused.key,
                  body: { cap: proposedCap(paused) },
                })
              }
            >
              Raise {budgetLabel(paused)} cap
            </PrimaryButton>
          ) : undefined
        }
        metrics={[
          {
            label: "LLM spend",
            value: totals.llm,
            sub: `of ${formatMoney(cap, true)} cap`,
            bar: cap.amount === 0 ? 0 : totals.llm.amount / cap.amount,
          },
          {
            label: "Forecast to month end",
            value: forecast,
            sub: forecastInsideCap ? "within cap" : "over cap",
            estimate: true,
          },
          { label: "WhatsApp", value: totals.whatsapp },
          { label: "Compute", value: totals.compute },
          {
            label: "Cache-hit ratio",
            value: `${Math.round(totals.cacheHitRate * 100)}%`,
            sub: `saves about ${formatMoney(totals.estimatedCacheSaving, true)}`,
            bar: totals.cacheHitRate,
          },
          {
            label: "Off-peak share",
            value: `${Math.round(totals.offPeakShare * 100)}%`,
            sub: "batch tiers",
            bar: totals.offPeakShare,
          },
        ]}
      />

      {/* One banner carrying both budget facts: what has stopped, and what is
          about to. Separating them would make the reader hunt for the second. */}
      {paused || near ? (
        <div className="px-5">
          <ExceptionBanner
            severity={paused ? "DANGER" : "WARN"}
            title={
              paused
                ? `${budgetLabel(paused)} is paused by its cap`
                : `${budgetLabel(near!)} is near its cap`
            }
            subtitle={[
              paused
                ? `Every run requesting ${budgetLabel(paused)} is refused with AGENT_PAUSED and reason BUDGET_CAP until the cap is raised. Raising it is the MD's decision.`
                : null,
              near
                ? `${budgetLabel(near)} has spent ${Math.round((near.spend.amount / near.cap.amount) * 100)}% of its cap.`
                : null,
              forecastInsideCap
                ? "The month-end forecast is still inside the overall cap."
                : "The month-end forecast is already over the overall cap.",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        </div>
      ) : null}

      {raise.isError ? (
        <div className="px-5">
          <RefusalBanner title="The cap was not raised" error={raise.error} />
        </div>
      ) : null}
      {raise.isSuccess ? (
        <div className="px-5">
          <ExceptionBanner
            severity="INFO"
            title={`${budgetLabel(raise.data)} cap raised to ${formatMoney(raise.data.cap, true)}`}
            subtitle="Runs requesting this budget resume on the next attempt. The raise is in the audit log with who asked for it."
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 px-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ContentCard
          title="Cost breakdown"
          eyebrow="November 2026"
          actions={
            <PillTabGroup
              tabs={tabs}
              activeId={groupBy}
              onSelect={(id) => setGroupBy(id as UsageGroupBy)}
              label="Group usage by"
            />
          }
        >
          <ul className="flex flex-col gap-3">
            {breakdown.map((row) => (
              <BreakdownRow key={row.key} row={row} max={maxSpend} />
            ))}
          </ul>
          <p className="pt-3 text-[12px] text-ink-muted">
            Every row drills to the runs behind it. The query comes from the server with the row, so
            the number and the list it opens can never disagree.
          </p>
        </ContentCard>

        <ContentCard title="Where the savings come from" eyebrow="Cache and off-peak">
          <dl className="flex flex-col gap-4">
            <Stat
              label="Cache-hit ratio"
              value={`${Math.round(totals.cacheHitRate * 100)}%`}
              bar={totals.cacheHitRate}
              note={
                <>
                  Estimated saving <MoneyText value={totals.estimatedCacheSaving} /> — cached tokens
                  priced at the tier rate that would otherwise have applied.
                </>
              }
            />
            <Stat
              label="Off-peak share"
              value={`${Math.round(totals.offPeakShare * 100)}%`}
              bar={totals.offPeakShare}
              note="Batch-eligible tiers are restricted to off-peak hours and queue rather than escalate, so this share is a routing outcome rather than a coincidence."
            />
            <Stat
              label="Forecast headroom"
              value={`${Math.round(((cap.amount - forecast.amount) / cap.amount) * 100)}%`}
              bar={Math.max(0, (cap.amount - forecast.amount) / cap.amount)}
              note="Forecast is linear on the trailing seven days. It is an estimate and is labelled as one wherever it appears."
            />
          </dl>
        </ContentCard>
      </div>

      <div className="px-5">
        <ContentCard title="Budget caps" flush actions={<GhostButton>Budget policy</GhostButton>}>
          <DataTable
            label="Budget caps"
            columns={budgetColumns}
            rows={budgetRows}
            rowKey={(budget) => `${budget.scope}:${budget.key}`}
          />
        </ContentCard>
      </div>

      <p className="px-5 text-[12px] leading-relaxed text-ink-muted">
        A cap is a hard stop, not a warning: the run that would cross it is refused before the spend
        rather than after it. Raising one is the MD&rsquo;s decision and goes through the approval
        queue, which is why this page can offer the raise but cannot make it.
      </p>
    </div>
  );
}

/**
 * One horizontal bar in a cost-breakdown list.
 *
 * The bar is the kit's `MiniBar` and the drill is a real button with the
 * server's own `drillTo` on it — a row that looks clickable and is not is the
 * state `MetricCell` explicitly refuses to have, and the same rule applies here.
 */
function BreakdownRow({ row, max }: { row: UsageBreakdownRow; max: number }) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] text-ink">{row.label}</span>
        <span className="flex shrink-0 items-center gap-2">
          <MoneyText value={row.spend} className="text-[13px]" />
          <a
            href={row.drillTo}
            className="text-[12px] text-primary-hover underline decoration-dotted"
          >
            runs
          </a>
        </span>
      </div>
      <MiniBar value={row.spend.amount / max} label={row.label} />
    </li>
  );
}

function Stat({
  label,
  value,
  bar,
  note,
}: {
  label: string;
  value: string;
  bar: number;
  note: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          {label}
        </dt>
        <dd className="font-mono text-[15px] font-semibold text-ink">{value}</dd>
      </div>
      <MiniBar value={bar} label={label} />
      <p className="text-[12px] leading-relaxed text-ink-muted">{note}</p>
    </div>
  );
}
