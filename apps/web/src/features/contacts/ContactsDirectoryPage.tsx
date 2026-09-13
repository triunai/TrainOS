import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ChannelConsent,
  Contact,
  Organisation,
  OrganisationRelations,
  RelatedEngagement,
  RelatedInvoice,
} from "@trainos/contract";
import {
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  INVOICE_TONE,
  LifecycleStepper,
  ListToolbar,
  LoadingState,
  MoneyText,
  ORGANISATION_TONE,
  PillTabGroup,
  plural,
  PrimaryButton,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  channelLabel,
  humanise,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import { useContact, useContactConsent, useContacts, useOrganisationRelations } from "./api";

/**
 * Sales › Contacts. No artboard. The pane's anatomy is M04-S02's — identity
 * line, then the relations panel behind a tab group — which is the only anatomy
 * in the pack for "a record and the things attached to it".
 *
 * THE SPLIT, per the 13 Sep ruling that reversed the morning's aligned 72px
 * header: two independent panes, no shared header row, no shared hairline. The
 * directory starts immediately under the toolbar because the tab row already
 * counts it, and the record pane owns a sticky header and its own scroll.
 * `minmax(360px, 40%) 1fr`. The kit's `SplitWorkspace` had not landed when this
 * was written, so the rules are built here; adopting it is a deletion.
 *
 * TWO DECISIONS THE ANATOMY FORCED, both recorded rather than quietly taken:
 *
 *  - The pane's identity is an `h2` and a mono meta line, not a `RecordHeader`.
 *    RecordHeader renders an `h1`, and this page already has one: CLAUDE.md
 *    says record identity appears once per page, and a master/detail screen
 *    whose pane claims a second `h1` has two page titles. The enquiry inbox
 *    made the same call for the same reason.
 *  - No MetricStrip. M04-S02 carries one, but every metric in §5 belongs to the
 *    ORGANISATION — lifetime value, open pipeline, AR overdue, levy. Printing
 *    them under a person's name attributes a company's numbers to one employee.
 *    The relations panel is captioned as the organisation's for the same
 *    reason, and the metrics stay on the organisation record that owns them.
 *
 * The three exceptions this screen exists to surface are consent-shaped:
 * `pdpaFlag` on the record, a channel with `granted: false`, and a contact with
 * no consent row at all. §16's rule applies — the exception gets the component,
 * normal data becomes typography — so a contact who can be contacted carries no
 * chip, and only the ones who cannot are marked.
 */

const ALL_TAB = "all";
const PRIMARY_TAB = "primary";
const BLOCKED_TAB = "blocked";

const QUEUE_TABS = [
  { id: ALL_TAB, label: "All" },
  { id: PRIMARY_TAB, label: "Primary" },
  { id: BLOCKED_TAB, label: "Consent missing" },
] as const;

const RELATION_ENGAGEMENTS = "engagements";
const RELATION_INVOICES = "invoices";
const RELATION_HRDC = "hrdc";

/**
 * A contact nobody may write to. Either flag is enough: the record's own
 * `pdpaFlag` is the compliance answer and the two booleans are the operational
 * one, and a screen that trusted only one of them would let a send through.
 */
/**
 * The record-level PDPA flag, worded so it cannot be mistaken for a channel's
 * answer. Both render as a warning chip, and three chips reading "No consent"
 * side by side would say nothing about which one is the compliance flag and
 * which two are the dated log.
 */
function pdpaLabel(flag: string): string {
  return `PDPA · ${humanise(flag)}`;
}

function consentMissing(contact: Contact): boolean {
  return Boolean(contact.pdpaFlag) || (!contact.consent.email && !contact.consent.whatsapp);
}

function matchesTab(contact: Contact, tab: string): boolean {
  if (tab === PRIMARY_TAB) return contact.primary;
  if (tab === BLOCKED_TAB) return consentMissing(contact);
  return true;
}

export function ContactsDirectoryPage() {
  useBreadcrumb([{ label: "Sales" }, { label: "Contacts" }]);

  const navigate = useNavigate();
  const [tab, setTab] = useState<string>(ALL_TAB);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [relationTab, setRelationTab] = useState<string>(RELATION_ENGAGEMENTS);

  const contacts = useContacts();
  const directory = useOrganisationDirectory();

  const rows = useMemo(() => contacts.data?.data ?? [], [contacts.data]);
  const visible = useMemo(() => rows.filter((row) => matchesTab(row, tab)), [rows, tab]);

  const current = selectedRef ?? visible[0]?.ref ?? null;
  const detail = useContact(current ?? undefined);
  const consent = useContactConsent(current ?? undefined);
  const relations = useOrganisationRelations(detail.data?.organisationRef);

  const organisation = directory.byRef(detail.data?.organisationRef);

  const tabs = useMemo(
    () =>
      QUEUE_TABS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        count: rows.filter((row) => matchesTab(row, entry.id)).length,
      })),
    [rows],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordHeader
        withoutCondensed
        title="Contacts"
        meta={[
          contacts.data ? `${plural(contacts.data.page.total, "contact")} on record` : null,
          rows.some(consentMissing)
            ? `${rows.filter(consentMissing).length} cannot be contacted`
            : null,
        ]}
        actions={
          <SecondaryButton onClick={() => navigate("/relationships/marketing")}>
            Marketing reach
          </SecondaryButton>
        }
      />

      {/* Brief §10b: tabs and any narrowing share one row. No FilterBar — the
          tabs ARE the narrowing here, and each already carries its count. */}
      <ListToolbar
        className="px-5 pb-4"
        tabs={
          <PillTabGroup
            tabs={tabs}
            activeId={tab}
            onSelect={(id) => {
              setTab(id);
              setSelectedRef(null);
            }}
            label="Contact views"
          />
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,40%)_1fr] grid-rows-[minmax(0,1fr)]">
        <section
          aria-label="Contact directory"
          className="flex min-h-0 min-w-0 flex-col border-r border-border"
        >
          <div className="min-h-0 flex-1 overflow-auto">
            {contacts.isPending ? (
              <LoadingState rows={6} label="Loading the contact directory" />
            ) : contacts.isError ? (
              <ErrorState
                title="The directory did not load"
                error={toApiError(contacts.error)}
                onRetry={() => void contacts.refetch()}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                title="Nobody in this view"
                description="No contact matches the view in play. Switch to All to see everyone on record."
              />
            ) : (
              <ul className="flex flex-col">
                {visible.map((contact) => (
                  <ContactRow
                    key={contact.ref}
                    contact={contact}
                    organisationName={directory.nameOf(contact.organisationRef)}
                    selected={contact.ref === current}
                    onSelect={() => setSelectedRef(contact.ref)}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section
          aria-label="Contact record"
          className="flex min-h-0 min-w-0 flex-col overflow-auto"
        >
          {detail.isPending && current ? (
            <LoadingState rows={5} label="Loading the contact" />
          ) : detail.isError ? (
            <ErrorState
              title="The contact did not load"
              error={toApiError(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          ) : !detail.data ? (
            <EmptyState
              title="Nothing selected"
              description="Pick someone from the directory to see how to reach them and what their company has open."
            />
          ) : (
            <>
              {/* This pane's own sticky header, not a row shared with the
                  directory: the name, the refs and the primary stay reachable
                  at any scroll depth without moving the list. */}
              <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-5 py-3.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <h2 className="truncate text-[16px] font-semibold leading-6">
                    {detail.data.name}
                  </h2>
                  <p className="truncate font-mono text-[12px] leading-[18px] text-ink-muted">
                    {detail.data.ref} · {detail.data.role} ·{" "}
                    {directory.nameOf(detail.data.organisationRef)}
                  </p>
                </div>
                {detail.data.primary ? <StatusChip>Primary contact</StatusChip> : null}
                <PrimaryButton
                  onClick={() =>
                    navigate(`/sales/organisations/${detail.data?.organisationRef ?? ""}`)
                  }
                >
                  Open organisation
                </PrimaryButton>
              </div>

              {/* Blocks separated by spacing, not rules — removing the border
                  leaves no relationship ambiguous, which is CLAUDE.md's test. */}
              <div className="flex flex-col gap-8 px-5 pb-8 pt-6">
                <ReachSection
                  contact={detail.data}
                  consent={consent.data?.data}
                  pending={consent.isPending}
                  error={consent.isError ? toApiError(consent.error) : undefined}
                  onRetry={() => void consent.refetch()}
                />

                <OrganisationSection
                  organisation={organisation}
                  reference={detail.data.organisationRef}
                  directoryPending={directory.query.isPending}
                  directoryError={
                    directory.query.isError ? toApiError(directory.query.error) : undefined
                  }
                  onRetryDirectory={() => void directory.query.refetch()}
                  relations={relations.data}
                  relationsPending={relations.isPending}
                  relationsError={relations.isError ? toApiError(relations.error) : undefined}
                  onRetryRelations={() => void relations.refetch()}
                  tab={relationTab}
                  onTab={setRelationTab}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * How to reach this person, and whether anyone may.
 *
 * The dated consent rows are the answer; the record's booleans are shown beside
 * them as the operational summary. When the two disagree the screen says so
 * rather than picking a winner — a contact whose record claims consent and
 * whose log holds none is a fact somebody has to resolve, not a rendering
 * conflict to hide.
 */
function ReachSection({
  contact,
  consent,
  pending,
  error,
  onRetry,
}: {
  contact: Contact;
  consent: ChannelConsent[] | undefined;
  pending: boolean;
  error: ReturnType<typeof toApiError> | undefined;
  onRetry: () => void;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-[13px] font-semibold text-ink">How to reach them</h3>
        {contact.pdpaFlag ? (
          <StatusChip tone="warning">{pdpaLabel(contact.pdpaFlag)}</StatusChip>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-[12px] text-ink-muted">Email</dt>
          <dd className={cn("text-[14px]", contact.email ? "text-ink" : "text-ink-muted")}>
            {contact.email ?? "not on record"}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Phone</dt>
          <dd className={cn("text-[14px]", contact.phone ? "text-ink" : "text-ink-muted")}>
            {contact.phone ?? "not on record"}
          </dd>
        </div>
      </dl>

      {pending ? <LoadingState rows={2} label="Loading the consent record" /> : null}

      {error ? (
        <ErrorState
          title="The consent record did not load"
          description="Without it there is no dated answer to whether this person may be contacted, so nothing should be sent."
          error={error}
          onRetry={onRetry}
        />
      ) : null}

      {!pending && !error && (consent?.length ?? 0) === 0 ? (
        <EmptyState
          title="No consent has ever been recorded"
          description="PDPA consent is a dated fact, and there is no row for this contact on any channel. Treat every channel as closed until one is recorded."
        />
      ) : null}

      {consent && consent.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {consent.map((row) => (
            <li key={row.channel} className="flex flex-wrap items-baseline gap-2 text-[13px]">
              <span className="w-24 shrink-0 text-ink-secondary">{channelLabel(row.channel)}</span>
              {row.granted ? (
                <span className="text-ink">
                  Consent recorded <DateText value={row.recordedAt} className="text-ink-muted" />
                </span>
              ) : (
                <StatusChip tone="warning">No consent</StatusChip>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The organisation behind the person, and M04-S02's relations panel. */
function OrganisationSection({
  organisation,
  reference,
  directoryPending,
  directoryError,
  onRetryDirectory,
  relations,
  relationsPending,
  relationsError,
  onRetryRelations,
  tab,
  onTab,
}: {
  organisation: Organisation | undefined;
  reference: string;
  directoryPending: boolean;
  directoryError: ReturnType<typeof toApiError> | undefined;
  onRetryDirectory: () => void;
  relations: OrganisationRelations | undefined;
  relationsPending: boolean;
  relationsError: ReturnType<typeof toApiError> | undefined;
  onRetryRelations: () => void;
  tab: string;
  onTab: (id: string) => void;
}) {
  const engagements = relations?.engagements ?? [];
  const invoices = relations?.invoices ?? [];
  const packets = relations?.hrdc?.packets ?? [];

  const engagementColumns: Column<RelatedEngagement>[] = [
    {
      key: "title",
      label: "Engagement",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{row.title}</p>
          <p className="truncate font-mono text-[11px] text-ink-muted">{row.ref}</p>
        </div>
      ),
    },
    {
      key: "lifecycle",
      label: "Progress",
      width: "150px",
      /* The stepper renders SERVER steps. A related engagement carries its own
         `lifecycle`, which is why this row may draw the chain and the lead
         queue may not — §11a, inline variant C in a table. */
      accessor: (row) => <LifecycleStepper steps={row.lifecycle} variant="table" />,
    },
    { key: "dates", label: "Dates", width: "150px", accessor: (row) => row.dates },
    {
      key: "value",
      label: "Value",
      width: "116px",
      align: "right",
      accessor: (row) => <MoneyText value={row.value} compact />,
    },
  ];

  const invoiceColumns: Column<RelatedInvoice>[] = [
    {
      key: "ref",
      label: "Invoice",
      accessor: (row) => <span className="font-mono text-[12px] text-ink">{row.ref}</span>,
    },
    {
      key: "status",
      label: "Status",
      width: "140px",
      accessor: (row) => (
        <StatusChip tone={INVOICE_TONE[row.status as keyof typeof INVOICE_TONE] ?? "neutral"}>
          {humanise(row.status)}
        </StatusChip>
      ),
    },
    {
      key: "daysOverdue",
      label: "Overdue",
      width: "96px",
      accessor: (row) =>
        typeof row.daysOverdue === "number" ? (
          <span className="tabular-nums">{`${row.daysOverdue} days`}</span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: "amount",
      label: "Amount",
      width: "116px",
      align: "right",
      accessor: (row) => <MoneyText value={row.amount} />,
    },
  ];

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-[13px] font-semibold text-ink">Their organisation</h3>
        {organisation ? (
          <StatusChip tone={ORGANISATION_TONE[organisation.status]}>
            {humanise(organisation.status)}
          </StatusChip>
        ) : null}
      </div>

      {directoryPending ? <LoadingState rows={2} label="Loading the organisation" /> : null}

      {directoryError ? (
        <ErrorState
          title="The organisation did not load"
          error={directoryError}
          onRetry={onRetryDirectory}
        />
      ) : null}

      {!directoryPending && !directoryError && !organisation ? (
        <EmptyState
          title="Organisation not in the book"
          description={`${reference} is referenced by this contact but is not in the organisation list.`}
        />
      ) : null}

      {organisation ? (
        <p className="text-[13px] text-ink-secondary">
          {`${humanise(organisation.industry)} · ${organisation.location} · owner ${organisation.owner.name}`}
        </p>
      ) : null}

      <p className="text-[12px] text-ink-muted">
        Everything below belongs to the organisation, not to this person.
      </p>

      <PillTabGroup
        label="Organisation relations"
        activeId={tab}
        onSelect={onTab}
        tabs={[
          { id: RELATION_ENGAGEMENTS, label: "Engagements", count: engagements.length },
          { id: RELATION_INVOICES, label: "Invoices", count: invoices.length },
          { id: RELATION_HRDC, label: "HRD Corp", count: packets.length },
        ]}
      />

      {relationsPending ? <LoadingState rows={4} label="Loading the relations" /> : null}

      {relationsError ? (
        <ErrorState
          title="The relations did not load"
          error={relationsError}
          onRetry={onRetryRelations}
        />
      ) : null}

      {relations && tab === RELATION_ENGAGEMENTS ? (
        <DataTable
          label="Engagements at this organisation"
          columns={engagementColumns}
          rows={engagements}
          rowKey={(row) => row.ref}
          empty={
            <EmptyState
              title="No engagement on record"
              description="This organisation has not run a programme yet, so there is nothing to renew or claim."
            />
          }
        />
      ) : null}

      {relations && tab === RELATION_INVOICES ? (
        <DataTable
          label="Invoices at this organisation"
          columns={invoiceColumns}
          rows={invoices}
          rowKey={(row) => row.ref}
          empty={
            <EmptyState
              title="Nothing invoiced"
              description="No invoice has been raised against this organisation."
            />
          }
        />
      ) : null}

      {relations && tab === RELATION_HRDC ? (
        relations.hrdc ? (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-ink-secondary">
              Employer code{" "}
              <span className="font-mono text-[12px] text-ink">{relations.hrdc.employerCode}</span>{" "}
              · levy available <MoneyText value={relations.hrdc.levyAvailable} compact />
            </p>
            {packets.length === 0 ? (
              <EmptyState
                title="No claim packet open"
                description="Nothing is in flight with HRD Corp for this organisation."
              />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {packets.map((packet) => (
                  <li key={packet.ref} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-mono text-[12px] text-ink">{packet.ref}</span>
                    <StatusChip tone={packet.state === "BLOCKED" ? "warning" : "neutral"}>
                      {humanise(packet.state)}
                    </StatusChip>
                    {typeof packet.missingDocuments === "number" ? (
                      <span className="text-ink-secondary">
                        {`${packet.missingDocuments} documents missing`}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <EmptyState
            title="Not registered with HRD Corp"
            description="This organisation has no employer code on record, so no levy can be claimed against its training."
          />
        )
      ) : null}
    </section>
  );
}

/**
 * One row, three layers — §16, with the 13 Sep ruling's amendment that a chip
 * never gets a row to itself.
 *
 *   Nurul Hassan
 *   CON-0233 · HR Manager · Aurora Manufacturing Sdn Bhd
 *   [Primary]                                       updated 15 Sep 2026
 *
 * The person is the strongest line, the ref and their place are muted machine
 * context, and the third row pairs whatever chips apply with the date — so a
 * contact carrying no exception still has three layers and the rows stay the
 * same height down the list.
 */
function ContactRow({
  contact,
  organisationName,
  selected,
  onSelect,
}: {
  contact: Contact;
  organisationName: string;
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
        <span className="truncate text-[15px] font-semibold text-ink">{contact.name}</span>

        <span className="truncate font-mono text-[11px] text-ink-muted">
          {`${contact.ref} · ${contact.role} · ${organisationName}`}
        </span>

        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {contact.primary ? <StatusChip>Primary</StatusChip> : null}
          {consentMissing(contact) ? (
            <StatusChip tone="warning">
              {contact.pdpaFlag ? pdpaLabel(contact.pdpaFlag) : "No consent"}
            </StatusChip>
          ) : null}
          <span className="ml-auto shrink-0 text-[12px] tabular-nums text-ink-muted">
            updated <DateText value={contact.updatedAt} />
          </span>
        </span>
      </button>
    </li>
  );
}
