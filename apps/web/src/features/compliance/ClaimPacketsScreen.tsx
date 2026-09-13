import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { HRDCScheme } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSearch,
  FilterSelect,
  ListToolbar,
  LoadingState,
  MoneyText,
  PartialDataBanner,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  formatDate,
  formatMoney,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
  type PartialRead,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { HRDC_PACKET_PATH } from "@/features/hrdc";
import { hrdcSchemeLabel } from "@/features/programmes";
import { useClaimPackets, useHrdcDeadlines, useOrganisations } from "./api";
import { PACKET_TONE, packetRows, type PacketRow } from "./registers";

/**
 * `/compliance/hrd-corp` — the list half of HRD Corp.
 *
 * The nav leaf used to mount M12-S02 directly, so the rail's own "HRD Corp"
 * entry landed on ENG-0231 and the breadcrumb on a LIST route ended at a record
 * reference. CLAUDE.md gives the breadcrumb the path and `RecordHeader` the
 * identity; a leaf that opens one record can honour neither. This screen is the
 * list that route was always meant to be, and the packet screen keeps the
 * `/:engagementRef` pattern beneath it.
 *
 * WHERE THE ROWS COME FROM. There is no packets list endpoint — `GET
 * /v1/hrdc/packets/{engagementRef}` is per engagement — so the index is `GET
 * /v1/hrdc/deadlines`, the list of engagements that HAVE an open claim, and
 * each packet is read on its own key from there. `ComplianceDocumentsScreen`
 * reads the same pair for the same reason; this screen reuses its hooks rather
 * than standing a second fan-out up beside them.
 *
 * The deadline and its severity come off the PACKET, which carries both, not
 * off the index row. One fact, one source: the two would otherwise be free to
 * disagree the moment a packet's window moved and the badge query had not
 * refetched.
 *
 * It lives in `features/compliance` and not in `features/hrdc` for the reason
 * `paths.ts` in this folder already gives: that folder is the M12 RECORD
 * screens, and anything spanning engagements is a register. The route entry
 * stays in `routes/hrdc.routes.tsx`, which owns the path constant.
 *
 * The question it answers is the one the deadlines register does not: not when
 * each window closes but how far each packet has got and what it is worth, so
 * documents and claim value are the columns and the date is support.
 *
 * NO SOLID PRIMARY. Filing on eTRIS happens on the packet, which is where every
 * row goes.
 */

const ANY = "ALL";

const TABS = { incomplete: "Incomplete", all: "All" } as const;

type TabId = keyof typeof TABS;

export function ClaimPacketsScreen() {
  useBreadcrumb([{ label: "Compliance" }, { label: "HRD Corp" }]);

  const navigate = useNavigate();
  const [tabOverride, setTab] = useState<TabId | null>(null);
  const [scheme, setScheme] = useState<string>(ANY);
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const deadlines = useHrdcDeadlines();

  const engagementRefs = useMemo(
    () => (deadlines.data?.data ?? []).map((deadline) => deadline.engagementRef),
    [deadlines.data],
  );

  const packets = useClaimPackets(engagementRefs);

  const loaded = useMemo(
    () => packets.flatMap((packet) => (packet.data ? [packet.data] : [])),
    [packets],
  );

  const organisationRefs = useMemo(
    () => [...new Set(loaded.map((packet) => packet.organisationRef))],
    [loaded],
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

  /* A packet that failed is a row that is ABSENT, and a register rendering a
     short list as though it were the whole list is the one failure this banner
     exists for. The client's name is cosmetic and joins it rather than earning
     a second banner. */
  const partial: PartialRead[] = [
    ...engagementRefs.map((ref, index) => ({
      label: `the claim packet for ${ref}`,
      error: packets[index]?.isError ? toApiError(packets[index]?.error) : null,
      retry: () => void packets[index]?.refetch(),
    })),
    ...organisationRefs.map((ref, index) => ({
      label: `the client name for ${ref}`,
      error: organisations[index]?.isError ? toApiError(organisations[index]?.error) : null,
      retry: () => void organisations[index]?.refetch(),
    })),
  ];

  const all = useMemo(() => packetRows(loaded), [loaded]);

  const incomplete = all.filter((row) => !row.complete).length;
  const tab: TabId = tabOverride ?? (incomplete > 0 ? "incomplete" : "all");

  const schemes = useMemo(() => [...new Set(all.map((row) => row.scheme))].sort(), [all]);

  const inTab = useMemo(
    () => (tab === "all" ? all : all.filter((row) => !row.complete)),
    [all, tab],
  );

  const narrowed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inTab.filter((row) => {
      if (scheme !== ANY && row.scheme !== scheme) return false;
      if (needle === "") return true;
      return (
        row.engagementRef.toLowerCase().includes(needle) ||
        (nameOf.get(row.organisationRef) ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inTab, scheme, query, nameOf]);

  const rows = useMemo(() => {
    if (!sort) return narrowed;
    const read = (row: PacketRow) =>
      sort.key === "claimValue" ? row.claimValue.amount : row.completeness;
    return [...narrowed].sort((left, right) =>
      sort.direction === "asc" ? read(left) - read(right) : read(right) - read(left),
    );
  }, [narrowed, sort]);

  const chips: FilterChipModel[] = [];
  if (query.trim().length > 0) chips.push({ id: "query", label: "Search", value: query.trim() });
  if (scheme !== ANY) {
    chips.push({ id: "scheme", label: "Scheme", value: hrdcSchemeLabel(scheme as HRDCScheme) });
  }

  const claimable = {
    amount: all.reduce((total, row) => total + row.claimValue.amount, 0),
    currency: all[0]?.claimValue.currency ?? "MYR",
  };

  const columns: Column<PacketRow>[] = [
    {
      key: "claim",
      label: "Claim",
      accessor: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-ink">
            {nameOf.get(row.organisationRef) ?? row.organisationRef}
          </div>
          <div className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{row.engagementRef}</span>
            {` · ${hrdcSchemeLabel(row.scheme)}`}
          </div>
        </div>
      ),
    },
    {
      key: "completeness",
      label: "Documents",
      width: "170px",
      sortable: true,
      /* The count leads and the rate supports it. "3 of 5 present" is what a
         reader acts on; the percentage is the server's weighting of the same
         fact and reads as precision the reader cannot use on its own. */
      accessor: (row) => (
        <div className="min-w-0">
          <div className="text-[13px] tabular-nums text-ink">
            {`${row.documents - row.missing} of ${row.documents} present`}
          </div>
          <div className="text-[12px] tabular-nums text-ink-muted">
            {`${Math.round(row.completeness * 100)}% complete`}
          </div>
        </div>
      ),
    },
    {
      key: "claimValue",
      label: "Claim value",
      width: "132px",
      align: "right",
      sortable: true,
      accessor: (row) => <MoneyText value={row.claimValue} className="tabular-nums" />,
    },
    {
      key: "deadlineAt",
      label: "Window closes",
      width: "140px",
      /* §16: a date in a data column is typography, never a badge. */
      accessor: (row) => (
        <span className="text-[13px] tabular-nums text-ink-secondary">
          {formatDate(row.deadlineAt)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "196px",
      /* Status colour lives on chips, and nowhere else on this screen. */
      accessor: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={PACKET_TONE[row.status] ?? "neutral"}>
            {humanise(row.status)}
          </StatusChip>
          {row.missing > 0 ? (
            <StatusChip tone={row.deadlineTone}>{`${row.missing} missing`}</StatusChip>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="HRD Corp claims"
        withoutCondensed
        meta={[
          `${all.length} open ${all.length === 1 ? "packet" : "packets"}`,
          incomplete === 0 ? "every packet complete" : `${incomplete} still incomplete`,
          all.length > 0 ? `${formatMoney(claimable)} claimable` : null,
        ]}
      />

      <div className="px-5 py-3">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Claim packets"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={[
                { id: "incomplete", label: TABS.incomplete, count: incomplete },
                { id: "all", label: TABS.all, count: all.length },
              ]}
            />
          }
          filters={
            <FilterBar
              filters={chips}
              shown={rows.length}
              total={inTab.length}
              onRemove={(id) => {
                if (id === "query") setQuery("");
                if (id === "scheme") setScheme(ANY);
              }}
              onClearAll={() => {
                setQuery("");
                setScheme(ANY);
              }}
            >
              <FilterSearch
                label="Search claims"
                labelHidden
                value={query}
                onChange={setQuery}
                placeholder="Client or engagement"
              />
              {/* Built from the data. `HRDCScheme` widens whenever HRD Corp
                  publishes another scheme, and a hardcoded option list would
                  silently hide every packet filed under the new one. */}
              <FilterSelect
                label="Scheme"
                value={scheme}
                onChange={setScheme}
                options={[
                  { value: ANY, label: "Any scheme" },
                  ...schemes.map((value) => ({ value, label: hrdcSchemeLabel(value) })),
                ]}
              />
            </FilterBar>
          }
          actions={<DensityToggle value={density} onChange={setDensity} />}
        />
      </div>

      {partial.some((read) => read.error) ? (
        <div className="px-5 pb-2">
          <PartialDataBanner reads={partial} />
        </div>
      ) : null}

      {deadlines.isPending ? <LoadingState rows={5} label="Loading the claim packets" /> : null}

      {deadlines.isError ? (
        <ErrorState
          title="The claim packets could not be loaded"
          error={toApiError(deadlines.error)}
          onRetry={() => void deadlines.refetch()}
        />
      ) : null}

      {!deadlines.isPending && !deadlines.isError ? (
        <DataTable
          label="HRD Corp claim packets"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          density={density}
          {...(sort ? { sortKey: sort.key, sortDirection: sort.direction } : {})}
          onSort={(key) =>
            setSort((current) =>
              current?.key === key
                ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
                : { key, direction: "desc" },
            )
          }
          onRowClick={(row) => navigate(`${HRDC_PACKET_PATH}/${row.engagementRef}`)}
          empty={
            all.length === 0 ? (
              <EmptyState
                title="No claim packet is open"
                description="A packet appears here once an engagement has a grant and a claim window running."
              />
            ) : inTab.length === 0 ? (
              /* The TAB is empty, not the filter. Saying "nothing matches this
                 search" over a search box the reader never touched sends them
                 to clear something they did not set. */
              <EmptyState
                title="Every packet is complete"
                description="Nothing is waiting on a document. Switch to All to see the packets already assembled."
              />
            ) : (
              <EmptyState
                title="No claim matches this search"
                description="Clear the search and the scheme facet to see every open packet."
              />
            )
          }
        />
      ) : null}
    </div>
  );
}

export default ClaimPacketsScreen;
