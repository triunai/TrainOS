import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Contact, Money, Template, TemplateType } from "@trainos/contract";
import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  ListToolbar,
  LoadingState,
  MoneyText,
  PillTabGroup,
  plural,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  channelLabel,
  humanise,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { useContacts, useTemplates } from "./api";

/**
 * Relationships › Marketing. No artboard. List + toolbar + table, then the
 * people the table's numbers exclude.
 *
 * The screen answers one question: if we sent this template, who would legally
 * receive it, and what would that cost? Both halves are already in the system —
 * §2 templates carry the channel, the category and the per-message rate, and §5
 * contacts carry PDPA consent per channel — so the screen is a join, not a new
 * object.
 *
 * WHICH TEMPLATES ARE MARKETING is a table over the contract's own
 * `TemplateType`, exhaustive by type: a template type added to the contract is
 * a compile error here rather than a silent default into "not a message",
 * which would quietly drop a whole channel off this screen. R14.
 *
 * NO AI ON THIS SCREEN, and that is a decision rather than an omission. The
 * brief asks the relationships rows to carry an AI suggestion at 6% tint with
 * the ✦ glyph and a label. Renewals and cross-sell do, because §5 publishes
 * real suggestions with real provenance behind them. Nothing in the contract
 * suggests a campaign, so an AI row here would be a tint and a glyph over a
 * sentence this file made up — provenance invented in the UI, which is the one
 * thing the AI treatment exists to prevent. Reported as owed: when a campaign
 * agent exists, its suggestion belongs on these rows.
 *
 * The cost is an ESTIMATE COMPUTED HERE, not a quotation: rate × reachable, and
 * the caption says so. The kit's `WhatsAppCostStrip` is deliberately not used —
 * it renders a server-priced draft, and dressing a client-side multiplication
 * in it would imply a quote nobody gave.
 */

/** The channel a template sends on, or null when it is a document. */
const TEMPLATE_CHANNEL: Record<TemplateType, "EMAIL" | "WHATSAPP" | null> = {
  PROPOSAL: null,
  QUOTATION: null,
  CERTIFICATE: null,
  EMAIL: "EMAIL",
  WHATSAPP: "WHATSAPP",
  INVOICE: null,
  TNA_QUESTIONNAIRE: null,
  EVALUATION: null,
  HRDC_PACKET: null,
};

const ALL_TAB = "all";

/** Whether this contact may be written to on this channel. */
function reachable(contact: Contact, channel: "EMAIL" | "WHATSAPP"): boolean {
  if (contact.pdpaFlag) return false;
  return channel === "EMAIL" ? contact.consent.email : contact.consent.whatsapp;
}

function multiply(rate: Money | undefined, count: number): Money | null {
  if (!rate) return null;
  return { amount: rate.amount * count, currency: rate.currency };
}

export function MarketingPage() {
  useBreadcrumb([{ label: "Relationships" }, { label: "Marketing" }]);

  const navigate = useNavigate();
  const [tab, setTab] = useState<string>(ALL_TAB);

  const templates = useTemplates();
  const contacts = useContacts();
  const directory = useOrganisationDirectory();

  const contactRows = useMemo(() => contacts.data?.data ?? [], [contacts.data]);

  /* Only the templates that actually send something. A proposal template has no
     audience, so listing it here would put a reach of zero beside nine rows
     that mean it and one that does not. */
  const messageTemplates = useMemo(
    () => (templates.data?.data ?? []).filter((row) => TEMPLATE_CHANNEL[row.type] !== null),
    [templates.data],
  );

  const channels = useMemo(
    () => [...new Set(messageTemplates.map((row) => TEMPLATE_CHANNEL[row.type]))].filter(Boolean),
    [messageTemplates],
  );

  const visible = useMemo(
    () =>
      tab === ALL_TAB
        ? messageTemplates
        : messageTemplates.filter((row) => TEMPLATE_CHANNEL[row.type] === tab),
    [messageTemplates, tab],
  );

  const reachOn = (channel: "EMAIL" | "WHATSAPP") =>
    contactRows.filter((contact) => reachable(contact, channel)).length;

  const blocked = contactRows.filter(
    (contact) => !reachable(contact, "EMAIL") && !reachable(contact, "WHATSAPP"),
  );

  const columns: Column<Template>[] = [
    {
      key: "label",
      label: "Template",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{row.label}</p>
          <p className="truncate font-mono text-[11px] text-ink-muted">
            {`${row.id} · v${row.version}`}
          </p>
        </div>
      ),
    },
    {
      key: "channel",
      label: "Channel",
      width: "120px",
      accessor: (row) => {
        const channel = TEMPLATE_CHANNEL[row.type];
        return (
          <span className="text-[13px] text-ink">{channel ? channelLabel(channel) : "—"}</span>
        );
      },
    },
    {
      key: "category",
      label: "Category",
      width: "128px",
      accessor: (row) =>
        row.category ? (
          /* MARKETING costs six times UTILITY per message. That is the one
             status on this screen worth a colour. */
          <StatusChip tone={row.category === "MARKETING" ? "warning" : "neutral"}>
            {humanise(row.category)}
          </StatusChip>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: "reach",
      label: "Reachable",
      width: "104px",
      align: "right",
      accessor: (row) => {
        const channel = TEMPLATE_CHANNEL[row.type];
        return <span className="tabular-nums">{channel ? reachOn(channel) : 0}</span>;
      },
    },
    {
      key: "rate",
      label: "Per message",
      width: "116px",
      align: "right",
      accessor: (row) =>
        row.ratePerMessage ? (
          <MoneyText value={row.ratePerMessage} />
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: "cost",
      label: "Estimated send",
      width: "132px",
      align: "right",
      accessor: (row) => {
        const channel = TEMPLATE_CHANNEL[row.type];
        const cost = channel ? multiply(row.ratePerMessage, reachOn(channel)) : null;
        return cost ? <MoneyText value={cost} /> : <span className="text-ink-muted">—</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col">
      <div className="border-b border-border">
        <RecordHeader
          withoutCondensed
          title="Marketing"
          meta={[
            templates.data ? plural(messageTemplates.length, "message template") : null,
            contacts.data ? `${reachOn("EMAIL")} reachable by email` : null,
            contacts.data ? `${reachOn("WHATSAPP")} by WhatsApp` : null,
          ]}
          actions={
            <SecondaryButton onClick={() => navigate("/sales/contacts")}>Contacts</SecondaryButton>
          }
        />
      </div>

      <ListToolbar
        className="px-5 pt-4"
        tabs={
          <PillTabGroup
            label="Channels"
            activeId={tab}
            onSelect={setTab}
            tabs={[
              { id: ALL_TAB, label: "All", count: messageTemplates.length },
              ...channels.map((channel) => ({
                id: channel as string,
                label: channelLabel(channel as "EMAIL" | "WHATSAPP"),
                count: messageTemplates.filter((row) => TEMPLATE_CHANNEL[row.type] === channel)
                  .length,
              })),
            ]}
          />
        }
        filters={<FilterBar filters={[]} shown={visible.length} total={messageTemplates.length} />}
      />

      <div className="flex flex-col gap-4 px-5 py-4">
        {templates.isPending || contacts.isPending ? (
          <LoadingState rows={6} label="Loading the marketing templates" />
        ) : null}

        {templates.isError ? (
          <ErrorState
            title="The templates did not load"
            error={toApiError(templates.error)}
            onRetry={() => void templates.refetch()}
          />
        ) : null}

        {contacts.isError ? (
          <ErrorState
            title="The audience did not load"
            description="Reach is consent, and without the contact list there is no honest number to put beside a template."
            error={toApiError(contacts.error)}
            onRetry={() => void contacts.refetch()}
          />
        ) : null}

        {templates.data && contacts.data ? (
          <>
            <DataTable
              label="Message templates and their reach"
              columns={columns}
              rows={visible}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No template on this channel"
                  description="Nothing is configured to send here. Switch to All to see every message template."
                />
              }
            />

            <p className="text-[12px] text-ink-muted">
              Reach counts the contacts holding consent on that channel today, and the estimated
              send is that count times the template&apos;s per-message rate. It is an estimate made
              here, not a quotation: the rate is billed at send time and a consent withdrawn between
              now and then removes a recipient.
            </p>
          </>
        ) : null}

        {contacts.data ? (
          <section className="flex flex-col gap-2.5 border-t border-divider pt-4">
            <h2 className="text-[13px] font-semibold text-ink">Who this excludes</h2>
            {blocked.length === 0 ? (
              <EmptyState
                title="Everyone on record can be reached"
                description="Every contact holds consent on at least one channel, so no audience is being silently trimmed."
              />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {blocked.map((contact) => (
                  <li key={contact.ref} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                    <span className="font-medium text-ink">{contact.name}</span>
                    <span className="text-ink-secondary">
                      {`${contact.role} · ${directory.nameOf(contact.organisationRef)}`}
                    </span>
                    <StatusChip tone="warning">
                      {contact.pdpaFlag ? `PDPA · ${humanise(contact.pdpaFlag)}` : "No consent"}
                    </StatusChip>
                    <span className="ml-auto font-mono text-[11px] text-ink-muted">
                      {contact.ref}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
