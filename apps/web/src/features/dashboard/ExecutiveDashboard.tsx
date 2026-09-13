/**
 * M01-S01 · Executive dashboard.
 *
 * "Whole-company view for the MD: money in flight, delivery load, compliance
 * exposure and what the agents did." Dato' Lim reads it; the Sales Manager and
 * Finance read it too.
 *
 * The screen's discipline, from the pack's own annotation: every metric drills
 * through to a filtered list, "Open approvals" is the ONLY primary, and no
 * money moves here. Agent activity and the autonomy mix are reporting surfaces
 * rather than generated content, so neither carries the ✦ glyph — the AI badge
 * belongs on the approval rows in M02-S01, which inherit it there.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentDaily, DashboardMetric } from "@trainos/contract";
import {
  AutonomyChip,
  BudgetHeadline,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  LoadingState,
  MetricStrip,
  MiniBar,
  MoneyText,
  PairedBars,
  PrimaryButton,
  SecondaryButton,
  StatusChip,
  formatPeriod,
  humanise,
  type Column,
  type MetricCellProps,
  type PairedBarsSeries,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { navPath } from "@/shared/config/nav";
import { APPROVALS_PATH } from "@/features/approvals";
import { useExecutiveDashboard, useProposalsVsWon } from "./api";

/** The period the demo story runs in. */
const PERIOD = "2026-11";
const PERIOD_LABEL = "November 2026";
const CHART_MONTHS = 6;

/**
 * The chart's two series, in artboard order: the quiet one behind, the ink one
 * in front. Sent is the volume and won is the outcome, and painting the outcome
 * darker is the only emphasis the chart spends.
 */
const CHART_SERIES: [PairedBarsSeries, PairedBarsSeries] = [
  { label: "Sent", tone: "track" },
  { label: "Won", tone: "ink" },
];

/**
 * Metric key → the screen it drills to.
 *
 * The contract's `drillTo` is an API path (`/v1/receivables?filter…`), not a
 * route, so it cannot be navigated to directly. This table is the translation,
 * and it is deliberately partial: a metric with no destination gets no drill
 * affordance rather than a link that goes nowhere.
 */
const DRILL_TO: Record<string, string> = {
  OPEN_PIPELINE: navPath("Sales", "Pipeline"),
  AR_OVERDUE: navPath("Finance", "Collections"),
  PROPOSALS_SENT: navPath("Sales", "Proposals"),
  CLAIM_VALUE_AT_RISK: navPath("Compliance", "Deadlines"),
};

/** A section heading. Mono eyebrow, no border — §09's section pattern. */
function Section({
  title,
  link,
  children,
}: {
  title: string;
  link?: { label: string; to: string };
  children: React.ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline gap-2.5">
        <h2 className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          {title}
        </h2>
        {link ? (
          <button
            type="button"
            onClick={() => navigate(link.to)}
            className="ml-auto whitespace-nowrap text-[12px] text-primary-hover hover:underline"
          >
            {link.label} ›
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function ExecutiveDashboard() {
  const navigate = useNavigate();

  useBreadcrumb([{ label: "Home", href: "/" }, { label: "Dashboard" }, { label: PERIOD_LABEL }]);

  const dashboard = useExecutiveDashboard(PERIOD);
  const chart = useProposalsVsWon(CHART_MONTHS);

  const data = dashboard.data;

  /* Cells come from the server self-describing: label, value, secondary, delta
     and drill target all travel with the metric. Nothing here knows what
     "AR overdue" means. */
  const cells: MetricCellProps[] = useMemo(
    () =>
      (data?.metrics ?? []).map((metric: DashboardMetric) => {
        const to = DRILL_TO[metric.key];
        return {
          label: metric.label,
          value: metric.value,
          /* DECISIONS §4: the hours-saved tile must render its basis and may
             not show a bare number. `estimate` takes the SERVER's sentence, so
             the caveat can be reworded without a kit release — and passing it
             here rather than as `sub` is what stops the line printing twice. */
          ...(metric.estimate === true
            ? { estimate: metric.secondary ?? true }
            : metric.secondary
              ? { sub: metric.secondary }
              : {}),
          /* The movement, with the server's severity deciding its ink. A rise
             is not bad news by itself — UP on pipeline and UP on overdue
             receivables are opposite facts, and only the server knows which. */
          ...(metric.delta ? { delta: metric.delta } : {}),
          ...(to ? { onDrill: () => navigate(to) } : {}),
        };
      }),
    [data, navigate],
  );

  /* §10 the metric that carries a warning delta also earns the banner. Which
     metric that is comes from the data, not from a hardcoded key. */
  const exception = (data?.metrics ?? []).find(
    (metric) => metric.delta?.severity === "WARN" || metric.delta?.severity === "DANGER",
  );

  const agentColumns: Column<AgentDaily>[] = useMemo(
    () => [
      {
        key: "agent",
        label: "Agent",
        accessor: (row) => <span className="font-medium text-ink">{row.agentName}</span>,
      },
      { key: "actions", label: "Actions", align: "right", accessor: (row) => row.actionsToday },
      {
        key: "autonomy",
        label: "Autonomy",
        /* `fluid` drops the chip's 118px column floor. That floor exists so the
           ladder lines up on the autonomy matrix; here it only pads four short
           words out to the width of the longest rung and widens the column. */
        accessor: (row) => <AutonomyChip level={row.autonomy} fluid />,
      },
      {
        key: "cost",
        label: "Cost this month",
        align: "right",
        accessor: (row) => <MoneyText value={row.costMonth} />,
      },
      {
        key: "eval",
        label: "Eval",
        align: "right",
        accessor: (row) => row.evalScore.toFixed(2),
      },
    ],
    [],
  );

  const header = (
    <>
      <div className="flex min-h-9 flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-5">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{PERIOD_LABEL}</h1>
        <StatusChip tone="info">Company-wide</StatusChip>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SecondaryButton onClick={() => navigate(navPath("Reports"))}>
            Full reports
          </SecondaryButton>
          <PrimaryButton onClick={() => navigate(APPROVALS_PATH)}>Open approvals</PrimaryButton>
        </div>
      </div>
    </>
  );

  if (dashboard.isPending) {
    return (
      <div className="flex flex-col">
        {header}
        <LoadingState rows={8} label="Loading the executive dashboard" className="px-5" />
      </div>
    );
  }

  if (dashboard.error || !data) {
    /* The query throws an exception WRAPPING the ApiError; unwrap it or every
       refusal reads as a transport failure and gets a retry button. Whether the
       retry is offered is `ErrorState`'s decision, not this screen's — one copy
       of R2, in the component that renders the button. */
    const failure = dashboard.error ? toApiError(dashboard.error) : undefined;

    return (
      <div className="flex flex-col">
        {header}
        <ErrorState
          title="The dashboard could not be loaded"
          error={failure}
          onRetry={() => void dashboard.refetch()}
        />
      </div>
    );
  }

  const series = chart.data?.series ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}

      <div className="px-5">
        <MetricStrip cells={cells} />
      </div>

      <div className="flex min-h-0 flex-1 flex-wrap items-start gap-0 pt-3.5">
        {/* ---- Left column ----------------------------------------------- */}
        <div className="flex min-w-[420px] flex-1 flex-col gap-5 border-r border-divider px-5 pb-6">
          {exception?.delta ? (
            <ExceptionBanner
              severity={exception.delta.severity === "DANGER" ? "DANGER" : "WARN"}
              title={`${exception.label} is ${
                exception.delta.direction === "UP" ? "up" : "down"
              } ${Math.round(exception.delta.rate * 100)}% on last month`}
              /* NOT `secondary` — the metric cell already prints that, and a
                 banner that repeats the cell it sits under says nothing twice.
                 What the banner adds is what the movement is measured against. */
              {...(exception.delta.comparedTo
                ? { subtitle: `Measured against ${exception.delta.comparedTo}` }
                : {})}
              action={
                DRILL_TO[exception.key] ? (
                  <SecondaryButton onClick={() => navigate(DRILL_TO[exception.key] as string)}>
                    Open collections
                  </SecondaryButton>
                ) : undefined
              }
            />
          ) : null}

          <Section title={`Proposals sent vs won · ${CHART_MONTHS} months`}>
            {chart.isPending ? (
              <LoadingState rows={CHART_MONTHS} label="Loading the proposals report" />
            ) : series.length === 0 ? (
              <EmptyState
                title="No proposals in this window"
                description="Nothing was sent in the last six months, so there is nothing to compare."
              />
            ) : (
              /* The drill link rides in the legend row rather than up beside the
                 caption — the artboard puts it there, and it reads better at the
                 foot of the thing it filters than above it. */
              <PairedBars
                label={`Proposals sent versus won over ${CHART_MONTHS} months`}
                series={CHART_SERIES}
                points={series.map((point) => ({
                  key: point.period,
                  label: formatPeriod(point.period),
                  values: [point.sent, point.won],
                }))}
                action={
                  <button
                    type="button"
                    onClick={() => navigate(navPath("Sales", "Proposals"))}
                    className="whitespace-nowrap text-[12px] text-primary-hover hover:underline"
                  >
                    Open filtered list ›
                  </button>
                }
              />
            )}
          </Section>

          <Section
            title="Agent activity today"
            link={{ label: "Agent registry", to: navPath("Automation", "Agents") }}
          >
            <DataTable
              label="What each agent did today"
              columns={agentColumns}
              rows={data.agentActivity}
              rowKey={(row) => row.agentId}
              /* A five-row reporting table on a dashboard, not a list screen
                 someone works through: the artboard draws it at 38px rows, and
                 comfortable spacing here buys nothing but scroll. */
              density="compact"
              stickyHeader={false}
              empty={
                <EmptyState
                  title="No agent ran today"
                  description="Agent activity appears here as runs complete."
                />
              }
            />
          </Section>
        </div>

        {/* ---- Right rail ------------------------------------------------- */}
        <aside className="flex w-[360px] shrink-0 flex-col gap-5 px-5 pb-6">
          <Section
            title={`Approvals pending · ${data.approvalsPending.length}`}
            link={{ label: "Approval inbox", to: APPROVALS_PATH }}
          >
            {data.approvalsPending.length === 0 ? (
              <EmptyState
                title="Nothing is waiting"
                description="Every approval has been decided."
              />
            ) : (
              <ul className="flex flex-col">
                {data.approvalsPending.map((approval) => (
                  <li key={approval.ref} className="border-t border-divider first:border-t-0">
                    <button
                      type="button"
                      onClick={() => navigate(`${APPROVALS_PATH}/${approval.ref}`)}
                      className="flex w-full flex-col gap-0.5 py-2.5 text-left hover:text-ink"
                    >
                      <span className="text-[13px] font-semibold leading-snug text-ink">
                        {approval.subject}
                      </span>
                      <span
                        className={`font-mono text-[11px] ${
                          approval.slaBreached ? "text-danger" : "text-ink-muted"
                        }`}
                      >
                        {approval.value ? <MoneyText value={approval.value} compact /> : null}
                        {approval.value ? <span aria-hidden="true"> · </span> : null}
                        {approval.slaBreached ? (
                          <span className="font-semibold text-danger">SLA breached</span>
                        ) : (
                          <DateText value={approval.slaDueAt} withTime />
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Autonomy mix">
            <ul className="flex flex-col gap-2">
              {data.autonomyMix.map((slice) => (
                <li key={slice.level} className="flex items-center gap-3">
                  <span className="w-[126px] shrink-0 text-[13px] text-ink-secondary">
                    {humanise(slice.level)}
                  </span>
                  {/* Ink for the three rungs a human still drives, accent for
                      the one that runs itself — the artboard's own emphasis,
                      and the only place on this screen where a bar is blue. */}
                  <MiniBar
                    value={slice.rate}
                    size="md"
                    state={slice.level === "AUTONOMOUS" ? "primary" : "neutral"}
                    label={`${humanise(slice.level)} share`}
                    valueText={`${Math.round(slice.rate * 100)}%`}
                  />
                  {/* `valueText` is the ACCESSIBLE value, not a rendered one.
                      A bar with no number beside it is unreadable to everyone
                      who is not using a screen reader. */}
                  <span className="w-9 shrink-0 text-right font-mono text-[12px] text-ink-secondary">
                    {Math.round(slice.rate * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Agent spend · November">
            <BudgetHeadline
              used={data.agentSpend.spent}
              limit={data.agentSpend.budget}
              label="Agent spend against budget"
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}
