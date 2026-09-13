import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSelect,
  ListToolbar,
  LoadingState,
  PartialDataBanner,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  formatDate,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
  type PartialRead,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { HRDC_PACKET_PATH } from "@/features/hrdc";
import { useEngagements } from "@/features/engagements";
import { useHrdcDeadlines, useOrganisations } from "./api";
import { deadlineRows, type DeadlineRow } from "./registers";

/**
 * `/compliance/deadlines` — every HRD Corp claim window, soonest first.
 *
 * M12's anatomy, applied to a register rather than a record: title and count
 * line, one control row, one table. No artboard draws it.
 *
 * The urgency chip reads the server's `severity` and never `daysRemaining`.
 * `statusTone.ts` already carries the note about `Organisation360Page` deriving
 * urgency from the day count and getting it wrong; deriving it a second time
 * here would reintroduce exactly that defect. A 99-day deadline on a blocked
 * packet is a warning and a 180-day one is not, and only the server knows why.
 *
 * No solid primary. Filing on eTRIS happens on the packet screen, which is
 * where each row goes.
 */

const ANY = "ALL";

const TABS = { attention: "Needs attention", all: "All" } as const;

type TabId = keyof typeof TABS;

const URGENT = new Set(["DANGER", "ALERT"]);

export function ComplianceDeadlinesScreen() {
  useBreadcrumb([{ label: "Compliance" }, { label: "Deadlines" }]);

  const navigate = useNavigate();
  const [tabOverride, setTab] = useState<TabId | null>(null);
  const [status, setStatus] = useState<string>(ANY);
  const [density, setDensity] = useState<Density>("comfortable");

  const deadlines = useHrdcDeadlines();
  const engagements = useEngagements();

  const all = useMemo(() => deadlineRows(deadlines.data?.data ?? []), [deadlines.data]);

  const organisationRefs = useMemo(
    () => [...new Set(all.map((row) => row.organisationRef))],
    [all],
  );
  const organisations = useOrganisations(organisationRefs);

  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    organisationRefs.forEach((ref, index) => {
      const name = organisations[index]?.data?.name;
      if (name) names.set(ref, name);
    });
    return names;
  }, [organisationRefs, organisations]);

  const titleOf = useMemo(() => {
    const titles = new Map<string, string>();
    for (const engagement of engagements.data?.data ?? []) {
      titles.set(engagement.ref, engagement.title);
    }
    return titles;
  }, [engagements.data]);

  /* Every supporting read that failed, as ONE banner. The client's name and the
     engagement's title are things this register can exist without — the
     deadline itself is not, and that one gets `ErrorState`. */
  const partial: PartialRead[] = [
    {
      label: "the engagement titles",
      error: engagements.isError ? toApiError(engagements.error) : null,
      retry: () => void engagements.refetch(),
    },
    ...organisationRefs.map((ref, index) => ({
      label: `the client name for ${ref}`,
      error: organisations[index]?.isError ? toApiError(organisations[index]?.error) : null,
      retry: () => void organisations[index]?.refetch(),
    })),
  ];

  const statuses = useMemo(() => [...new Set(all.map((row) => row.status))].sort(), [all]);
  const urgent = all.filter((row) => URGENT.has(row.severity) || row.overdue).length;
  const tab: TabId = tabOverride ?? (urgent > 0 ? "attention" : "all");

  const inTab = useMemo(
    () => (tab === "all" ? all : all.filter((row) => URGENT.has(row.severity) || row.overdue)),
    [all, tab],
  );

  const rows = useMemo(
    () => (status === ANY ? inTab : inTab.filter((row) => row.status === status)),
    [inTab, status],
  );

  const chips: FilterChipModel[] =
    status === ANY ? [] : [{ id: "status", label: "Status", value: humanise(status) }];

  const columns: Column<DeadlineRow>[] = [
    {
      key: "engagement",
      label: "Claim",
      accessor: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-ink">
            {titleOf.get(row.engagementRef) ?? row.engagementRef}
          </div>
          <div className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{row.engagementRef}</span>
            {nameOf.has(row.organisationRef) ? ` · ${nameOf.get(row.organisationRef)}` : null}
          </div>
        </div>
      ),
    },
    {
      key: "deadlineAt",
      label: "Window closes",
      width: "148px",
      sortable: true,
      /* §16: a date is typography in a data column, never a badge. */
      accessor: (row) => (
        <span className="text-[13px] tabular-nums text-ink">{formatDate(row.deadlineAt)}</span>
      ),
    },
    {
      key: "daysRemaining",
      label: "Remaining",
      width: "128px",
      align: "right",
      accessor: (row) => (
        <span className="text-[13px] tabular-nums text-ink-secondary">
          {row.overdue ? `${Math.abs(row.daysRemaining)} days over` : `${row.daysRemaining} days`}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "196px",
      /* Overdue rides on the chip, per the brief, and status colour lives
         nowhere else on this screen. */
      accessor: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {row.overdue ? <StatusChip tone="danger">Overdue</StatusChip> : null}
          <StatusChip tone={row.tone}>{humanise(row.status)}</StatusChip>
        </div>
      ),
    },
  ];

  const earliest = all[0]?.deadlineAt ?? null;

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="HRD Corp deadlines"
        withoutCondensed
        meta={[
          `${all.length} open ${all.length === 1 ? "claim" : "claims"}`,
          urgent === 0 ? "none needs attention" : `${urgent} need attention`,
          earliest ? `earliest closes ${formatDate(earliest)}` : null,
        ]}
      />

      <div className="px-5 py-3">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Deadlines"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={[
                { id: "attention", label: TABS.attention, count: urgent },
                { id: "all", label: TABS.all, count: all.length },
              ]}
            />
          }
          filters={
            <FilterBar
              filters={chips}
              shown={rows.length}
              total={inTab.length}
              onRemove={() => setStatus(ANY)}
              onClearAll={() => setStatus(ANY)}
            >
              {/* Built from the data. `HrdcDeadline.status` is `string` in the
                  contract, so a hardcoded list of options would silently drop a
                  status the server started sending. */}
              <FilterSelect
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: ANY, label: "Any status" },
                  ...statuses.map((value) => ({ value, label: humanise(value) })),
                ]}
              />
            </FilterBar>
          }
          actions={<DensityToggle value={density} onChange={setDensity} />}
        />
      </div>

      {partial.some((read) => read.error) ? (
        <div className="px-5 pt-4">
          <PartialDataBanner reads={partial} />
        </div>
      ) : null}

      {deadlines.isPending ? <LoadingState label="Loading the claim deadlines" /> : null}

      {deadlines.isError ? (
        <ErrorState
          title="The claim deadlines could not be loaded"
          error={toApiError(deadlines.error)}
          onRetry={() => void deadlines.refetch()}
        />
      ) : null}

      {!deadlines.isPending && !deadlines.isError ? (
        <DataTable
          label="HRD Corp deadlines"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          density={density}
          onRowClick={(row) => navigate(`${HRDC_PACKET_PATH}/${row.engagementRef}`)}
          empty={
            all.length === 0 ? (
              <EmptyState
                title="No claim window is open"
                description="A deadline appears here once an engagement has a grant and a claim window running."
              />
            ) : inTab.length === 0 ? (
              /* The tab is empty, not the filter. See the documents register. */
              <EmptyState
                title="Nothing needs attention"
                description="Every open claim window has room. Switch to All to see them."
              />
            ) : (
              <EmptyState
                title="No claim matches this status"
                description="Clear the status facet to see every open window."
              />
            )
          }
        />
      ) : null}
    </div>
  );
}

export default ComplianceDeadlinesScreen;
