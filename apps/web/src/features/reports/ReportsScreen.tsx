import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { HoursSavedActionType, ProposalsVsWonReport } from "@trainos/contract";
import {
  Collapse,
  ContentCard,
  DataTable,
  DisclosureButton,
  EmptyState,
  ErrorState,
  LoadingState,
  PairedBars,
  PillTabGroup,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  formatPeriod,
  humanise,
  type Column,
  type MetricCellProps,
  type PairedBarsSeries,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { navPath } from "@/shared/config/nav";
import { useHoursSaved, useProposalsVsWon } from "./api";

/**
 * `/reports` — the two reports the contract actually publishes.
 *
 * `Reports` is the tree's only childless parent, so its path is `/reports` and
 * the page has to be a destination rather than an index of children. It is
 * built as the tightening brief §18 asks every control-panel screen to be: the
 * human summary first, the machinery behind a click.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 * · The executive dashboard. It is a screen already, at `/dashboard`, and
 *   redrawing its metrics under Reports would be two visual languages for one
 *   set of numbers. There is a link, not a copy.
 * · A solid primary button. Nothing on this page writes — there is no export
 *   endpoint in the contract — and a primary that navigates is a secondary
 *   wearing the view's one badge of consequence.
 *
 * THE HOURS-SAVED TILE IS THE POINT OF CARE. §18 and DECISIONS §4 say the tile
 * **must** render `basis` and may not display a bare number: the fixture's 41
 * hours is `ILLUSTRATIVE`, computed from a baseline table that has not been
 * measured yet and cut by 0.7 to be conservative. A dashboard number with no
 * provenance is how an estimate becomes a claim in somebody's board pack, so
 * the basis, the haircut and the baseline version are rendered beside it and
 * the per-action-type arithmetic is one disclosure away.
 */

const SERIES: [PairedBarsSeries, PairedBarsSeries] = [
  { label: "Sent", tone: "track" },
  { label: "Won", tone: "ink" },
];

const WINDOWS = [
  { id: "6", label: "6 months" },
  { id: "12", label: "12 months" },
] as const;

/** Totals across the window — the sentence a reader wants before the bars. */
function summarise(report: ProposalsVsWonReport | undefined) {
  const series = report?.series ?? [];
  const sent = series.reduce((total, point) => total + point.sent, 0);
  const won = series.reduce((total, point) => total + point.won, 0);
  return { sent, won, rate: sent === 0 ? null : won / sent };
}

export function ReportsScreen() {
  useBreadcrumb([{ label: "Reports" }]);

  const navigate = useNavigate();
  const [window, setWindow] = useState<"6" | "12">("6");
  const months = Number(window);

  const proposals = useProposalsVsWon(months);
  const hours = useHoursSaved();

  const disclosureId = useId();
  const [showWorking, setShowWorking] = useState(false);

  const totals = useMemo(() => summarise(proposals.data), [proposals.data]);

  /**
   * The summary band.
   *
   * `estimate` on the hours cell is the kit's own affordance for exactly this
   * case — the caveat travels with the number instead of sitting in a footnote
   * a screenshot would crop off.
   */
  const metrics: MetricCellProps[] = [
    {
      label: "Proposals sent",
      value: totals.sent,
      sub: `${months} month window`,
    },
    {
      label: "Won",
      value: totals.won,
      ...(totals.rate === null ? {} : { sub: `${Math.round(totals.rate * 100)}% of sent` }),
      ...(totals.rate === null ? {} : { bar: totals.rate }),
    },
    {
      /* "Hours saved", not "Admin hours saved": the card below carries the
         full title, and a band cell repeating a section heading verbatim is
         the same label rendered twice. */
      label: "Hours saved",
      value: hours.data ? `${hours.data.hours}` : "—",
      ...(hours.data
        ? {
            sub: `${humanise(hours.data.basis).toLowerCase()} · ×${hours.data.haircut} haircut`,
            /* Short, because the card below states the baseline version and
               the arithmetic. What the caveat has to do here is stop the
               number travelling without it. */
            estimate:
              hours.data.basis === "MEASURED"
                ? "Measured against the discovery baseline."
                : "Illustrative: the baseline has not been measured yet.",
          }
        : {}),
    },
  ];

  const workingColumns: Column<HoursSavedActionType>[] = [
    {
      key: "key",
      label: "Action type",
      accessor: (row) => <span className="text-[13px] text-ink">{humanise(row.key)}</span>,
    },
    {
      key: "baseline",
      label: "Baseline",
      width: "112px",
      align: "right",
      accessor: (row) => (
        <span className="tabular-nums text-ink-secondary">{`${row.baselineMinutes} min`}</span>
      ),
    },
    {
      key: "human",
      label: "With the agent",
      width: "128px",
      align: "right",
      accessor: (row) => (
        <span className="tabular-nums text-ink-secondary">{`${row.humanMinutes} min`}</span>
      ),
    },
    {
      key: "credited",
      label: "Credited",
      width: "112px",
      align: "right",
      accessor: (row) => (
        <span className="tabular-nums font-medium text-ink">{`${row.credited} h`}</span>
      ),
    },
  ];

  const bothFailed = proposals.isError && hours.isError;
  const bothPending = proposals.isPending && hours.isPending;

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="Reports"
        meta={[
          "2 published reports",
          hours.data ? `hours saved is ${humanise(hours.data.basis).toLowerCase()}` : null,
        ]}
        actions={
          <SecondaryButton onClick={() => navigate(navPath("Home", "Dashboard"))}>
            Executive dashboard
          </SecondaryButton>
        }
        metrics={bothPending ? undefined : metrics}
      />

      {bothPending ? (
        <div className="px-5">
          <LoadingState rows={8} label="Loading the reports" />
        </div>
      ) : null}

      {bothFailed ? (
        <div className="px-5">
          <ErrorState
            title="No report could be loaded"
            error={proposals.error ?? undefined}
            onRetry={() => {
              void proposals.refetch();
              void hours.refetch();
            }}
          />
        </div>
      ) : null}

      {!bothPending && !bothFailed ? (
        <>
          <div className="px-5">
            <ContentCard
              title="Proposals sent and won"
              actions={
                <PillTabGroup
                  label="Reporting window"
                  activeId={window}
                  onSelect={(id) => setWindow(id as "6" | "12")}
                  tabs={WINDOWS.map((entry) => ({ id: entry.id, label: entry.label }))}
                />
              }
            >
              {/* The sentence before the chart. A bar chart answers "how did it
                  move"; it does not answer "how are we doing", and the reader
                  asked the second question first. */}
              <p className="pb-3 text-[13px] text-ink-secondary">
                {totals.rate === null
                  ? "Nothing was sent in this window."
                  : `${totals.won} of ${totals.sent} proposals were won over ${months} months — ${Math.round(totals.rate * 100)}%.`}
              </p>

              {proposals.isPending ? (
                <LoadingState rows={5} label="Loading proposals sent versus won" />
              ) : null}

              {proposals.isError ? (
                <ErrorState
                  title="Proposals sent versus won could not be loaded"
                  error={proposals.error}
                  onRetry={() => void proposals.refetch()}
                />
              ) : null}

              {proposals.data && proposals.data.series.length === 0 ? (
                <EmptyState
                  title="No proposals in this window"
                  description="Nothing was sent over these months, so there is nothing to compare. Widen the window or send a proposal."
                />
              ) : null}

              {proposals.data && proposals.data.series.length > 0 ? (
                <PairedBars
                  label={`Proposals sent versus won over ${months} months`}
                  series={SERIES}
                  points={proposals.data.series.map((point) => ({
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
              ) : null}
            </ContentCard>
          </div>

          <div className="px-5">
            <ContentCard
              title="Admin hours saved"
              actions={
                hours.data ? (
                  <StatusChip
                    /* The basis is the status of the number. MEASURED is a
                       fact; ILLUSTRATIVE is a caveat, and the chip is the one
                       place status colour is allowed to say so. */
                    tone={hours.data.basis === "MEASURED" ? "success" : "warning"}
                  >
                    {humanise(hours.data.basis)}
                  </StatusChip>
                ) : undefined
              }
            >
              {hours.isPending ? (
                <LoadingState rows={4} label="Loading the hours-saved report" />
              ) : null}

              {hours.isError ? (
                <ErrorState
                  title="The hours-saved report could not be loaded"
                  error={hours.error}
                  onRetry={() => void hours.refetch()}
                />
              ) : null}

              {hours.data && hours.data.actionTypes.length === 0 ? (
                <EmptyState
                  title="No action type has credited any time yet"
                  description="Hours are credited when an agent completes an action a person used to do by hand. Nothing has been credited in this period."
                />
              ) : null}

              {hours.data && hours.data.actionTypes.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] leading-relaxed text-ink-secondary">
                    {`${hours.data.hours} hours across ${hours.data.actionTypes.length} action types, on the ${hours.data.basis === "MEASURED" ? "measured" : "illustrative"} baseline table `}
                    <span className="font-mono text-[12px] text-ink-muted">
                      {hours.data.baselineTableVersion}
                    </span>
                    {`, cut by ×${hours.data.haircut} to stay conservative. It is an estimate of time a person did not spend, not money.`}
                  </p>

                  <div className="flex items-center gap-2">
                    <DisclosureButton
                      open={showWorking}
                      onToggle={() => setShowWorking((open) => !open)}
                      controls={disclosureId}
                      label="the working behind the figure"
                    />
                    <span className="text-[12px] text-ink-muted">
                      How the figure is arrived at, per action type
                    </span>
                  </div>

                  {/* §18: the machinery, behind a click. */}
                  <Collapse open={showWorking} id={disclosureId}>
                    <DataTable
                      label="Hours saved by action type"
                      columns={workingColumns}
                      rows={hours.data.actionTypes}
                      rowKey={(row) => row.key}
                      stickyHeader={false}
                    />
                  </Collapse>
                </div>
              ) : null}
            </ContentCard>
          </div>

          <p className="px-5 text-[12px] leading-relaxed text-ink-muted">
            Both reports come from the contract&rsquo;s own report endpoints. Anything that reads
            like a report but is really a live queue — approvals, collections, the run trace — stays
            on the screen that owns it, so there is one place each number is computed.
          </p>
        </>
      ) : null}
    </div>
  );
}
