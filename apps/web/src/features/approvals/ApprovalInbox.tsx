/**
 * M02-S01 · Approval inbox.
 *
 * "One queue for every human decision the system needs, ordered by urgency
 * rather than by module." Primary user Kelvin (Sales Manager); the MD sees
 * items above RM 50,000.
 *
 * Two rules from the pack drive the whole screen:
 *
 *   · Grouping is by SLA urgency, and the groups come from the SERVER
 *     (`groups[]` on the §7 response), never from a client-side sort. The
 *     screen renders the buckets it is given, in the order it is given them.
 *   · Bulk approve is unavailable for anything carrying money. That is
 *     `bulkApprovable`, decided server-side, and it surfaces as a DISABLED
 *     checkbox whose accessible name is the reason — not a silent no-op.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ApprovalRequest, FilterClause, UrgencyGroup } from "@trainos/contract";
import {
  AIChip,
  AutonomyChip,
  BulkActionBar,
  DataTable,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  KeyboardShortcut,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  SecondaryButton,
  StatusChip,
  humanise,
  tabsFromViews,
  type Column,
  type FilterChipModel,
  type RowGroup,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { isDomainError, readableMessage, type ApiError } from "@/shared/api";
import {
  useApprovalInbox,
  useApprovalViews,
  useBulkDecideApprovals,
  type ApprovalPageRequest,
} from "./api";
import { apiErrorFromThrown } from "./client";
import { approvalPath } from "./paths";

/**
 * Bucket headings. Total over `UrgencyGroup`, so a new bucket in the contract
 * breaks the build here rather than rendering as a raw enum. The pack's wording
 * is kept: "Breaching SLA", not "Breaching".
 */
const GROUP_CAPTION: Record<UrgencyGroup, string> = {
  BREACHING: "Breaching SLA",
  TODAY: "Due today",
  THIS_WEEK: "This week",
  LATER: "Later",
};

/** The one optional filter the screen offers, matching the pack's chip. */
const HIGH_VALUE_FILTER: FilterClause = { field: "value.amount", op: "gte", value: 500_000 };
const HIGH_VALUE_CHIP: FilterChipModel = {
  id: "high-value",
  label: "Value",
  value: "≥ RM 5,000",
};

/**
 * `slaRemainingMinutes` is a server fact — §7 returns it alongside `slaDueAt`
 * precisely so the UI does not recompute a countdown from a timestamp and
 * disagree with the queue. Negative means the SLA has already passed.
 */
function formatSla(minutes: number | undefined, breached: boolean): string {
  if (minutes === undefined) return breached ? "SLA breached" : "—";

  const over = minutes < 0;
  const absolute = Math.abs(minutes);
  const suffix = over ? "over" : "left";

  if (absolute < 60) return `${absolute}m ${suffix}`;
  if (absolute < 60 * 24) return `${Math.round(absolute / 60)}h ${suffix}`;
  return `${Math.round(absolute / (60 * 24))}d ${suffix}`;
}

/** The median is reported in seconds; the footer reads "3m 40s". */
function formatMedian(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

export function ApprovalInbox() {
  const navigate = useNavigate();

  /* The top bar owns the path. CLAUDE.md: the breadcrumb owns the path and
     RecordHeader owns the identity — neither is duplicated inside the card. */
  useBreadcrumb([{ label: "Home", href: "/" }, { label: "Approvals" }]);

  const views = useApprovalViews();
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [highValueOnly, setHighValueOnly] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [bulkBlockers, setBulkBlockers] = useState<string[] | null>(null);
  const [bulkError, setBulkError] = useState<ApiError | null>(null);

  /* The default view is the server's, not the first in the array. */
  const defaultViewId = views.data?.data.find((view) => view.isDefault)?.id ?? null;
  const viewId = activeViewId ?? defaultViewId;

  const page: ApprovalPageRequest = useMemo(
    () => ({
      group: "URGENCY",
      ...(viewId === null ? {} : { view: viewId }),
      ...(highValueOnly ? { filter: [HIGH_VALUE_FILTER] } : {}),
    }),
    [viewId, highValueOnly],
  );

  const inbox = useApprovalInbox(page);
  const bulkDecide = useBulkDecideApprovals();

  const rows = useMemo(() => inbox.data?.data ?? [], [inbox.data]);

  /* Render the buckets the server returned, in the server's order. A group it
     did not send is a group with nothing in it, and an empty heading is noise. */
  const groups: RowGroup<ApprovalRequest>[] = useMemo(
    () =>
      (inbox.data?.groups ?? [])
        .map((group) => ({
          caption: `${GROUP_CAPTION[group.key]} · ${group.count}`,
          rows: rows.filter((row) => row.urgencyGroup === group.key),
        }))
        .filter((group) => group.rows.length > 0),
    [inbox.data, rows],
  );

  const open = useCallback(
    (row: ApprovalRequest) => {
      navigate(approvalPath(row.ref));
    },
    [navigate],
  );

  /* J/K walk the queue and ⏎ opens it, which is the pack's "2 clicks or 1
     keystroke" budget. A and R are NOT bound here: the inbox's action is Open,
     and a keystroke that decides an approval without showing the diff is the
     opposite of what M02-S02 exists for. */
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const queue = rowsRef.current;
      if (queue.length === 0) return;

      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        setFocusedIndex((index) => {
          const next = event.key === "j" ? index + 1 : index - 1;
          return Math.min(Math.max(next, 0), queue.length - 1);
        });
        return;
      }

      if (event.key === "Enter") {
        const row = queue[focusedIndex];
        if (row) {
          event.preventDefault();
          open(row);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedIndex, open]);

  const columns: Column<ApprovalRequest>[] = useMemo(
    () => [
      {
        key: "subject",
        label: "Request",
        accessor: (row) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-ink">{row.subject}</span>
            <span className="text-[11px] text-ink-muted">
              {humanise(row.actionType)} · policy {row.policyId}
            </span>
          </div>
        ),
      },
      {
        key: "value",
        label: "Value (RM)",
        align: "right",
        accessor: (row) =>
          row.value ? <MoneyText value={row.value} /> : <span className="text-ink-muted">—</span>,
      },
      {
        key: "requestedBy",
        label: "Requested by",
        accessor: (row) =>
          /* §7: the column distinguishes an agent from a human. An agent gets
             the ✦ chip; a human deliberately gets no badge at all. */
          row.requestedBy.kind === "AGENT" ? (
            <AIChip variant="suggested" label={row.requestedBy.name} withoutPopover />
          ) : (
            <span>{row.requestedBy.name}</span>
          ),
      },
      {
        key: "confidence",
        label: "Confidence",
        align: "right",
        accessor: (row) =>
          typeof row.confidence === "number" ? (
            <span className="text-primary-hover">{Math.round(row.confidence * 100)}%</span>
          ) : (
            /* Confidence is only meaningful for an agent-raised item. */
            <span className="text-ink-muted">—</span>
          ),
      },
      {
        key: "sla",
        label: "SLA",
        accessor: (row) => (
          <span
            className={
              row.slaBreached ? "font-semibold text-danger" : "whitespace-nowrap text-ink-secondary"
            }
          >
            {formatSla(row.slaRemainingMinutes, row.slaBreached)}
          </span>
        ),
      },
      {
        key: "autonomy",
        label: "Autonomy",
        accessor: (row) =>
          row.autonomy ? (
            <AutonomyChip level={row.autonomy} />
          ) : (
            <span className="text-ink-muted">—</span>
          ),
      },
    ],
    [],
  );

  const filterChips: FilterChipModel[] = highValueOnly ? [HIGH_VALUE_CHIP] : [];

  const runBulkApprove = async () => {
    setBulkBlockers(null);
    setBulkError(null);
    try {
      await bulkDecide.mutateAsync({ ids: [...selected], decision: "APPROVE", note: null });
      setSelected(new Set());
    } catch (thrown) {
      /* The refusal IS the screen, which is why this write is awaited rather
         than toasted. §7 returns the offending refs in `details.blockers`, and
         naming them beats "something went wrong". */
      const error = apiErrorFromThrown(thrown);
      const blockers = isDomainError(error) ? error.details?.blockers : undefined;
      if (blockers && blockers.length > 0) setBulkBlockers(blockers);
      else setBulkError(error);
    }
  };

  const header = (
    <>
      <div className="flex min-h-9 flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-5">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Approvals</h1>
        {typeof inbox.data?.page.total === "number" ? (
          <StatusChip tone="info">Assigned to me · {inbox.data.page.total}</StatusChip>
        ) : null}
      </div>
    </>
  );

  if (inbox.isPending || views.isPending) {
    return (
      <div className="flex flex-col">
        {header}
        <LoadingState rows={7} label="Loading the approval queue" className="px-5" />
      </div>
    );
  }

  if (inbox.error) {
    /* TanStack hands back the EXCEPTION the query threw, not the `ApiError`
       inside it. Unwrapping is what keeps a refusal classified as one — and a
       refusal, per CLAUDE.md R2, is never offered a retry button. */
    const failure = apiErrorFromThrown(inbox.error);

    return (
      <div className="flex flex-col">
        {header}
        <ErrorState
          title="The approval queue could not be loaded"
          error={failure}
          {...(isDomainError(failure) ? {} : { onRetry: () => void inbox.refetch() })}
        />
      </div>
    );
  }

  const tabs = tabsFromViews(views.data?.data ?? []);
  const total = inbox.data?.page.total ?? 0;
  const median = inbox.data?.summary?.medianDecisionSeconds;
  const cursor = rows[Math.min(focusedIndex, Math.max(rows.length - 1, 0))];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}

      <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3">
        {tabs.length > 0 && viewId !== null ? (
          <PillTabGroup
            tabs={tabs}
            activeId={viewId}
            onSelect={(id) => {
              setActiveViewId(id);
              setSelected(new Set());
              setFocusedIndex(0);
            }}
            label="Approval views"
          />
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SecondaryButton onClick={() => setHighValueOnly((on) => !on)}>
            {highValueOnly ? "Clear value filter" : "Value ≥ RM 5,000"}
          </SecondaryButton>
          {cursor ? <PrimaryButton onClick={() => open(cursor)}>Review next</PrimaryButton> : null}
        </div>
      </div>

      <FilterBar
        filters={filterChips}
        onRemove={() => setHighValueOnly(false)}
        onClearAll={() => setHighValueOnly(false)}
        shown={rows.length}
        total={total}
      />

      {bulkBlockers ? (
        <div className="px-5 pb-3">
          <ExceptionBanner
            severity="DANGER"
            title="Those approvals carry money and must be decided one at a time"
            subtitle={bulkBlockers.join(" · ")}
            action={
              <SecondaryButton onClick={() => setBulkBlockers(null)}>Dismiss</SecondaryButton>
            }
          />
        </div>
      ) : null}

      {bulkError ? (
        <div className="px-5 pb-3">
          <ExceptionBanner
            severity="DANGER"
            title="That bulk approval did not go through"
            subtitle={readableMessage(bulkError)}
            action={<SecondaryButton onClick={() => setBulkError(null)}>Dismiss</SecondaryButton>}
          />
        </div>
      ) : null}

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <SecondaryButton onClick={() => void runBulkApprove()} disabled={bulkDecide.isPending}>
          {bulkDecide.isPending ? "Approving…" : "Bulk approve"}
        </SecondaryButton>
        <span className="text-[12px] text-ink-secondary">
          Bulk approve is unavailable for money actions
        </span>
      </BulkActionBar>

      <div className="min-h-0 flex-1 overflow-auto">
        <DataTable
          label="Approvals awaiting a decision, grouped by SLA urgency"
          columns={columns}
          groups={groups}
          rowKey={(row) => row.ref}
          selectedKeys={selected}
          onSelectionChange={setSelected}
          /* The reason becomes the checkbox's accessible name. §7 decides
             `bulkApprovable` server-side: false for anything carrying money. */
          selectionDisabledReason={(row) =>
            row.bulkApprovable
              ? undefined
              : "Carries a monetary value — approve this one on its own"
          }
          onRowClick={open}
          empty={
            <EmptyState
              title="Nothing is waiting on you"
              description="Every approval in this view has been decided. New requests arrive here as policies match them."
            />
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3.5 border-t border-divider px-5 py-3">
        <KeyboardShortcut keys={["J", "K"]} action="move through the queue" />
        {/* The cursor has to be legible somewhere or J/K is a keystroke into
            the dark. Naming the row ⏎ will open is the smallest honest cue
            until `DataTable` can highlight a focused row. */}
        <KeyboardShortcut keys={["⏎"]} action={cursor ? `open ${cursor.ref}` : "open"} />
        {typeof median === "number" ? (
          <span className="ml-auto text-[12px] text-ink-secondary">
            Median decision time this week: {formatMedian(median)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
