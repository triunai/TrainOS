import Link from "next/link";
import { Body, DataTable, MetricStrip, MiniBar, PageHeader, Section, StatusChip } from "@/components/kit";
import { finLabel, finTone, opsLabel } from "@/components/packages/stageTone";
import { Frame } from "@/components/shell/Frame";
import { LiveRefresh } from "@/components/shell/LiveRefresh";
import { daysBetween, formatDate, todayMY } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { currentOperator } from "@/server/auth/operator";
import { GATE_LABEL } from "@/server/decisions/service";
import { listDecisionRows } from "@/server/decisions/queries";
import { FIN_STAGES, OPS_SPINE } from "@/server/domain/stages";
import { pipelineTotals, stageCounts, upcomingDeliveries } from "@/server/packages/overview";
import { FinanceKpis } from "./FinanceKpis";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function HomePage() {
  const operator = currentOperator();
  const [totals, counts, upcoming, decisions] = await Promise.all([pipelineTotals(), stageCounts(), upcomingDeliveries(30), listDecisionRows("PENDING", 8)]);
  const today = todayMY();
  const opsMax = Math.max(1, ...counts.ops.map((c) => c.count));
  return (
    <Frame crumbs={[{ label: "Overview" }]}>
      <LiveRefresh />
      <PageHeader
        title={`Good day, ${operator.name.split(" ")[0]}`}
        summary={`${formatDate(today)} · single-tenant training operations for HRD Corp SBL-Khas`}
      >
        <MetricStrip
          cells={[
            { label: "Live packages", value: String(totals.live), sub: formatRM(totals.liveValue, { compact: true }) },
            { label: "Settled to date", value: formatRM(totals.settledValue, { compact: true }) },
            { label: "Decisions waiting", value: String(totals.decisions) },
            { label: "Attendance exceptions", value: String(totals.exceptions) },
            { label: "Leads · 7 days", value: String(totals.leads7d) },
          ]}
        />
      </PageHeader>
      <Body>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Section eyebrow="Operational FSM" title="Pipeline by stage" actions={<Link href="/operations" className="text-[12px] text-primary-hover hover:underline">Board ›</Link>}>
              <ul className="flex flex-col gap-2.5">
                {OPS_SPINE.map((stage) => {
                  const c = counts.ops.find((x) => x.stage === stage);
                  return (
                    <li key={stage} className="grid grid-cols-[150px_minmax(0,1fr)_110px_40px] items-center gap-3 text-[13px]">
                      <span className="truncate text-ink-secondary">{opsLabel(stage)}</span>
                      <MiniBar value={(c?.count ?? 0) / opsMax} label={opsLabel(stage)} />
                      <span className="text-right tabular-nums text-ink-secondary">{formatRM(c?.value ?? 0, { compact: true })}</span>
                      <span className="text-right tabular-nums text-ink">{c?.count ?? 0}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
            <FinanceKpis />
            <Section eyebrow="Next 30 days" title="Upcoming deliveries" flush>
              <DataTable
                label="Upcoming"
                rows={plain(upcoming)}
                rowKey={(r) => r.packageCode}
                rowHref={(r) => `/operations/${r.packageCode}`}
                empty={<p className="px-4 py-4 text-[13px] text-ink-muted">Nothing scheduled in the next 30 days.</p>}
                columns={[
                  { key: "start", label: "Starts", cell: (r) => `${formatDate(r.startDate)} · T-${daysBetween(today, r.startDate)}` },
                  { key: "client", label: "Client · programme", cell: (r) => (<div className="flex flex-col"><span className="font-medium">{r.clientName}</span><span className="text-[12px] text-ink-muted">{r.title}</span></div>) },
                  { key: "stage", label: "Stage", cell: (r) => opsLabel(r.operationalStage) },
                  { key: "pax", label: "Cohort", align: "right", cell: (r) => <span className={r.participants < r.minParticipants ? "font-medium text-warning" : ""}>{r.participants} / min {r.minParticipants}</span> },
                ]}
              />
            </Section>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Section eyebrow="Human in the loop" title="Waiting on you" actions={<Link href="/decisions" className="text-[12px] text-primary-hover hover:underline">Desk ›</Link>} flush>
              {decisions.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-ink-muted">Inbox zero.</p>
              ) : (
                <ul>
                  {decisions.map((d) => (
                    <li key={d.id} className="border-b border-divider px-4 py-2.5 last:border-b-0">
                      <Link href={`/decisions/${d.id}`} className="block truncate text-[13px] font-medium text-ink hover:underline">{d.title}</Link>
                      <p className="truncate text-[12px] text-ink-muted">{GATE_LABEL[d.gate as keyof typeof GATE_LABEL] ?? d.gate} · {d.packageCode ?? d.subjectRef}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section eyebrow="Financial FSM" title="Claims pipeline">
              <ul className="flex flex-col gap-1.5">
                {FIN_STAGES.filter((s) => s !== "VOIDED").map((stage) => {
                  const c = counts.fin.find((x) => x.stage === stage);
                  if (!c) return null;
                  return (
                    <li key={stage} className="flex items-center justify-between gap-3 text-[13px]">
                      <StatusChip tone={finTone(stage)}>{finLabel(stage)}</StatusChip>
                      <span className="tabular-nums text-ink-secondary">{c.count} · {formatRM(c.value, { compact: true })}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          </div>
        </div>
      </Body>
    </Frame>
  );
}
