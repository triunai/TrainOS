import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Programme } from "@trainos/contract";
import {
  Breadcrumb,
  ContentCard,
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  MoneyText,
  StatusChip,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { errorMessageOf, useProgrammes } from "./api";
import { PROGRAMME_DETAIL_PATH } from "./paths";

/**
 * The programme catalogue list — template 1, "list + filter bar".
 *
 * Filtering happens client-side on the fixture page rather than through
 * `PageRequest.filter`, because the three facets M06 needs (category, HRDC
 * claimability, duration band) are not all server filter fields and the
 * catalogue is a handful of rows. The moment the list is paginated for real
 * this must become a `FilterClause[]`; the shape of `activeFilters` is already
 * the shape that translation wants.
 */

type CategoryFilter = "ALL" | string;
type ClaimableFilter = "ALL" | "CLAIMABLE" | "NOT_CLAIMABLE";
type DurationFilter = "ALL" | "1" | "2" | "3+";

interface Facets {
  category: CategoryFilter;
  claimable: ClaimableFilter;
  duration: DurationFilter;
}

const EMPTY_FACETS: Facets = { category: "ALL", claimable: "ALL", duration: "ALL" };

const durationBand = (days: number): DurationFilter =>
  days >= 3 ? "3+" : (String(days) as DurationFilter);

const DURATION_LABEL: Record<Exclude<DurationFilter, "ALL">, string> = {
  "1": "1 day",
  "2": "2 days",
  "3+": "3 days or more",
};

const CLAIMABLE_LABEL: Record<Exclude<ClaimableFilter, "ALL">, string> = {
  CLAIMABLE: "HRDC claimable",
  NOT_CLAIMABLE: "Not claimable",
};

function matches(programme: Programme, facets: Facets): boolean {
  if (facets.category !== "ALL" && programme.category !== facets.category) return false;
  if (facets.claimable === "CLAIMABLE" && !programme.hrdcClaimable) return false;
  if (facets.claimable === "NOT_CLAIMABLE" && programme.hrdcClaimable) return false;
  if (facets.duration !== "ALL" && durationBand(programme.days) !== facets.duration) return false;
  return true;
}

/**
 * A plain select. The kit has no filter-select control yet, so the facets are
 * native `<select>`s dropped into `FilterBar`'s own children slot — which is
 * exactly what that slot is for — rather than a second chip vocabulary.
 */
function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
      <span>{label}</span>
      <select
        className="h-7 rounded-[6px] border border-border bg-surface px-2 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ProgrammesListPage() {
  const navigate = useNavigate();
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [density, setDensity] = useState<Density>("comfortable");
  const { data, isPending, isError, error, refetch } = useProgrammes();

  const programmes = useMemo(() => data?.data ?? [], [data]);
  const categories = useMemo(
    () => [...new Set(programmes.map((programme) => programme.category))].sort(),
    [programmes],
  );
  const rows = useMemo(
    () => programmes.filter((programme) => matches(programme, facets)),
    [programmes, facets],
  );

  const chips: FilterChipModel[] = [];
  if (facets.category !== "ALL") {
    chips.push({ id: "category", label: "Category", value: humanise(facets.category) });
  }
  if (facets.claimable !== "ALL") {
    chips.push({ id: "claimable", label: "HRDC", value: CLAIMABLE_LABEL[facets.claimable] });
  }
  if (facets.duration !== "ALL") {
    chips.push({ id: "duration", label: "Duration", value: DURATION_LABEL[facets.duration] });
  }

  const columns: Column<Programme>[] = [
    {
      key: "name",
      label: "Programme",
      accessor: (programme) => (
        <div>
          <div className="font-medium text-ink">{programme.name}</div>
          <div className="text-[11px] text-ink-muted">
            {programme.ref} · v{programme.version}
          </div>
        </div>
      ),
    },
    { key: "category", label: "Category", accessor: (programme) => humanise(programme.category) },
    {
      key: "days",
      label: "Duration",
      accessor: (programme) => `${programme.days} ${programme.days === 1 ? "day" : "days"}`,
    },
    {
      key: "hrdc",
      label: "HRDC",
      accessor: (programme) =>
        programme.hrdcClaimable ? (
          <StatusChip tone="success">{humanise(programme.hrdcScheme)}</StatusChip>
        ) : (
          <StatusChip tone="neutral">Not claimable</StatusChip>
        ),
    },
    {
      key: "listPrice",
      label: "List price",
      align: "right",
      accessor: (programme) => (
        <div>
          <MoneyText value={programme.listPrice} />
          <div className="text-[11px] text-ink-muted">{programme.listPricePax} pax</div>
        </div>
      ),
    },
    {
      key: "deliveries",
      label: "Delivered",
      align: "right",
      accessor: (programme) => `${programme.stats.deliveries}×`,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb items={[{ label: "Training" }, { label: "Programmes" }]} />

      <ContentCard
        title="Programmes"
        eyebrow="Catalogue"
        actions={<DensityToggle value={density} onChange={setDensity} />}
        flush
      >
        <div className="border-b border-border px-4 py-3">
          <FilterBar
            filters={chips}
            shown={rows.length}
            total={programmes.length}
            onRemove={(id) => setFacets((current) => ({ ...current, [id]: "ALL" }))}
            onClearAll={() => setFacets(EMPTY_FACETS)}
          >
            <FacetSelect
              label="Category"
              value={facets.category}
              onChange={(value) => setFacets((current) => ({ ...current, category: value }))}
              options={[
                { value: "ALL", label: "All categories" },
                ...categories.map((category) => ({ value: category, label: humanise(category) })),
              ]}
            />
            <FacetSelect
              label="HRDC"
              value={facets.claimable}
              onChange={(value) =>
                setFacets((current) => ({ ...current, claimable: value as ClaimableFilter }))
              }
              options={[
                { value: "ALL", label: "Any" },
                { value: "CLAIMABLE", label: "Claimable" },
                { value: "NOT_CLAIMABLE", label: "Not claimable" },
              ]}
            />
            <FacetSelect
              label="Duration"
              value={facets.duration}
              onChange={(value) =>
                setFacets((current) => ({ ...current, duration: value as DurationFilter }))
              }
              options={[
                { value: "ALL", label: "Any length" },
                { value: "1", label: "1 day" },
                { value: "2", label: "2 days" },
                { value: "3+", label: "3 days or more" },
              ]}
            />
          </FilterBar>
        </div>

        {isPending ? <LoadingState label="Loading programmes" /> : null}

        {isError ? (
          <ErrorState
            title="Could not load the catalogue"
            description={errorMessageOf(error)}
            onRetry={() => void refetch()}
          />
        ) : null}

        {!isPending && !isError ? (
          <DataTable
            label="Programmes"
            columns={columns}
            rows={rows}
            rowKey={(programme) => programme.id}
            density={density}
            onRowClick={(programme) => navigate(PROGRAMME_DETAIL_PATH(programme.ref))}
            empty={
              <EmptyState
                title="No programme matches these filters"
                description="Clear a filter to widen the catalogue."
              />
            }
          />
        ) : null}
      </ContentCard>
    </div>
  );
}

export default ProgrammesListPage;
