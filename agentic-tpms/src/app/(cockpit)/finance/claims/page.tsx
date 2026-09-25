import Link from "next/link";
import { Banner, Body, DataTable, EmptyState, MetricStrip, MiniBar, PageHeader, PillTabNav, Section, StatusChip, type StatusTone } from "@/components/kit";
import { finLabel, finTone } from "@/components/packages/stageTone";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { OPERATORS } from "@/server/auth/operator";
import { CLAIM_QUEUE_STAGES, CLAIM_WINDOW_MONTHS, CLAIM_WINDOW_WARN_DAYS, listClaimQueueDetail, summariseClaimQueue, type ClaimQueueItem, type ClaimWindowState } from "@/server/claims";

export const dynamic = "force-dynamic";
export const metadata = { title: "Claims" };

/** R14: every window state has a rendering; an unknown one is a type error here. */
const WINDOW: Record<ClaimWindowState, { tone: StatusTone | null; label: (i: ClaimQueueItem) => string }> = {
  OPEN: { tone: null, label: (i) => `closes ${formatDate(i.window?.deadline)}` },
  CLOSING: { tone: "warning", label: (i) => `${i.window?.daysLeft} days left` },
  LAPSED: { tone: "danger", label: (i) => `lapsed ${Math.abs(i.window?.daysLeft ?? 0)} days ago` },
  FILED: { tone: null, label: () => "filed" },
};

const operatorName = (id: string) => OPERATORS.find((o) => o.id === id)?.name ?? id;
const claimsTab = (code: string) => `/operations/${code}/claims`;
const daysAgo = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null);

function HrdcStatus({ item }: { item: ClaimQueueItem }) {
  if (item.financialStage === "QUERIED" && item.query) {
    return (
      <div className="flex w-[210px] flex-col">
        <span className="line-clamp-2 text-[12px] text-ink" title={item.query.note}>{item.query.note}</span>
        <span className="text-[12px] text-ink-muted">queried {formatDate(item.query.raisedAt)} · recorded by {operatorName(item.query.raisedBy)}</span>
      </div>
    );
  }
  const answered = item.query && item.query.count > 0 ? `${item.query.count} ${item.query.count === 1 ? "query" : "queries"} answered` : null;
  if (item.claimSubmissionRef) {
    const days = daysAgo(item.submittedAt);
    const tail = item.financialStage === "REMITTED" ? `remitted ${formatRM(item.remittanceAmount)}` : days === null ? "" : `${days} days with HRD Corp`;
    return (
      <div className="flex flex-col">
        <span className="whitespace-nowrap font-mono text-[12px] text-ink">{item.claimSubmissionRef}</span>
        {tail ? <span className="whitespace-nowrap text-[12px] text-ink-muted">{tail}</span> : null}
        {answered ? <span className="whitespace-nowrap text-[12px] text-ink-muted">{answered}</span> : null}
      </div>
    );
  }
  return <span className="whitespace-nowrap text-[12px] text-ink-muted">{item.pendingDecisionId ? "pack ready for your review" : "not submitted"}</span>;
}

export default async function ClaimsQueuePage({ searchParams }: { searchParams: { stage?: string } }) {
  const all = plain(await listClaimQueueDetail());
  const summary = summariseClaimQueue(all);
  const active = CLAIM_QUEUE_STAGES.find((s) => s === searchParams.stage) ?? "ALL";
  const rows = active === "ALL" ? all : all.filter((i) => i.financialStage === active);
  const closing = all.filter((i) => i.window?.state === "CLOSING" || i.window?.state === "LAPSED");

  return (
    <Frame crumbs={[{ label: "Claims & AP" }, { label: "Claims" }]}>
      <PageHeader
        title="Claims"
        summary={`${all.length} open claims · ${formatRM(summary.awaitingHrdc)} still to come from HRD Corp · a claim must reach e-TRiS within ${CLAIM_WINDOW_MONTHS} months of the last training day`}
      >
        <MetricStrip
          cells={[
            { label: "Total claimable", value: formatRM(summary.claimable.amount), sub: `${summary.claimable.count} claims · ${formatRM(summary.notSubmitted.amount, { compact: true })} not yet submitted` },
            { label: "Submitted · awaiting HRD Corp", value: formatRM(summary.submitted.amount), sub: `${summary.submitted.count} ${summary.submitted.count === 1 ? "claim" : "claims"}` },
            { label: "Approved · awaiting remittance", value: formatRM(summary.approved.amount), sub: `${summary.approved.count} ${summary.approved.count === 1 ? "claim" : "claims"}` },
            { label: "Queried", value: String(summary.queried.count), sub: formatRM(summary.queried.amount) },
          ]}
        />
      </PageHeader>
      <Body>
        {closing.length > 0 ? (
          <Banner tone={closing.some((i) => i.window?.state === "LAPSED") ? "danger" : "warning"} title={`${closing.length} ${closing.length === 1 ? "claim is" : "claims are"} inside ${CLAIM_WINDOW_WARN_DAYS} days of the HRD Corp deadline`}>
            {closing.map((i, n) => (
              <span key={i.packageId}>
                {n > 0 ? " · " : ""}
                <Link href={claimsTab(i.packageCode)} className="font-medium text-ink hover:underline">{i.packageCode}</Link> closes {formatDate(i.window?.deadline)}{i.checklist.missing[0] ? ` — blocked on: ${i.checklist.missing[0]}` : " — ready to submit"}
              </span>
            ))}
          </Banner>
        ) : null}

        <PillTabNav
          label="Financial stage"
          activeId={active}
          tabs={[
            { id: "ALL", label: "All open", count: all.length, href: "/finance/claims" },
            ...summary.stages.map((s) => ({ id: s.stage, label: finLabel(s.stage), count: s.count, href: `/finance/claims?stage=${s.stage}` })),
          ]}
        />

        <Section flush>
          <DataTable
            label={active === "ALL" ? "Open claims" : `Claims at ${finLabel(active)}`}
            rows={rows}
            rowKey={(i) => i.packageId}
            rowHref={(i) => claimsTab(i.packageCode)}
            empty={<EmptyState title={active === "ALL" ? "No open claims" : `Nothing at ${finLabel(active)}`} description="A claim opens when delivery is verified complete and closes when the package is settled." />}
            columns={[
              {
                key: "pkg",
                label: "Package · client",
                cell: (i) => (
                  <div className="flex min-w-0 flex-col" title={i.title}>
                    <Link href={claimsTab(i.packageCode)} className="font-mono text-[12px] text-primary-hover hover:underline">{i.packageCode}</Link>
                    <span className="max-w-[200px] truncate text-[13px] text-ink">{i.clientName}</span>
                    <span className="max-w-[200px] truncate text-[12px] text-ink-muted">{i.title}</span>
                  </div>
                ),
              },
              { key: "stage", label: "Stage", cell: (i) => <StatusChip tone={finTone(i.financialStage)}>{finLabel(i.financialStage)}</StatusChip> },
              {
                key: "amount",
                label: "Claimable",
                align: "right",
                cell: (i) => (
                  <div className="flex flex-col items-end whitespace-nowrap">
                    <span className="font-medium text-ink">{formatRM(i.claimable)}</span>
                    {Number(i.upfrontAmount) > 0 ? <span className="text-[12px] text-ink-muted">less upfront {formatRM(i.upfrontAmount, { compact: true })}</span> : null}
                    {i.financialStage === "APPROVED" && i.hrdcApprovedAmount !== i.claimable ? <span className="text-[12px] text-ink-muted">approved {formatRM(i.hrdcApprovedAmount, { compact: true })}</span> : null}
                  </div>
                ),
              },
              {
                key: "evidence",
                label: "Checklist",
                cell: (i) =>
                  i.window?.state === "FILED" ? (
                    <span className="whitespace-nowrap text-[12px] text-ink-muted">{i.checklist.ok}/{i.checklist.required} · pack filed</span>
                  ) : (
                  <div className="flex w-[140px] flex-col gap-1" title={i.checklist.missing.join(" · ") || "Every required item is in place"}>
                    <span className="flex items-center gap-2">
                      <MiniBar value={i.checklist.required ? i.checklist.ok / i.checklist.required : 0} width="56px" label={`${i.packageCode} checklist`} state={i.checklist.ready ? "success" : "neutral"} />
                      <span className="tabular-nums text-ink">{i.checklist.ok}/{i.checklist.required}</span>
                    </span>
                    {i.checklist.missing[0] ? <span className="truncate text-[12px] text-ink-muted">{i.checklist.missing[0]}</span> : null}
                  </div>
                ),
              },
              {
                key: "delivered",
                label: "Delivered",
                cell: (i) => (
                  <div className="flex flex-col whitespace-nowrap">
                    <span className="tabular-nums">{formatDate(i.endDate)}</span>
                    <span className="text-[12px] text-ink-muted">{i.daysSinceEnd === null ? "—" : `${i.daysSinceEnd} days ago`}</span>
                  </div>
                ),
              },
              {
                key: "window",
                label: "Claim window",
                cell: (i) => {
                  if (!i.window) return <span className="text-ink-muted">—</span>;
                  const w = WINDOW[i.window.state];
                  return w.tone ? <StatusChip tone={w.tone} title={`HRD Corp deadline ${formatDate(i.window.deadline)}`}>{w.label(i)}</StatusChip> : <span className="whitespace-nowrap text-[12px] text-ink-muted">{w.label(i)}</span>;
                },
              },
              { key: "hrdc", label: "HRD Corp", cell: (i) => <HrdcStatus item={i} /> },
            ]}
          />
        </Section>
        <p className="text-[12px] text-ink-muted">
          Every action on a claim — verifying evidence, approving the pack, recording a query, approval or remittance — happens on the package&apos;s Claims & AP tab. Open a row to go there.
        </p>
      </Body>
    </Frame>
  );
}
