import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Invoice, InvoiceStatus } from "@trainos/contract";
import {
  DataTable,
  DateText,
  DensityToggle,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSearch,
  FilterSelect,
  INVOICE_TONE,
  ListToolbar,
  LoadingState,
  MoneyText,
  PartialDataBanner,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  SYNC_TONE,
  formatMoney,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
  type PartialRead,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { useInvoices } from "./api";
import { INVOICES_PATH } from "./paths";

/**
 * `/finance/invoices` — the list half of Invoices.
 *
 * The leaf used to mount M13-S02 directly, so Finance › Invoices opened
 * INV-2026-0311 and the breadcrumb on a LIST route ended at a record reference.
 * CLAUDE.md gives the breadcrumb the path and `RecordHeader` the identity, and a
 * leaf that opens one invoice can honour neither. `/:invoiceRef` still opens the
 * record, and the detail screen's existing crumb href now points at something.
 *
 * The money columns are the subject: what was billed, what is still out, and
 * whether the accounting package has taken it. OUTSTANDING is the one a reader
 * scans for, so it is the sorted column on arrival — a list of invoices sorted
 * by date answers "what happened recently" and Finance is asking "what is still
 * owed".
 *
 * SYNC IS REPORTED, NEVER ASSERTED. TrainOS does not e-invoice; the state in
 * that column is what the accounting package said back, which is why it is a
 * chip of its own rather than folded into the invoice's status. The two mean
 * different things and an invoice can be PAID while its push has errored.
 *
 * NO SOLID PRIMARY. Creating an invoice is policy-gated (FIN-01) and recording a
 * payment happens on the record; this screen only routes to one.
 */

const ANY = "ALL";

const TABS = {
  outstanding: "Outstanding",
  overdue: "Overdue",
  paid: "Paid",
  all: "All",
} as const;

type TabId = keyof typeof TABS;

/** Anything still carrying a balance, whatever the status says about it. */
const isOutstanding = (invoice: Invoice) => invoice.outstanding.amount > 0;

function inTabOf(invoice: Invoice, tab: TabId): boolean {
  switch (tab) {
    case "outstanding":
      return isOutstanding(invoice);
    case "overdue":
      return invoice.status === "OVERDUE";
    case "paid":
      return invoice.status === "PAID";
    case "all":
      return true;
  }
}

export function InvoicesListScreen() {
  useBreadcrumb([{ label: "Finance" }, { label: "Invoices" }]);

  const navigate = useNavigate();
  const invoices = useInvoices();
  const directory = useOrganisationDirectory();

  const [tabOverride, setTab] = useState<TabId | null>(null);
  const [status, setStatus] = useState<string>(ANY);
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "outstanding",
    direction: "desc",
  });

  const all = useMemo(() => invoices.data?.data ?? [], [invoices.data]);

  const outstanding = all.filter(isOutstanding);
  const overdue = all.filter((invoice) => invoice.status === "OVERDUE");
  const tab: TabId = tabOverride ?? (outstanding.length > 0 ? "outstanding" : "all");

  /* Built from the data. `InvoiceStatus` gains members as the ledger does, and
     a hardcoded option list would silently hide every invoice on a new one. */
  const statuses = useMemo(() => [...new Set(all.map((invoice) => invoice.status))].sort(), [all]);

  /* The client's name is a supporting read: an invoice list is still readable
     with references in it, so a failed directory is a banner and not the
     screen's error state. */
  const partial: PartialRead[] = [
    {
      label: "the client names",
      error: directory.query.isError ? toApiError(directory.query.error) : null,
      retry: () => void directory.query.refetch(),
    },
  ];

  const inTab = useMemo(() => all.filter((invoice) => inTabOf(invoice, tab)), [all, tab]);

  const narrowed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inTab.filter((invoice) => {
      if (status !== ANY && invoice.status !== status) return false;
      if (needle === "") return true;
      return (
        invoice.ref.toLowerCase().includes(needle) ||
        invoice.engagementRef.toLowerCase().includes(needle) ||
        directory.nameOf(invoice.organisationRef).toLowerCase().includes(needle)
      );
    });
  }, [inTab, status, query, directory]);

  const rows = useMemo(() => {
    const read = (invoice: Invoice) => {
      if (sort.key === "total") return invoice.total.amount;
      if (sort.key === "dueAt") return Date.parse(invoice.dueAt);
      return invoice.outstanding.amount;
    };
    return [...narrowed].sort((left, right) =>
      sort.direction === "asc" ? read(left) - read(right) : read(right) - read(left),
    );
  }, [narrowed, sort]);

  const chips: FilterChipModel[] = [];
  if (query.trim().length > 0) chips.push({ id: "query", label: "Search", value: query.trim() });
  if (status !== ANY) {
    chips.push({ id: "status", label: "Status", value: humanise(status) });
  }

  const owed = {
    amount: outstanding.reduce((total, invoice) => total + invoice.outstanding.amount, 0),
    currency: all[0]?.outstanding.currency ?? "MYR",
  };

  const columns: Column<Invoice>[] = [
    {
      key: "invoice",
      label: "Invoice",
      accessor: (invoice) => (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-ink">
            {directory.nameOf(invoice.organisationRef)}
          </div>
          <div className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{invoice.ref}</span>
            {" · "}
            <span className="font-mono">{invoice.engagementRef}</span>
          </div>
        </div>
      ),
    },
    {
      key: "issuedAt",
      label: "Issued",
      width: "108px",
      accessor: (invoice) => <DateText value={invoice.issuedAt} />,
    },
    {
      key: "dueAt",
      label: "Due",
      width: "132px",
      sortable: true,
      /* §16: a date in a data column is typography, never a badge. The terms are
         the supporting line because "30 days" is how Finance argues about a
         due date it disagrees with. */
      accessor: (invoice) => (
        <div className="min-w-0">
          <DateText value={invoice.dueAt} />
          <div className="text-[12px] tabular-nums text-ink-muted">
            {`${invoice.termsDays} day terms`}
          </div>
        </div>
      ),
    },
    {
      key: "total",
      label: "Total",
      width: "124px",
      align: "right",
      sortable: true,
      accessor: (invoice) => <MoneyText value={invoice.total} className="tabular-nums" />,
    },
    {
      key: "outstanding",
      label: "Outstanding",
      width: "124px",
      align: "right",
      sortable: true,
      /* A settled invoice shows a dash rather than RM 0.00: zero is a number a
         reader has to compare, and nothing outstanding is not a number at all. */
      accessor: (invoice) => (
        <MoneyText value={invoice.outstanding} dashWhenZero className="tabular-nums" />
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "204px",
      /* Two chips because they are two facts. The invoice's own status is ours;
         the sync state is the accounting package's answer, and an invoice can
         be PAID while its push has errored. */
      accessor: (invoice) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={INVOICE_TONE[invoice.status as InvoiceStatus] ?? "neutral"}>
            {humanise(invoice.status)}
          </StatusChip>
          <StatusChip tone={SYNC_TONE[invoice.sync.state] ?? "neutral"}>
            {humanise(invoice.sync.state)}
          </StatusChip>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Invoices"
        withoutCondensed
        meta={[
          `${all.length} ${all.length === 1 ? "invoice" : "invoices"}`,
          owed.amount === 0 ? "nothing outstanding" : `${formatMoney(owed)} outstanding`,
          overdue.length > 0 ? `${overdue.length} overdue` : null,
        ]}
      />

      <div className="px-5 py-3">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Invoices"
              activeId={tab}
              onSelect={(id) => setTab(id as TabId)}
              tabs={[
                { id: "outstanding", label: TABS.outstanding, count: outstanding.length },
                { id: "overdue", label: TABS.overdue, count: overdue.length },
                {
                  id: "paid",
                  label: TABS.paid,
                  count: all.filter((invoice) => invoice.status === "PAID").length,
                },
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
                if (id === "status") setStatus(ANY);
              }}
              onClearAll={() => {
                setQuery("");
                setStatus(ANY);
              }}
            >
              <FilterSearch
                label="Search invoices"
                labelHidden
                value={query}
                onChange={setQuery}
                placeholder="Client or reference"
              />
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
        <div className="px-5 pb-2">
          <PartialDataBanner reads={partial} />
        </div>
      ) : null}

      {invoices.isPending ? <LoadingState rows={6} label="Loading the invoices" /> : null}

      {invoices.isError ? (
        <ErrorState
          title="The invoices could not be loaded"
          error={toApiError(invoices.error)}
          onRetry={() => void invoices.refetch()}
        />
      ) : null}

      {!invoices.isPending && !invoices.isError ? (
        <DataTable
          label="Invoices"
          columns={columns}
          rows={rows}
          rowKey={(invoice) => invoice.ref}
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
          onRowClick={(invoice) => navigate(`${INVOICES_PATH}/${invoice.ref}`)}
          empty={
            all.length === 0 ? (
              <EmptyState
                title="No invoice has been raised"
                description="An invoice appears here once an engagement is billed and pushed to the accounting package."
              />
            ) : inTab.length === 0 ? (
              /* The TAB is empty, not the filter. Telling a reader to clear a
                 search they never typed sends them looking for a control they
                 did not touch. */
              <EmptyState
                title="Nothing in this bucket"
                description="No invoice is in this state. Switch to All to see the whole ledger."
              />
            ) : (
              <EmptyState
                title="No invoice matches this search"
                description="Clear the search and the status facet to see every invoice in this bucket."
              />
            )
          }
        />
      ) : null}
    </div>
  );
}

export default InvoicesListScreen;
