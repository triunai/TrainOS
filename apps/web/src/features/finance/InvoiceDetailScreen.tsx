import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ActionResponse, Invoice, Money, SyncEvent } from "@trainos/contract";
import {
  ActionOutcome,
  ContentCard,
  DataTable,
  DateField,
  DateText,
  describeActionError,
  Drawer,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  formatDate,
  humanise,
  INVOICE_TONE,
  LoadingState,
  MoneyInput,
  MoneyText,
  PrimaryButton,
  RecordHeader,
  RefChip,
  SecondaryButton,
  StatusChip,
  SYNC_TONE,
  TextField,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { useInvoice, useInvoices, useRecordPayment, useRepushInvoice } from "./api";
import { INVOICES_PATH } from "./paths";

/**
 * M13-S02 · invoice detail.
 *
 * The screen's job is to be clear about where TrainOS stops. TrainOS does not
 * e-invoice: the invoice is pushed to the client's accounting package, which
 * handles LHDN MyInvois validation, and what is shown here is SYNC STATE
 * reported back — never a claim of our own. The UIN arrives masked from
 * MyInvois and is shown as it arrives.
 *
 * DECISIONS §7: lines are truth and totals are sums. The table adds the lines
 * up in front of the reader rather than printing a stored total beside them,
 * and the per-pax figure stays a caption because RM 616.67 × 30 is not
 * RM 18,500.
 */

/** Sum the rounded line amounts. The subtotal the reader can check. */
function sumLines(invoice: Invoice): Money {
  return {
    amount: invoice.lines.reduce((total, line) => total + line.amount.amount, 0),
    currency: invoice.total.currency,
  };
}

export function InvoiceDetailScreen({ invoiceRef }: { invoiceRef: string }) {
  /* Ends at the LIST — the header already carries the reference. */
  useBreadcrumb([{ label: "Finance" }, { label: "Invoices", href: INVOICES_PATH }]);

  const navigate = useNavigate();
  const invoice = useInvoice(invoiceRef);
  const invoices = useInvoices();
  const repush = useRepushInvoice(invoiceRef);
  const recordPayment = useRecordPayment(invoiceRef);

  const [recording, setRecording] = useState(false);
  const [amount, setAmount] = useState<Money | null>(null);
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  const [pushOutcome, setPushOutcome] = useState<ActionResponse | undefined>(undefined);

  const data = invoice.data;

  const sibling = useMemo(() => {
    if (!data || !invoices.data) return null;
    return (
      invoices.data.data.find(
        (other) =>
          other.ref !== data.ref &&
          other.organisationRef === data.organisationRef &&
          other.outstanding.amount > 0,
      ) ?? null
    );
  }, [data, invoices.data]);

  if (invoice.isPending) {
    return <LoadingState rows={8} label={`Loading invoice ${invoiceRef}`} />;
  }

  if (invoice.error || !data) {
    return (
      <ErrorState
        title="This invoice could not be loaded"
        error={toApiError(invoice.error)}
        onRetry={() => void invoice.refetch()}
      />
    );
  }

  const computedSubtotal = sumLines(data);
  const reconciles = computedSubtotal.amount === data.subtotal.amount;

  return (
    <div className="flex flex-col">
      <RecordHeader
        accent
        collapsible
        recordType="invoice"
        title={data.ref}
        recordRef={data.organisationRef}
        meta={[
          data.engagementRef,
          `issued ${formatDate(data.issuedAt)}`,
          `due ${formatDate(data.dueAt)}`,
          `terms ${data.termsDays} days`,
        ]}
        chips={
          <>
            <StatusChip tone={INVOICE_TONE[data.status]} live>
              {humanise(data.status)}
            </StatusChip>
            <StatusChip tone={SYNC_TONE[data.sync.state]}>
              {data.sync.state === "VALIDATED" ? "MyInvois validated" : humanise(data.sync.state)}
            </StatusChip>
          </>
        }
        actions={
          <SecondaryButton
            disabled={repush.isPending}
            onClick={() => {
              repush.mutate(undefined, { onSuccess: setPushOutcome });
            }}
          >
            Re-push to accounting
          </SecondaryButton>
        }
        primaryAction={
          /* Opening a drawer is not the view's action — the drawer's own
             "Record payment" is, and it is solid. This keeps the header slot,
             because that is what the condensed bar carries and reachability is
             the slot's job, but it is no longer a second solid button. */
          <SecondaryButton
            onClick={() => setRecording(true)}
            disabled={data.outstanding.amount === 0}
          >
            Record payment
          </SecondaryButton>
        }
        metrics={[
          { label: "Total", value: <MoneyText value={data.total} compact /> },
          {
            label: "SST",
            value: <MoneyText value={data.sst} />,
            sub: data.sstReason ? humanise(data.sstReason).toLowerCase() : undefined,
          },
          { label: "Outstanding", value: <MoneyText value={data.outstanding} compact /> },
          { label: "Terms", value: `${data.termsDays} days`, sub: `due ${formatDate(data.dueAt)}` },
          {
            label: "Sync",
            value: humanise(data.sync.state),
            sub: `${data.sync.provider.toLowerCase()} → MyInvois`,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <ActionOutcome
            response={pushOutcome}
            error={
              repush.error
                ? describeActionError(
                    toApiError(repush.error),
                    "The invoice was not pushed to the accounting package",
                  )
                : undefined
            }
            subject={`Re-push · ${data.ref}`}
          />

          <ContentCard title="Line items" flush>
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">{`Line items on invoice ${data.ref}`}</caption>
              <thead>
                <tr className="border-b border-divider">
                  <th className="px-4 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                    Description
                  </th>
                  <th className="px-4 py-2.5 text-right font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                    Qty
                  </th>
                  <th className="px-4 py-2.5 text-right font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                    Unit
                  </th>
                  <th className="px-4 py-2.5 text-right font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.description} className="border-b border-divider align-top">
                    <td className="px-4 py-2.5">
                      <p className="text-ink">{line.description}</p>
                      {line.detail ? (
                        <p className="pt-0.5 text-[12px] text-ink-muted">{line.detail}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink-secondary">
                      {line.qty}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink-secondary">
                      <MoneyText value={line.unit} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink">
                      <MoneyText value={line.amount} />
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-divider">
                  <td className="px-4 py-2.5 text-ink-secondary" colSpan={3}>
                    {`Subtotal · sum of ${data.lines.length} line${data.lines.length === 1 ? "" : "s"}`}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink">
                    <MoneyText value={computedSubtotal} />
                  </td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="px-4 py-2.5 text-ink-secondary" colSpan={3}>
                    {`SST on net${data.sstReason ? ` · ${humanise(data.sstReason).toLowerCase()}` : ""}`}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink">
                    <MoneyText value={data.sst} />
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-semibold text-ink" colSpan={3}>
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink">
                    <MoneyText value={data.total} />
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="border-t border-divider px-4 py-2.5">
              {reconciles ? (
                <p className="text-[12px] text-ink-muted">
                  {`The total is the sum of the lines plus SST on the net. `}
                  {data.display?.perPax ? (
                    <>
                      Per participant <MoneyText value={data.display.perPax} /> is a caption, not a
                      line: it does not multiply back to the package price.
                    </>
                  ) : null}
                </p>
              ) : (
                <ExceptionBanner
                  severity="DANGER"
                  title="This invoice does not reconcile"
                  subtitle="The stored subtotal disagrees with the sum of its lines. Lines are truth; the total is wrong."
                />
              )}
            </div>
          </ContentCard>

          <ContentCard title="Accounting sync log">
            {data.syncLog.length === 0 ? (
              <EmptyState
                title="Never pushed"
                description="This invoice has not been sent to the accounting package."
              />
            ) : (
              <ol className="flex flex-col">
                {[...data.syncLog]
                  .sort((a, b) => a.at.localeCompare(b.at))
                  .map((event) => (
                    <SyncRow key={`${event.at}-${event.state}`} event={event} />
                  ))}
              </ol>
            )}
          </ContentCard>

          <ContentCard title="Payment history">
            {data.payments.length === 0 ? (
              <EmptyState
                title="No payments recorded"
                description={`Due ${formatDate(data.dueAt)}. Collections start at 7 days overdue.`}
              />
            ) : (
              <PaymentTable invoice={data} />
            )}
          </ContentCard>
        </div>

        <div className="flex flex-col gap-5">
          <ExceptionBanner
            severity="INFO"
            title="TrainOS does not e-invoice"
            subtitle="The invoice is pushed to the client's accounting package, which handles LHDN MyInvois validation. TrainOS shows sync status only."
          />

          <ContentCard title="MyInvois">
            <dl className="text-[13px]">
              <RelatedRow label="UIN">
                {data.sync.uin ? (
                  <span className="font-mono text-ink">{data.sync.uin}</span>
                ) : (
                  <span className="text-ink-muted">Not issued</span>
                )}
              </RelatedRow>
              <RelatedRow label="Last attempt">
                {data.sync.lastAttemptAt ? (
                  <DateText value={data.sync.lastAttemptAt} withTime />
                ) : (
                  "—"
                )}
              </RelatedRow>
            </dl>
            <p className="pt-2 text-[12px] text-ink-muted">
              The UIN is issued and masked by MyInvois. TrainOS stores what it is given and unmasks
              nothing.
            </p>
          </ContentCard>

          <ContentCard title="Related">
            <dl className="text-[13px]">
              <RelatedRow label="Engagement">
                <RefChip refValue={data.engagementRef} />
              </RelatedRow>
              <RelatedRow label="Organisation">
                <RefChip refValue={data.organisationRef} />
              </RelatedRow>
              <RelatedRow label="Claim packet">
                <Link
                  to={`/compliance/hrd-corp/${data.engagementRef}`}
                  className="text-primary-hover hover:underline"
                >
                  HRD Corp packet ›
                </Link>
              </RelatedRow>
            </dl>
          </ContentCard>

          {sibling ? (
            <ContentCard title="Other invoice on this account">
              <p className="text-[13px] text-ink">
                {sibling.ref} · <MoneyText value={sibling.outstanding} /> outstanding
              </p>
              <p className="pt-0.5 text-[12px] text-ink-muted">
                {humanise(sibling.status)} · due {formatDate(sibling.dueAt)}
              </p>
              <div className="pt-3">
                <SecondaryButton onClick={() => navigate("/finance/collections")}>
                  Open collections
                </SecondaryButton>
              </div>
            </ContentCard>
          ) : null}
        </div>
      </div>

      <Drawer
        open={recording}
        onClose={() => setRecording(false)}
        title="Record payment"
        subtitle={`${data.ref} · ${data.organisationRef}`}
        footer={
          <PrimaryButton
            disabled={amount === null || paidOn === "" || recordPayment.isPending}
            onClick={() => {
              if (amount === null) return;
              recordPayment.mutate(
                {
                  amount,
                  at: new Date(`${paidOn}T00:00:00+08:00`).toISOString(),
                  method: "BANK_TRANSFER",
                  ...(reference === "" ? {} : { reference }),
                },
                {
                  onSuccess: () => {
                    setRecording(false);
                    setAmount(null);
                    setPaidOn("");
                    setReference("");
                  },
                },
              );
            }}
          >
            Record payment
          </PrimaryButton>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-ink-secondary">
            Creating an invoice is policy-gated; recording a payment against one is not. The
            outstanding balance and the collections queue both follow from what is entered here.
          </p>
          <MoneyInput
            label="Amount received"
            value={amount}
            onChange={setAmount}
            hint="Part payment is fine; the outstanding balance follows the sum of what is recorded."
          />
          <DateField label="Received on" value={paidOn} onChange={setPaidOn} />
          <TextField
            label="Bank reference"
            value={reference}
            onChange={setReference}
            placeholder="FT26…"
            mono
            hint="What the statement shows. A payment nobody can trace is not reconciled."
          />
          {recordPayment.error ? (
            <ActionOutcome
              error={describeActionError(
                toApiError(recordPayment.error),
                "The payment was not recorded",
              )}
              subject={`Payment · ${data.ref}`}
            />
          ) : null}
        </div>
      </Drawer>
    </div>
  );
}

/**
 * One sync attempt.
 *
 * A failed attempt is KEPT, not replaced by the success that followed it. The
 * error carries what the provider said and what a human did about it; deleting
 * that leaves the next mapping failure with no precedent to follow.
 */
function SyncRow({ event }: { event: SyncEvent }) {
  const failed = event.state === "ERROR";

  return (
    <li className="flex flex-wrap items-baseline gap-x-2.5 border-t border-divider py-2.5 text-[13px]">
      <span className="font-mono text-[12px] text-ink-muted">
        <DateText value={event.at} withTime />
      </span>
      <StatusChip tone={SYNC_TONE[event.state]}>{humanise(event.state)}</StatusChip>
      <span className="min-w-0 flex-1 text-ink-secondary">
        {event.providerCode ? (
          <span className="font-mono text-[12px] text-ink">{event.providerCode} · </span>
        ) : null}
        {event.detail}
        {event.uin ? <span className="font-mono text-[12px] text-ink"> · {event.uin}</span> : null}
      </span>
      {failed && event.resolution ? (
        <span className="w-full pt-1 text-[12px] text-ink-muted">
          Resolved by {event.resolution}, then retried.
        </span>
      ) : null}
    </li>
  );
}

function PaymentTable({ invoice }: { invoice: Invoice }) {
  const columns: Column<Invoice["payments"][number]>[] = [
    { key: "at", label: "Received", accessor: (payment) => <DateText value={payment.at} /> },
    {
      key: "method",
      label: "Method",
      accessor: (payment) => (payment.method ? humanise(payment.method) : "—"),
    },
    {
      key: "reference",
      label: "Reference",
      accessor: (payment) => (
        <span className="font-mono text-[12px]">{payment.reference ?? "—"}</span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      accessor: (payment) => <MoneyText value={payment.amount} />,
    },
  ];

  return (
    <DataTable
      label={`Payments against ${invoice.ref}`}
      columns={columns}
      rows={invoice.payments}
      rowKey={(payment) => payment.id}
    />
  );
}

function RelatedRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-divider py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}
