import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Engagement, EngagementStatus } from "@trainos/contract";
import {
  AIChip,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  LifecycleStepper,
  ListToolbar,
  LoadingState,
  MoneyText,
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
import { useEngagements, useSuggestionsByOrganisation } from "./api";

/**
 * Relationships › Renewals. No artboard. List + toolbar + table, per the
 * Collections composition and brief §10b: the tab group and the narrowing share
 * one row, with the table directly beneath.
 *
 * A renewal candidate is an engagement that has been DELIVERED — the client has
 * had the programme and could have it again. Which statuses count is a table
 * over the contract's own `EngagementStatus`, exhaustive by type: a status
 * added to the contract is a compile error here rather than a silent fall into
 * whichever branch happens to be the `else`. That is R14, applied to a
 * vocabulary this screen does not own.
 *
 * THE AI ROW. The tint marks a row the agent has something to say about, and
 * only those rows: §5 hangs cross-sell suggestions off an organisation, and in
 * this book one organisation has one. That is the point rather than a thin
 * seam — §16's rule is that the exception gets the component and normal data
 * stays typography, so a renewal with no suggestion is a plain row and the one
 * with a suggestion is tinted, glyphed and labelled. The tint never appears
 * without the chip beside it, because colour is not a label.
 *
 * The lifecycle strip is legal here and is not on the leads queue for a reason
 * worth stating: an engagement carries a server-sent `lifecycle`, so the
 * stepper renders steps rather than computing them.
 */

/**
 * Whether an engagement in this status is something to sell again.
 *
 * Exhaustive over the contract enum on purpose — see the note above.
 */
const DUE_FOR_RENEWAL: Record<EngagementStatus, boolean> = {
  PROPOSED: false,
  CONFIRMED: false,
  SCHEDULED: false,
  IN_DELIVERY: false,
  DELIVERED: true,
  CLOSED: true,
  CANCELLED: false,
};

const DUE_TAB = "due";
const IN_FLIGHT_TAB = "in-flight";
const ALL_TAB = "all";

function matchesTab(row: Engagement, tab: string): boolean {
  if (tab === DUE_TAB) return DUE_FOR_RENEWAL[row.status];
  if (tab === IN_FLIGHT_TAB) return !DUE_FOR_RENEWAL[row.status];
  return true;
}

/** The last day the programme ran. `dates` is server-ordered; take the end. */
function lastDelivered(row: Engagement): string | undefined {
  return row.dates[row.dates.length - 1];
}

export function RenewalsPage() {
  useBreadcrumb([{ label: "Relationships" }, { label: "Renewals" }]);

  const navigate = useNavigate();
  const [tab, setTab] = useState<string>(DUE_TAB);

  const engagements = useEngagements();
  const directory = useOrganisationDirectory();

  const rows = useMemo(() => engagements.data?.data ?? [], [engagements.data]);

  /* Only the organisations actually on screen are asked. A book-wide fan-out
     for rows nobody is looking at is N reads spent on nothing. */
  const organisationRefs = useMemo(
    () => [...new Set(rows.map((row) => row.organisationRef))],
    [rows],
  );
  const suggestions = useSuggestionsByOrganisation(organisationRefs);

  const visible = useMemo(() => rows.filter((row) => matchesTab(row, tab)), [rows, tab]);

  const columns: Column<Engagement>[] = [
    {
      key: "title",
      label: "Engagement",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{row.title}</p>
          <p className="truncate font-mono text-[11px] text-ink-muted">
            {`${row.ref} · ${directory.nameOf(row.organisationRef)}`}
          </p>
        </div>
      ),
    },
    {
      key: "lifecycle",
      label: "Progress",
      width: "150px",
      accessor: (row) => <LifecycleStepper steps={row.lifecycle} variant="table" />,
    },
    {
      key: "status",
      label: "Status",
      width: "132px",
      accessor: (row) => (
        <StatusChip tone={DUE_FOR_RENEWAL[row.status] ? "success" : "neutral"}>
          {humanise(row.status)}
        </StatusChip>
      ),
    },
    {
      key: "lastDelivered",
      label: "Last delivered",
      width: "128px",
      accessor: (row) => {
        const day = lastDelivered(row);
        return day ? <DateText value={day} /> : <span className="text-ink-muted">—</span>;
      },
    },
    {
      key: "value",
      label: "Last value",
      width: "116px",
      align: "right",
      accessor: (row) => <MoneyText value={row.value} compact />,
    },
    {
      key: "suggestion",
      label: "What the agent says",
      width: "240px",
      accessor: (row) => {
        const suggestion = suggestions.byOrganisation.get(row.organisationRef)?.[0];
        if (!suggestion) {
          /* Typography, not a component. Nothing is wrong with this row. */
          return <span className="text-[12px] text-ink-muted">Nothing suggested</span>;
        }
        return (
          <div className="flex min-w-0 flex-col gap-1">
            {/* The glyph and the words, beside the tint. The popover carries
                the provenance, which is where §05 says it belongs. */}
            <AIChip provenance={suggestion.provenance} label="Cross-sell" />
            <span className="truncate text-[12px] text-ink-secondary" title={suggestion.title}>
              {suggestion.title}
            </span>
          </div>
        );
      },
    },
  ];

  const dueCount = rows.filter((row) => DUE_FOR_RENEWAL[row.status]).length;

  return (
    <div className="flex flex-col">
      <div className="border-b border-border">
        <RecordHeader
          withoutCondensed
          title="Renewals"
          meta={[
            engagements.data ? plural(engagements.data.page.total, "engagement") : null,
            engagements.data ? `${dueCount} delivered and renewable` : null,
            suggestions.all.length > 0
              ? plural(suggestions.all.length, "suggested next step")
              : null,
          ]}
          actions={
            <SecondaryButton onClick={() => navigate("/relationships/cross-sell")}>
              Cross-sell
            </SecondaryButton>
          }
        />
      </div>

      <ListToolbar
        className="px-5 pt-4"
        tabs={
          <PillTabGroup
            label="Renewal views"
            activeId={tab}
            onSelect={setTab}
            tabs={[
              { id: DUE_TAB, label: "Due for renewal", count: dueCount },
              { id: IN_FLIGHT_TAB, label: "Still in flight", count: rows.length - dueCount },
              { id: ALL_TAB, label: "All", count: rows.length },
            ]}
          />
        }
        filters={
          <FilterBar filters={[]} shown={visible.length} total={engagements.data?.page.total} />
        }
      />

      <div className="flex flex-col gap-4 px-5 py-4">
        {/* An organisation whose suggestions did not load is not an
            organisation with nothing to suggest, and the table cannot say the
            difference in a cell. It says it here instead. */}
        {suggestions.failed > 0 ? (
          <ExceptionBanner
            severity="WARN"
            title="Some suggestions could not be read"
            subtitle={`${suggestions.failed} of ${organisationRefs.length} organisations did not answer. Their rows read as "Nothing suggested", which is not the same fact.`}
          />
        ) : null}

        {engagements.isPending ? <LoadingState rows={6} label="Loading the renewal book" /> : null}

        {engagements.isError ? (
          <ErrorState
            title="The renewal book did not load"
            error={toApiError(engagements.error)}
            onRetry={() => void engagements.refetch()}
          />
        ) : null}

        {engagements.data ? (
          <DataTable
            label="Renewal candidates"
            columns={columns}
            rows={visible}
            rowKey={(row) => row.ref}
            rowSuggested={(row) => suggestions.byOrganisation.has(row.organisationRef)}
            onRowClick={(row) => navigate(`/training/engagements/${row.ref}`)}
            empty={
              <EmptyState
                title="Nothing in this view"
                description="No engagement is at this point in its life. Switch to All to see the whole book."
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}
