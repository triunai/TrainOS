import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Organisation, OrganisationSuggestion } from "@trainos/contract";
import {
  AIChip,
  CitationChip,
  ContentCard,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  ListToolbar,
  LoadingState,
  MoneyText,
  ORGANISATION_TONE,
  PillTabGroup,
  plural,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  humanise,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { useSuggestionsByOrganisation } from "./api";

/**
 * Relationships › Cross-sell. No artboard. List + toolbar + table, then the
 * selected row's reasoning underneath.
 *
 * The screen answers one question — where does the knowledge agent think there
 * is more work — and the answer is an exception across the book rather than a
 * property of every row. So the TABLE is the organisations and the TINT is the
 * ones with something suggested. Tinting every row instead would have been a
 * fill by another name and would have spent the whole 5–15% blue budget on a
 * surface that said nothing by saying it everywhere.
 *
 * The rationale, its citations and the actions the suggestion offers live in a
 * panel below the table rather than in a cell. §18's principle, applied off its
 * own screen: the human summary first, the machinery when somebody asks.
 *
 * `actions` comes from the suggestion, not from this file: `OPPORTUNITY_CREATE`
 * is a UI intent in the contract rather than a governed action, so the buttons
 * navigate and no approval can be queued from here. A solid primary would be a
 * promise this screen cannot keep, so there is none.
 */

const SUGGESTED_TAB = "suggested";
const QUIET_TAB = "quiet";
const ALL_TAB = "all";

export function CrossSellPage() {
  useBreadcrumb([{ label: "Relationships" }, { label: "Cross-sell" }]);

  const navigate = useNavigate();
  const [tab, setTab] = useState<string>(ALL_TAB);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  const directory = useOrganisationDirectory();
  const organisations = directory.organisations;

  const refs = useMemo(() => organisations.map((row) => row.ref), [organisations]);
  const suggestions = useSuggestionsByOrganisation(refs);

  const visible = useMemo(() => {
    if (tab === SUGGESTED_TAB) {
      return organisations.filter((row) => suggestions.byOrganisation.has(row.ref));
    }
    if (tab === QUIET_TAB) {
      return organisations.filter((row) => !suggestions.byOrganisation.has(row.ref));
    }
    return organisations;
  }, [organisations, suggestions, tab]);

  const selected =
    organisations.find((row) => row.ref === selectedRef) ??
    organisations.find((row) => suggestions.byOrganisation.has(row.ref)) ??
    null;

  const selectedSuggestions = selected ? (suggestions.byOrganisation.get(selected.ref) ?? []) : [];

  const columns: Column<Organisation>[] = [
    {
      key: "name",
      label: "Organisation",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{row.name}</p>
          <p className="truncate font-mono text-[11px] text-ink-muted">
            {`${row.ref} · ${humanise(row.industry)}`}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "132px",
      accessor: (row) => (
        <StatusChip tone={ORGANISATION_TONE[row.status]}>{humanise(row.status)}</StatusChip>
      ),
    },
    {
      key: "levy",
      label: "Levy available",
      width: "132px",
      align: "right",
      accessor: (row) => (
        <MoneyText value={row.metrics.hrdcLevyAvailable.value} compact dashWhenZero />
      ),
    },
    {
      key: "health",
      label: "Health",
      width: "88px",
      align: "right",
      accessor: (row) => <span className="tabular-nums">{row.metrics.healthScore.value}</span>,
    },
    {
      key: "suggestion",
      label: "What the agent says",
      width: "260px",
      accessor: (row) => {
        const suggestion = suggestions.byOrganisation.get(row.ref)?.[0];
        if (!suggestion) {
          return <span className="text-[12px] text-ink-muted">Nothing suggested</span>;
        }
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <AIChip provenance={suggestion.provenance} label="Cross-sell" />
            <span className="truncate text-[12px] text-ink-secondary" title={suggestion.title}>
              {suggestion.title}
            </span>
          </div>
        );
      },
    },
  ];

  const suggestedCount = organisations.filter((row) =>
    suggestions.byOrganisation.has(row.ref),
  ).length;

  return (
    <div className="flex flex-col">
      <div className="border-b border-border">
        <RecordHeader
          withoutCondensed
          title="Cross-sell"
          meta={[
            plural(organisations.length, "organisation"),
            `${plural(suggestions.all.length, "suggestion")} on record`,
          ]}
          actions={
            <SecondaryButton onClick={() => navigate("/relationships/renewals")}>
              Renewals
            </SecondaryButton>
          }
        />
      </div>

      <ListToolbar
        className="px-5 pt-4"
        tabs={
          <PillTabGroup
            label="Cross-sell views"
            activeId={tab}
            onSelect={(id) => {
              setTab(id);
              setSelectedRef(null);
            }}
            tabs={[
              { id: ALL_TAB, label: "All", count: organisations.length },
              { id: SUGGESTED_TAB, label: "Has a suggestion", count: suggestedCount },
              {
                id: QUIET_TAB,
                label: "Nothing suggested",
                count: organisations.length - suggestedCount,
              },
            ]}
          />
        }
        filters={<FilterBar filters={[]} shown={visible.length} total={organisations.length} />}
      />

      <div className="flex flex-col gap-4 px-5 py-4">
        {suggestions.failed > 0 ? (
          <ExceptionBanner
            severity="WARN"
            title="Some organisations could not be asked"
            subtitle={`${suggestions.failed} of ${refs.length} reads failed. Those rows read as "Nothing suggested", and an organisation nobody asked is not an organisation with no opportunity in it.`}
          />
        ) : null}

        {directory.query.isPending || suggestions.pending ? (
          <LoadingState rows={6} label="Loading the cross-sell book" />
        ) : null}

        {directory.query.isError ? (
          <ErrorState
            title="The organisation book did not load"
            error={toApiError(directory.query.error)}
            onRetry={() => void directory.query.refetch()}
          />
        ) : null}

        {suggestions.error && suggestions.failed === refs.length && refs.length > 0 ? (
          <ErrorState
            title="No suggestion could be read"
            description="Every organisation was asked and none answered, so this screen can say nothing about where there is more work."
            error={suggestions.error}
          />
        ) : null}

        {directory.query.data ? (
          <DataTable
            label="Cross-sell opportunities"
            columns={columns}
            rows={visible}
            rowKey={(row) => row.ref}
            rowSuggested={(row) => suggestions.byOrganisation.has(row.ref)}
            /* `selectedKeys` is deliberately NOT passed. It turns on the kit's
               selection column, and a checkbox per row promises bulk actions
               this screen does not have. The panel below names the organisation
               it is explaining instead, which is the link. */
            onRowClick={(row) => setSelectedRef(row.ref)}
            empty={
              <EmptyState
                title="Nothing in this view"
                description="No organisation is in this state. Switch to All to see the whole book."
              />
            }
          />
        ) : null}

        {selected ? (
          <ContentCard title={`Why ${selected.name}`}>
            {selectedSuggestions.length === 0 ? (
              <EmptyState
                title="The agent has nothing to say about this client"
                description="No cross-sell suggestion is on record here. That is an answer, not a gap: the knowledge agent found nothing worth proposing."
              />
            ) : (
              <div className="flex flex-col gap-5">
                {selectedSuggestions.map((suggestion) => (
                  <SuggestionDetail
                    key={suggestion.programmeId}
                    suggestion={suggestion}
                    onOpenOrganisation={() => navigate(`/sales/organisations/${selected.ref}`)}
                  />
                ))}
              </div>
            )}
          </ContentCard>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One suggestion's reasoning.
 *
 * The rationale is the server's sentence rendered verbatim, the citations are
 * its sources, and the buttons are the actions the suggestion itself offers.
 * None of the three is composed here — a screen that wrote its own rationale
 * would be putting words in an agent's mouth.
 */
function SuggestionDetail({
  suggestion,
  onOpenOrganisation,
}: {
  suggestion: OrganisationSuggestion;
  onOpenOrganisation: () => void;
}) {
  const sources = suggestion.provenance.sources ?? [];

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <AIChip provenance={suggestion.provenance} label="Cross-sell suggestion" />
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
          {suggestion.title}
        </h3>
        {suggestion.provenance.generatedAt ? (
          <span className="shrink-0 text-[12px] text-ink-muted">
            <DateText value={suggestion.provenance.generatedAt} />
          </span>
        ) : null}
      </div>

      <p className="max-w-[80ch] text-[13px] leading-[1.6] text-ink-secondary">
        {suggestion.rationale}
      </p>

      {sources.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((source, index) => (
            <CitationChip
              key={`${source.ref}-${index}`}
              variant="inline"
              label={`Source ${index + 1}: ${source.ref}`}
            >
              {index + 1}
            </CitationChip>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-ink-muted">
          The agent cited nothing. Treat the sentence above as an opinion, not as evidence.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {suggestion.actions.map((action) => (
          <SecondaryButton
            key={action.type}
            onClick={action.type === "OPPORTUNITY_CREATE" ? onOpenOrganisation : undefined}
          >
            {action.label}
          </SecondaryButton>
        ))}
      </div>
    </section>
  );
}
