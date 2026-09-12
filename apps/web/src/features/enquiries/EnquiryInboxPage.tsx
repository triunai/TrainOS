import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ActionResponse,
  Enquiry,
  EnquiryChannel,
  PageRequest,
  SavedView,
} from "@trainos/contract";
import {
  ActionOutcome,
  AIChip,
  DateText,
  EmptyState,
  ErrorState,
  Fab,
  FilterBar,
  GhostButton,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  RefChip,
  SecondaryButton,
  StatusChip,
  describeActionError,
  humanise,
  tabsFromViews,
  variantOf,
  type ActionError,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { cn } from "@/shared/lib/utils";
import {
  errorMessageOf,
  useAction,
  useActor,
  useEnquiries,
  useEnquiry,
  useEnquiryViews,
} from "./api";

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

const CHANNEL_LABEL: Record<EnquiryChannel, string> = {
  EMAIL: "EMAIL",
  WHATSAPP: "WHATSAPP",
  WEB_FORM: "WEB FORM",
  PHONE: "PHONE",
};

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

  const action = useAction();
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
        onSuccess: setResponse,
        onError: (thrown) => setFailure(describeActionError(thrown, errorMessageOf(thrown))),
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-5 pb-3 pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Enquiry inbox</h1>
          {enquiries.data ? (
            <StatusChip>{`${enquiries.data.page.total} in view`}</StatusChip>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SecondaryButton>Columns</SecondaryButton>
            <SecondaryButton>Export</SecondaryButton>
            <SecondaryButton>Log enquiry</SecondaryButton>
          </div>
        </div>

        {views.isPending ? null : (
          <PillTabGroup
            tabs={tabs}
            activeId={activeView}
            onSelect={(id) => {
              setActiveView(id);
              setSelectedRef(null);
            }}
            label="Saved views"
          />
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Enquiry queue"
          className="flex w-[496px] shrink-0 flex-col border-r border-border"
        >
          <FilterBar
            filters={filters}
            shown={rows.length}
            total={enquiries.data?.page.total}
            className="border-b border-border"
          />

          <div className="min-h-0 flex-1 overflow-auto">
            {enquiries.isPending ? (
              <LoadingState rows={6} label="Loading the enquiry queue" />
            ) : enquiries.isError ? (
              <ErrorState
                title="The queue did not load"
                description={errorMessageOf(enquiries.error)}
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
            )}
          </div>
        </section>

        <section
          aria-label="Enquiry preview"
          className="flex min-w-0 flex-1 flex-col overflow-auto"
        >
          {detail.isPending && current ? (
            <LoadingState rows={5} label="Loading the enquiry" />
          ) : detail.isError ? (
            <ErrorState
              title="The enquiry did not load"
              description={errorMessageOf(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          ) : !detail.data ? (
            <EmptyState
              title="Nothing selected"
              description="Pick an enquiry from the queue to see what the Lead Agent extracted."
            />
          ) : (
            <>
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h2 className="text-[16px] font-semibold">{detail.data.subject}</h2>
                  <p className="font-mono text-[12px] text-ink-muted">
                    {detail.data.ref} · received{" "}
                    <DateText value={detail.data.receivedAt} withTime /> ·{" "}
                    {detail.data.assignedTo ? detail.data.assignedTo.name : "unassigned"}
                  </p>
                </div>
                <SecondaryButton>Assign to me</SecondaryButton>
                <SecondaryButton onClick={() => navigate(`/sales/enquiries/${detail.data.ref}`)}>
                  Open enquiry
                </SecondaryButton>
              </div>

              <div className="flex flex-col gap-6 px-5 pb-6 pt-5">
                <section className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2.5">
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      Original enquiry
                    </h3>
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
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      Extracted
                    </h3>
                    <AIChip
                      provenance={detail.data.classification.provenance}
                      label="Lead Agent"
                      withoutPopover
                    />
                    <GhostButton
                      className="ml-auto"
                      onClick={() => navigate(`/sales/enquiries/${detail.data.ref}`)}
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
                        onClick={() =>
                          navigate(
                            `/sales/organisations/${detail.data.matchedOrganisation?.ref ?? ""}`,
                          )
                        }
                      >
                        {detail.data.matchedOrganisation.name}
                      </button>{" "}
                      on {humanise(detail.data.matchedOrganisation.matchReason).toLowerCase()}
                    </p>
                  ) : null}
                </section>

                {!suggestion ? (
                  <section className="flex flex-col gap-2.5 border-t border-divider pt-4">
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      Suggested action
                    </h3>
                    <p className="max-w-[70ch] text-[13px] text-ink-muted">
                      The Lead Agent proposed no next step for this enquiry. Converting it is a
                      human decision, and it is recorded as one.
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
                  <section className="flex flex-col gap-2.5 border-t border-divider pt-4">
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                        Suggested action
                      </h3>
                      <AIChip
                        provenance={suggestion.provenance}
                        label="Lead Agent"
                        withoutPopover
                      />
                      <span className="text-[12px] text-ink-muted">Act with approval</span>
                    </div>
                    <p className="max-w-[70ch] text-[14px] leading-[1.6] text-ink">
                      {suggestion.summary}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <PrimaryButton onClick={convert} disabled={action.isPending}>
                        Accept &amp; convert
                      </PrimaryButton>
                      <SecondaryButton
                        onClick={() => navigate(`/sales/enquiries/${detail.data.ref}`)}
                      >
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
            </>
          )}
        </section>
      </div>

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

  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-1.5 border-b border-border px-4 py-3 text-left hover:bg-surface-hover",
          selected && "bg-surface shadow-[inset_2px_0_0_rgb(var(--ink))]",
          archived && "opacity-85",
        )}
      >
        <span className="flex items-center gap-2">
          <RefChip refValue={CHANNEL_LABEL[enquiry.channel]} />
          <span className="truncate text-[13px] font-semibold text-ink">
            {enquiry.from.name}
            {enquiry.matchedOrganisation
              ? ` · ${enquiry.matchedOrganisation.name}`
              : " · unmatched"}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-muted">
            <DateText value={enquiry.receivedAt} withTime />
          </span>
        </span>

        <span className="line-clamp-2 text-[13px] leading-[1.45] text-ink-secondary">
          {enquiry.preview}
        </span>

        <span className="flex flex-wrap items-center gap-1.5">
          <AIChip
            variant={variantOf(enquiry.classification.provenance)}
            provenance={enquiry.classification.provenance}
            label={humanise(enquiry.classification.label)}
            withoutPopover
          />
          {needsReview ? <StatusChip tone="warning">Needs human classification</StatusChip> : null}
          {archived ? <StatusChip>Auto-archived</StatusChip> : null}
          {enquiry.estimatedValue ? (
            <StatusChip>
              <MoneyText value={enquiry.estimatedValue} compact />
            </StatusChip>
          ) : null}
        </span>
      </button>
    </li>
  );
}
