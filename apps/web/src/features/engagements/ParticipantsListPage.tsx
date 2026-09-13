import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Engagement, EngagementStatus, Participant } from "@trainos/contract";
import { ENGAGEMENT_STATUSES } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  EmptyState,
  ENGAGEMENT_TONE,
  ErrorState,
  FilterBar,
  FilterSearch,
  FilterSelect,
  formatDateRange,
  humanise,
  ListToolbar,
  LoadingState,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { useAllParticipants, useEngagements } from "./api";
import { attendancePath } from "./paths";

/**
 * The participant directory — the list half of M10-S06.
 *
 * M10 is drawn as one cohort's attendance sheet; the nav leaf above it is every
 * participant. `Participant` hangs off an engagement and there is no
 * participants endpoint, so the only honest list is the fan-out: one page per
 * engagement, joined here. That join is the whole reason this screen carries
 * the engagement's own columns — a participant row without its cohort is not
 * something an ops lead can act on.
 *
 * A row leads to that cohort's attendance sheet, because attendance is the one
 * thing this screen exists upstream of. There is no participant record page and
 * this screen does not invent one.
 */

type StatusFilter = "ALL" | EngagementStatus;

interface Row {
  participant: Participant;
  engagement: Engagement;
}

/** A `DateOnly[]` as the range helper wants it: first day to last. */
function rangeOf(dates: readonly string[]): string | null {
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first : `${first}/${last}`;
}

export function ParticipantsListPage() {
  useBreadcrumb([{ label: "Training" }, { label: "Participants" }]);

  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [engagementRef, setEngagementRef] = useState("ALL");
  const [department, setDepartment] = useState("ALL");
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");

  const engagements = useEngagements();
  const cohorts = useMemo(() => engagements.data?.data ?? [], [engagements.data]);
  const pages = useAllParticipants(cohorts.map((cohort) => cohort.ref));

  /* One query per cohort, so a single cohort refetching does not re-read the
     rest. The page is ready only when every one of them is. */
  const loadingParticipants = pages.some((page) => page.isPending);
  const failed = pages.find((page) => page.isError);

  /* Deliberately not memoised. `useQueries` hands back a fresh array every
     render, so a `useMemo` over it would recompute every time anyway — and
     would then need a hand-rolled dependency key that lies about what it
     watches. The join is a flatMap over a few hundred rows; the honest version
     is the cheap one. */
  const all: Row[] = cohorts.flatMap((engagement, index) =>
    (pages[index]?.data?.data ?? []).map((participant) => ({ participant, engagement })),
  );

  const departments = [...new Set(all.map((row) => row.participant.department))].sort();

  const needle = query.trim().toLowerCase();

  const narrowed = all.filter((row) => {
    if (engagementRef !== "ALL" && row.engagement.ref !== engagementRef) return false;
    if (department !== "ALL" && row.participant.department !== department) return false;
    if (needle.length === 0) return true;
    return (
      row.participant.name.toLowerCase().includes(needle) ||
      row.participant.ref.toLowerCase().includes(needle) ||
      row.engagement.title.toLowerCase().includes(needle)
    );
  });

  const countOf = (id: StatusFilter) =>
    id === "ALL" ? narrowed.length : narrowed.filter((row) => row.engagement.status === id).length;

  const rows =
    status === "ALL" ? narrowed : narrowed.filter((row) => row.engagement.status === status);

  const chips: FilterChipModel[] = [];
  if (needle.length > 0) chips.push({ id: "query", label: "Search", value: query.trim() });
  if (engagementRef !== "ALL") {
    chips.push({ id: "engagement", label: "Engagement", value: engagementRef });
  }
  if (department !== "ALL") {
    chips.push({ id: "department", label: "Department", value: humanise(department) });
  }

  const columns: Column<Row>[] = [
    {
      key: "participant",
      label: "Participant",
      accessor: ({ participant }) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{participant.name}</p>
          <p className="truncate font-mono text-[12px] text-ink-muted">{participant.ref}</p>
        </div>
      ),
    },
    {
      key: "department",
      label: "Department",
      width: "168px",
      accessor: ({ participant }) => (
        <span className="text-[13px] text-ink-secondary">{participant.department}</span>
      ),
    },
    {
      key: "engagement",
      label: "Engagement",
      accessor: ({ engagement }) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-ink">{engagement.title}</p>
          <p className="truncate font-mono text-[12px] text-ink-muted">{engagement.ref}</p>
        </div>
      ),
    },
    {
      key: "dates",
      label: "Delivery",
      width: "156px",
      accessor: ({ engagement }) => (
        <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-secondary">
          {formatDateRange(rangeOf(engagement.dates))}
        </span>
      ),
    },
    {
      key: "certificate",
      label: "Certificate",
      width: "148px",
      /* Absent is the ordinary case before delivery closes out, so it is muted
         typography rather than a chip. Only a state someone must act on earns
         colour, and "no certificate yet" is not one. */
      accessor: ({ participant }) =>
        participant.certificateId ? (
          <span className="font-mono text-[12px] text-ink-secondary">
            {participant.certificateId}
          </span>
        ) : (
          <span className="text-[13px] text-ink-muted">—</span>
        ),
    },
    {
      key: "status",
      label: "Cohort status",
      width: "124px",
      accessor: ({ engagement }) => (
        <StatusChip tone={ENGAGEMENT_TONE[engagement.status]}>
          {humanise(engagement.status)}
        </StatusChip>
      ),
    },
  ];

  const pending = engagements.isPending || loadingParticipants;

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Participants"
        withoutCondensed
        meta={[
          `${all.length} ${all.length === 1 ? "participant" : "participants"}`,
          `${cohorts.length} ${cohorts.length === 1 ? "cohort" : "cohorts"}`,
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
            label="Cohort status"
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
            onRemove={(id) => {
              if (id === "query") setQuery("");
              if (id === "engagement") setEngagementRef("ALL");
              if (id === "department") setDepartment("ALL");
            }}
            onClearAll={() => {
              setQuery("");
              setEngagementRef("ALL");
              setDepartment("ALL");
            }}
          >
            <FilterSearch
              label="Search"
              value={query}
              onChange={setQuery}
              placeholder="Name, reference or cohort"
            />
            <FilterSelect
              label="Engagement"
              value={engagementRef}
              onChange={setEngagementRef}
              options={[
                { value: "ALL", label: "Any engagement" },
                ...cohorts.map((cohort) => ({ value: cohort.ref, label: cohort.title })),
              ]}
            />
            <FilterSelect
              label="Department"
              value={department}
              onChange={setDepartment}
              options={[
                { value: "ALL", label: "Any department" },
                ...departments.map((name) => ({ value: name, label: name })),
              ]}
            />
          </FilterBar>
        }
      />

      <div className="pt-3">
        {pending ? <LoadingState rows={8} label="Loading the participant directory" /> : null}

        {/* Either read failing means rows are missing, and a short list is
            indistinguishable from a complete one. So the whole table is
            replaced rather than silently under-reporting. */}
        {!pending && engagements.isError ? (
          <ErrorState
            title="The participant directory could not be loaded"
            error={toApiError(engagements.error)}
            onRetry={() => void engagements.refetch()}
          />
        ) : null}

        {!pending && !engagements.isError && failed ? (
          <ErrorState
            title="Some cohorts' participants could not be loaded"
            error={toApiError(failed.error)}
            onRetry={() => void failed.refetch()}
          />
        ) : null}

        {!pending && !engagements.isError && !failed ? (
          <DataTable
            label="Participants"
            columns={columns}
            rows={rows}
            rowKey={({ participant }) => participant.id}
            density={density}
            onRowClick={({ engagement }) => navigate(attendancePath(engagement.ref))}
            empty={
              <EmptyState
                title="No participant matches these filters"
                description="Clear a filter, or widen the cohort tab, to see the rest of the directory."
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}

export default ParticipantsListPage;
