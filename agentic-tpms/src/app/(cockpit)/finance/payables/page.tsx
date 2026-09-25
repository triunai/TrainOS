import Link from "next/link";
import { Body, DataTable, EmptyState, MetricStrip, PageHeader, PillTabNav, Section, StatusChip } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { PAYEE_LABEL } from "@/components/finance/tones";
import { VoucherList } from "@/components/finance/VoucherList";
import { finLabel, finTone } from "@/components/packages/stageTone";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { payablesDesk, type PayablesGroup, type PayablesState } from "@/server/finance";
import { adjustVoucherAction, markPaidAction, settleAction } from "../../operations/[code]/claims/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payables" };

const VIEWS: Array<{ id: string; state: PayablesState; label: string }> = [
  { id: "payable", state: "PAYABLE", label: "Payable" },
  { id: "awaiting", state: "AWAITING_REMITTANCE", label: "Awaiting remittance" },
  { id: "settled", state: "SETTLED", label: "Settled" },
];

const claimsTab = (code: string) => `/operations/${code}/claims`;
const live = (g: PayablesGroup) => g.vouchers.filter((v) => v.status !== "CANCELLED");

function PackageCell({ g }: { g: PayablesGroup }) {
  return (
    <div className="flex min-w-0 flex-col" title={g.title}>
      <Link href={claimsTab(g.packageCode)} className="font-mono text-[12px] text-primary-hover hover:underline">{g.packageCode}</Link>
      <span className="max-w-[220px] truncate text-[13px] text-ink">{g.clientName}</span>
      <span className="max-w-[220px] truncate text-[12px] text-ink-muted">{g.title}</span>
    </div>
  );
}

function PayableGroup({ g }: { g: PayablesGroup }) {
  const vouchers = live(g);
  const paid = vouchers.filter((v) => v.status === "PAID").length;
  return (
    <Section
      eyebrow={`${g.clientName} · HRD Corp remitted ${formatRM(g.remittanceAmount)}${g.remittanceReference ? ` · ${g.remittanceReference}` : ""}`}
      title={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <Link href={claimsTab(g.packageCode)} className="font-mono text-[13px] font-medium text-primary-hover hover:underline">{g.packageCode}</Link>
          <span>{g.title}</span>
        </span>
      }
      actions={
        g.readyToSettle ? (
          <ActionButton
            action={settleAction}
            args={[g.packageCode]}
            label="Settle & close"
            confirm={{
              title: `Settle and close ${g.packageCode}?`,
              body: `Every voucher (${formatRM(g.total)}) is paid with a bank reference and a receipt. REMITTED → SETTLED_CLOSED under AP_DISBURSEMENT_CONFIRMED, attributed to you; the unit-economics ledger is rewritten with the actual payments.`,
              confirmLabel: "Settle & close",
            }}
          />
        ) : (
          <span className="text-[12px] text-ink-muted">
            {paid} of {vouchers.length} paid · settle when all are paid
          </span>
        )
      }
      flush
    >
      <VoucherList vouchers={g.vouchers} payable waitingReason="" adjust={adjustVoucherAction} pay={markPaidAction} />
      <div className="flex justify-between gap-3 border-t border-divider px-4 py-2 text-[12px] text-ink-secondary">
        <span>{vouchers.length} {vouchers.length === 1 ? "voucher" : "vouchers"}</span>
        <span className="tabular-nums">
          {formatRM(g.unpaid)} unpaid of {formatRM(g.total)}
        </span>
      </div>
    </Section>
  );
}

export default async function PayablesPage({ searchParams }: { searchParams: { view?: string } }) {
  const desk = plain(await payablesDesk());
  const m = desk.metrics;
  const view = VIEWS.find((v) => v.id === searchParams.view) ?? VIEWS[0];
  const groups = desk.groups.filter((g) => g.state === view.state);
  if (view.state === "PAYABLE") groups.sort((a, b) => Number(b.readyToSettle) - Number(a.readyToSettle) || a.packageCode.localeCompare(b.packageCode));
  if (view.state === "SETTLED") groups.reverse();

  return (
    <Frame crumbs={[{ label: "Claims & AP" }, { label: "Payables" }]}>
      <PageHeader title="Payables" summary="Gate 3 · accounts payable across packages · pay-when-paid: a trainer or vendor is paid only after HRD Corp remits that package's claim">
        <MetricStrip
          cells={[
            { label: "Payable now", value: formatRM(m.payableNow.amount), sub: `${m.payableNow.toApprove} to approve · ${m.payableNow.toPay} to pay` },
            { label: "Awaiting remittance", value: formatRM(m.awaitingRemittance.amount), sub: `${m.awaitingRemittance.packages} delivered ${m.awaitingRemittance.packages === 1 ? "package" : "packages"}` },
            { label: "Paid this month", value: formatRM(m.paidThisMonth.amount), sub: `${m.paidThisMonth.vouchers} ${m.paidThisMonth.vouchers === 1 ? "voucher" : "vouchers"}` },
            { label: "Ready to settle", value: String(m.readyToSettle), sub: m.readyToSettle === 1 ? "package" : "packages" },
          ]}
        />
      </PageHeader>
      <Body>
        <PillTabNav
          label="Payables view"
          activeId={view.id}
          tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, count: desk.groups.filter((g) => g.state === v.state).length, href: `/finance/payables?view=${v.id}` }))}
        />

        {groups.length === 0 ? (
          <Section>
            <EmptyState
              title={view.state === "PAYABLE" ? "Nothing payable" : view.state === "AWAITING_REMITTANCE" ? "Nothing waiting on HRD Corp" : "Nothing settled yet"}
              description={view.state === "PAYABLE" ? "Vouchers are drafted the moment HRD Corp remits a package's claim, and appear here to approve and pay." : undefined}
            />
          </Section>
        ) : view.state === "PAYABLE" ? (
          groups.map((g) => <PayableGroup key={g.packageId} g={g} />)
        ) : view.state === "AWAITING_REMITTANCE" ? (
          <Section flush eyebrow="Pay-when-paid" title="Owed once HRD Corp remits">
            <DataTable
              label="Payables awaiting remittance"
              rows={groups}
              rowKey={(g) => g.packageId}
              rowHref={(g) => claimsTab(g.packageCode)}
              columns={[
                { key: "pkg", label: "Package · client", cell: (g) => <PackageCell g={g} /> },
                { key: "stage", label: "Claim", cell: (g) => <StatusChip tone={finTone(g.financialStage)}>{finLabel(g.financialStage)}</StatusChip> },
                {
                  key: "payees",
                  label: "Payees",
                  cell: (g) => (
                    <ul className="grid w-full max-w-[420px] grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-[12px]">
                      {(g.planned.length ? g.planned.map((p) => ({ key: `${p.payeeType}:${p.payeeName}`, name: p.payeeName, type: p.payeeType, amount: p.agreed, basis: p.basis })) : live(g).map((v) => ({ key: v.id, name: v.payeeName, type: v.payeeType, amount: v.finalAmount, basis: v.pvNumber }))).map((p) => (
                        <li key={p.key} className="contents" title={p.basis}>
                          <span className="truncate text-ink">
                            {p.name} <span className="text-ink-muted">· {PAYEE_LABEL[p.type] ?? p.type.toLowerCase()}</span>
                          </span>
                          <span className="whitespace-nowrap text-right tabular-nums text-ink-secondary">{formatRM(p.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ),
                },
                { key: "owed", label: "Owed", align: "right", cell: (g) => <span className="whitespace-nowrap font-medium">{formatRM(g.unpaid)}</span> },
                {
                  key: "payable",
                  label: "Payable",
                  cell: (g) => (
                    <StatusChip tone="neutral" title={g.vouchers.length ? "Vouchers exist but cannot be paid before HRD Corp remits" : "Vouchers are drafted when HRD Corp remits"}>
                      waiting on remittance
                    </StatusChip>
                  ),
                },
              ]}
            />
          </Section>
        ) : (
          <Section flush>
            <DataTable
              label="Settled packages"
              rows={groups}
              rowKey={(g) => g.packageId}
              rowHref={(g) => claimsTab(g.packageCode)}
              columns={[
                { key: "pkg", label: "Package · client", cell: (g) => <PackageCell g={g} /> },
                { key: "vouchers", label: "Vouchers", align: "right", cell: (g) => live(g).length },
                { key: "paid", label: "Paid out", align: "right", cell: (g) => formatRM(g.total) },
                { key: "remitted", label: "HRD Corp remitted", align: "right", cell: (g) => formatRM(g.remittanceAmount) },
                {
                  key: "last",
                  label: "Last payment",
                  cell: (g) => formatDate(live(g).flatMap((v) => (v.paidAt ? [new Date(v.paidAt).toISOString()] : [])).sort().at(-1) ?? null),
                },
              ]}
            />
          </Section>
        )}
      </Body>
    </Frame>
  );
}
