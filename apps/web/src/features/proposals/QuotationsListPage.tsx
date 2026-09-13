import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BindingFloorBasis, Quotation, QuotationStatus } from "@trainos/contract";
import { QUOTATION_STATUSES } from "@trainos/contract";
import {
  BINDING_FLOOR_TONE,
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
  PillTabGroup,
  QUOTATION_TONE,
  RecordHeader,
  StatusChip,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { useQuotations } from "./api";
import { COSTING_WORKSHEET_PATH } from "./paths";

/**
 * The quotation list — the half of M07-S03 the Finance nav leaf pointed at.
 *
 * Quotations live under Finance because that is where the navigation tree puts
 * them, even though Sales is their primary user. One tree, one path.
 *
 * The column this screen exists for is the binding floor. `Quotation` carries
 * both floors and the basis that decided between them, so the list can say
 * WHICH constraint is holding a price up — `MARGIN` meaning cost rather than
 * the tier, which is the case a pricer has to look at — instead of making
 * someone open every record to find out. That is the one place a second tone
 * is spent on this row, and it is spent on an exception.
 *
 * The rate card version is a machine value and stays mono, per §1. Money is a
 * right-aligned tabular column. Nothing here is a badge.
 *
 * The whole screen refuses for OPS: `quotation:read` is not granted to that
 * role, and the list is gated exactly as the record is. That refusal renders as
 * the kit's `ErrorState` carrying the server's own sentence, not as an empty
 * table — a policy decision the reader could act on must not look like absence.
 */

type StatusFilter = "ALL" | QuotationStatus;
type FloorFilter = "ALL" | BindingFloorBasis;

const FLOOR_LABEL: Record<BindingFloorBasis, string> = {
  ABSOLUTE: "Tier floor",
  MARGIN: "Margin floor",
};

export function QuotationsListPage() {
  useBreadcrumb([{ label: "Finance" }, { label: "Quotations" }]);

  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [floor, setFloor] = useState<FloorFilter>("ALL");
  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");

  const quotations = useQuotations();

  const all = useMemo(() => quotations.data?.data ?? [], [quotations.data]);

  const needle = search.trim().toLowerCase();

  const narrowed = all.filter((quotation) => {
    if (floor !== "ALL" && quotation.bindingFloorBasis !== floor) return false;
    if (needle.length === 0) return true;
    return (
      quotation.ref.toLowerCase().includes(needle) ||
      quotation.proposalRef.toLowerCase().includes(needle)
    );
  });

  const countOf = (id: StatusFilter) =>
    id === "ALL" ? narrowed.length : narrowed.filter((quotation) => quotation.status === id).length;

  const rows =
    status === "ALL" ? narrowed : narrowed.filter((quotation) => quotation.status === status);

  const chips: FilterChipModel[] = [];
  if (needle.length > 0) chips.push({ id: "query", label: "Search", value: search.trim() });
  if (floor !== "ALL") {
    chips.push({ id: "floor", label: "Binding floor", value: FLOOR_LABEL[floor] });
  }

  const columns: Column<Quotation>[] = [
    {
      key: "ref",
      label: "Quotation",
      accessor: (quotation) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px] font-medium text-ink">{quotation.ref}</p>
          <p className="truncate text-[12px] text-ink-muted">
            {"for "}
            <span className="font-mono">{quotation.proposalRef}</span>
            {` · ${quotation.lines.length} ${quotation.lines.length === 1 ? "line" : "lines"}`}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "180px",
      accessor: (quotation) => (
        <StatusChip tone={QUOTATION_TONE[quotation.status]}>
          {humanise(quotation.status)}
        </StatusChip>
      ),
    },
    {
      key: "bindingFloorBasis",
      label: "Binding floor",
      width: "148px",
      /* The one exception column. `MARGIN` means direct cost is holding the
         price up rather than the tier, and that is the row a pricer opens. */
      accessor: (quotation) => (
        <div className="flex flex-col items-start gap-1">
          <StatusChip tone={BINDING_FLOOR_TONE[quotation.bindingFloorBasis]}>
            {FLOOR_LABEL[quotation.bindingFloorBasis]}
          </StatusChip>
          <MoneyText value={quotation.floorPrice} className="tabular-nums text-[11px]" />
        </div>
      ),
    },
    {
      key: "sellPrice",
      label: "Sell price",
      width: "124px",
      align: "right",
      accessor: (quotation) => <MoneyText value={quotation.sellPrice} className="tabular-nums" />,
    },
    {
      key: "marginRate",
      label: "Margin",
      width: "88px",
      align: "right",
      accessor: (quotation) => (
        <span className="tabular-nums text-[13px] text-ink">
          {`${Math.round(quotation.marginRate * 100)}%`}
        </span>
      ),
    },
    {
      key: "commission",
      label: "Commission",
      width: "132px",
      align: "right",
      accessor: (quotation) => (
        <div className="tabular-nums">
          <MoneyText value={quotation.commission} className="tabular-nums" />
          <p className="text-[11px] text-ink-muted">
            {`on ${humanise(quotation.commissionPayableOn).toLowerCase()}`}
          </p>
        </div>
      ),
    },
    {
      key: "rateCardVersion",
      label: "Rate card",
      width: "112px",
      accessor: (quotation) => (
        <span className="whitespace-nowrap font-mono text-[12px] text-ink-secondary">
          {quotation.rateCardVersion}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Quotations"
        withoutCondensed
        meta={[
          `${all.length} ${all.length === 1 ? "quotation" : "quotations"}`,
          `${all.filter((quotation) => quotation.bindingFloorBasis === "MARGIN").length} held up by margin`,
        ]}
        actions={<DensityToggle value={density} onChange={setDensity} />}
      />

      <div className="px-5 pb-3">
        <PillTabGroup
          label="Quotation status"
          activeId={status}
          onSelect={(id) => setStatus(id as StatusFilter)}
          tabs={[
            { id: "ALL", label: "All", count: countOf("ALL") },
            ...QUOTATION_STATUSES.map((value) => ({
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
          total={all.length}
          onRemove={(id) => (id === "query" ? setSearch("") : setFloor("ALL"))}
          onClearAll={() => {
            setSearch("");
            setFloor("ALL");
          }}
        >
          <FilterSearch
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder="Quotation or proposal reference"
          />
          <FilterSelect
            label="Binding floor"
            value={floor}
            onChange={(value) => setFloor(value as FloorFilter)}
            options={[
              { value: "ALL", label: "Either floor" },
              { value: "MARGIN", label: FLOOR_LABEL.MARGIN },
              { value: "ABSOLUTE", label: FLOOR_LABEL.ABSOLUTE },
            ]}
          />
        </FilterBar>
      </div>

      <div className="pt-3">
        {quotations.isPending ? <LoadingState rows={6} label="Loading the quotations" /> : null}

        {/* A refusal renders as itself. `quotation:read` is withheld from OPS,
            and `ErrorState` shows the server's own sentence for a domain error
            — retry is offered only where retrying could help, which R2 says a
            refusal never is. */}
        {quotations.isError ? (
          <ErrorState
            title="The quotations could not be loaded"
            error={toApiError(quotations.error)}
          />
        ) : null}

        {!quotations.isPending && !quotations.isError ? (
          <DataTable
            label="Quotations"
            columns={columns}
            rows={rows}
            rowKey={(quotation) => quotation.id}
            density={density}
            onRowClick={(quotation) => navigate(COSTING_WORKSHEET_PATH(quotation.ref))}
            empty={
              <EmptyState
                title="No quotation matches these filters"
                description="Clear a filter, or widen the status tab, to see the rest."
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}

export default QuotationsListPage;
