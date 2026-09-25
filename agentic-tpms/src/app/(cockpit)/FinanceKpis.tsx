import Link from "next/link";
import { DataTable, MetricStrip, SECTION_LABEL, Section } from "@/components/kit";
import { formatRM, toSen } from "@/lib/money";
import { plain } from "@/server/actions";
import { listClaimQueueDetail, summariseClaimQueue } from "@/server/claims";
import { executiveOverview, marginByPackage } from "@/server/finance";

const pctText = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);

/**
 * Finance KPIs on Home: claim DSO, receivables with HRD Corp, cash still to
 * come from HRD Corp, and unit-economics margin by trainer and by package.
 * Margins are estimates until settlement reconciles the ledger; they say so.
 */
export async function FinanceKpis() {
  const [overview, queue, packages] = await Promise.all([executiveOverview(), listClaimQueueDetail(), marginByPackage({ limit: 5 })]);
  const o = plain(overview);
  const claims = summariseClaimQueue(plain(queue));
  const trainers = o.marginByTrainer.slice(0, 5);
  const revenue = o.marginByTrainer.reduce((acc, t) => acc + toSen(t.revenue), 0);
  const gross = o.marginByTrainer.reduce((acc, t) => acc + toSen(t.grossMargin), 0);
  const jobs = o.marginByTrainer.reduce((acc, t) => acc + t.packages, 0);
  const reconciled = o.marginByTrainer.reduce((acc, t) => acc + t.reconciled, 0);
  const oldest = o.receivables.rows.reduce<number | null>((acc, r) => (r.daysOutstanding === null ? acc : Math.max(acc ?? 0, r.daysOutstanding)), null);

  return (
    <Section
      eyebrow="Financial FSM · unit economics"
      title="Cash & margin"
      actions={
        <span className="flex items-center gap-3 text-[12px]">
          <Link href="/finance/claims" className="text-primary-hover hover:underline">Claims ›</Link>
          <Link href="/finance/payables" className="text-primary-hover hover:underline">Payables ›</Link>
        </span>
      }
      flush
    >
      <div className="px-4 pb-3 pt-3">
        <MetricStrip
          bare
          cells={[
            {
              label: "Claim DSO",
              value: o.dso.averageDays === null ? "—" : `${o.dso.averageDays} days`,
              sub: o.dso.sampleSize ? `${o.dso.sampleSize} remitted · ${o.dso.windowDays} d` : `none in ${o.dso.windowDays} d`,
            },
            {
              label: "Receivables",
              value: formatRM(o.receivables.total, { compact: true }),
              sub: `${o.receivables.count} claims${oldest !== null ? ` · oldest ${oldest} d` : ""}`,
            },
            {
              label: "Waiting on HRD Corp",
              value: formatRM(claims.awaitingHrdc, { compact: true }),
              sub: `${formatRM(claims.notSubmitted.amount, { compact: true })} unclaimed`,
            },
            {
              label: "Gross margin",
              value: revenue > 0 ? pctText(Math.round((gross / revenue) * 1000) / 10) : "—",
              sub: `${jobs} ${jobs === 1 ? "job" : "jobs"}`,
              estimate: reconciled < jobs,
            },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 border-t border-divider lg:grid-cols-2">
        <div className="min-w-0 lg:border-r lg:border-divider">
          <p className={`${SECTION_LABEL} px-3 pb-1.5 pt-2.5`}>Margin by trainer · estimates until settled</p>
          <DataTable
            label="Margin by trainer"
            density="compact"
            rows={trainers}
            rowKey={(t) => t.trainerId ?? t.trainerName}
            empty={<p className="px-3 pb-3 text-[12px] text-ink-muted">No claims submitted yet.</p>}
            columns={[
              { key: "name", label: "Trainer", cell: (t) => <span className="block max-w-[140px] truncate">{t.trainerName}</span> },
              { key: "jobs", label: "Jobs", align: "right", cell: (t) => <span title={`${t.reconciled} of ${t.packages} reconciled at settlement`}>{t.packages}</span> },
              { key: "gm", label: "Gross margin", align: "right", cell: (t) => <span className="whitespace-nowrap">{formatRM(t.grossMargin, { compact: true })}</span> },
              { key: "pct", label: "%", align: "right", cell: (t) => pctText(t.marginPct) },
            ]}
          />
        </div>
        <div className="min-w-0 border-t border-divider lg:border-t-0">
          <p className={`${SECTION_LABEL} px-3 pb-1.5 pt-2.5`}>Margin by package · latest</p>
          <DataTable
            label="Margin by package"
            density="compact"
            rows={plain(packages)}
            rowKey={(p) => p.packageId}
            rowHref={(p) => `/operations/${p.packageCode}/claims`}
            empty={<p className="px-3 pb-3 text-[12px] text-ink-muted">No claims submitted yet.</p>}
            columns={[
              {
                key: "pkg",
                label: "Package",
                cell: (p) => (
                  <span className="flex flex-col">
                    <span className="font-mono text-[12px]">{p.packageCode}</span>
                    <span className="max-w-[170px] truncate whitespace-nowrap text-[12px] text-ink-muted">{p.reconciled ? "settled" : "estimate"} · revenue {formatRM(p.revenue, { compact: true })}</span>
                  </span>
                ),
              },
              { key: "gm", label: "Gross margin", align: "right", cell: (p) => <span className="whitespace-nowrap">{formatRM(p.grossMargin, { compact: true })}</span> },
              { key: "pct", label: "%", align: "right", cell: (p) => pctText(p.marginPct) },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}
