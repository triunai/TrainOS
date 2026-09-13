import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FixtureTrainer } from "@trainos/fixtures";
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
  PillTabGroup,
  RecordHeader,
  StatusChip,
  formatDate,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { todayKey } from "@/features/calendar";
import { useTrainers } from "./api";
import { accreditationOf, nextBookedDay } from "./accreditation";
import { trainerPath } from "./paths";

/**
 * `/training/trainers` — the pool, and who can be put in front of a claimable
 * course. Template 1, "list + filter bar", with no artboard to transcribe.
 *
 * The accreditation column is the reason this screen is not just a contact
 * list. Two gates decide it and they are independent (see `accreditation.ts`),
 * so the chip carries the one that would stop a booking.
 */

const ANY = "ALL";

/**
 * The three subsets a reader asks for, as the toolbar's saved-view switcher.
 *
 * "Needs attention" is the whole reason this list is not a contact list, so it
 * is a tab with a count rather than a facet buried in a select: a count the
 * reader can see without opening anything is what makes the gap actionable.
 */
const TABS = { all: "All", claimable: "Claim-eligible", attention: "Needs attention" } as const;

type TabId = keyof typeof TABS;

interface Facets {
  band: string;
  query: string;
}

const EMPTY_FACETS: Facets = { band: ANY, query: "" };

export function TrainersListPage() {
  useBreadcrumb([{ label: "Training" }, { label: "Trainers" }]);

  const navigate = useNavigate();
  const today = useMemo(() => todayKey(), []);
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [tab, setTab] = useState<TabId>("all");
  const [density, setDensity] = useState<Density>("comfortable");
  const { data, isPending, isError, error, refetch } = useTrainers();

  const trainers = useMemo(() => data?.data ?? [], [data]);
  const bands = useMemo(
    () => [...new Set(trainers.map((trainer) => trainer.bands))].sort(),
    [trainers],
  );

  const inTab = useMemo(
    () =>
      trainers.filter((trainer) => {
        if (tab === "all") return true;
        const { claimable } = accreditationOf(trainer, today);
        return tab === "claimable" ? claimable : !claimable;
      }),
    [trainers, tab, today],
  );

  const rows = useMemo(() => {
    const needle = facets.query.trim().toLowerCase();
    return inTab.filter((trainer) => {
      if (facets.band !== ANY && trainer.bands !== facets.band) return false;
      if (needle.length === 0) return true;
      return (
        trainer.name.toLowerCase().includes(needle) ||
        trainer.ref.toLowerCase().includes(needle) ||
        trainer.email.toLowerCase().includes(needle)
      );
    });
  }, [inTab, facets]);

  const countOf = (id: TabId): number =>
    trainers.filter((trainer) => {
      if (id === "all") return true;
      const { claimable } = accreditationOf(trainer, today);
      return id === "claimable" ? claimable : !claimable;
    }).length;

  const chips: FilterChipModel[] = [];
  if (facets.band !== ANY) chips.push({ id: "band", label: "Band", value: facets.band });
  if (facets.query.trim().length > 0) {
    chips.push({ id: "query", label: "Search", value: facets.query.trim() });
  }

  const columns: Column<FixtureTrainer>[] = [
    {
      key: "name",
      label: "Trainer",
      accessor: (trainer) => (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-ink">{trainer.name}</div>
          {/* §16: the ref is machine-ish and stays mono; everything else is UI font. */}
          <div className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{trainer.ref}</span>
            {` · ${trainer.email}`}
          </div>
        </div>
      ),
    },
    {
      key: "band",
      label: "Band",
      width: "72px",
      accessor: (trainer) => <span className="text-[13px] text-ink">{trainer.bands}</span>,
    },
    {
      key: "accreditation",
      label: "Accreditation",
      width: "184px",
      accessor: (trainer) => {
        const accreditation = accreditationOf(trainer, today);
        return <StatusChip tone={accreditation.tone}>{accreditation.label}</StatusChip>;
      },
    },
    {
      key: "programmes",
      label: "Programmes",
      width: "104px",
      align: "right",
      accessor: (trainer) => (
        <span className="tabular-nums text-[13px] text-ink">{trainer.programmeRefs.length}</span>
      ),
    },
    {
      key: "next",
      label: "Next booked",
      width: "132px",
      accessor: (trainer) => {
        const next = nextBookedDay(trainer, today);
        return (
          <span className="text-[13px] text-ink-secondary">{next ? formatDate(next) : "Free"}</span>
        );
      },
    },
    {
      key: "rating",
      label: "Rating",
      width: "84px",
      align: "right",
      sortable: true,
      accessor: (trainer) => (
        <span className="tabular-nums text-[13px] text-ink">{trainer.rating.toFixed(1)}</span>
      ),
    },
  ];

  const attention = trainers.filter((trainer) => !accreditationOf(trainer, today).claimable).length;

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Trainers"
        withoutCondensed
        meta={[
          `${trainers.length} in the pool`,
          attention === 0 ? "all claim-eligible" : `${attention} cannot be cited on a claim`,
        ]}
      />

      <div className="border-b border-border px-5 py-3">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Trainer pool"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={(Object.keys(TABS) as TabId[]).map((id) => ({
                id,
                label: TABS[id],
                count: countOf(id),
              }))}
            />
          }
          filters={
            <FilterBar
              filters={chips}
              shown={rows.length}
              total={inTab.length}
              onRemove={(id) =>
                setFacets((current) => ({ ...current, [id]: id === "query" ? "" : ANY }))
              }
              onClearAll={() => setFacets(EMPTY_FACETS)}
            >
              <FilterSearch
                label="Search trainers"
                value={facets.query}
                onChange={(query) => setFacets((current) => ({ ...current, query }))}
                placeholder="Name, ref or email"
              />
              <FilterSelect
                label="Band"
                value={facets.band}
                onChange={(band) => setFacets((current) => ({ ...current, band }))}
                options={[
                  { value: ANY, label: "Any band" },
                  ...bands.map((band) => ({ value: band, label: `Band ${band}` })),
                ]}
              />
            </FilterBar>
          }
          actions={<DensityToggle value={density} onChange={setDensity} />}
        />
      </div>

      {isPending ? <LoadingState label="Loading the trainer pool" /> : null}

      {isError ? (
        <ErrorState
          title="The trainer pool could not be loaded"
          error={toApiError(error)}
          onRetry={() => void refetch()}
        />
      ) : null}

      {!isPending && !isError ? (
        <DataTable
          label="Trainers"
          columns={columns}
          rows={rows}
          rowKey={(trainer) => trainer.id}
          density={density}
          onRowClick={(trainer) => navigate(trainerPath(trainer.ref))}
          empty={
            trainers.length === 0 ? (
              <EmptyState
                title="No trainers yet"
                description="Trainers appear here once they are added to the pool and their accreditation is recorded."
              />
            ) : (
              <EmptyState
                title="No trainer matches these filters"
                description="Clear a filter to widen the pool."
              />
            )
          }
        />
      ) : null}
    </div>
  );
}

export default TrainersListPage;
