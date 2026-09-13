import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Programme } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  Drawer,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSearch,
  ListToolbar,
  LoadingState,
  PillTabGroup,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  formatDate,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { todayKey } from "@/features/calendar";
import { engagementPath, useEngagements } from "@/features/engagements";
import { useProgrammes } from "@/features/programmes";
import {
  assessmentRows,
  countByState,
  type AssessmentRow,
  type EvaluationState,
} from "./evaluations";

/**
 * `/training/assessments` — which deliveries owe a post-course evaluation.
 *
 * List + filter bar with a detail drawer, the brief's shape for this screen.
 * The contract has no assessment domain (see `evaluations.ts`), so the register
 * is built on the evaluation summary that really exists: one of the five HRD
 * Corp document types, tracked on the engagement's own checklist.
 *
 * No solid primary. Compiling an evaluation summary is not an action this API
 * offers; the row's route out is the engagement, which is a link.
 */

const TABS: Record<"owed" | "all" | "compiled", string> = {
  owed: "Owed",
  all: "All",
  compiled: "Compiled",
};

type TabId = keyof typeof TABS;

const OWED: EvaluationState[] = ["OUTSTANDING", "UNTRACKED"];

export function AssessmentsScreen() {
  useBreadcrumb([{ label: "Training" }, { label: "Assessments" }]);

  const today = useMemo(() => todayKey(), []);
  /* `null` until the reader chooses, so the opening tab can follow the data
     rather than being pinned before the register has loaded. */
  const [tabOverride, setTab] = useState<TabId | null>(null);
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");
  const [openRef, setOpenRef] = useState<string | null>(null);

  const engagements = useEngagements();
  const programmes = useProgrammes();

  const all = useMemo(
    () => assessmentRows(engagements.data?.data ?? [], today),
    [engagements.data, today],
  );
  const counts = useMemo(() => countByState(all), [all]);
  const owed = counts.OUTSTANDING + counts.UNTRACKED;

  /**
   * Open on what is owed — unless nothing is, in which case open on All.
   *
   * Collections opens on "Needs approval" and this screen follows it, but an
   * empty default tab reads as a broken screen rather than as good news. The
   * count on the Owed tab still says zero, so nothing is hidden by landing
   * somewhere with rows in it.
   */
  const tab: TabId = tabOverride ?? (owed > 0 ? "owed" : "all");

  const inTab = useMemo(
    () =>
      all.filter((row) => {
        if (tab === "all") return true;
        if (tab === "compiled") return row.state === "COMPILED";
        return OWED.includes(row.state);
      }),
    [all, tab],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return inTab;
    return inTab.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        row.engagementRef.toLowerCase().includes(needle),
    );
  }, [inTab, query]);

  const chips: FilterChipModel[] = query.trim()
    ? [{ id: "query", label: "Search", value: query.trim() }]
    : [];

  const open = all.find((row) => row.engagementRef === openRef) ?? null;
  const programme = (programmes.data?.data ?? []).find(
    (candidate) => candidate.ref === open?.programmeRef,
  );

  const columns: Column<AssessmentRow>[] = [
    {
      key: "title",
      label: "Delivery",
      accessor: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-ink">{row.title}</div>
          <div className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{row.engagementRef}</span>
            {` · ${humanise(row.engagementStatus)}`}
          </div>
        </div>
      ),
    },
    {
      key: "deliveredOn",
      label: "Delivered",
      width: "132px",
      sortable: true,
      /* §16: a date is typography in a data column, never a badge. */
      accessor: (row) => (
        <span className="text-[13px] tabular-nums text-ink-secondary">
          {row.deliveredOn ? formatDate(row.deliveredOn) : "—"}
        </span>
      ),
    },
    {
      key: "attendance",
      label: "Attendance",
      width: "128px",
      align: "right",
      accessor: (row) => (
        <span className="text-[13px] tabular-nums text-ink">
          {`${row.attended} / ${row.participants}`}
        </span>
      ),
    },
    {
      key: "state",
      label: "Evaluation",
      width: "148px",
      accessor: (row) => <StatusChip tone={row.tone}>{row.label}</StatusChip>,
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Assessments"
        withoutCondensed
        meta={[
          `${all.length} ${all.length === 1 ? "delivery" : "deliveries"}`,
          owed === 0 ? "every evaluation is in" : `${owed} owe an evaluation summary`,
          counts.UNTRACKED > 0 ? `${counts.UNTRACKED} not tracked at all` : null,
        ]}
      />

      <div className="px-5 py-3">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Assessments"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={[
                { id: "owed", label: TABS.owed, count: owed },
                { id: "all", label: TABS.all, count: all.length },
                { id: "compiled", label: TABS.compiled, count: counts.COMPILED },
              ]}
            />
          }
          filters={
            <FilterBar
              filters={chips}
              shown={rows.length}
              total={inTab.length}
              onRemove={() => setQuery("")}
              onClearAll={() => setQuery("")}
            >
              <FilterSearch
                label="Search deliveries"
                value={query}
                onChange={setQuery}
                placeholder="Title or engagement ref"
              />
            </FilterBar>
          }
          actions={<DensityToggle value={density} onChange={setDensity} />}
        />
      </div>

      {engagements.isPending ? <LoadingState label="Loading the evaluation register" /> : null}

      {engagements.isError ? (
        <ErrorState
          title="The evaluation register could not be loaded"
          error={toApiError(engagements.error)}
          onRetry={() => void engagements.refetch()}
        />
      ) : null}

      {!engagements.isPending && !engagements.isError ? (
        <DataTable
          label="Assessments"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          density={density}
          onRowClick={(row) => setOpenRef(row.engagementRef)}
          empty={
            all.length === 0 ? (
              <EmptyState
                title="No deliveries yet"
                description="A delivery owes an evaluation summary once its last day has passed."
              />
            ) : inTab.length === 0 ? (
              /* The TAB is empty, which is good news. Checked before the filter
                 branch: a search that matches nothing on this tab is a
                 different fact, and "every evaluation is in" printed over a
                 failed search is a lie the reader cannot see through. */
              <EmptyState
                title={
                  tab === "compiled"
                    ? "No evaluation has been compiled yet"
                    : "Every evaluation is in"
                }
                description="Switch to All to see every delivery."
              />
            ) : (
              <EmptyState
                title="No delivery matches this search"
                description="Clear the search to widen the register."
              />
            )
          }
        />
      ) : null}

      <Drawer
        open={open !== null}
        onClose={() => setOpenRef(null)}
        title={open?.title ?? "Evaluation"}
        subtitle={open?.engagementRef}
        footer={
          open ? (
            <Link to={engagementPath(open.engagementRef)}>
              <SecondaryButton>Open the engagement</SecondaryButton>
            </Link>
          ) : null
        }
      >
        {open ? (
          <EvaluationDetail
            row={open}
            {...(programme ? { programme } : {})}
            programmesPending={programmes.isPending}
            {...(programmes.isError
              ? {
                  programmesError: toApiError(programmes.error),
                  onRetryProgrammes: () => void programmes.refetch(),
                }
              : {})}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function EvaluationDetail({
  row,
  programme,
  programmesPending,
  programmesError,
  onRetryProgrammes,
}: {
  row: AssessmentRow;
  programme?: Programme;
  programmesPending: boolean;
  programmesError?: ReturnType<typeof toApiError>;
  onRetryProgrammes?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StatusChip tone={row.tone}>{row.label}</StatusChip>
        <StatusChip tone="neutral">{humanise(row.engagementStatus)}</StatusChip>
      </div>

      <p className="text-[13px] leading-relaxed text-ink-secondary">{EXPLANATION[row.state]}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <Fact label="Delivered" value={row.deliveredOn ? formatDate(row.deliveredOn) : "—"} />
        <Fact label="Attendance" value={`${row.attended} of ${row.participants}`} />
        <Fact label="Attendance rate" value={`${Math.round(row.attendanceRate * 100)}%`} />
        <Fact label="Engagement" value={row.engagementRef} mono />
      </dl>

      <div className="border-t border-divider pt-4">
        <h3 className="text-[13px] font-medium text-ink">Programme benchmark</h3>
        {programmesPending ? <LoadingState rows={2} label="Loading the programme" /> : null}
        {programmesError ? (
          <ErrorState
            title="The programme could not be loaded"
            error={programmesError}
            {...(onRetryProgrammes ? { onRetry: onRetryProgrammes } : {})}
          />
        ) : null}
        {programme ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <Fact label="Programme" value={programme.name} />
            <Fact label="Deliveries" value={String(programme.stats.deliveries)} />
            <Fact label="Average evaluation" value={programme.stats.averageEvaluation.toFixed(1)} />
            <Fact label="Reference" value={programme.ref} mono />
          </dl>
        ) : null}
        {!programmesPending && !programmesError && !programme ? (
          <p className="mt-2 text-[12px] text-ink-muted">
            {`The catalogue has no entry for ${row.programmeRef}, so there is no benchmark to compare against.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** One sentence per state. The reader needs to know what to do, not the enum. */
const EXPLANATION: Record<EvaluationState, string> = {
  COMPILED: "The evaluation summary is compiled and can be attached to the HRD Corp claim packet.",
  OUTSTANDING:
    "This delivery is complete and its evaluation summary has not been compiled. EVALUATION_SUMMARY is one of the five documents the claim packet requires, so the claim cannot be filed without it.",
  NOT_DUE:
    "Nothing is owed yet. An evaluation summary becomes due once the last delivery day has passed.",
  UNTRACKED:
    "This engagement carries no evaluation item on its checklist at all, so nobody is being asked for one. That is a setup gap rather than an overdue task — an absent item and an unticked item are different facts.",
};

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={mono ? "truncate font-mono text-ink" : "truncate text-ink"}>{value}</dd>
    </div>
  );
}

export default AssessmentsScreen;
