import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ContactSummary,
  LifecycleStep,
  Money,
  OrganisationRelations,
  PipelineStage,
  RelatedEngagement,
  RelatedHrdcPacket,
} from "@trainos/contract";
import {
  AIChip,
  CitationChip,
  DataTable,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  Fab,
  formatDate,
  formatDateRange,
  GhostButton,
  HRDC_PACKET_PANEL_TONE,
  humanise,
  INVOICE_TONE,
  LifecycleStepper,
  LoadingState,
  MoneyText,
  ORGANISATION_TONE,
  PartialDataBanner,
  PillTabGroup,
  PrimaryButton,
  RecordHeader,
  RefChip,
  SecondaryButton,
  StatusChip,
  stepLabel,
  type Column,
} from "@/shared/components/kit";
import { toApiError } from "@/shared/api";
import { useBreadcrumb } from "@/shared/components/layout";
import {
  useDealChainStages,
  useOrganisation,
  useOrganisationRelations,
  useOrganisationSuggestions,
} from "./api";
import { ORGANISATIONS_LIST_PATH } from "./paths";

/**
 * M04-S02 · Organisation 360 (Kit.dc.html `proof-m04s02`).
 *
 * This is the canonical record page — breadcrumb, title and status chips,
 * identity line, metric strip, chain stepper, tabs, exception banner,
 * relationship panels, right rail. Every other record screen reuses this
 * skeleton, so nothing here may be special-cased for organisations.
 *
 * Record identity appears exactly once: RecordHeader owns the title, the
 * breadcrumb owns the path, and neither repeats the other.
 *
 * The primary is "New opportunity". It is a navigation, not an envelope call —
 * `OPPORTUNITY_CREATE` is a UI intent in the contract, not a governed action —
 * so no approval can be queued from this screen and none is drawn.
 */

const TAB_OVERVIEW = "overview";

/**
 * The step that decides how the row reads: a failure first, then a block, then
 * whatever is current. Pending stages say nothing a reader needs in one line.
 */
function decisiveStep(engagement: RelatedEngagement): LifecycleStep | undefined {
  const byState = (state: LifecycleStep["state"]) =>
    engagement.lifecycle.find((step) => step.state === state);
  return byState("FAILED") ?? byState("BLOCKED") ?? byState("CURRENT");
}

/**
 * The words after the ref in the row's subline, e.g. `ENG-0198 · delivery blocked`.
 *
 * Both halves are derived, neither is written here: the stage name comes from
 * pipeline configuration through `stepLabel` — CLAUDE.md's standing rule — and
 * the state word from the contract's own `LifecycleState`. That is why this
 * does not reproduce the artboard's literal "proposed" / "claim blocked" /
 * "lost": those are mock copy for a chain the artboard invented, and a tenant
 * that renames a stage must see its own name here.
 *
 * A stage alone would not do. "delivery" reads like ordinary progress on a row
 * whose delivery is BLOCKED, which is the one thing the subline exists to say.
 */
function engagementState(
  engagement: RelatedEngagement,
  stages: PipelineStage[] | undefined,
): string {
  const step = decisiveStep(engagement);
  /* Nothing failed, blocked or in flight: every stage is behind it. */
  if (!step) return "complete";

  const stage = stepLabel(step, stages).toLowerCase();
  if (step.state === "FAILED") return `${stage} failed`;
  if (step.state === "BLOCKED") return `${stage} blocked`;
  return stage;
}

export function Organisation360Page() {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState(TAB_OVERVIEW);

  /* Ends at the LIST. `RecordHeader` carries `recordRef`, so an id here is the
     record identifying itself a second time — CLAUDE.md gives the identity to
     the header and the path to the breadcrumb. */
  useBreadcrumb([{ label: "Sales" }, { label: "Organisations", href: ORGANISATIONS_LIST_PATH }]);

  const organisation = useOrganisation(organisationId);
  const relations = useOrganisationRelations(organisationId);
  const suggestions = useOrganisationSuggestions(organisationId);
  const stages = useDealChainStages();

  const related: OrganisationRelations = relations.data ?? {};
  const engagements = related.engagements ?? [];
  const contacts = related.contacts ?? [];
  const invoices = related.invoices ?? [];
  const hrdc = related.hrdc;

  const overdueInvoice = invoices.find((invoice) => invoice.status === "OVERDUE");

  const tabs = useMemo(
    () => [
      { id: TAB_OVERVIEW, label: "Overview" },
      { id: "contacts", label: "Contacts", count: contacts.length },
      { id: "engagements", label: "Engagements", count: engagements.length },
      { id: "finance", label: "Finance", count: invoices.length },
      { id: "hrdc", label: "HRD Corp", count: hrdc?.packets.length },
    ],
    [contacts.length, engagements.length, invoices.length, hrdc],
  );

  if (organisation.isPending) return <LoadingState rows={8} label="Loading the organisation" />;

  if (organisation.isError || !organisation.data) {
    return (
      <ErrorState
        title="The organisation did not load"
        error={toApiError(organisation.error)}
        onRetry={() => void organisation.refetch()}
      />
    );
  }

  const org = organisation.data;

  /* The header's variant-A stepper walks the CURRENT engagement — the most
     recent one the organisation has in flight. Labels and order come from the
     DEAL_CHAIN pipeline configuration, never from this file. */
  const currentEngagement = engagements[0];

  const engagementColumns: Column<RelatedEngagement>[] = [
    {
      key: "engagement",
      label: "Engagement",
      accessor: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink">{row.title}</span>
          <span className="font-mono text-[11px] text-ink-muted">
            {row.ref} · {engagementState(row, stages.data?.stages)}
          </span>
        </div>
      ),
    },
    {
      key: "progress",
      label: "Progress",
      width: "180px",
      accessor: (row) => (
        <LifecycleStepper steps={row.lifecycle} stages={stages.data?.stages} variant="table" />
      ),
    },
    {
      key: "dates",
      label: "Dates",
      width: "160px",
      accessor: (row) => <span className="text-ink-secondary">{formatDateRange(row.dates)}</span>,
    },
    {
      key: "value",
      label: "Value",
      align: "right",
      width: "148px",
      /* The artboard greys a lost engagement's value rather than striking it
         through: the number is still true, it just stopped mattering. */
      accessor: (row) => (
        <MoneyText
          value={row.value}
          className={decisiveStep(row)?.state === "FAILED" ? "text-ink-muted" : undefined}
        />
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordHeaderBlock
        org={org}
        currentEngagement={currentEngagement}
        stages={stages.data?.stages}
        onNewOpportunity={() => navigate("/sales/pipeline")}
      />

      {/* DEAL_CHAIN is what names and orders the chain stepper's stages. A
          failed read left `stages.data?.stages` undefined, which the stepper
          and the engagement subline both treat as "no configuration" and fall
          back from — so a dropped request rendered as a pipeline with no
          labels rather than as a failure. */}
      <PartialDataBanner
        className="mx-5 mb-2.5"
        reads={[
          {
            label: "The deal chain's stage names",
            error: stages.isError ? toApiError(stages.error) : null,
            retry: () => void stages.refetch(),
          },
        ]}
      />

      <div className="px-5 pb-2.5">
        <PillTabGroup tabs={tabs} activeId={tab} onSelect={setTab} label="Organisation sections" />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-5 pb-5">
          {relations.isPending ? (
            <LoadingState rows={6} label="Loading relationships" />
          ) : relations.isError ? (
            <ErrorState
              title="Relationships did not load"
              error={toApiError(relations.error)}
              onRetry={() => void relations.refetch()}
            />
          ) : (
            <>
              {overdueInvoice ? (
                <ExceptionBanner
                  severity="DANGER"
                  title={`${overdueInvoice.ref} overdue ${overdueInvoice.daysOverdue ?? 0} days`}
                  subtitle="Collections Agent has drafted a second reminder — awaiting your approval"
                  action={
                    <SecondaryButton onClick={() => navigate("/finance/collections")}>
                      Review draft
                    </SecondaryButton>
                  }
                />
              ) : null}

              {/* Overview shows every panel; a named tab narrows to one. The
                  tab is a filter over the same panels, never a different page,
                  so no relationship gets a second layout. */}
              {tab === TAB_OVERVIEW || tab === "engagements" ? (
                <section className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2 pb-1">
                    <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      Engagements · {engagements.length}
                    </h2>
                    <GhostButton
                      className="ml-auto"
                      onClick={() => navigate("/training/engagements")}
                    >
                      View all
                    </GhostButton>
                  </div>
                  <DataTable
                    label={`Engagements for ${org.name}`}
                    columns={engagementColumns}
                    rows={engagements}
                    rowKey={(row) => row.ref}
                    density="compact"
                    stickyHeader={false}
                  />
                </section>
              ) : null}

              {tab === "finance" ? (
                <section className="flex flex-col gap-2">
                  <h2 className="pb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                    Invoices · {invoices.length}
                  </h2>
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.ref}
                      className="flex items-center gap-2.5 border-b border-divider py-2 text-[13px]"
                    >
                      <RefChip type="INVOICE" />
                      <span className="font-medium text-ink">{invoice.ref}</span>
                      <StatusChip tone={INVOICE_TONE[invoice.status]}>
                        {humanise(invoice.status)}
                        {invoice.daysOverdue ? ` · ${invoice.daysOverdue} days` : ""}
                      </StatusChip>
                      <span className="ml-auto">
                        <MoneyText value={invoice.amount} />
                      </span>
                    </div>
                  ))}
                </section>
              ) : null}

              <div
                className={
                  tab === TAB_OVERVIEW ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"
                }
              >
                {tab === TAB_OVERVIEW || tab === "contacts" ? (
                  <section className="flex flex-col gap-1 border-t border-divider pt-2.5">
                    <h2 className="pb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      Contacts · {contacts.length}
                    </h2>
                    {contacts.map((contact) => (
                      <ContactRow key={contact.ref} contact={contact} />
                    ))}
                  </section>
                ) : null}

                {tab === TAB_OVERVIEW || tab === "hrdc" ? (
                  <section className="flex flex-col gap-2 border-t border-divider pt-2.5">
                    <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      HRD Corp
                    </h2>
                    {hrdc ? (
                      <div className="flex flex-col gap-2 text-[13px]">
                        <div className="flex items-center justify-between">
                          <span className="text-ink-secondary">Levy available</span>
                          <MoneyText value={hrdc.levyAvailable} compact />
                        </div>
                        {hrdc.packets.map((packet) => (
                          <PacketRow key={packet.ref} packet={packet} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[13px] text-ink-muted">Not registered with HRD Corp.</p>
                    )}
                  </section>
                ) : null}
              </div>
            </>
          )}
        </div>

        <aside
          aria-label="Assistant"
          className="flex w-[340px] shrink-0 flex-col gap-3 overflow-auto border-l border-border bg-surface px-3.5 py-3.5"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold">Assistant</h2>
            <span className="text-[12px] text-ink-muted">context: {org.ref}</span>
          </div>

          {/* `?? []` made an errored read pixel-identical to an organisation
              with nothing to suggest. The rail is a region of its own, so it
              carries its own three branches rather than folding into the
              page-level banner. */}
          {suggestions.isError ? (
            <ErrorState
              className="px-0 py-8"
              title="Suggestions did not load"
              error={toApiError(suggestions.error)}
              onRetry={() => void suggestions.refetch()}
            />
          ) : null}

          {suggestions.isPending ? (
            <LoadingState rows={3} label="Loading cross-sell suggestions" />
          ) : null}

          {/* The third branch the `?? []` collapsed. An organisation the
              cross-sell agent has nothing to say about is an ordinary,
              frequent state — a new account, or one already holding every
              programme it is eligible for — and it deserves a sentence rather
              than a rail that merely stops. */}
          {suggestions.data && suggestions.data.data.length === 0 ? (
            <EmptyState
              className="px-0 py-8"
              title="No suggestions for this organisation"
              description="Cross-sell suggestions appear here when the agent finds a programme this account has not bought and is eligible for."
            />
          ) : null}

          {(suggestions.data?.data ?? []).map((suggestion) => (
            <article
              key={suggestion.programmeId}
              className="overflow-hidden rounded-control border border-border bg-card"
            >
              <div className="flex items-center gap-2 border-b border-primary-border bg-ai-tint px-2.5 py-2">
                <AIChip provenance={suggestion.provenance} label="Cross-sell suggestion" />
              </div>
              <div className="flex flex-col gap-2 p-2.5">
                <p className="text-[12px] leading-[1.55] text-ink-secondary">
                  {suggestion.rationale}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(suggestion.provenance.sources ?? []).map((source, index) => (
                    <CitationChip
                      key={`${source.ref}-${index}`}
                      variant="inline"
                      label={`Source ${index + 1}: ${source.ref}`}
                    >
                      {index + 1}
                    </CitationChip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestion.actions.map((suggestionAction) => (
                    <SecondaryButton
                      key={suggestionAction.type}
                      onClick={
                        suggestionAction.type === "OPPORTUNITY_CREATE"
                          ? () => navigate("/sales/pipeline")
                          : undefined
                      }
                    >
                      {suggestionAction.label}
                    </SecondaryButton>
                  ))}
                </div>
              </div>
            </article>
          ))}

          <section className="flex flex-col gap-1.5 border-t border-divider pt-3">
            <h3 className="pb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              Related records
            </h3>
            <RailRow label="Engagements" value={`${engagements.length}`} />
            <RailRow
              label="Invoices"
              value={`${invoices.length} · ${invoices.filter((i) => i.status === "OVERDUE").length} overdue`}
            />
            <RailRow label="Contacts" value={`${contacts.length}`} />
          </section>
        </aside>
      </div>

      <Fab />
    </div>
  );
}

/* The header is lifted out so the page body reads as a sequence of sections
   rather than one 200-line expression. It is the kit's RecordHeader with the
   record's own values — no second header pattern exists. */
function RecordHeaderBlock({
  org,
  currentEngagement,
  stages,
  onNewOpportunity,
}: {
  org: NonNullable<ReturnType<typeof useOrganisation>["data"]>;
  currentEngagement: RelatedEngagement | undefined;
  /* Ruling R16 gave `PipelineStage` a `terminal` flag, and this prop had been
     a structural copy of the old three fields — a fourth spelling of a
     contract type, which is how a stage list silently loses a field. */
  stages: PipelineStage[] | undefined;
  onNewOpportunity: () => void;
}) {
  const metrics = org.metrics;

  return (
    <RecordHeader
      /* §15a / M04-S02: "the record-page pattern every entity in the chain
         inherits". The second proof of the accent card, and the first one with
         a stepper and a mini bar inside it — both of which read the card
         through `useOnAccent`, so nothing here says "blue". */
      accent
      collapsible
      recordType="organisation"
      title={org.name}
      recordRef={org.ref}
      meta={[
        humanise(org.industry),
        org.location,
        `owner ${org.owner.name ?? org.owner.id}`,
        `created ${formatDate(org.createdAt)}`,
      ]}
      chips={
        <>
          <StatusChip tone={ORGANISATION_TONE[org.status]} live>
            {humanise(org.status)}
          </StatusChip>
          {org.hrdcRegistered ? <StatusChip tone="info">HRD Corp registered</StatusChip> : null}
        </>
      }
      actions={<SecondaryButton>Audit trail</SecondaryButton>}
      primaryAction={<PrimaryButton onClick={onNewOpportunity}>New opportunity</PrimaryButton>}
      metrics={[
        {
          label: "Lifetime value",
          value: metrics.lifetimeValue.value as Money,
          sub: metrics.lifetimeValue.secondary,
        },
        {
          label: "Open pipeline",
          value: metrics.openPipeline.value as Money,
          sub: metrics.openPipeline.secondary,
        },
        {
          label: "AR overdue",
          value: metrics.arOverdue.value as Money,
          sub: metrics.arOverdue.secondary,
        },
        {
          label: "HRDC levy",
          value: metrics.hrdcLevyAvailable.value as Money,
          sub: metrics.hrdcLevyAvailable.secondary,
        },
        {
          label: "Health",
          value: `${metrics.healthScore.value as number}`,
          sub: metrics.healthScore.secondary,
          bar: (metrics.healthScore.value as number) / 100,
        },
      ]}
      stepper={
        currentEngagement ? (
          <LifecycleStepper steps={currentEngagement.lifecycle} stages={stages} variant="header" />
        ) : undefined
      }
    />
  );
}

function ContactRow({ contact }: { contact: ContactSummary }) {
  const noConsent = !contact.consent.email && !contact.consent.whatsapp;

  return (
    <div className="flex items-center gap-2.5 py-1.5 text-[13px]">
      <RefChip type="CONTACT" />
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{contact.name}</div>
        <div className="truncate text-[11px] text-ink-muted">
          {contact.role}
          {contact.primary ? " · primary" : ""}
          {noConsent ? " · no consent" : ""}
        </div>
      </div>
      {contact.pdpaFlag ? (
        <StatusChip tone="warning" className="ml-auto">
          PDPA
        </StatusChip>
      ) : null}
    </div>
  );
}

function PacketRow({ packet }: { packet: RelatedHrdcPacket }) {
  const atRisk = packet.daysRemaining !== undefined && packet.daysRemaining <= 7;

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-secondary">{packet.ref} claim</span>
      <StatusChip tone={HRDC_PACKET_PANEL_TONE[packet.state]}>
        {packet.state === "BLOCKED"
          ? `Blocked · ${packet.missingDocuments ?? 0} docs`
          : atRisk
            ? `Apply within ${packet.daysRemaining} days`
            : humanise(packet.state)}
      </StatusChip>
    </div>
  );
}

function RailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-ink-secondary">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
