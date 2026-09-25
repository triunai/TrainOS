import Link from "next/link";
import { Banner, Body, DataTable, LINK_BUTTON, MetricStrip, MiniBar, PageHeader, Section, StatusChip } from "@/components/kit";
import { CostBreakdown } from "@/components/settings/CostBreakdown";
import { Frame } from "@/components/shell/Frame";
import { formatRM, pct } from "@/lib/money";
import { plain } from "@/server/actions";
import { getUsageSummary } from "@/server/ai";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage & cost" };

export default async function UsagePage() {
  const u = plain(await getUsageSummary({ topPackages: 8 }));
  const cap = u.budgets.reduce((a, b) => a + Number(b.capMyr), 0);
  const paused = u.budgets.filter((b) => b.state === "PAUSED");
  const maxDay = Math.max(0.0001, ...u.daily.map((d) => Number(d.costMyr)));
  return (
    <Frame crumbs={[{ label: "Settings" }, { label: "Usage & cost" }]}>
      <PageHeader
        title="Usage"
        summary={`${u.month} · ${u.timeZone} · every model call and every template fallback is a row in llm_usage`}
        actions={<Link href="/settings/ai/keys" className={LINK_BUTTON.secondary}>Provider keys</Link>}
      >
        <MetricStrip
          cells={[
            { label: "LLM spend", value: formatRM(u.totalMyr), bar: cap > 0 ? Number(u.totalMyr) / cap : 0, sub: `of ${formatRM(cap)} across tier caps` },
            { label: "Forecast to month end", value: formatRM(u.forecast.projectedMyr), sub: `trailing 7-day avg ${formatRM(u.forecast.trailing7DayAverageMyr)}/day`, estimate: true },
            { label: "Model calls", value: String(u.calls) },
            { label: "Template fallback", value: pct(u.templateFallback.share * 100, 0), bar: u.templateFallback.share, sub: `${u.templateFallback.fallbacks} of ${u.templateFallback.fallbacks + u.templateFallback.answers} runs` },
            { label: "Cache-hit ratio", value: pct(u.cacheHitRatio * 100, 0), bar: u.cacheHitRatio },
          ]}
        />
      </PageHeader>
      <Body>
        {paused.map((b) => (
          <Banner key={b.tier} tone="danger" title={`${b.tier} ${b.label} is paused by its cap`}>
            {formatRM(b.spentMyr)} spent of {formatRM(b.capMyr)}. Every run on this tier answers from its deterministic template until the cap is raised or the month rolls over.
          </Banner>
        ))}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Section eyebrow={u.month} title="Cost breakdown">
            <CostBreakdown
              byTier={u.byTier}
              byAgent={u.byAgent}
              byModel={u.byModel.map((m) => ({ key: `${m.provider} · ${m.model}`, costMyr: m.costMyr, calls: m.calls, share: 0 }))}
            />
          </Section>
          <Section eyebrow="Daily" title="Spend this month">
            <div className="flex h-[140px] items-end gap-[3px]" role="img" aria-label="Daily spend">
              {u.daily.map((d) => (
                <div key={d.date} title={`${d.date}: ${formatRM(d.costMyr)} · ${d.calls} calls`} className="flex-1 rounded-t-[2px] bg-ink/80" style={{ height: `${Math.max(2, (Number(d.costMyr) / maxDay) * 100)}%` }} />
              ))}
            </div>
            <p className="mt-2 text-[12px] text-ink-muted">Forecast is a straight line through the last seven days — an estimate, labelled as one.</p>
          </Section>
        </div>
        <Section title="Budget caps" flush>
          <DataTable
            label="Budgets"
            rows={u.budgets}
            rowKey={(b) => b.tier}
            columns={[
              { key: "tier", label: "Scope", cell: (b) => <span><span className="font-mono">{b.tier}</span> · {b.label}</span> },
              { key: "cap", label: "Cap", align: "right", cell: (b) => formatRM(b.capMyr) },
              { key: "spent", label: "Spent", align: "right", cell: (b) => formatRM(b.spentMyr) },
              { key: "bar", label: "Progress", cell: (b) => <MiniBar value={b.ratio} state={b.state === "PAUSED" ? "danger" : b.state === "NEAR" ? "warning" : "neutral"} label={`${b.tier} budget`} width="160px" /> },
              { key: "state", label: "Status", cell: (b) => <StatusChip tone={b.state === "PAUSED" ? "danger" : b.state === "NEAR" ? "warning" : "neutral"}>{b.state.toLowerCase()}</StatusChip> },
            ]}
          />
        </Section>
        <Section title="Top packages by AI cost" flush>
          <DataTable
            label="Packages"
            rows={u.topPackages}
            rowKey={(p) => p.packageId}
            rowHref={(p) => `/operations/${p.packageCode}`}
            columns={[
              { key: "code", label: "Package", cell: (p) => p.packageCode, mono: true },
              { key: "title", label: "Programme", cell: (p) => p.title },
              { key: "calls", label: "Calls", align: "right", cell: (p) => String(p.calls) },
              { key: "cost", label: "Cost", align: "right", cell: (p) => formatRM(p.costMyr) },
            ]}
          />
        </Section>
      </Body>
    </Frame>
  );
}
