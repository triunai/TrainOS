import { useMemo, useState } from "react";
import type { Engagement, EngagementStatus, Money, Programme } from "@trainos/contract";
import {
  ContentCard,
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  FilterSearch,
  FilterSelect,
  ListToolbar,
  LoadingState,
  MoneyText,
  PairedBars,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  formatMoney,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
  type PairedBarsPoint,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { useEngagements, useProgrammeCatalogue, useRateCard } from "./reporting.api";
import { formatRate } from "./rate";

/**
 * Finance › Profitability.
 *
 * No artboard. The composition is the Collections page again — title, human
 * summary, tabs, one table — because CLAUDE.md says a pattern that works on
 * three screens becomes the pattern, not because margin resembles collections.
 *
 * Two rules shape what is on it.
 *
 * The FLOOR is configuration. `rateCard.marginFloorPct` carries a percentage
 * per programme type, and a floor typed into this file is a floor that stops
 * matching Finance's the day they change it, with nothing on screen to say so.
 * The programme's own `floorMarginRate` is the fallback, and the screen says
 * which one it used.
 *
 * A MISSING margin is not a margin of zero. The API drops the whole `finance`
 * block from an engagement for a principal without `quotation:read` rather than
 * zeroing it, so a row with no finance block means "you may not see this" and
 * must never render as a deal that made nothing. Cancelled engagements are the
 * mirror image: they carry a real zero, which is why they are their own tab and
 * are kept out of the blended figures instead of dragging them down.
 *
 * The comparison is a `PairedBars` of revenue against direct cost per
 * programme, which is the one place a chart says something a column of numbers
 * does not: the gap between the two columns IS the margin, read as a shape.
 * Everything else on the page is typography, per the tightening brief §16.
 */

const TABS = {
  realised: "Realised",
  forecast: "Forecast",
  cancelled: "Cancelled",
  all: "All",
} as const;

type TabId = keyof typeof TABS;

/** Delivered and closed engagements have a margin that happened. */
const REALISED: ReadonlySet<EngagementStatus> = new Set(["DELIVERED", "CLOSED"]);
/** Everything still ahead of delivery is a forecast, not a result. */
const FORECAST: ReadonlySet<EngagementStatus> = new Set([
  "PROPOSED",
  "CONFIRMED",
  "SCHEDULED",
  "IN_DELIVERY",
]);

function tabOf(engagement: Engagement): Exclude<TabId, "all"> {
  if (engagement.status === "CANCELLED") return "cancelled";
  return REALISED.has(engagement.status) ? "realised" : "forecast";
}

/** One engagement's money, with the floor it is measured against. */
interface Row {
  engagement: Engagement;
  programme: Programme | undefined;
  /** Absent where the principal may not read the finance block. */
  marginRate: number | undefined;
  margin: Money | undefined;
  directCost: Money | undefined;
  floor: number | undefined;
  floorSource: "RATE_CARD" | "PROGRAMME" | undefined;
  belowFloor: boolean;
}

const money = (amount: number): Money => ({ amount, currency: "MYR" });

export function ProfitabilityScreen() {
  useBreadcrumb([{ label: "Finance" }, { label: "Profitability" }]);

  const engagements = useEngagements();
  const programmes = useProgrammeCatalogue();
  const rateCard = useRateCard();
  /* The account is the fact the subline is for. The engagement carries only a
     ref, and a reader cannot tell two "Leading Through Change" deliveries
     apart by their programme — only by whose they are. */
  const directory = useOrganisationDirectory();

  const [tab, setTab] = useState<TabId>("realised");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [density, setDensity] = useState<Density>("comfortable");

  const catalogue = useMemo(() => {
    const index = new Map<string, Programme>();
    for (const programme of programmes.data?.data ?? []) index.set(programme.ref, programme);
    return index;
  }, [programmes.data]);

  const rows = useMemo<Row[]>(() => {
    const floors = rateCard.data?.marginFloorPct ?? [];
    return (engagements.data?.data ?? []).map((engagement): Row => {
      const programme = catalogue.get(engagement.programmeRef);
      const finance = engagement.finance;

      /* The block is optional on the projection and its absence is a refusal,
         so nothing below may substitute a zero for it. */
      if (!finance) {
        return {
          engagement,
          programme,
          marginRate: undefined,
          margin: undefined,
          directCost: undefined,
          floor: undefined,
          floorSource: undefined,
          belowFloor: false,
        };
      }

      const marginRate = finance.realisedMarginRate;
      const margin = money(Math.round(engagement.value.amount * marginRate));
      const directCost = money(engagement.value.amount - margin.amount);

      const configured = programme
        ? floors.find((entry) => entry.programmeType === programme.category)
        : undefined;
      const floor = configured?.pct ?? programme?.floorMarginRate;
      const floorSource = configured ? "RATE_CARD" : programme ? "PROGRAMME" : undefined;

      return {
        engagement,
        programme,
        marginRate,
        margin,
        directCost,
        floor,
        floorSource,
        /* A cancelled engagement has a real zero margin and is not a pricing
           failure, so it is never flagged as breaching a floor. */
        belowFloor: engagement.status !== "CANCELLED" && floor !== undefined && marginRate < floor,
      };
    });
  }, [engagements.data, catalogue, rateCard.data]);

  const categories = useMemo(
    () =>
      [...new Set(rows.map((row) => row.programme?.category).filter(Boolean))].sort() as string[],
    [rows],
  );

  const narrowed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (category !== "ALL" && row.programme?.category !== category) return false;
      if (needle === "") return true;
      return (
        row.engagement.title.toLowerCase().includes(needle) ||
        row.engagement.ref.toLowerCase().includes(needle) ||
        (row.programme?.name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, category, query]);

  const countOf = (id: TabId) =>
    id === "all" ? narrowed.length : narrowed.filter((row) => tabOf(row.engagement) === id).length;

  const visible = useMemo(
    () => (tab === "all" ? narrowed : narrowed.filter((row) => tabOf(row.engagement) === tab)),
    [narrowed, tab],
  );

  /* The headline reads the realised rows only. Blending a cancelled deal's
     honest zero into the margin would report a business that lost money it
     never spent. */
  const realised = rows.filter((row) => tabOf(row.engagement) === "realised" && row.margin);
  const revenue = realised.reduce((total, row) => total + row.engagement.value.amount, 0);
  const marginTotal = realised.reduce((total, row) => total + (row.margin?.amount ?? 0), 0);
  const blended = revenue === 0 ? 0 : marginTotal / revenue;
  const breaching = rows.filter((row) => row.belowFloor);
  const withheld = rows.filter((row) => row.marginRate === undefined);

  const chartPoints = useMemo<PairedBarsPoint[]>(() => {
    const byProgramme = new Map<string, { label: string; revenue: number; cost: number }>();
    for (const row of realised) {
      const key = row.programme?.ref ?? row.engagement.programmeRef;
      const entry = byProgramme.get(key) ?? {
        label: row.programme?.name ?? key,
        revenue: 0,
        cost: 0,
      };
      entry.revenue += row.engagement.value.amount;
      entry.cost += row.directCost?.amount ?? 0;
      byProgramme.set(key, entry);
    }
    return [...byProgramme.entries()].map(([key, entry]) => ({
      key,
      /* The axis has room for a word, not a title. The full name is in the
         table directly beneath, so nothing is lost by shortening it here. */
      label: entry.label.split(" ").slice(0, 2).join(" "),
      values: [entry.revenue, entry.cost],
    }));
  }, [realised]);

  const chips: FilterChipModel[] = [];
  if (query.trim().length > 0) chips.push({ id: "query", label: "Search", value: query.trim() });
  if (category !== "ALL") {
    chips.push({ id: "category", label: "Programme type", value: humanise(category) });
  }

  const columns: Column<Row>[] = [
    {
      key: "engagement",
      label: "Engagement",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{row.engagement.title}</p>
          <p className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{row.engagement.ref}</span>
            {` · ${directory.nameOf(row.engagement.organisationRef)}`}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "116px",
      accessor: (row) => (
        <span className="text-[13px] text-ink-secondary">{humanise(row.engagement.status)}</span>
      ),
    },
    {
      key: "value",
      label: "Revenue",
      width: "124px",
      align: "right",
      sortable: true,
      accessor: (row) => <MoneyText value={row.engagement.value} className="tabular-nums" />,
    },
    {
      key: "cost",
      label: "Direct cost",
      width: "124px",
      align: "right",
      accessor: (row) =>
        row.directCost ? (
          <MoneyText value={row.directCost} className="tabular-nums" />
        ) : (
          <Withheld />
        ),
    },
    {
      key: "margin",
      label: "Margin",
      width: "124px",
      align: "right",
      accessor: (row) =>
        row.margin ? <MoneyText value={row.margin} className="tabular-nums" /> : <Withheld />,
    },
    {
      key: "marginRate",
      label: "Margin %",
      width: "150px",
      align: "right",
      sortable: true,
      /* The number is typography and only the exception gets a component: a
         margin above its floor is a figure, a margin below it is an event. */
      accessor: (row) => {
        if (row.marginRate === undefined) return <Withheld />;
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="tabular-nums text-[13px] text-ink">{formatRate(row.marginRate)}</span>
            {row.belowFloor ? (
              <StatusChip tone="danger">{`${formatRate(row.floor ?? 0)} floor`}</StatusChip>
            ) : (
              <span className="text-[11px] text-ink-muted">
                {row.floor === undefined ? "no floor set" : `floor ${formatRate(row.floor)}`}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "trainerPayable",
      label: "Trainer payable",
      width: "140px",
      align: "right",
      accessor: (row) =>
        row.engagement.finance ? (
          <MoneyText
            value={row.engagement.finance.trainerPayable}
            dashWhenZero
            className="tabular-nums"
          />
        ) : (
          <Withheld />
        ),
    },
  ];

  const loading = engagements.isPending || programmes.isPending || rateCard.isPending;
  const failed = engagements.error ?? programmes.error ?? rateCard.error;

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Profitability"
        withoutCondensed
        meta={[
          `${realised.length} realised engagements`,
          `${formatMoney(money(revenue))} revenue`,
          `${formatRate(blended)} blended margin`,
          breaching.length > 0 ? `${breaching.length} below floor` : "none below floor",
        ]}
        actions={<DensityToggle value={density} onChange={setDensity} />}
      />

      {withheld.length > 0 ? (
        <div className="px-5 pb-1">
          <ExceptionBanner
            severity="INFO"
            title={`${withheld.length} of ${rows.length} engagements are showing no margin`}
            subtitle="The API returns an engagement without its finance block to a principal who may not read a quotation, so these rows have no margin to show rather than a margin of zero. Switch to a finance or executive role to see them."
          />
        </div>
      ) : null}

      {breaching.length > 0 ? (
        <div className="px-5 pb-1">
          <ExceptionBanner
            severity="WARN"
            title={`${breaching.length} engagement${breaching.length === 1 ? "" : "s"} delivered below the margin floor`}
            subtitle={`${breaching
              .map((row) => `${row.engagement.ref} at ${formatRate(row.marginRate ?? 0)}`)
              .join(", ")}. The floor is ${
              breaching[0]?.floorSource === "RATE_CARD"
                ? "the rate card's marginFloorPct for the programme type"
                : "the programme's own floorMarginRate"
            }, so it moves when Finance moves it.`}
          />
        </div>
      ) : null}

      <ListToolbar
        tabs={
          <PillTabGroup
            label="Engagement stage"
            activeId={tab}
            onSelect={(value) => setTab(value as TabId)}
            tabs={(Object.keys(TABS) as TabId[]).map((value) => ({
              id: value,
              label: TABS[value],
              count: countOf(value),
            }))}
          />
        }
        filters={
          <FilterBar
            filters={chips}
            shown={visible.length}
            total={rows.length}
            onRemove={(id) => {
              if (id === "query") setQuery("");
              if (id === "category") setCategory("ALL");
            }}
            onClearAll={() => {
              setQuery("");
              setCategory("ALL");
            }}
          >
            <FilterSearch
              label="Search engagements"
              labelHidden
              value={query}
              onChange={setQuery}
              placeholder="Engagement or programme"
            />
            <FilterSelect
              label="Type"
              value={category}
              onChange={setCategory}
              options={[
                { value: "ALL", label: "Any type" },
                ...categories.map((value) => ({ value, label: humanise(value) })),
              ]}
            />
          </FilterBar>
        }
      />

      {loading ? <LoadingState rows={6} label="Loading engagement profitability" /> : null}

      {failed ? (
        <ErrorState
          title="Profitability could not be loaded"
          error={toApiError(failed)}
          onRetry={() => {
            void engagements.refetch();
            void programmes.refetch();
            void rateCard.refetch();
          }}
        />
      ) : null}

      {!loading && !failed ? (
        <>
          <DataTable
            label="Engagement profitability"
            columns={columns}
            rows={visible}
            rowKey={(row) => row.engagement.id}
            density={density}
            empty={
              <EmptyState
                title="No engagement in this stage"
                description="Nothing matches the current search and programme type. Widen the filter or choose another tab."
              />
            }
          />

          {chartPoints.length > 0 ? (
            <div className="px-5 py-5">
              <ContentCard
                title="Revenue against direct cost"
                actions={
                  <span className="text-[12px] text-ink-muted">
                    realised engagements, by programme
                  </span>
                }
              >
                <PairedBars
                  label="Revenue against direct cost by programme"
                  points={chartPoints}
                  series={[
                    { label: "Revenue", tone: "ink" },
                    { label: "Direct cost", tone: "track" },
                  ]}
                  formatValue={(value, series) => `${formatMoney(money(value), true)} ${series}`}
                />
                <p className="pt-3 text-[12px] text-ink-secondary">
                  The gap between the two columns is the margin. Direct cost is revenue less the
                  realised margin the API reports, so it is the same figure the table states as a
                  percentage — not a second measurement that could disagree with it.
                </p>
              </ContentCard>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** A fact this principal may not read. Not a zero, and never rendered as one. */
function Withheld() {
  return (
    <span className="text-[13px] text-ink-muted" title="Not visible to your role">
      not shown
    </span>
  );
}

export default ProfitabilityScreen;
