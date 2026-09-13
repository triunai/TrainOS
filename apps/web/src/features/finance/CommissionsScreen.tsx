import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Money } from "@trainos/contract";
import type { FixtureCommission } from "@trainos/fixtures";
import {
  DataTable,
  DateText,
  DensityToggle,
  Drawer,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  FilterSearch,
  FilterSelect,
  ListToolbar,
  LoadingState,
  MoneyText,
  PillTabGroup,
  RecordHeader,
  RefChip,
  SecondaryButton,
  StatusChip,
  formatMoney,
  type Column,
  type Density,
  type FilterChipModel,
  type StatusTone,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { useCommissions } from "./reporting.api";
import { formatRate } from "./rate";
import { INVOICES_PATH } from "./paths";

/**
 * Finance › Commissions.
 *
 * No artboard: the design pack draws twenty-six screens and this is not one of
 * them, so the composition is the Collections page (M13-S05) applied to a
 * different question — title, human summary, segmented tabs, one table — and
 * the tightening brief §18 decides what the page leads with.
 *
 * The question it answers, in order: how much commission is payable right now,
 * how much is merely accrued, and is any of it at risk. Those are three
 * different amounts and a single "total commission" figure is the answer to
 * none of them — an accrual whose invoice is 78 days overdue is not money the
 * business has, and a forecast on a deal nobody has won is not money at all.
 *
 * The machinery — which configuration supplied the rate, what the gate is,
 * which invoice the gate is waiting on — is one click away in the row drawer,
 * per §18. On the page itself the rate is a number beside the amount, because
 * a reader who sees 2% on the largest deal needs to see WHY without opening
 * anything, and the answer is that the deal belongs to a sales manager.
 */

const TABS = {
  payable: "Payable",
  accrued: "Accrued",
  risk: "At risk",
  forecast: "Forecast",
  all: "All",
} as const;

type TabId = keyof typeof TABS;

const TAB_STATUS: Record<Exclude<TabId, "all">, FixtureCommission["status"]> = {
  payable: "PAYABLE",
  accrued: "ACCRUED",
  risk: "AT_RISK",
  forecast: "FORECAST",
};

/** Status colour lives on chips, and only where the state is an event. */
const STATUS_TONE: Record<FixtureCommission["status"], StatusTone> = {
  PAYABLE: "success",
  ACCRUED: "neutral",
  AT_RISK: "danger",
  FORECAST: "info",
};

const STATUS_LABEL: Record<FixtureCommission["status"], string> = {
  PAYABLE: "Payable",
  ACCRUED: "Accrued",
  AT_RISK: "At risk",
  FORECAST: "Forecast",
};

const BASIS_LABEL: Record<FixtureCommission["rateBasis"], string> = {
  QUOTATION: "from the quotation",
  RATE_CARD: "from the rate card",
};

/** The same fact in a cell, where three wrapped lines would cost more than it. */
const BASIS_SHORT: Record<FixtureCommission["rateBasis"], string> = {
  QUOTATION: "quotation",
  RATE_CARD: "rate card",
};

const sum = (rows: FixtureCommission[]): Money => ({
  amount: rows.reduce((total, row) => total + row.amount.amount, 0),
  currency: "MYR",
});

/**
 * The sentence under the row's status — what has to happen for it to be paid.
 *
 * Written per state rather than as one template with holes in it, because the
 * four states are four different facts and a generic "pending" says none of
 * them.
 */
function gateOf(row: FixtureCommission): string {
  switch (row.status) {
    case "PAYABLE":
      return `Collected in full`;
    case "ACCRUED":
      return row.daysOverdue === null
        ? `On collection of ${row.invoiceRef}`
        : `${row.invoiceRef} is ${row.daysOverdue} days overdue`;
    case "AT_RISK":
      return `${row.invoiceRef} is ${row.daysOverdue} days overdue, past the trading-hold rung`;
    case "FORECAST":
      return "Not won — no invoice raised";
  }
}

export function CommissionsScreen() {
  useBreadcrumb([{ label: "Finance" }, { label: "Commissions" }]);

  const navigate = useNavigate();
  const commissions = useCommissions();

  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("ALL");
  const [density, setDensity] = useState<Density>("comfortable");
  const [openRow, setOpenRow] = useState<FixtureCommission | null>(null);
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "amount",
    direction: "desc",
  });

  const all = useMemo(() => commissions.data?.data ?? [], [commissions.data]);

  const owners = useMemo(
    () => [...new Map(all.map((row) => [row.owner.id, row.owner])).values()],
    [all],
  );

  /* Narrowed first, then tabbed, so a tab count answers "how many of the rows
     I can currently see" rather than "how many exist". */
  const narrowed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((row) => {
      if (owner !== "ALL" && row.owner.id !== owner) return false;
      if (needle === "") return true;
      return (
        row.organisation.name.toLowerCase().includes(needle) ||
        row.engagementRef.toLowerCase().includes(needle) ||
        (row.invoiceRef ?? "").toLowerCase().includes(needle)
      );
    });
  }, [all, owner, query]);

  const countOf = (id: TabId) =>
    id === "all" ? narrowed.length : narrowed.filter((row) => row.status === TAB_STATUS[id]).length;

  const rows = useMemo(() => {
    const tabbed =
      tab === "all" ? narrowed : narrowed.filter((row) => row.status === TAB_STATUS[tab]);
    const read = (row: FixtureCommission) =>
      sort.key === "dealValue" ? row.dealValue.amount : row.amount.amount;
    return [...tabbed].sort((left, right) =>
      sort.direction === "asc" ? read(left) - read(right) : read(right) - read(left),
    );
  }, [narrowed, tab, sort]);

  const payable = sum(all.filter((row) => row.status === "PAYABLE"));
  const accrued = sum(all.filter((row) => row.status === "ACCRUED"));
  const atRisk = all.filter((row) => row.status === "AT_RISK");

  const chips: FilterChipModel[] = [];
  if (query.trim().length > 0) chips.push({ id: "query", label: "Search", value: query.trim() });
  if (owner !== "ALL") {
    chips.push({
      id: "owner",
      label: "Owner",
      value: owners.find((actor) => actor.id === owner)?.name ?? owner,
    });
  }

  const columns: Column<FixtureCommission>[] = [
    {
      key: "deal",
      label: "Deal",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{row.organisation.name}</p>
          <p className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{row.engagementRef}</span>
            {row.quotationRef ? (
              <>
                {" · "}
                <span className="font-mono">{row.quotationRef}</span>
              </>
            ) : null}
          </p>
        </div>
      ),
    },
    {
      key: "owner",
      label: "Owner",
      width: "150px",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-ink">{row.owner.name}</p>
          <p className="truncate text-[11px] text-ink-muted">
            {row.ownerRole === "SALES_MANAGER" ? "Sales manager" : "Sales"}
          </p>
        </div>
      ),
    },
    {
      key: "dealValue",
      label: "Deal value",
      width: "124px",
      align: "right",
      sortable: true,
      accessor: (row) => <MoneyText value={row.dealValue} className="tabular-nums" />,
    },
    {
      key: "rate",
      label: "Rate",
      width: "128px",
      align: "right",
      /* The rate earns its own column because it is not a constant: it comes
         from the quotation or from the rate card, and on this dataset the two
         disagree by a factor of four. A commission shown without it reads as
         arithmetic nobody can check. */
      accessor: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-[13px] text-ink">{formatRate(row.rate)}</p>
          <p className="text-[11px] text-ink-muted">{BASIS_SHORT[row.rateBasis]}</p>
        </div>
      ),
    },
    {
      key: "amount",
      label: "Commission",
      width: "132px",
      align: "right",
      sortable: true,
      accessor: (row) => <MoneyText value={row.amount} className="tabular-nums" />,
    },
    {
      key: "status",
      label: "Status",
      width: "260px",
      accessor: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusChip tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</StatusChip>
          <span className="text-[11px] text-ink-muted">{gateOf(row)}</span>
        </div>
      ),
    },
    {
      key: "collectedAt",
      label: "Collected",
      width: "112px",
      accessor: (row) =>
        row.collectedAt ? (
          <DateText value={row.collectedAt} />
        ) : (
          <span className="text-[13px] text-ink-muted">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col">
      {/* The human summary §18 asks for, as the header's own meta line. No
          PageHeader exists: a list screen is a RecordHeader with no record. */}
      <RecordHeader
        title="Commissions"
        withoutCondensed
        meta={[
          `${all.length} accruals`,
          `${payable.amount === 0 ? "nothing" : formatMoney(payable)} payable`,
          `${formatMoney(accrued)} accrued`,
          atRisk.length > 0 ? `${atRisk.length} at risk` : null,
        ]}
        actions={
          <SecondaryButton onClick={() => navigate(INVOICES_PATH)}>Invoices</SecondaryButton>
        }
      />

      {atRisk.length > 0 ? (
        <div className="px-5 pb-1">
          <ExceptionBanner
            severity="WARN"
            title={`${formatMoney(sum(atRisk))} of commission sits behind an invoice past the trading-hold rung`}
            subtitle={`${atRisk
              .map((row) => `${row.organisation.name} · ${row.invoiceRef}`)
              .join(", ")}. Commission on these deals is payable on collection, so it is not
              merely late — it is money that may never be earned. The rung comes from the
              collection rules, not from a threshold set here.`}
          />
        </div>
      ) : null}

      <ListToolbar
        tabs={
          <PillTabGroup
            label="Commission status"
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
            total={all.length}
            onRemove={(id) => {
              if (id === "query") setQuery("");
              if (id === "owner") setOwner("ALL");
            }}
            onClearAll={() => {
              setQuery("");
              setOwner("ALL");
            }}
          >
            <FilterSearch
              label="Search commissions"
              labelHidden
              value={query}
              onChange={setQuery}
              placeholder="Account"
            />
            <FilterSelect
              label="Owner"
              value={owner}
              onChange={setOwner}
              options={[
                { value: "ALL", label: "Anyone" },
                ...owners.map((actor) => ({ value: actor.id, label: actor.name })),
              ]}
            />
          </FilterBar>
        }
        actions={<DensityToggle value={density} onChange={setDensity} />}
      />

      {commissions.isPending ? <LoadingState rows={6} label="Loading commission accruals" /> : null}

      {commissions.isError ? (
        <ErrorState
          title="Commission accruals could not be loaded"
          error={toApiError(commissions.error)}
          onRetry={() => void commissions.refetch()}
        />
      ) : null}

      {!commissions.isPending && !commissions.isError ? (
        <DataTable
          label="Commission accruals"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          density={density}
          sortKey={sort.key}
          sortDirection={sort.direction}
          onSort={(key) =>
            setSort((current) =>
              current.key === key
                ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
                : { key, direction: "desc" },
            )
          }
          onRowClick={(row) => setOpenRow(row)}
          empty={
            <EmptyState
              title="Nothing in this bucket"
              description="No deal is in this state for the current owner and search. Widen the filter or choose another tab."
            />
          }
        />
      ) : null}

      <CommissionDrawer row={openRow} onClose={() => setOpenRow(null)} />
    </div>
  );
}

/**
 * The machinery, one click away — §18's "hide it until somebody needs it".
 *
 * It shows the sum as a sum: the sell price, the rate, where the rate came
 * from, and the gate. A commission figure that cannot be recomputed by the
 * person reading it is a number they have to take on trust, and Finance does
 * not take numbers on trust.
 */
function CommissionDrawer({
  row,
  onClose,
}: {
  row: FixtureCommission | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  if (!row) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${row.organisation.name} · commission`}
      subtitle={`${row.engagementRef}${row.quotationRef ? ` · ${row.quotationRef}` : ""}`}
      width="460px"
      footer={
        row.invoiceRef ? (
          <SecondaryButton onClick={() => navigate(`${INVOICES_PATH}/${row.invoiceRef}`)}>
            Open invoice
          </SecondaryButton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink">How it was calculated</h3>
          <dl className="flex flex-col gap-1.5 text-[13px]">
            <Line term="Sell price" value={<MoneyText value={row.dealValue} />} />
            <Line
              term="Commission rate"
              value={
                <span className="tabular-nums">
                  {formatRate(row.rate)}
                  <span className="text-ink-muted"> · {BASIS_LABEL[row.rateBasis]}</span>
                </span>
              }
            />
            <Line
              term="Rate card"
              value={<span className="font-mono text-[12px]">{row.rateCardVersion}</span>}
            />
            <Line
              term="Commission"
              value={<MoneyText value={row.amount} className="font-medium" />}
            />
          </dl>
          {row.rateCardVersion === "v0-placeholder" ? (
            <p className="text-[12px] text-ink-muted">
              The rate card is still the placeholder version. Finance has not supplied real figures,
              so every rate on this page is the seeded one.
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink">When it becomes payable</h3>
          <dl className="flex flex-col gap-1.5 text-[13px]">
            <Line
              term="Gate"
              value={row.payableOn === "COLLECTION" ? "On collection" : "On invoice"}
            />
            <Line
              term="Invoice"
              value={
                row.invoiceRef ? (
                  <RefChip refValue={row.invoiceRef} />
                ) : (
                  <span className="text-ink-muted">none raised</span>
                )
              }
            />
            <Line
              term="Outstanding"
              value={
                row.outstanding ? (
                  <MoneyText value={row.outstanding} dashWhenZero />
                ) : (
                  <span className="text-ink-muted">—</span>
                )
              }
            />
            <Line
              term="Collected"
              value={
                row.collectedAt ? (
                  <DateText value={row.collectedAt} withTime />
                ) : (
                  <span className="text-ink-muted">not yet</span>
                )
              }
            />
          </dl>
          <p className="text-[12px] text-ink-secondary">{gateOf(row)}.</p>
        </section>
      </div>
    </Drawer>
  );
}

function Line({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{term}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

export default CommissionsScreen;
