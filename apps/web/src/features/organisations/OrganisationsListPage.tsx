import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Organisation, OrganisationStatus } from "@trainos/contract";
import { ORGANISATION_STATUSES } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSearch,
  FilterSelect,
  humanise,
  LoadingState,
  MoneyText,
  ORGANISATION_TONE,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { ORGANISATION_DETAIL_PATH } from "./paths";

/**
 * The organisation directory — the list half of M04-S02, template 1
 * "list + filter bar".
 *
 * M04 is never drawn. The Kit's canonical record proof is the 360 view, so this
 * screen is composed under constraint rather than transcribed: the Collections
 * page's sequence — title → count → tabs → filter row → table — with the
 * columns taken from what the 360 view puts in its metric band, because those
 * are the five numbers an account owner is already reading one record at a time.
 *
 * The search box hands its needle to `useOrganisationDirectory` in `shared/api`
 * — the same hook the five other screens that resolve an `organisationRef` use.
 * §5 publishes no organisations collection, so the directory IS the search with
 * an empty needle; the unfiltered list and a search are one request rather than
 * two code paths. Status and industry narrow the page that comes back, because
 * neither is a server filter field today.
 */

type StatusFilter = "ALL" | OrganisationStatus;
type IndustryFilter = "ALL" | string;
type HrdcFilter = "ALL" | "REGISTERED" | "NOT_REGISTERED";

const HRDC_LABEL: Record<Exclude<HrdcFilter, "ALL">, string> = {
  REGISTERED: "HRD Corp registered",
  NOT_REGISTERED: "Not registered",
};

interface Facets {
  industry: IndustryFilter;
  hrdc: HrdcFilter;
}

const EMPTY_FACETS: Facets = { industry: "ALL", hrdc: "ALL" };

function matches(organisation: Organisation, facets: Facets): boolean {
  if (facets.industry !== "ALL" && organisation.industry !== facets.industry) return false;
  if (facets.hrdc === "REGISTERED" && !organisation.hrdcRegistered) return false;
  if (facets.hrdc === "NOT_REGISTERED" && organisation.hrdcRegistered) return false;
  return true;
}

export function OrganisationsListPage() {
  useBreadcrumb([{ label: "Sales" }, { label: "Organisations" }]);

  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [density, setDensity] = useState<Density>("comfortable");

  const { organisations, query } = useOrganisationDirectory(search);

  const industries = useMemo(
    () => [...new Set(organisations.map((organisation) => organisation.industry))].sort(),
    [organisations],
  );

  /* Faceted first, then tabbed, so a tab's count answers "how many of the rows
     I can currently see", not "how many exist". A count that ignores the
     filters is the one a reader trusts and should not. */
  const faceted = useMemo(
    () => organisations.filter((organisation) => matches(organisation, facets)),
    [organisations, facets],
  );

  const countOf = (id: StatusFilter) =>
    id === "ALL"
      ? faceted.length
      : faceted.filter((organisation) => organisation.status === id).length;

  const rows = useMemo(
    () =>
      status === "ALL" ? faceted : faceted.filter((organisation) => organisation.status === status),
    [faceted, status],
  );

  const chips: FilterChipModel[] = [];
  if (search.trim().length > 0) {
    chips.push({ id: "query", label: "Search", value: search.trim() });
  }
  if (facets.industry !== "ALL") {
    chips.push({ id: "industry", label: "Industry", value: humanise(facets.industry) });
  }
  if (facets.hrdc !== "ALL") {
    chips.push({ id: "hrdc", label: "HRD Corp", value: HRDC_LABEL[facets.hrdc] });
  }

  const columns: Column<Organisation>[] = [
    {
      key: "name",
      label: "Organisation",
      accessor: (organisation) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{organisation.name}</p>
          {/* §16: the identity subline is a reference and two plain facts, so
              only the reference is mono. The rest is typography. */}
          <p className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{organisation.ref}</span>
            {` · ${humanise(organisation.industry)} · ${organisation.location}`}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "128px",
      accessor: (organisation) => (
        <StatusChip tone={ORGANISATION_TONE[organisation.status]}>
          {humanise(organisation.status)}
        </StatusChip>
      ),
    },
    {
      key: "hrdc",
      label: "HRD Corp",
      width: "136px",
      /* The employer code is the fact an account owner needs; "registered" with
         no code is the exception, and only the exception earns a tone. */
      accessor: (organisation) =>
        organisation.hrdcEmployerCode ? (
          <span className="font-mono text-[12px] text-ink-secondary">
            {organisation.hrdcEmployerCode}
          </span>
        ) : (
          <StatusChip tone="warning">Not registered</StatusChip>
        ),
    },
    {
      key: "lifetimeValue",
      label: "Lifetime value",
      width: "132px",
      align: "right",
      accessor: (organisation) => (
        <MoneyText value={organisation.metrics.lifetimeValue.value} className="tabular-nums" />
      ),
    },
    {
      key: "openPipeline",
      label: "Open pipeline",
      width: "132px",
      align: "right",
      accessor: (organisation) => (
        <MoneyText value={organisation.metrics.openPipeline.value} className="tabular-nums" />
      ),
    },
    {
      key: "arOverdue",
      label: "AR overdue",
      width: "124px",
      align: "right",
      accessor: (organisation) =>
        organisation.metrics.arOverdue.value.amount === 0 ? (
          <span className="tabular-nums text-[13px] text-ink-muted">—</span>
        ) : (
          <MoneyText value={organisation.metrics.arOverdue.value} className="tabular-nums" />
        ),
    },
    {
      key: "healthScore",
      label: "Health",
      width: "80px",
      align: "right",
      accessor: (organisation) => (
        <span className="tabular-nums text-[13px] text-ink">
          {organisation.metrics.healthScore.value}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      {/* A list screen's header is a RecordHeader with no `recordRef` — there is
          no PageHeader in the kit and there will not be one. `meta` carries the
          count line the tightening brief §3 asks for. */}
      <RecordHeader
        title="Organisations"
        withoutCondensed
        meta={[
          `${organisations.length} ${organisations.length === 1 ? "organisation" : "organisations"}`,
          `${countOf("ACTIVE_CLIENT")} active`,
        ]}
        actions={<DensityToggle value={density} onChange={setDensity} />}
      />

      <div className="px-5 pb-3">
        <PillTabGroup
          label="Organisation status"
          activeId={status}
          onSelect={(id) => setStatus(id as StatusFilter)}
          tabs={[
            { id: "ALL", label: "All", count: countOf("ALL") },
            ...ORGANISATION_STATUSES.map((value) => ({
              id: value,
              label: humanise(value),
              count: countOf(value),
            })),
          ]}
        />
      </div>

      <div className="border-b border-border px-5 pb-3">
        <FilterBar
          filters={chips}
          shown={rows.length}
          total={organisations.length}
          onRemove={(id) => {
            if (id === "query") setSearch("");
            else setFacets((current) => ({ ...current, [id]: "ALL" }));
          }}
          onClearAll={() => {
            setSearch("");
            setFacets(EMPTY_FACETS);
          }}
        >
          <FilterSearch
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder="Name or reference"
          />
          <FilterSelect
            label="Industry"
            value={facets.industry}
            onChange={(value) => setFacets((current) => ({ ...current, industry: value }))}
            options={[
              { value: "ALL", label: "Any industry" },
              ...industries.map((industry) => ({ value: industry, label: humanise(industry) })),
            ]}
          />
          <FilterSelect
            label="HRD Corp"
            value={facets.hrdc}
            onChange={(value) =>
              setFacets((current) => ({ ...current, hrdc: value as HrdcFilter }))
            }
            options={[
              { value: "ALL", label: "Any" },
              { value: "REGISTERED", label: "Registered" },
              { value: "NOT_REGISTERED", label: "Not registered" },
            ]}
          />
        </FilterBar>
      </div>

      {query.isPending ? (
        <LoadingState rows={6} label="Loading the organisation directory" />
      ) : null}

      {query.isError ? (
        <ErrorState
          title="The organisation directory could not be loaded"
          error={toApiError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {!query.isPending && !query.isError ? (
        <DataTable
          label="Organisations"
          columns={columns}
          rows={rows}
          rowKey={(organisation) => organisation.id}
          density={density}
          onRowClick={(organisation) => navigate(ORGANISATION_DETAIL_PATH(organisation.ref))}
          empty={
            <EmptyState
              title="No organisation matches this search"
              description="Clear the search or widen a filter to see the rest of the directory."
            />
          }
        />
      ) : null}
    </div>
  );
}

export default OrganisationsListPage;
