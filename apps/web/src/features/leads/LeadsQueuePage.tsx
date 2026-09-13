import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Contact, Money, Opportunity, PipelineStage } from "@trainos/contract";
import {
  DateText,
  EmptyState,
  ErrorState,
  formatMoney,
  LoadingState,
  MoneyText,
  OPPORTUNITY_TONE,
  plural,
  ListToolbar,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  SecondaryButton,
  SplitWorkspace,
  StatusChip,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import { useContacts, useOpportunities, useOpportunity, useOpportunityStages } from "./api";

/**
 * Sales › Leads. No artboard: M03 draws the enquiry inbox and M04-S02 the
 * organisation record, and the design pack never draws this screen.
 *
 * THE SPLIT, per the 13 Sep ruling that reversed the morning's aligned
 * 72px header. The two panes are INDEPENDENT: there is no shared header row and
 * no shared hairline, only the rule between them. The list has no header block
 * at all — it starts immediately under the toolbar, because the tab row already
 * says how many are in view and a second count under it was the same fact
 * twice. The detail pane owns a sticky header of its own and scrolls on its
 * own, so the title, the refs and the actions stay reachable at any scroll
 * position without the list moving with them.
 *
 * `minmax(360px, 40%) 1fr`: the list needs a floor wide enough for a client
 * name and a money column, and a ceiling that stops it eating the record.
 *
 * All of that is the kit's `SplitWorkspace` now, which this screen composes.
 * The rules above were built here first, before the component landed; adopting
 * it was the deletion this docblock promised it would be.
 *
 * A lead here is a §5 `Opportunity`: the thing an accepted enquiry becomes.
 * `/sales/pipeline` shows the same objects as a board. Two views of one object
 * is not the divergence CLAUDE.md forbids — the vocabulary, the stage names and
 * the chips are shared, and only the arrangement differs.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT DO, and why:
 *
 *  - It renders NO `LifecycleStepper`. An `Opportunity` carries a `stage` and
 *    no `lifecycle`, so a chain here would have to be computed from the stage
 *    list — which is exactly what the stepper's own contract forbids ("no
 *    client-side computation of which stage is current"). Worse, the pipeline
 *    config marks no stage as terminal or negative, so a computed chain would
 *    read `LOST` as the stage after `WON` and draw every lost deal as a won one
 *    with one more step to go. The stage is a chip instead, which is where
 *    CLAUDE.md puts status colour anyway.
 *  - It offers no stage change. `PATCH /v1/opportunities/{id}` exists, but for
 *    the same reason there is no honest "next stage" to advance to. Reported as
 *    a contract gap rather than guessed at.
 *
 * The one solid primary is a navigation, as it is on M04-S02: opening the
 * organisation record is what a consultant does next with a lead, and no
 * governed action is reachable from a queue.
 */

/** The tab that applies no stage filter at all. */
const ALL_TAB = "all";

/** A closing date already behind us. The one exception a row calls out. */
function overdue(opportunity: Opportunity, today: string): boolean {
  return Boolean(opportunity.expectedCloseDate && opportunity.expectedCloseDate < today);
}

/**
 * `probability` is a §1 decimal fraction, so it is a percentage for a reader
 * and never a raw `0.3`. Absent means the owner has not judged it, which is a
 * different fact from zero.
 */
function probabilityText(value: number | undefined): string | null {
  if (typeof value !== "number") return null;
  return `${Math.round(value * 100)}% likely`;
}

export function LeadsQueuePage() {
  useBreadcrumb([{ label: "Sales" }, { label: "Leads" }]);

  const navigate = useNavigate();
  const [activeStage, setActiveStage] = useState<string>(ALL_TAB);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  const stages = useOpportunityStages();
  const leads = useOpportunities();
  const directory = useOrganisationDirectory();
  const contacts = useContacts();

  const rows = useMemo(() => leads.data?.data ?? [], [leads.data]);
  const stageList: PipelineStage[] = useMemo(
    () => [...(stages.data?.stages ?? [])].sort((left, right) => left.order - right.order),
    [stages.data],
  );

  const visible = useMemo(
    () => (activeStage === ALL_TAB ? rows : rows.filter((row) => row.stage === activeStage)),
    [rows, activeStage],
  );

  const current = selectedRef ?? visible[0]?.ref ?? null;
  const detail = useOpportunity(current ?? undefined);

  /* Every configured stage gets a segment, including the ones holding nothing.
     A tab row that hides its empty stages teaches the reader a pipeline shape
     the tenant does not have, and hides the gap that matters most — the stage
     with no deals in it. */
  const tabs = useMemo(
    () => [
      { id: ALL_TAB, label: "All", count: rows.length },
      ...stageList.map((stage) => ({
        id: stage.key,
        label: stage.label,
        count: rows.filter((row) => row.stage === stage.key).length,
      })),
    ],
    [rows, stageList],
  );

  /* One currency per tenant in the pack, so the fold takes the first row's.
     A mixed-currency book would need a per-currency total rather than a sum,
     and summing across currencies silently is the failure worth avoiding. */
  const bookValue = useMemo<Money | null>(
    () =>
      rows.reduce<Money | null>(
        (total, row) =>
          total ? { amount: total.amount + row.value.amount, currency: total.currency } : row.value,
        null,
      ),
    [rows],
  );

  /* Today as a `DateOnly` string. ISO dates sort lexically, so the comparison
     needs no Date parsing and no timezone. */
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const organisation = directory.byRef(detail.data?.organisationRef);
  const leadContacts: Contact[] = (contacts.data?.data ?? []).filter(
    (contact) => contact.organisationRef === detail.data?.organisationRef,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordHeader
        withoutCondensed
        title="Leads"
        meta={[
          leads.data ? plural(leads.data.page.total, "lead") : null,
          /* "across the book", not "in play": pipeline configuration marks no
             stage as terminal, so this total includes the won and the lost and
             the screen must not claim otherwise. */
          bookValue ? `${formatMoney(bookValue, true)} across the book` : null,
        ]}
        actions={
          <SecondaryButton onClick={() => navigate("/sales/pipeline")}>
            Pipeline board
          </SecondaryButton>
        }
      />

      {stages.isError ? (
        <div className="px-5 pb-4">
          <ErrorState
            title="The stage list did not load"
            description="Stage names come from pipeline configuration, so the queue cannot be split by stage until this loads."
            error={toApiError(stages.error)}
            onRetry={() => void stages.refetch()}
          />
        </div>
      ) : stages.isPending ? null : (
        /* Brief §10b: the tabs and any narrowing share ONE row, with the work
           directly beneath. There is no FilterBar here because this screen has
           no filter beyond the tabs — a bar rendering only "5 of 5 shown" would
           be the count the tab row already carries. */
        <ListToolbar
          className="px-5 pb-4"
          tabs={
            <PillTabGroup
              tabs={tabs}
              activeId={activeStage}
              onSelect={(id) => {
                setActiveStage(id);
                setSelectedRef(null);
              }}
              label="Pipeline stages"
            />
          }
        />
      )}

      {/* The two independent panes, now the kit's. This screen built the rules
          by hand because SplitWorkspace had not landed; adopting it is the
          deletion its docblock promised, and the grid, the seam, the two
          scrolls and the sticky header all move into one place. */}
      <SplitWorkspace
        listLabel="Lead queue"
        list={
          leads.isPending ? (
            <LoadingState rows={6} label="Loading the lead queue" />
          ) : leads.isError ? (
            <ErrorState
              title="The lead queue did not load"
              error={toApiError(leads.error)}
              onRetry={() => void leads.refetch()}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="No leads at this stage"
              description="Nothing has reached this stage of the pipeline. Switch to All to see the whole book."
            />
          ) : (
            <ul className="flex flex-col">
              {visible.map((lead) => (
                <LeadRow
                  key={lead.ref}
                  lead={lead}
                  organisationName={directory.nameOf(lead.organisationRef)}
                  stages={stageList}
                  overdue={overdue(lead, today)}
                  selected={lead.ref === current}
                  onSelect={() => setSelectedRef(lead.ref)}
                />
              ))}
            </ul>
          )
        }

        detailLabel="Lead preview"
        /* The sticky geometry moves into the kit; what stays here is the
           record's own identity, which is the only part this screen knows. */
        {...(detail.data
          ? {
              detailHeader: (
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h2
                      className="truncate text-[16px] font-semibold leading-6"
                      title={directory.nameOf(detail.data.organisationRef)}
                    >
                      {directory.nameOf(detail.data.organisationRef)}
                    </h2>
                    <p className="truncate font-mono text-[12px] leading-[18px] text-ink-muted">
                      {detail.data.ref} · {stageLabelOf(detail.data.stage, stageList)} · owner{" "}
                      {detail.data.owner.name}
                    </p>
                  </div>
                  {detail.data.sourceEnquiryRef ? (
                    <SecondaryButton
                      onClick={() =>
                        navigate(`/sales/enquiries/${detail.data?.sourceEnquiryRef ?? ""}`)
                      }
                    >
                      Open enquiry
                    </SecondaryButton>
                  ) : null}
                  <PrimaryButton
                    onClick={() =>
                      navigate(`/sales/organisations/${detail.data?.organisationRef ?? ""}`)
                    }
                  >
                    Open organisation
                  </PrimaryButton>
                </div>
              ),
            }
          : {})}
        detail={
          detail.isPending && current ? (
            <LoadingState rows={5} label="Loading the lead" />
          ) : detail.isError ? (
            <ErrorState
              title="The lead did not load"
              error={toApiError(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          ) : !detail.data ? (
            <EmptyState
              title="Nothing selected"
              description="Pick a lead from the queue to see the deal, the client and the people behind it."
            />
          ) : (
            <>
              {/* Blocks are separated by SPACING, not rules: removing a border
                  here leaves no relationship ambiguous, which CLAUDE.md says is
                  the test for keeping one. */}
              <div className="flex flex-col gap-8 px-5 pb-8 pt-6">
                {/* Money and dates are typography, not badges — §16. The stage
                    is the one value that gets a chip, because it is the one
                    that is a status. */}
                <section className="flex flex-col gap-2.5">
                  <h3 className="text-[13px] font-semibold text-ink">The deal</h3>
                  <dl className="grid grid-cols-4 gap-4">
                    <DetailCell
                      label="Value"
                      value={<MoneyText value={detail.data.value} compact />}
                    />
                    <DetailCell
                      label="Stage"
                      value={
                        <StatusChip tone={OPPORTUNITY_TONE[detail.data.stage]} live>
                          {stageLabelOf(detail.data.stage, stageList)}
                        </StatusChip>
                      }
                    />
                    <DetailCell
                      label="Confidence"
                      value={probabilityText(detail.data.probability)}
                    />
                    <DetailCell
                      label="Expected close"
                      value={
                        detail.data.expectedCloseDate ? (
                          <DateText value={detail.data.expectedCloseDate} />
                        ) : null
                      }
                    />
                  </dl>
                </section>

                <section className="flex flex-col gap-2.5">
                  <h3 className="text-[13px] font-semibold text-ink">The client</h3>
                  {directory.query.isPending ? (
                    <LoadingState rows={2} label="Loading the organisation" />
                  ) : directory.query.isError ? (
                    <ErrorState
                      title="The organisation did not load"
                      description="The lead is real; the client's name and industry are not available."
                      error={toApiError(directory.query.error)}
                      onRetry={() => void directory.query.refetch()}
                    />
                  ) : !organisation ? (
                    <EmptyState
                      title="Organisation not in the book"
                      description={`${detail.data.organisationRef} is referenced by this lead but is not in the organisation list.`}
                    />
                  ) : (
                    <dl className="grid grid-cols-4 gap-4">
                      <DetailCell label="Industry" value={titleCase(organisation.industry)} />
                      <DetailCell label="Location" value={organisation.location} />
                      <DetailCell label="Owner" value={organisation.owner.name} />
                      <DetailCell
                        label="HRD Corp"
                        value={
                          organisation.hrdcRegistered
                            ? (organisation.hrdcEmployerCode ?? "registered")
                            : "not registered"
                        }
                      />
                    </dl>
                  )}
                </section>

                <section className="flex flex-col gap-2.5">
                  <h3 className="text-[13px] font-semibold text-ink">Who to talk to</h3>
                  {contacts.isPending ? (
                    <LoadingState rows={2} label="Loading the contacts" />
                  ) : contacts.isError ? (
                    <ErrorState
                      title="The contacts did not load"
                      error={toApiError(contacts.error)}
                      onRetry={() => void contacts.refetch()}
                    />
                  ) : leadContacts.length === 0 ? (
                    <EmptyState
                      title="No contact on record"
                      description="Nobody at this organisation has been recorded yet, so there is no one to send a proposal to."
                    />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {leadContacts.map((contact) => (
                        <li key={contact.ref} className="flex flex-wrap items-baseline gap-2">
                          <span className="text-[14px] font-medium text-ink">{contact.name}</span>
                          <span className="text-[13px] text-ink-secondary">{contact.role}</span>
                          {contact.primary ? <StatusChip>Primary</StatusChip> : null}
                          {/* Consent is an EXCEPTION, so it is only drawn when
                              it is missing. A green "consent on record" chip on
                              every row would spend colour on the normal case. */}
                          {contact.pdpaFlag ? (
                            <StatusChip tone="warning">{titleCase(contact.pdpaFlag)}</StatusChip>
                          ) : null}
                          <span className="ml-auto font-mono text-[11px] text-ink-muted">
                            {contact.ref}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )
        }
      />
    </div>
  );
}

/** The configured label for a stage key, never a hardcoded word. */
function stageLabelOf(key: string, stages: PipelineStage[]): string {
  return stages.find((stage) => stage.key === key)?.label ?? key;
}

/** `NO_CONSENT` and `MANUFACTURING` are machine values; a reader gets words. */
function titleCase(value: string): string {
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function DetailCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={cn("text-[14px]", value ? "font-medium text-ink" : "text-ink-muted")}>
        {value ?? "not stated"}
      </dd>
    </div>
  );
}

/**
 * One row, three layers — the shape §16 sets for every list screen, with the
 * 13 Sep ruling's amendment: a chip never gets a row to itself.
 *
 *   Aurora Manufacturing Sdn Bhd                              RM 18,500
 *   OPP-0512 · Amirah Yusof
 *   [Won]  [Close date passed]                              30 Sep 2026
 *
 * The client is the strongest line, the ref and the owner are muted machine
 * context, and money sits in a fixed right column in tabular numerals rather
 * than in a badge. The third row pairs the stage chip with the date, so the
 * chip is carried by a line that says something rather than floating alone.
 */
function LeadRow({
  lead,
  organisationName,
  stages,
  overdue: isOverdue,
  selected,
  onSelect,
}: {
  lead: Opportunity;
  organisationName: string;
  stages: PipelineStage[];
  overdue: boolean;
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
          "flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left hover:bg-surface-hover",
          selected && "bg-surface shadow-[inset_2px_0_0_rgb(var(--ink))]",
        )}
      >
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold text-ink">{organisationName}</span>
          <MoneyText value={lead.value} compact className="ml-auto shrink-0 text-[13px] text-ink" />
        </span>

        <span className="flex items-baseline gap-2 truncate font-mono text-[11px] text-ink-muted">
          {`${lead.ref} · ${lead.owner.name}`}
        </span>

        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <StatusChip tone={OPPORTUNITY_TONE[lead.stage]}>
            {stageLabelOf(lead.stage, stages)}
          </StatusChip>
          {isOverdue ? <StatusChip tone="warning">Close date passed</StatusChip> : null}
          {lead.expectedCloseDate ? (
            <span className="ml-auto shrink-0 text-[12px] tabular-nums text-ink-muted">
              <DateText value={lead.expectedCloseDate} />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
