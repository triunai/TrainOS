import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Tna, TNAStatus } from "@trainos/contract";
import { TNA_STATUSES } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  FilterSearch,
  FilterSelect,
  formatDate,
  humanise,
  ListToolbar,
  LoadingState,
  MoneyText,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  TNA_TONE,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOpportunityIndex, useOrganisationDirectory } from "@/shared/api";
import { useTnas } from "./api";
import { TNA_DETAIL_PATH } from "./paths";

/**
 * The TNA list — the half of M05-S02 the nav leaf pointed at and never had.
 *
 * M05 draws the questionnaire and its gaps; no artboard draws the list, so the
 * composition is the Collections page's and the columns are the four facts a
 * consultant sorts a needs analysis by: who it is for, whether it came back,
 * what it is worth, and how many gaps it found.
 *
 * A TNA names its client twice removed — it carries an `opportunityRef`, the
 * opportunity carries the `organisationRef`. `TnaDetailPage` makes that walk
 * per record; a list cannot make it per row, so the two shared books in
 * `shared/api` are read once and the walk becomes a lookup.
 *
 * The gap count is typography, not a chip. Colour on this row belongs to the
 * status, which is the only thing a reader acts on, and a second tone beside it
 * would spend the accent budget on a number.
 */

type StatusFilter = "ALL" | TNAStatus;

export function TnaListPage() {
  useBreadcrumb([{ label: "Sales" }, { label: "TNA" }]);

  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [priority, setPriority] = useState("ALL");
  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");

  const tnas = useTnas();
  const opportunities = useOpportunityIndex();
  const directory = useOrganisationDirectory();

  const all = useMemo(() => tnas.data?.data ?? [], [tnas.data]);

  /* Two hops, resolved once: TNA → opportunity → organisation → name. */
  const clientOf = (tna: Tna) =>
    directory.nameOf(opportunities.organisationRefOf(tna.opportunityRef));

  const namesUnavailable = opportunities.query.isError || directory.query.isError;

  const needle = search.trim().toLowerCase();

  const narrowed = all.filter((tna) => {
    if (priority !== "ALL" && !tna.gaps.some((gap) => gap.priority === priority)) return false;
    if (needle.length === 0) return true;
    return (
      tna.ref.toLowerCase().includes(needle) ||
      tna.opportunityRef.toLowerCase().includes(needle) ||
      clientOf(tna).toLowerCase().includes(needle)
    );
  });

  const countOf = (id: StatusFilter) =>
    id === "ALL" ? narrowed.length : narrowed.filter((tna) => tna.status === id).length;

  const rows = status === "ALL" ? narrowed : narrowed.filter((tna) => tna.status === status);

  const chips: FilterChipModel[] = [];
  if (needle.length > 0) chips.push({ id: "query", label: "Search", value: search.trim() });
  if (priority !== "ALL") {
    chips.push({ id: "priority", label: "Gap priority", value: humanise(priority) });
  }

  const columns: Column<Tna>[] = [
    {
      key: "ref",
      label: "Needs analysis",
      accessor: (tna) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{clientOf(tna)}</p>
          <p className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{tna.ref}</span>
            {` · ${tna.audience.headcount} pax · ${humanise(tna.audience.level)}`}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "116px",
      accessor: (tna) => (
        <StatusChip tone={TNA_TONE[tna.status]}>{humanise(tna.status)}</StatusChip>
      ),
    },
    {
      key: "gaps",
      label: "Gaps",
      width: "132px",
      accessor: (tna) => {
        const high = tna.gaps.filter((gap) => gap.priority === "HIGH").length;
        return (
          <div className="tabular-nums">
            <p className="text-[13px] text-ink">{tna.gaps.length}</p>
            <p className="text-[11px] text-ink-muted">
              {high === 0 ? "none high" : `${high} high priority`}
            </p>
          </div>
        );
      },
    },
    {
      key: "sites",
      label: "Sites",
      width: "168px",
      accessor: (tna) => (
        <span className="truncate text-[13px] text-ink-secondary">
          {tna.audience.sites.join(", ")}
        </span>
      ),
    },
    {
      key: "budget",
      label: "Budget",
      width: "124px",
      align: "right",
      /* A TNA with no stated budget is ordinary, not an exception, so it reads
         as an em dash rather than RM 0 — which would be a number the client
         never gave. */
      accessor: (tna) =>
        tna.budget ? (
          <MoneyText value={tna.budget} className="tabular-nums" />
        ) : (
          <span className="text-[13px] text-ink-muted">—</span>
        ),
    },
    {
      key: "completedAt",
      label: "Completed",
      width: "128px",
      accessor: (tna) => (
        <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-secondary">
          {tna.completedAt ? formatDate(tna.completedAt) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Needs analyses"
        withoutCondensed
        meta={[
          `${all.length} ${all.length === 1 ? "analysis" : "analyses"}`,
          `${all.filter((tna) => tna.status === "COMPLETE").length} complete`,
        ]}
        actions={<DensityToggle value={density} onChange={setDensity} />}
      />

      {/* Brief §10b: the saved-view track and the narrowing are ONE row, with
          the table directly beneath. Stacked, they put two horizontal rules
          between the heading and the first row of data while each band left
          half its width empty — the tabs say which subset and the filters say
          which slice of it, so they are one control surface.

          §16b's count rule rides with them: "N of M shown" appears only when a
          filter chip has actually narrowed the set. Unfiltered, the active tab
          already prints the number, and the counter beside it was the same
          fact twice on one row. */}
      <ListToolbar
        className="px-5 pb-3"
        tabs={
          <PillTabGroup
            label="TNA status"
            activeId={status}
            onSelect={(id) => setStatus(id as StatusFilter)}
            tabs={[
              { id: "ALL", label: "All", count: countOf("ALL") },
              ...TNA_STATUSES.map((value) => ({
                id: value,
                label: humanise(value),
                count: countOf(value),
              })),
            ]}
          />
        }
        filters={
          <FilterBar
            filters={chips}
            shown={chips.length > 0 ? rows.length : undefined}
            total={chips.length > 0 ? all.length : undefined}
            onRemove={(id) => (id === "query" ? setSearch("") : setPriority("ALL"))}
            onClearAll={() => {
              setSearch("");
              setPriority("ALL");
            }}
          >
            <FilterSearch
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder="Client or reference"
            />
            <FilterSelect
              label="Gap priority"
              value={priority}
              onChange={setPriority}
              options={[
                { value: "ALL", label: "Any priority" },
                { value: "HIGH", label: "Has a high-priority gap" },
                { value: "MEDIUM", label: "Has a medium-priority gap" },
                { value: "LOW", label: "Has a low-priority gap" },
              ]}
            />
          </FilterBar>
        }
      />

      <div className="flex flex-col gap-3 pt-3">
        {namesUnavailable ? (
          <div className="px-5">
            <ExceptionBanner
              severity="WARN"
              title="Client names are unavailable"
              subtitle="The opportunity or organisation book did not load, so each row falls back to its reference. Every other figure is still the server's."
            />
          </div>
        ) : null}

        {tnas.isPending ? <LoadingState rows={6} label="Loading the needs analyses" /> : null}

        {tnas.isError ? (
          <ErrorState
            title="The needs analyses could not be loaded"
            error={toApiError(tnas.error)}
            onRetry={() => void tnas.refetch()}
          />
        ) : null}

        {!tnas.isPending && !tnas.isError ? (
          <DataTable
            label="Needs analyses"
            columns={columns}
            rows={rows}
            rowKey={(tna) => tna.id}
            density={density}
            onRowClick={(tna) => navigate(TNA_DETAIL_PATH(tna.ref))}
            empty={
              <EmptyState
                title="No needs analysis matches these filters"
                description="Clear a filter, or widen the status tab, to see the rest."
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}

export default TnaListPage;
