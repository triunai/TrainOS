import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Proposal, ProposalStatus } from "@trainos/contract";
import { PROPOSAL_STATUSES } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  FilterSearch,
  FilterSelect,
  formatDate,
  humanise,
  ListToolbar,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PROPOSAL_TONE,
  RecordHeader,
  StatusChip,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOpportunityIndex, useOrganisationDirectory } from "@/shared/api";
import { useProposals } from "./api";
import { PROPOSAL_BUILDER_PATH } from "./paths";

/**
 * The proposal list — the half of M07-S02 the nav leaf pointed at.
 *
 * M07 draws the builder; nothing draws the list, so this is the Collections
 * composition with the four facts a consultant sorts a pipeline of documents
 * by: who it is for, where it stands, what it is worth, and whether the draft
 * came back with anything wrong.
 *
 * A proposal names its client twice removed, so the two shared books in
 * `shared/api` do the walk once rather than per row.
 *
 * Warnings are the exception, so warnings get the component: a row with none
 * shows nothing at all, and only a row carrying them earns a tone. Margin is a
 * number and reads as one — tabular, no bar, no chip. §16's rule, applied to a
 * screen §16 does not name.
 */

type StatusFilter = "ALL" | ProposalStatus;

export function ProposalsListPage() {
  useBreadcrumb([{ label: "Sales" }, { label: "Proposals" }]);

  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [origin, setOrigin] = useState("ALL");
  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");

  const proposals = useProposals();
  const opportunities = useOpportunityIndex();
  const directory = useOrganisationDirectory();

  const all = useMemo(() => proposals.data?.data ?? [], [proposals.data]);

  const clientOf = (proposal: Proposal) =>
    directory.nameOf(opportunities.organisationRefOf(proposal.opportunityRef));

  const namesUnavailable = opportunities.query.isError || directory.query.isError;

  const needle = search.trim().toLowerCase();

  const narrowed = all.filter((proposal) => {
    /* `runId` present means an agent drafted it. §1: absent provenance means a
       person wrote it, so this facet reads the record rather than a badge. */
    if (origin === "AI" && !proposal.runId) return false;
    if (origin === "HUMAN" && proposal.runId) return false;
    if (needle.length === 0) return true;
    return (
      proposal.ref.toLowerCase().includes(needle) ||
      proposal.opportunityRef.toLowerCase().includes(needle) ||
      clientOf(proposal).toLowerCase().includes(needle)
    );
  });

  const countOf = (id: StatusFilter) =>
    id === "ALL" ? narrowed.length : narrowed.filter((proposal) => proposal.status === id).length;

  const rows =
    status === "ALL" ? narrowed : narrowed.filter((proposal) => proposal.status === status);

  const chips: FilterChipModel[] = [];
  if (needle.length > 0) chips.push({ id: "query", label: "Search", value: search.trim() });
  if (origin !== "ALL") {
    chips.push({
      id: "origin",
      label: "Drafted by",
      value: origin === "AI" ? "An agent" : "A person",
    });
  }

  const columns: Column<Proposal>[] = [
    {
      key: "ref",
      label: "Proposal",
      accessor: (proposal) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{clientOf(proposal)}</p>
          <p className="truncate text-[12px] text-ink-muted">
            <span className="font-mono">{proposal.ref}</span>
            {` · ${proposal.sections.length} ${proposal.sections.length === 1 ? "section" : "sections"}`}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "148px",
      accessor: (proposal) => (
        <StatusChip tone={PROPOSAL_TONE[proposal.status]}>{humanise(proposal.status)}</StatusChip>
      ),
    },
    {
      key: "warnings",
      label: "Warnings",
      width: "128px",
      /* Nothing where there is nothing. A "0 warnings" cell on every clean row
         spends a column teaching the reader to ignore it. */
      accessor: (proposal) =>
        proposal.warnings && proposal.warnings.length > 0 ? (
          <StatusChip tone="warning">
            {`${proposal.warnings.length} ${proposal.warnings.length === 1 ? "warning" : "warnings"}`}
          </StatusChip>
        ) : null,
    },
    {
      key: "value",
      label: "Value",
      width: "124px",
      align: "right",
      accessor: (proposal) => <MoneyText value={proposal.value} className="tabular-nums" />,
    },
    {
      key: "marginRate",
      label: "Margin",
      width: "88px",
      align: "right",
      accessor: (proposal) => (
        <span className="tabular-nums text-[13px] text-ink">
          {`${Math.round(proposal.marginRate * 100)}%`}
        </span>
      ),
    },
    {
      key: "updatedAt",
      label: "Updated",
      width: "128px",
      accessor: (proposal) => (
        <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-secondary">
          {formatDate(proposal.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Proposals"
        withoutCondensed
        meta={[
          `${all.length} ${all.length === 1 ? "proposal" : "proposals"}`,
          `${all.filter((proposal) => proposal.status === "AWAITING_APPROVAL").length} awaiting approval`,
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
            label="Proposal status"
            activeId={status}
            onSelect={(id) => setStatus(id as StatusFilter)}
            tabs={[
              { id: "ALL", label: "All", count: countOf("ALL") },
              ...PROPOSAL_STATUSES.map((value) => ({
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
            onRemove={(id) => (id === "query" ? setSearch("") : setOrigin("ALL"))}
            onClearAll={() => {
              setSearch("");
              setOrigin("ALL");
            }}
          >
            <FilterSearch
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder="Client or reference"
            />
            <FilterSelect
              label="Drafted by"
              value={origin}
              onChange={setOrigin}
              options={[
                { value: "ALL", label: "Anyone" },
                { value: "AI", label: "An agent" },
                { value: "HUMAN", label: "A person" },
              ]}
            />
          </FilterBar>
        }
      />

      <div className="flex flex-col gap-3 pt-3">
        {namesUnavailable ? (
          <div className="px-5">
            <ExceptionBanner
              severity="WARN"
              title="Client names are unavailable"
              subtitle="The opportunity or organisation book did not load, so each row falls back to its reference. Every other figure is still the server's."
            />
          </div>
        ) : null}

        {proposals.isPending ? <LoadingState rows={6} label="Loading the proposals" /> : null}

        {proposals.isError ? (
          <ErrorState
            title="The proposals could not be loaded"
            error={toApiError(proposals.error)}
            onRetry={() => void proposals.refetch()}
          />
        ) : null}

        {!proposals.isPending && !proposals.isError ? (
          <DataTable
            label="Proposals"
            columns={columns}
            rows={rows}
            rowKey={(proposal) => proposal.id}
            density={density}
            onRowClick={(proposal) => navigate(PROPOSAL_BUILDER_PATH(proposal.ref))}
            empty={
              <EmptyState
                title="No proposal matches these filters"
                description="Clear a filter, or widen the status tab, to see the rest of the pipeline."
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}

export default ProposalsListPage;
