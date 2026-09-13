import { useMemo, useState } from "react";
import type { ActionResponse, FollowUp, FollowUpStatus, PageRequest } from "@trainos/contract";
import {
  ActionOutcome,
  AIChip,
  AutonomyChip,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  Fab,
  ListToolbar,
  LoadingState,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  SecondaryButton,
  SplitWorkspace,
  StatusChip,
  WhatsAppCostStrip,
  describeActionError,
  FOLLOW_UP_TONE,
  type ActionError,
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
          with no `recordRef` and no condensed bar.

          §16b: "My accounts · 9" lost its number. The tab group one row below
          says "All 9", and the header said it again in a meta line the eye
          reaches first — the same fact twice, which is the defect the ruling
          names. "My accounts" is the part the tabs do not say. */}
      <RecordHeader
        withoutCondensed
        title="Follow-up queue"
        meta={["My accounts"]}
        actions={
          <>
            <SecondaryButton>Rules</SecondaryButton>
            <SecondaryButton>Export</SecondaryButton>
          </>
        }
      />

      {/* §10b: the tabs are this screen's only narrowing, so the toolbar holds
          nothing else. There is deliberately NO FilterBar: the one it used to
          carry existed only to fill the list pane's 72px header block with
          something, and what it filled it with was "9 of 9 shown" — a count the
          tab beside it was already printing. No filter narrows this list, so no
          count is owed. */}
      <ListToolbar
        className="border-b border-border px-5 pb-3"
        tabs={
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
        }
      />

      <SplitWorkspace
        listLabel="Follow-up queue"
        list={
          queue.isPending ? (
            <LoadingState rows={6} label="Loading the follow-up queue" />
          ) : queue.isError ? (
            <ErrorState
              title="The queue did not load"
              error={toApiError(queue.error)}
              onRetry={() => void queue.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing to chase"
              description="No follow-up in this filter. Everything here has been worked or is not due yet."
            />
          ) : (
            <ul aria-label="Follow-ups" className="flex flex-col">
              {rows.map((row) => (
                <FollowUpRow
                  key={row.id}
                  followUp={row}
                  selected={row.id === selected?.id}
                  onSelect={() => {
                    setSelectedId(row.id);
                    clearOutcome();
                  }}
                />
              ))}
            </ul>
          )
        }
        detailLabel="Draft"
        /* The header no longer renders on an empty pane. It existed there only
           to carry a hairline across a seam the two panes no longer share. */
        {...(selected
          ? {
              detailHeader: (
                <div className="flex items-center gap-2.5">
                  {/* `truncate` survives the withdrawn height rule for a new
                      reason: this block is sticky, so a name that wrapped would
                      shorten every screenful beneath it. */}
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
                </div>
              ),
            }
          : {})}
        detail={
          <div className="flex flex-col gap-5 px-5 py-5">
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

                    <section className="flex flex-col gap-2">
                      <h3 className="text-[13px] font-semibold text-ink">Why now</h3>
                      <p className="text-[13px] leading-[1.6] text-ink-secondary">
                        {selected.reason}
                      </p>
                    </section>
                  </>
                ) : null}
              </>
            )}
          </div>
        }
      />

      <Fab />
    </div>
  );
}

/**
 * §16b's row shape, on a queue that used to be a four-column `DataTable`.
 *
 * The table was correct on a full-width screen and wrong in a pane the ruling
 * caps at 40%: Status, Due and Autonomy took 352 fixed pixels of roughly 460,
 * which left the Contact column about 110 and wrapped "Nurul Hassan · Aurora
 * Manufacturing Sdn Bhd" over four lines beside three cells of whitespace.
 *
 * So the row reads down instead of across. Row one is the name, row two is the
 * reference and why the follow-up exists, row three carries the state and the
 * date — which the ruling allows exactly where the stage matters, and on an
 * aging queue "Overdue · 10 Nov" is the whole point of the screen.
 *
 * The autonomy chip stays. Every row in this queue sits at SUGGEST and none of
 * them sends itself, and that is the fact the solid "Send" button depends on.
 */
function FollowUpRow({
  followUp,
  selected,
  onSelect,
}: {
  followUp: FollowUp;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-1.5 border-b border-border px-4 py-3 text-left hover:bg-surface-hover",
          selected && "bg-surface shadow-[inset_2px_0_0_rgb(var(--ink))]",
        )}
      >
        <span className="truncate text-[13px] font-semibold text-ink">
          {followUp.contact.name} · {followUp.organisation.name}
        </span>

        <span className="line-clamp-2 text-[12px] leading-[1.45] text-ink-muted">
          <span className="font-mono text-[11px]">{followUp.ref}</span> · {followUp.reason}
        </span>

        <span className="flex items-center gap-2">
          <StatusChip tone={FOLLOW_UP_TONE[followUp.status]}>{TITLE[followUp.status]}</StatusChip>
          {/* No "due" in front of it. The chip to its left already says Due or
              Overdue, and printing the word again next to it was the same
              label twice on one line. */}
          <span className="text-[12px] text-ink-secondary" title="Due date">
            <DateText value={followUp.dueDate} />
          </span>
          <AutonomyChip level={followUp.autonomy} className="ml-auto" />
        </span>
      </button>
    </li>
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
