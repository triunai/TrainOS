import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  ActionResponse,
  CollectionRule,
  MessageChannel,
  MessageDraft,
  Receivable,
} from "@trainos/contract";
import {
  ActionOutcome,
  AIChip,
  AgingStrip,
  AutonomyChip,
  ContentCard,
  DataTable,
  DateText,
  describeActionError,
  EmptyState,
  ErrorState,
  EscalationLadder,
  ExceptionBanner,
  LoadingState,
  MoneyText,
  PillTabGroup,
  PrimaryButton,
  SecondaryButton,
  StatusChip,
  WhatsAppCostStrip,
  humanise,
  type Column,
  type LadderRung,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import {
  useCollectionDraft,
  useCollectionRules,
  useCollectionsQueue,
  useReceivablesAging,
  useSendReminder,
} from "./api";

/**
 * M13-S05 · collections queue.
 *
 * Chase money on a schedule the client can predict, with the agent writing and
 * a human deciding. Two rows carry the argument:
 *
 *  - the 48-day item has climbed past the agent's autonomy. DECISIONS §1 makes
 *    reminder 3 always human, so the agent STOPS and the row offers no draft.
 *    A queue that quietly drafted one anyway would be lying about who decided.
 *  - the 78-day item is past the day-75 rung, where the ladder proposes a
 *    trading hold that only the MD can approve.
 *
 * The ladder itself is configuration read from `GET /v1/collections/rules`, so
 * changing the cadence in Settings changes this screen and no code moves.
 */

const TABS = {
  approval: "Needs approval",
  escalated: "Escalated",
  blocked: "Blocked",
  all: "All",
} as const;

type TabId = keyof typeof TABS;

function tabOf(row: Receivable): Exclude<TabId, "all"> {
  if (row.nextAction.status === "BLOCKED_ON_SYNC") return "blocked";
  if (row.nextAction.autonomy === "OBSERVE") return "escalated";
  return "approval";
}

/** The ladder, with the selected row's stage marked current. */
function rungsFor(rules: CollectionRule[], stage: string | undefined): LadderRung[] {
  const index = rules.findIndex((rule) => rule.stage === stage);
  return rules.map((rule, position) => ({
    when: `${rule.afterDays} days overdue`,
    action: `${humanise(rule.stage)}${rule.channel ? ` · ${humanise(rule.channel)}` : ""}`,
    autonomy: rule.autonomy,
    ...(rule.requiresApprovalFromRole
      ? { note: `requires ${rule.requiresApprovalFromRole} approval` }
      : {}),
    state:
      index === -1
        ? "pending"
        : position < index
          ? "done"
          : position === index
            ? "current"
            : "pending",
  }));
}

export function CollectionsQueueScreen() {
  useBreadcrumb([{ label: "Finance" }, { label: "Collections" }, { label: "Overdue" }]);

  const navigate = useNavigate();
  const queue = useCollectionsQueue();
  const aging = useReceivablesAging();
  const rules = useCollectionRules();

  const [tab, setTab] = useState<TabId>("approval");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [channel, setChannel] = useState<MessageChannel | null>(null);
  const [outcome, setOutcome] = useState<ActionResponse | undefined>(undefined);

  const rows = useMemo(() => queue.data?.data ?? [], [queue.data]);

  const selected = useMemo(() => {
    const explicit = rows.find((row) => row.invoiceRef === selectedRef);
    if (explicit) return explicit;
    return rows.find((row) => row.nextAction.status === "DRAFT_READY") ?? rows[0] ?? null;
  }, [rows, selectedRef]);

  const hasDraft = selected?.nextAction.status === "DRAFT_READY";
  const draft = useCollectionDraft(hasDraft ? (selected?.invoiceRef ?? null) : null);
  const send = useSendReminder(selected?.invoiceRef ?? null);

  const visible = useMemo(
    () => (tab === "all" ? rows : rows.filter((row) => tabOf(row) === tab)),
    [rows, tab],
  );

  const countOf = (id: TabId) =>
    id === "all" ? rows.length : rows.filter((row) => tabOf(row) === id).length;

  const columns: Column<Receivable>[] = [
    {
      key: "invoiceRef",
      label: "Invoice",
      accessor: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-[12px] text-ink">{row.invoiceRef}</p>
          <p className="truncate text-[12px] text-ink-muted">{row.organisation.name}</p>
        </div>
      ),
    },
    {
      key: "daysOverdue",
      label: "Overdue",
      width: "88px",
      sortable: true,
      accessor: (row) => (
        <StatusChip
          tone={row.daysOverdue >= 60 ? "danger" : row.daysOverdue >= 30 ? "warning" : "neutral"}
        >
          {`${row.daysOverdue} days`}
        </StatusChip>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      width: "116px",
      align: "right",
      accessor: (row) => <MoneyText value={row.amount} className="whitespace-nowrap" />,
    },
    {
      key: "stage",
      label: "Stage",
      width: "104px",
      accessor: (row) => <span className="text-[13px] text-ink">{humanise(row.stage)}</span>,
    },
    {
      key: "nextAction",
      label: "Next action",
      width: "148px",
      accessor: (row) => (
        /* Stacked, not side by side: at 1440px a two-pane layout has no room
           for both chips on one line and a clipped column is worse than two. */
        <div className="flex flex-col items-start gap-1">
          <StatusChip tone={row.nextAction.status === "DRAFT_READY" ? "info" : "neutral"}>
            {humanise(row.nextAction.status)}
          </StatusChip>
          <AutonomyChip level={row.nextAction.autonomy} fluid />
        </div>
      ),
    },
  ];

  const arTotal = aging.data
    ? {
        amount:
          aging.data.current.amount +
          aging.data.d1_30.amount +
          aging.data.d31_60.amount +
          aging.data.d60_plus.amount,
        currency: aging.data.current.currency,
      }
    : null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-6 pb-4 pt-3">
        <h1 className="text-[20px] font-semibold text-ink">Collections</h1>
        {arTotal ? (
          <span className="font-mono text-[12px] text-ink-muted">
            AR <MoneyText value={arTotal} compact />
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <SecondaryButton onClick={() => navigate("/finance/invoices")}>Invoices</SecondaryButton>
          <PrimaryButton
            disabled={!hasDraft || !draft.data || send.isPending}
            onClick={() => {
              if (!draft.data || !selected) return;
              send.mutate(
                {
                  channel: channel ?? draft.data.channel,
                  templateId: draft.data.templateId,
                  stage: selected.stage,
                  body: draft.data.body,
                },
                { onSuccess: setOutcome },
              );
            }}
          >
            Approve &amp; send
          </PrimaryButton>
        </div>
      </div>

      <div className="px-6">
        {aging.isPending ? <LoadingState rows={1} label="Loading the ageing buckets" /> : null}
        {aging.error ? (
          <ErrorState
            title="The ageing buckets could not be loaded"
            error={toApiError(aging.error)}
            onRetry={() => void aging.refetch()}
          />
        ) : null}
        {aging.data ? <AgingStrip aging={aging.data} /> : null}
      </div>

      <div className="px-6 pt-4">
        <PillTabGroup
          label="Collections queue"
          activeId={tab}
          onSelect={(id) => setTab(id as TabId)}
          tabs={(Object.keys(TABS) as TabId[]).map((id) => ({
            id,
            label: TABS[id],
            count: countOf(id),
          }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 px-6 py-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div>
          {queue.isPending ? <LoadingState rows={6} label="Loading the collections queue" /> : null}
          {queue.error ? (
            <ErrorState
              title="The collections queue could not be loaded"
              error={toApiError(queue.error)}
              onRetry={() => void queue.refetch()}
            />
          ) : null}
          {queue.data ? (
            <DataTable
              label="Overdue receivables"
              columns={columns}
              rows={visible}
              rowKey={(row) => row.invoiceRef}
              onRowClick={(row) => {
                setSelectedRef(row.invoiceRef);
                setChannel(null);
              }}
              empty={
                <EmptyState
                  title="Nothing in this bucket"
                  description="Every invoice in this state has been paid or has moved to another rung of the ladder."
                />
              }
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <ActionOutcome
            response={outcome}
            error={
              send.error
                ? describeActionError(toApiError(send.error), "The reminder was not queued")
                : undefined
            }
            subject={selected ? `Collections reminder · ${selected.invoiceRef}` : "Reminder"}
          />

          {selected ? (
            <DraftPanel
              row={selected}
              draft={hasDraft ? draft.data : undefined}
              loading={hasDraft && draft.isPending}
              channel={channel ?? draft.data?.channel ?? "EMAIL"}
              onChannel={setChannel}
              onOpenInvoice={() => navigate(`/finance/invoices/${selected.invoiceRef}`)}
            />
          ) : null}

          <ContentCard title="Escalation ladder">
            {rules.isPending ? (
              <LoadingState rows={5} label="Loading the escalation rules" />
            ) : null}
            {rules.error ? (
              <ErrorState
                title="The escalation rules could not be loaded"
                error={toApiError(rules.error)}
                onRetry={() => void rules.refetch()}
              />
            ) : null}
            {rules.data ? (
              <EscalationLadder
                label={selected ? `Where ${selected.invoiceRef} stands` : "Collections cadence"}
                rungs={rungsFor(rules.data.data, selected?.stage)}
              />
            ) : null}
          </ContentCard>
        </div>
      </div>
    </div>
  );
}

/**
 * The agent's draft for the selected row — or the reason there is not one.
 *
 * An item the ladder has escalated past the agent's autonomy shows what the
 * rule said instead of a message. That is not an empty state: it is the system
 * reporting that a human now owns this account.
 */
function DraftPanel({
  row,
  draft,
  loading,
  channel,
  onChannel,
  onOpenInvoice,
}: {
  row: Receivable;
  draft: MessageDraft | undefined;
  loading: boolean;
  channel: MessageChannel;
  onChannel: (channel: MessageChannel) => void;
  onOpenInvoice: () => void;
}) {
  return (
    <ContentCard
      eyebrow={row.organisation.name}
      title={row.invoiceRef}
      actions={
        <div className="flex items-center gap-2">
          <StatusChip tone={row.daysOverdue >= 60 ? "danger" : "warning"}>
            {`${row.daysOverdue} days overdue`}
          </StatusChip>
          <SecondaryButton onClick={onOpenInvoice}>Open invoice</SecondaryButton>
        </div>
      }
    >
      {loading ? <LoadingState rows={4} label="Loading the drafted reminder" /> : null}

      {!loading && !draft ? (
        <ExceptionBanner
          severity={row.nextAction.type === "ACCOUNT_TRADING_HOLD" ? "DANGER" : "WARN"}
          title={
            row.nextAction.type === "ACCOUNT_TRADING_HOLD"
              ? "The ladder proposes a trading hold"
              : "The agent has stopped here"
          }
          subtitle={
            row.nextAction.type === "ACCOUNT_TRADING_HOLD"
              ? `${row.daysOverdue} days overdue is past the day-75 rung. Holding new engagements for ${row.organisation.name} needs the MD, not Finance, and no message is drafted for it.`
              : `${humanise(row.stage)} is always human. The agent holds ${humanise(
                  row.nextAction.autonomy,
                ).toLowerCase()} autonomy for this rung, so it drafts nothing and hands the account over.`
          }
          action={<AutonomyChip level={row.nextAction.autonomy} withCaption />}
        />
      ) : null}

      {draft ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <PillTabGroup
              label="Channel"
              activeId={channel}
              onSelect={(id) => onChannel(id as MessageChannel)}
              tabs={[
                { id: "EMAIL", label: "Email" },
                { id: "WHATSAPP", label: "WhatsApp" },
              ]}
            />
            <AIChip provenance={draft.provenance} />
          </div>

          <p className="whitespace-pre-line rounded-control border border-border bg-surface px-3.5 py-3 text-[13px] leading-relaxed text-ink">
            {draft.body}
          </p>

          <p className="text-[12px] text-ink-muted">
            {`${draft.recipients} recipient${draft.recipients === 1 ? "" : "s"} · consent ${
              draft.consent.granted ? "on record" : "NOT on record"
            }`}
            {draft.consent.recordedAt ? (
              <>
                {" · recorded "}
                <DateText value={draft.consent.recordedAt} />
              </>
            ) : null}
          </p>

          {/* Pass the unrounded rate and the other category's rate straight
              through: a per-message rate runs to four decimals, and the saving
              line is the server's comparison, not one composed here. */}
          <WhatsAppCostStrip
            category={draft.category}
            templateLabel={draft.templateId}
            recipients={draft.recipients}
            ratePerMessage={draft.ratePerMessage}
            estimatedCost={draft.estimatedCost}
            {...(draft.ratePerMessageExact
              ? { ratePerMessageExact: draft.ratePerMessageExact }
              : {})}
            {...(draft.alternativeCategoryRate
              ? { alternative: draft.alternativeCategoryRate }
              : {})}
          />

          <p className="text-[12px] text-ink-secondary">
            Policy FIN-03 routes every reminder to a human before it leaves. Approving here queues
            the send for approval; it does not send it.
          </p>
        </div>
      ) : null}
    </ContentCard>
  );
}
