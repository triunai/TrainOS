import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MESSAGE_CHANNELS } from "@trainos/contract";
import type {
  ActionResponse,
  Enquiry,
  EnquiryChannel,
  MessageChannel,
  PageRequest,
  SavedView,
} from "@trainos/contract";
import {
  ActionOutcome,
  DateText,
  EmptyState,
  ErrorState,
  Fab,
  FilterBar,
  GhostButton,
  ListToolbar,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  SecondaryButton,
  SplitWorkspace,
  StatusChip,
  channelLabel,
  describeActionError,
  humanise,
  tabsFromViews,
  type ActionError,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { readableMessage, toApiError, useActor } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import { useEnquiryAction, useEnquiries, useEnquiry, useEnquiryViews } from "./api";

/**
 * M03-S01 · Unified enquiry inbox (Kit.dc.html `proof-m03s01`).
 *
 * One queue for all four channels. The left rail is the queue, the right pane
 * is the enquiry the consultant is deciding about, and the single solid primary
 * — "Accept & convert" — is the only thing on the page that changes the world.
 *
 * Two states the design pack requires are properties of the data, not of a
 * prop: a low-confidence classification (<60%) carries `needsHumanReview` and
 * is never auto-archived, and a `NOT_AN_ENQUIRY` classification at high
 * confidence arrives already `ARCHIVED`. Both render from the record.
 */

/**
 * Brief §16: the channel is muted text with a tiny glyph and NO capsule. It was
 * a `RefChip`, which spent a bordered pill and an uppercase mono word on the
 * least interesting fact in the row.
 *
 * The GLYPH is all this screen still owns. The spelling is not: it used to be a
 * second copy of "WhatsApp" in a local map, which is the divergence 07b65a2
 * removed everywhere else — and the reason that commit exists is that
 * `humanise` once lower-cased it to "Whatsapp" on two screenshots.
 *
 * The two vocabularies stay apart, because the contract keeps them apart on
 * purpose: `MessageChannel` is the two channels a template can be SENT on, and
 * `EnquiryChannel` is the four an enquiry can ARRIVE by. Widening the kit's map
 * to four would merge them and put a rate-bearing union in reach of a web form.
 * So the label comes from `channelLabel` where the contract says the value is a
 * `MessageChannel` and from `humanise` otherwise — and membership is read off
 * `MESSAGE_CHANNELS` rather than written out here, so a channel promoted into
 * that union follows automatically instead of silently taking the else branch
 * (R14).
 */
const CHANNEL_GLYPH: Record<EnquiryChannel, string> = {
  EMAIL: "✉",
  WHATSAPP: "◉",
  WEB_FORM: "◌",
  PHONE: "☎",
};

const isMessageChannel = (channel: EnquiryChannel): channel is MessageChannel =>
  (MESSAGE_CHANNELS as readonly string[]).includes(channel);

function channelText(channel: EnquiryChannel): string {
  return isMessageChannel(channel) ? channelLabel(channel) : humanise(channel);
}

/** The "all open" pill the saved views do not carry: no filter, everything. */
const ALL_TAB = "view_all";

function pageFor(views: SavedView[], activeId: string): PageRequest | undefined {
  if (activeId === ALL_TAB) return undefined;
  const view = views.find((candidate) => candidate.id === activeId);
  return view ? { view: view.id } : undefined;
}

export function EnquiryInboxPage() {
  useBreadcrumb([{ label: "Sales" }, { label: "Enquiries" }]);

  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<string>(ALL_TAB);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [response, setResponse] = useState<ActionResponse | undefined>(undefined);
  const [failure, setFailure] = useState<ActionError | undefined>(undefined);

  const clearOutcome = () => {
    setResponse(undefined);
    setFailure(undefined);
  };

  const views = useEnquiryViews();
  const viewList = useMemo(() => views.data?.data ?? [], [views.data]);
  const enquiries = useEnquiries(pageFor(viewList, activeView));

  const rows = enquiries.data?.data ?? [];

  /* The default selection is the first row worth WORKING, not simply the first
     row. The queue is newest-first, and the newest item is as likely to be an
     auto-archived newsletter as a live enquiry — landing on one would open the
     screen on a record with nothing to decide. */
  const firstWorkable =
    rows.find((row) => row.status !== "ARCHIVED" && !row.classification.needsHumanReview) ??
    rows[0];
  const current = selectedRef ?? firstWorkable?.ref ?? null;
  const detail = useEnquiry(current ?? undefined);

  const action = useEnquiryAction();
  const actor = useActor();

  const tabs = useMemo(
    () => [
      { id: ALL_TAB, label: "All open", count: enquiries.data?.page.total },
      ...tabsFromViews(viewList),
    ],
    [viewList, enquiries.data],
  );

  const filters: FilterChipModel[] = useMemo(() => {
    const applied = enquiries.data?.appliedFilters ?? [];
    return applied.map((filter) => ({
      id: `${filter.field}:${filter.op}`,
      label: humanise(filter.field.split(".")[0] ?? filter.field),
      value: String(filter.value),
      locked: filter.source === "VIEW",
    }));
  }, [enquiries.data]);

  const suggestion = detail.data?.suggestedAction;

  /* Read once, at the top. These are used inside click handlers nested several
     levels into the detail slot, where reaching back through `detail.data`
     re-asserts a narrowing the reader has to re-derive at each call site. */
  const detailRef = detail.data?.ref ?? "";
  const matchedRef = detail.data?.matchedOrganisation?.ref ?? "";

  const convert = () => {
    if (!detail.data) return;
    clearOutcome();
    action.mutate(
      {
        type: "OPPORTUNITY_CONVERT",
        targetRef: detail.data.ref,
        /* Spelled out rather than passed through. The contract's payloads are
           named interfaces with no index signature, and `ActionRequest` wants a
           record — an object literal satisfies it and keeps every field the
           server will read visible at the call site.

           With no suggestion there is no agent payload, so the convert carries
           the enquiry's own estimated value and nothing invented. */
        payload: suggestion?.payload
          ? {
              value: suggestion.payload.value,
              questionnaireTemplateId: suggestion.payload.questionnaireTemplateId,
              programmeId: suggestion.payload.programmeId,
            }
          : undefined,
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
      {/* A list screen's header is a RecordHeader with no `recordRef` and no
          condensed bar — the kit's ruling, and there is no PageHeader to reach
          for.

          The "18 in view" meta line is GONE. §16b: the tab group already says
          "All open 18", and the page header repeating it was the same fact in
          two places two rows apart. A count earns its place only where a filter
          has narrowed the set, and then it belongs in the toolbar beside the
          filter that caused it. */}
      <RecordHeader
        withoutCondensed
        title="Enquiry inbox"
        actions={
          <>
            <SecondaryButton>Columns</SecondaryButton>
            <SecondaryButton>Export</SecondaryButton>
            <SecondaryButton>Log enquiry</SecondaryButton>
          </>
        }
      />

      {/* §10b: the saved views and the narrowing are ONE row, above the whole
          workspace rather than inside the list pane. The list pane used to
          carry this bar as a 72px header block pinned to the detail pane's —
          §16b withdrew that, and the bar was never the list's to own: it
          narrows the query, and the query feeds both panes.

          The hairline under it is the one rule this page keeps at the top: it
          is where the page's chrome stops and the two independent panes start,
          and without it the detail pane's sticky header reads as a second row
          of the toolbar. */}
      {views.isPending ? null : (
        <ListToolbar
          className="border-b border-border px-5 pb-3"
          tabs={
            <PillTabGroup
              tabs={tabs}
              activeId={activeView}
              onSelect={(id) => {
                setActiveView(id);
                setSelectedRef(null);
              }}
              label="Saved views"
            />
          }
          filters={
            /* The count rides with the chips or not at all. `FilterBar` prints
               "N of M shown" whenever both numbers arrive, so withholding them
               is how the unfiltered view stays silent — passing them and hiding
               the bar would leave the count to reappear the day the bar is
               rendered for some other reason. */
            filters.length > 0 ? (
              <FilterBar filters={filters} shown={rows.length} total={enquiries.data?.page.total} />
            ) : undefined
          }
        />
      )}

      <SplitWorkspace
        listLabel="Enquiry queue"
        list={
          enquiries.isPending ? (
            <LoadingState rows={6} label="Loading the enquiry queue" />
          ) : enquiries.isError ? (
            <ErrorState
              title="The queue did not load"
              error={toApiError(enquiries.error)}
              onRetry={() => void enquiries.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing in this view"
              description="No enquiry matches the saved view in play. Switch to All open to see the whole queue."
            />
          ) : (
            <ul className="flex flex-col">
              {rows.map((enquiry) => (
                <EnquiryRow
                  key={enquiry.ref}
                  enquiry={enquiry}
                  selected={enquiry.ref === current}
                  onSelect={() => {
                    setSelectedRef(enquiry.ref);
                    clearOutcome();
                  }}
                />
              ))}
            </ul>
          )
        }
        detailLabel="Enquiry preview"
        /* The header renders only when there is a record to name. An empty
           pane draws no hairline under nothing — there is no longer a seam for
           it to meet. */
        {...(detail.data
          ? {
              detailHeader: (
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {/* Both lines still truncate. Not because a shared height
                        depends on it any more, but because this block is
                        sticky: a subject that wraps to three lines would eat
                        the top of every scroll position beneath it. */}
                    <h2
                      className="truncate text-[16px] font-semibold leading-6"
                      title={detail.data.subject}
                    >
                      {detail.data.subject}
                    </h2>
                    <p className="truncate font-mono text-[12px] leading-[18px] text-ink-muted">
                      {detail.data.ref} · <DateText value={detail.data.receivedAt} withTime /> ·{" "}
                      {detail.data.assignedTo ? detail.data.assignedTo.name : "unassigned"}
                    </p>
                  </div>
                  <SecondaryButton>Assign to me</SecondaryButton>
                  <SecondaryButton onClick={() => navigate(`/sales/enquiries/${detailRef}`)}>
                    Open enquiry
                  </SecondaryButton>
                </div>
              ),
            }
          : {})}
        detail={
          detail.isPending && current ? (
            <LoadingState rows={5} label="Loading the enquiry" />
          ) : detail.isError ? (
            <ErrorState
              title="The enquiry did not load"
              error={toApiError(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          ) : !detail.data ? (
            <EmptyState
              title="Nothing selected"
              description="Pick an enquiry from the queue to see what the Lead Agent extracted."
            />
          ) : (
            /* §16b: the blocks are separated by SPACING, not by rules. The two
               `border-t border-divider` lines that used to bracket the
               suggestion are gone — a 24px gap and a heading already say where
               one block ends, and CLAUDE.md removes a border that is not
               resolving an ambiguity. */
            <div className="flex flex-col gap-7 px-5 pb-8 pt-5">
              <section className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2.5">
                  <h3 className="text-[13px] font-semibold text-ink">Original message</h3>
                  <span className="text-[12px] text-ink-muted">
                    {detail.data.from.email ?? detail.data.from.phone ?? detail.data.from.name} ·{" "}
                    <DateText value={detail.data.receivedAt} withTime />
                  </span>
                </div>
                <p className="max-w-[70ch] text-[14px] leading-[1.65] text-ink">
                  {detail.data.body}
                </p>
              </section>

              <section className="flex flex-col gap-2.5">
                {/* §16: the agent theatre goes. "EXTRACTED ✦ Lead Agent · 92%"
                    was a mono label, a chip and a confidence percentage spent
                    on four fields the reader can check themselves. The heading
                    names the block and a tiny tag says where it came from; the
                    provenance is still one click away in the AIChip popover on
                    the record page. */}
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h3 className="text-[13px] font-semibold text-ink">Enquiry details</h3>
                  <span className="text-[12px] text-ink-muted">AI extracted</span>
                  <GhostButton
                    className="ml-auto"
                    onClick={() => navigate(`/sales/enquiries/${detailRef}`)}
                  >
                    Edit before use
                  </GhostButton>
                </div>

                <dl className="grid grid-cols-4 gap-4">
                  <ExtractedCell label="Topic" value={detail.data.extraction.topic.value} />
                  <ExtractedCell label="Audience" value={detail.data.extraction.audience.value} />
                  <ExtractedCell label="Timing" value={detail.data.extraction.timing.value} />
                  <ExtractedCell
                    label="Budget"
                    value={
                      detail.data.extraction.budget.value ? (
                        <MoneyText value={detail.data.extraction.budget.value} compact />
                      ) : null
                    }
                  />
                </dl>

                {detail.data.matchedOrganisation ? (
                  <p className="text-[13px] text-ink-secondary">
                    Matched to{" "}
                    <button
                      type="button"
                      className="font-medium text-primary-hover underline-offset-2 hover:underline"
                      onClick={() => navigate(`/sales/organisations/${matchedRef}`)}
                    >
                      {detail.data.matchedOrganisation.name}
                    </button>{" "}
                    on {humanise(detail.data.matchedOrganisation.matchReason).toLowerCase()}
                  </p>
                ) : null}
              </section>

              {!suggestion ? (
                <section className="flex flex-col gap-2.5">
                  <h3 className="text-[13px] font-semibold text-ink">Recommended next step</h3>
                  <p className="max-w-[70ch] text-[13px] text-ink-muted">
                    The Lead Agent proposed no next step for this enquiry. Converting it is a human
                    decision, and it is recorded as one.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <PrimaryButton onClick={convert} disabled={action.isPending}>
                      Convert to lead
                    </PrimaryButton>
                    <SecondaryButton>Archive</SecondaryButton>
                  </div>
                  <ActionOutcome
                    response={response}
                    error={failure}
                    subject={`Convert ${detail.data.ref}`}
                    onDismiss={clearOutcome}
                  />
                </section>
              ) : (
                <section className="flex flex-col gap-2.5">
                  {/* §16 again: "SUGGESTED ACTION ✦ Lead Agent · 88% · Act with
                      approval" becomes a heading and a subline. "Requires
                      approval" is the fact that changes what the button does;
                      the confidence is not. */}
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[13px] font-semibold text-ink">Recommended next step</h3>
                    <span className="text-[12px] text-ink-muted">Requires approval</span>
                  </div>
                  <p className="max-w-[70ch] text-[14px] leading-[1.6] text-ink">
                    {suggestion.summary}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <PrimaryButton onClick={convert} disabled={action.isPending}>
                      Accept &amp; convert
                    </PrimaryButton>
                    <SecondaryButton onClick={() => navigate(`/sales/enquiries/${detailRef}`)}>
                      Edit first
                    </SecondaryButton>
                    <GhostButton>Dismiss</GhostButton>
                  </div>
                  <ActionOutcome
                    response={response}
                    error={failure}
                    subject={`Convert ${detail.data.ref}`}
                    onDismiss={clearOutcome}
                  />
                </section>
              )}
            </div>
          )
        }
      />

      <Fab />
    </div>
  );
}

function ExtractedCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={cn("text-[14px]", value ? "font-medium text-ink" : "text-ink-muted")}>
        {value ?? "not stated"}
      </dd>
    </div>
  );
}

function EnquiryRow({
  enquiry,
  selected,
  onSelect,
}: {
  enquiry: Enquiry;
  selected: boolean;
  onSelect: () => void;
}) {
  const archived = enquiry.status === "ARCHIVED";
  const needsReview = enquiry.classification.needsHumanReview === true;

  /* §16: "exception gets the component, normal data becomes typography".
     A classification the agent is confident about is a plain muted word on the
     meta line. Only the two exceptions — a low-confidence read a human has to
     settle, and a NOT_AN_ENQUIRY that archived itself — spend a chip. */
  const classification = needsReview ? (
    <StatusChip tone="warning">Needs human classification</StatusChip>
  ) : archived ? (
    <StatusChip>Auto-archived</StatusChip>
  ) : (
    <span className="truncate">{humanise(enquiry.classification.label)}</span>
  );

  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left hover:bg-surface-hover",
          selected && "bg-surface shadow-[inset_2px_0_0_rgb(var(--ink))]",
          archived && "opacity-85",
        )}
      >
        {/* §16b, row one: the title, with the money right-aligned in tabular
            numerals. The money used to be the fourth chip on a third row of
            chips — a `StatusChip` around a number, which is the one thing
            CLAUDE.md reserves chips against. It is a data column now. */}
        <span className="flex items-baseline gap-3">
          <span className="truncate text-[13px] font-semibold text-ink">
            {enquiry.from.name}
            {enquiry.matchedOrganisation
              ? ` · ${enquiry.matchedOrganisation.name}`
              : " · unmatched"}
          </span>
          {enquiry.estimatedValue ? (
            <span className="ml-auto shrink-0 text-[13px] font-medium text-ink">
              <MoneyText value={enquiry.estimatedValue} compact />
            </span>
          ) : null}
        </span>

        {/* Row two: where it came from, what it is, whose it is — and the time
            on the right. The channel is a glyph and a word rather than the
            bordered uppercase capsule it was. */}
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-muted">
          <span aria-hidden="true">{CHANNEL_GLYPH[enquiry.channel]}</span>
          <span className="shrink-0">{channelText(enquiry.channel)}</span>
          <span aria-hidden="true">·</span>
          {classification}
          <span aria-hidden="true">·</span>
          <span className="shrink-0 font-mono text-[11px]">{enquiry.ref}</span>
          <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[11px]">
            <DateText value={enquiry.receivedAt} withTime />
          </span>
        </span>

        <span className="line-clamp-2 text-[13px] leading-[1.45] text-ink-secondary">
          {enquiry.preview}
        </span>
      </button>
    </li>
  );
}
