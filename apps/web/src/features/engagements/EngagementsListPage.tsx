import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Engagement, EngagementStatus } from "@trainos/contract";
import { ENGAGEMENT_STATUSES } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  EmptyState,
  ENGAGEMENT_TONE,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  FilterSearch,
  FilterSelect,
  formatDateRange,
  humanise,
  LifecycleStepper,
  ListToolbar,
  LoadingState,
  MoneyText,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { useEngagements, usePipelineConfig } from "./api";
import { engagementPath } from "./paths";

/**
 * The engagement list — the half of M09-S02 that was missing, template 1.
 *
 * §11a names this table as the reference for the inline lifecycle stepper: the
 * artboards draw the dot-progress strip inside the row, so the chain renders as
 * the kit's `variant="table"` stepper from the server's own `LifecycleStep[]`,
 * never as text and never recomputed here. Stage LABELS come from
 * `GET /v1/config/pipelines?object=ENGAGEMENT` — CLAUDE.md's standing rule —
 * which is why the config failing gets a banner rather than a silent fallback
 * to raw keys.
 *
 * Money and dates are typography, per §16: a right-aligned tabular column and a
 * plain rendered range, not a component and not a badge. The only colour on the
 * row is the status chip.
 */

type StatusFilter = "ALL" | EngagementStatus;
type OwnerFilter = "ALL" | string;

/** A `DateOnly[]` as the range helper wants it: first day to last. */
function rangeOf(dates: readonly string[]): string | null {
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first : `${first}/${last}`;
}

export function EngagementsListPage() {
  useBreadcrumb([{ label: "Training" }, { label: "Engagements" }]);

  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [owner, setOwner] = useState<OwnerFilter>("ALL");
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");

  const engagements = useEngagements();
  const pipeline = usePipelineConfig("ENGAGEMENT");
  /* Names, not references. An engagement carries `organisationRef` only, and a
     row that says ORG-0114 where the reader expects "Aurora Manufacturing" is a
     list nobody can scan. `shared/api` owns the book and the resolver, so the
     six screens that resolve a ref cannot drift apart. */
  const directory = useOrganisationDirectory();
  const nameOf = directory.nameOf;

  const all = useMemo(() => engagements.data?.data ?? [], [engagements.data]);

  const owners = useMemo(
    () => [...new Set(all.map((engagement) => engagement.owner.name))].sort(),
    [all],
  );

  const needle = query.trim().toLowerCase();

  const narrowed = useMemo(
    () =>
      all.filter((engagement) => {
        if (owner !== "ALL" && engagement.owner.name !== owner) return false;
        if (needle.length === 0) return true;
        return (
          engagement.title.toLowerCase().includes(needle) ||
          engagement.ref.toLowerCase().includes(needle) ||
          nameOf(engagement.organisationRef).toLowerCase().includes(needle)
        );
      }),
    [all, owner, needle, nameOf],
  );

  const countOf = (id: StatusFilter) =>
    id === "ALL"
      ? narrowed.length
      : narrowed.filter((engagement) => engagement.status === id).length;

  const rows = useMemo(
    () =>
      status === "ALL" ? narrowed : narrowed.filter((engagement) => engagement.status === status),
    [narrowed, status],
  );

  const chips: FilterChipModel[] = [];
  if (needle.length > 0) chips.push({ id: "query", label: "Search", value: query.trim() });
  if (owner !== "ALL") chips.push({ id: "owner", label: "Owner", value: owner });

  const columns: Column<Engagement>[] = [
    {
      key: "title",
      label: "Engagement",
      accessor: (engagement) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{engagement.title}</p>
          <p className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{engagement.ref}</span>
            {` · ${nameOf(engagement.organisationRef)}`}
          </p>
        </div>
      ),
    },
    {
      key: "lifecycle",
      label: "Lifecycle",
      width: "148px",
      /* §11a, variant C. The whole cell is one focusable image whose accessible
         name enumerates every stage, so the dots are not the only way to read
         the chain. */
      accessor: (engagement) => (
        <LifecycleStepper
          steps={engagement.lifecycle}
          {...(pipeline.data ? { stages: pipeline.data.stages } : {})}
          variant="table"
        />
      ),
    },
    {
      key: "dates",
      label: "Delivery",
      width: "156px",
      accessor: (engagement) => (
        <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-secondary">
          {formatDateRange(rangeOf(engagement.dates))}
        </span>
      ),
    },
    {
      key: "participants",
      label: "Attendance",
      width: "116px",
      align: "right",
      accessor: (engagement) => (
        <div className="tabular-nums">
          <p className="text-[13px] text-ink">
            {`${engagement.metrics.attended} / ${engagement.metrics.participants}`}
          </p>
          <p className="text-[11px] text-ink-muted">
            {`${Math.round(engagement.metrics.attendanceRate * 100)}%`}
          </p>
        </div>
      ),
    },
    {
      key: "value",
      label: "Value",
      width: "124px",
      align: "right",
      accessor: (engagement) => <MoneyText value={engagement.value} className="tabular-nums" />,
    },
    {
      key: "status",
      label: "Status",
      width: "124px",
      accessor: (engagement) => (
        <StatusChip tone={ENGAGEMENT_TONE[engagement.status]}>
          {humanise(engagement.status)}
        </StatusChip>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Engagements"
        withoutCondensed
        meta={[
          `${all.length} ${all.length === 1 ? "engagement" : "engagements"}`,
          `${all.filter((engagement) => engagement.status === "IN_DELIVERY").length} in delivery`,
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
            label="Engagement status"
            activeId={status}
            onSelect={(id) => setStatus(id as StatusFilter)}
            tabs={[
              { id: "ALL", label: "All", count: countOf("ALL") },
              ...ENGAGEMENT_STATUSES.map((value) => ({
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
            onRemove={(id) => (id === "query" ? setQuery("") : setOwner("ALL"))}
            onClearAll={() => {
              setQuery("");
              setOwner("ALL");
            }}
          >
            <FilterSearch
              label="Search"
              value={query}
              onChange={setQuery}
              placeholder="Programme, client or reference"
            />
            <FilterSelect
              label="Owner"
              value={owner}
              onChange={setOwner}
              options={[
                { value: "ALL", label: "Any owner" },
                ...owners.map((name) => ({ value: name, label: name })),
              ]}
            />
          </FilterBar>
        }
      />

      <div className="flex flex-col gap-3 pt-3">
        {/* The stage vocabulary is configuration. Losing it does not stop the
            table, but it does mean the chain falls back to raw keys, and a
            reader is owed that fact rather than a row that quietly reads
            differently from yesterday's. */}
        {pipeline.isError ? (
          <div className="px-5">
            <ExceptionBanner
              severity="WARN"
              title="Stage names are unavailable"
              subtitle="The pipeline configuration did not load, so each lifecycle chain shows its raw stage keys. The order and the states are still the server's."
            />
          </div>
        ) : null}

        {directory.query.isError ? (
          <div className="px-5">
            <ExceptionBanner
              severity="WARN"
              title="Client names are unavailable"
              subtitle="The organisation directory did not load, so each row shows its client reference instead of the name."
            />
          </div>
        ) : null}

        {engagements.isPending ? <LoadingState rows={6} label="Loading the engagements" /> : null}

        {engagements.isError ? (
          <ErrorState
            title="The engagements could not be loaded"
            error={toApiError(engagements.error)}
            onRetry={() => void engagements.refetch()}
          />
        ) : null}

        {!engagements.isPending && !engagements.isError ? (
          <DataTable
            label="Engagements"
            columns={columns}
            rows={rows}
            rowKey={(engagement) => engagement.id}
            density={density}
            onRowClick={(engagement) => navigate(engagementPath(engagement.ref))}
            empty={
              <EmptyState
                title="No engagement matches these filters"
                description="Clear a filter, or widen the status tab, to see the rest of the schedule."
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}

export default EngagementsListPage;
