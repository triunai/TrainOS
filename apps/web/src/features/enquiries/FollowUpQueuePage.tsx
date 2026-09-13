import { useMemo, useState } from "react";
import type { ActionResponse, FollowUp, FollowUpStatus, PageRequest } from "@trainos/contract";
import {
  ActionOutcome,
  AIChip,
  AutonomyChip,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  Fab,
  FilterBar,
  LoadingState,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  SPLIT_HEADER_HEIGHT,
  SecondaryButton,
  StatusChip,
  WhatsAppCostStrip,
  describeActionError,
  FOLLOW_UP_TONE,
  type ActionError,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { cn } from "@/shared/lib/utils";
import { readableMessage, toApiError, useActor } from "@/shared/api";
import { useEnquiryAction, useFollowUpDraft, useFollowUps } from "./api";

/**
 * M03-S06 · Follow-up queue (`M03 Leads.dc.html`).
 *
 * The aging list gets worked without anybody writing the messages: the agent
 * drafts, the human reads the cost and the consent, and the human sends.
 *
 * "Send" is the view's one solid primary and it is always human-triggered —
 * every row in this queue sits at SUGGEST, and nothing at SUGGEST sends itself.
 * The cost strip is not decoration: WhatsApp is billed per message by category,
 * so the price of the click is shown before the click.
 */

type TabId = "ALL" | FollowUpStatus;

const TABS: { id: TabId; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "DUE", label: "Due" },
  { id: "OVERDUE", label: "Overdue" },
  { id: "SENT", label: "Sent" },
];

function pageFor(tab: TabId): PageRequest | undefined {
  if (tab === "ALL") return undefined;
  return { filter: [{ field: "status", op: "eq", value: tab }] };
}

export function FollowUpQueuePage() {
  useBreadcrumb([
    { label: "Sales" },
    { label: "Enquiries", href: "/sales/enquiries" },
    { label: "Follow-up queue" },
  ]);

  const [tab, setTab] = useState<TabId>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [response, setResponse] = useState<ActionResponse | undefined>(undefined);
  const [failure, setFailure] = useState<ActionError | undefined>(undefined);

  const clearOutcome = () => {
    setResponse(undefined);
    setFailure(undefined);
  };

  const queue = useFollowUps(pageFor(tab));
  const all = useFollowUps();
  const rows = queue.data?.data ?? [];
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  const draft = useFollowUpDraft(selected?.id, channel);
  const action = useEnquiryAction();
  const actor = useActor();

  const counts = useMemo(() => {
    const data = all.data?.data ?? [];
    return {
      ALL: data.length,
      DUE: data.filter((row) => row.status === "DUE").length,
      OVERDUE: data.filter((row) => row.status === "OVERDUE").length,
      SENT: data.filter((row) => row.status === "SENT").length,
      DISMISSED: data.filter((row) => row.status === "DISMISSED").length,
    } satisfies Record<TabId, number>;
  }, [all.data]);

  const columns: Column<FollowUp>[] = [
    {
      key: "contact",
      label: "Contact",
      accessor: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink">
            {row.contact.name} · {row.organisation.name}
          </span>
          <span className="text-[11px] text-ink-muted">{row.reason}</span>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "108px",
      accessor: (row) => (
        <StatusChip tone={FOLLOW_UP_TONE[row.status]}>{TITLE[row.status]}</StatusChip>
      ),
    },
    {
      key: "due",
      label: "Due",
      width: "104px",
      accessor: (row) => (
        /* No colour here. The Status column immediately to the left already
           renders OVERDUE through FOLLOW_UP_TONE, so this was the same fact
           said twice — the second time in the place CLAUDE.md reserves. */
        <span className="text-ink-secondary">
          <DateText value={row.dueDate} />
        </span>
      ),
    },
    {
      key: "autonomy",
      label: "Autonomy",
      width: "140px",
      accessor: (row) => <AutonomyChip level={row.autonomy} fluid />,
    },
  ];

  const consentBlocked = draft.data ? !draft.data.consent.granted : false;

  const send = () => {
    if (!selected || !draft.data) return;
    clearOutcome();
    action.mutate(
      {
        type: "FOLLOWUP_SEND",
        targetRef: selected.ref,
        payload: { channel: draft.data.channel, templateId: draft.data.templateId },
        requestedBy: actor,
      },
      {
        /* Every §3 outcome arrives here as a value, the refusal included: a
           queued approval is a success and rendering it through an error path
           is how an approval queue becomes invisible. */
        onSuccess: (result) => {
          if (result.kind === "error") {
            setFailure(describeActionError(result.error, readableMessage(result.error)));
            return;
          }
          setResponse(result.response);
        },
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Same ruling as the inbox: a list screen's header is a RecordHeader
          with no `recordRef` and no condensed bar, and the context count is a
          meta line rather than a chip. */}
      <RecordHeader
        withoutCondensed
        title="Follow-up queue"
        meta={[`My accounts · ${counts.ALL}`]}
        actions={
          <>
            <SecondaryButton>Rules</SecondaryButton>
            <SecondaryButton>Export</SecondaryButton>
          </>
        }
      />

      <div className="px-5 pb-4">
        <PillTabGroup
          tabs={TABS.map((entry) => ({ ...entry, count: counts[entry.id] }))}
          activeId={tab}
          onSelect={(id) => {
            setTab(id as TabId);
            setSelectedId(null);
            clearOutcome();
          }}
          label="Queue filters"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Follow-up queue"
          className="flex w-[560px] shrink-0 flex-col border-r border-divider"
        >
          {/* The list pane had NO header block at all: the table's sticky head
              started flush at the top of the split while the draft pane's
              header sat below its parent's padding, so the two sides began at
              different heights and no hairline ran across the seam. It gets the
              same summary row the enquiry inbox has, at the kit's shared
              master/detail height. */}
          <FilterBar
            filters={[]}
            shown={rows.length}
            total={counts.ALL}
            className={cn(
              SPLIT_HEADER_HEIGHT,
              "shrink-0 flex-nowrap overflow-hidden border-b border-divider py-0",
            )}
          />

          <div className="min-h-0 flex-1 overflow-auto">
            {queue.isPending ? (
              <LoadingState rows={6} label="Loading the follow-up queue" />
            ) : queue.isError ? (
              <ErrorState
                title="The queue did not load"
                error={toApiError(queue.error)}
                onRetry={() => void queue.refetch()}
              />
            ) : (
              <DataTable
                label="Follow-ups"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                onRowClick={(row) => {
                  setSelectedId(row.id);
                  clearOutcome();
                }}
                /* Highlight only — no checkbox column. `onSelectionChange` is
                 deliberately absent, which is what keeps the table unselectable
                 while still marking the row whose draft is on the right. */
                selectedKeys={selected ? new Set([selected.id]) : undefined}
                empty={
                  <EmptyState
                    title="Nothing to chase"
                    description="No follow-up in this filter. Everything here has been worked or is not due yet."
                  />
                }
              />
            )}
          </div>
        </section>

        <section aria-label="Draft" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The header block renders whether or not a row is selected, so the
              hairline runs across the seam even on an empty right pane. */}
          <div
            className={cn(
              SPLIT_HEADER_HEIGHT,
              "flex shrink-0 items-center gap-2.5 overflow-hidden border-b border-divider px-5",
            )}
          >
            {selected ? (
              <>
                {/* `truncate` and `flex-nowrap` are the two rules the shared
                    height depends on: this row used to wrap its buttons and
                    grow, which is what put the two panes at different heights. */}
                <h2 className="min-w-0 truncate text-[16px] font-semibold">
                  {selected.contact.name} · {selected.organisation.name}
                </h2>
                <StatusChip tone={FOLLOW_UP_TONE[selected.status]}>
                  Due <DateText value={selected.dueDate} />
                </StatusChip>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <SecondaryButton>Edit draft</SecondaryButton>
                  <PrimaryButton
                    onClick={send}
                    disabled={action.isPending || consentBlocked || !draft.data}
                  >
                    Send
                  </PrimaryButton>
                </div>
              </>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-4">
            {!selected ? (
              <EmptyState
                title="Nothing selected"
                description="Pick a row to read the draft the Follow-up Agent prepared for it."
              />
            ) : (
              <>
                {draft.isPending ? (
                  <LoadingState rows={4} label="Loading the draft" />
                ) : draft.isError ? (
                  <ErrorState
                    title="The draft did not load"
                    error={toApiError(draft.error)}
                    onRetry={() => void draft.refetch()}
                  />
                ) : draft.data ? (
                  <>
                    {consentBlocked ? (
                      <ExceptionBanner
                        severity="DANGER"
                        title="No PDPA consent on file for this channel"
                        subtitle={`${selected.contact.name} has not consented to ${TITLE_CHANNEL[draft.data.channel]}. Sending is blocked until consent is recorded.`}
                      />
                    ) : null}

                    <div className="overflow-hidden rounded-control border border-primary-border">
                      <div className="flex items-center gap-2 border-b border-primary-border bg-ai-tint px-3 py-2">
                        <AIChip
                          provenance={draft.data.provenance}
                          label="Follow-up Agent · draft"
                        />
                        <span className="ml-auto text-[12px] text-primary-hover">
                          Act on your click
                        </span>
                      </div>

                      <div className="flex flex-col gap-3 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <PillTabGroup
                            tabs={[
                              { id: "WHATSAPP", label: "WhatsApp" },
                              { id: "EMAIL", label: "Email" },
                            ]}
                            activeId={channel}
                            onSelect={(id) => setChannel(id as "WHATSAPP" | "EMAIL")}
                            label="Draft channel"
                          />
                          <span className="ml-auto font-mono text-[12px] text-ink-muted">
                            {draft.data.templateId}
                          </span>
                        </div>

                        <p className="whitespace-pre-wrap rounded-control border border-border bg-card p-3 text-[13px] leading-[1.6] text-ink">
                          {draft.data.body}
                        </p>

                        {draft.data.channel === "WHATSAPP" ? (
                          <WhatsAppCostStrip
                            category={draft.data.category}
                            templateLabel={draft.data.templateId}
                            recipients={draft.data.recipients}
                            ratePerMessage={draft.data.ratePerMessage}
                            ratePerMessageExact={draft.data.ratePerMessageExact}
                            estimatedCost={draft.data.estimatedCost}
                            alternative={draft.data.alternativeCategoryRate}
                          />
                        ) : null}

                        <p className="text-[12px] text-ink-secondary">
                          Consent on file: {TITLE_CHANNEL[draft.data.channel]}{" "}
                          {draft.data.consent.granted ? "✓" : "✕"}
                          {draft.data.consent.recordedAt ? (
                            <>
                              {" "}
                              · PDPA recorded <DateText value={draft.data.consent.recordedAt} />
                            </>
                          ) : (
                            " · no PDPA record"
                          )}
                        </p>
                      </div>
                    </div>

                    <ActionOutcome
                      response={response}
                      error={failure}
                      subject={`Follow-up · ${selected.contact.name}`}
                      onDismiss={clearOutcome}
                    />

                    <section className="flex flex-col gap-2.5">
                      <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                        Why now
                      </h3>
                      <p className="text-[13px] leading-[1.6] text-ink-secondary">
                        {selected.reason}
                      </p>
                    </section>
                  </>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>

      <Fab />
    </div>
  );
}

const TITLE: Record<FollowUpStatus, string> = {
  DUE: "Due",
  OVERDUE: "Overdue",
  SENT: "Sent",
  DISMISSED: "Dismissed",
};

const TITLE_CHANNEL: Record<"EMAIL" | "WHATSAPP", string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
};
