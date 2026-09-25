import { sql } from "drizzle-orm";
import Link from "next/link";
import { AIChip, Body, DataTable, PageHeader, Section, StatusChip } from "@/components/kit";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { plain } from "@/server/actions";
import { db, rows } from "@/server/db/client";
import { env } from "@/server/env";
import { GUARDED_REASONS } from "@/server/fsm/guards";
import { TRANSITIONS } from "@/server/fsm/transitions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent pool" };

interface RunRow {
  id: string;
  agent: string;
  tier: string;
  status: string;
  package_code: string | null;
  started_at: Date;
  finished_at: Date | null;
  cost_myr: string;
  provenance: Record<string, unknown>;
  error: string | null;
}

async function extractionHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${env().PADDLEOCR_URL}/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { engines?: Record<string, boolean> };
    const engines = Object.entries(body.engines ?? {}).filter(([, on]) => on).map(([k]) => k);
    return { ok: true, detail: engines.join(", ") || "up" };
  } catch {
    return { ok: false, detail: "service unreachable" };
  }
}

const TIERS = [
  { tier: "L0", name: "Deterministic policy validator", engine: "TypeScript guards + Postgres triggers", role: "Cap maths, ≥80% attendance, TTT verified, SHA-256 on every file, every stage move", keyEnv: null },
  { tier: "L1", name: "Fast classifier & router", engine: "Gemini Flash Lite class (BYOK)", role: "Sub-200 ms triage: intent, P(levy), urgency, abstain", keyEnv: ["GEMINI_API_KEY", "OPENROUTER_API_KEY"] },
  { tier: "L2", name: "Extraction worker", engine: "PaddleOCR / OpenCV microservice + EXIF", role: "Form T3 AM/PM signatures, e-TRiS letters, photo GPS/time", keyEnv: null },
  { tier: "L3", name: "Domain specialists", engine: "DeepSeek V3 class (BYOK)", role: "HRD-L&D outlines (Bloom), TNA mapping, invoices, PVs, micro-TNA", keyEnv: ["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"] },
  { tier: "L4", name: "Tone specialist", engine: "Claude (BYOK)", role: "Outbound copy <75 words, T+14 executive pack, T+90 laddering", keyEnv: ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"] },
] as const;

export default async function AgentsPage() {
  const [runs, keyRows, health] = await Promise.all([
    rows<RunRow>(
      db(),
      sql`select r.id, r.agent, r.tier, r.status, p.package_code, r.started_at, r.finished_at, r.cost_myr::text, r.provenance, r.error
            from tpms.agent_runs r left join tpms.training_packages p on p.id = r.package_id
           order by r.started_at desc limit 100`,
    ),
    rows<{ provider: string; tiers: string[]; status: string }>(db(), sql`select provider, tiers, status from tpms.provider_keys where status not in ('INVALID','DISABLED')`),
    extractionHealth(),
  ]);
  const e = env() as unknown as Record<string, string | undefined>;
  const hasKey = (tier: string, envs: readonly string[] | null) =>
    !envs ? null : envs.some((k) => Boolean(e[k])) || keyRows.some((k) => k.tiers.length === 0 || k.tiers.includes(tier));

  return (
    <Frame crumbs={[{ label: "Automation" }, { label: "Agent pool" }]}>
      <PageHeader
        title="Agent pool"
        summary="Five tiers, one rule: agents propose drafts, quotations and decisions — only a named human or an L0 rule moves a package."
        actions={<Link href="/settings/ai/keys" className="text-[13px] text-primary-hover hover:underline">Provider keys ›</Link>}
      />
      <Body>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {TIERS.map((t) => {
            const key = hasKey(t.tier, t.keyEnv);
            const status =
              t.tier === "L0" ? { tone: "success" as const, label: `${TRANSITIONS.length} transitions · ${GUARDED_REASONS.length} guards` }
              : t.tier === "L2" ? { tone: health.ok ? ("success" as const) : ("warning" as const), label: health.detail }
              : key ? { tone: "success" as const, label: "key configured" }
              : { tone: "neutral" as const, label: "template fallback" };
            return (
              <section key={t.tier} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] text-ink-muted">{t.tier}</span>
                  <StatusChip tone={status.tone} className="text-[11px]">{status.label}</StatusChip>
                </div>
                <h2 className="text-[14px] font-semibold text-ink">{t.name}</h2>
                <p className="text-[12px] text-ink-secondary">{t.role}</p>
                <p className="mt-auto text-[11px] text-ink-muted">{t.engine}</p>
              </section>
            );
          })}
        </div>
        <Section eyebrow="agent_runs" title="Recent runs" flush>
          <DataTable
            label="Agent runs"
            density="compact"
            rows={plain(runs)}
            rowKey={(r) => r.id}
            columns={[
              { key: "agent", label: "Agent", cell: (r) => r.agent, mono: true },
              { key: "prov", label: "Provenance", cell: (r) => <AIChip provenance={{ ...(r.provenance as object), tier: r.tier }} /> },
              { key: "pkg", label: "Package", cell: (r) => (r.package_code ? <Link href={`/operations/${r.package_code}`} className="font-mono text-[12px] text-primary-hover hover:underline">{r.package_code}</Link> : "—") },
              { key: "status", label: "Status", cell: (r) => <StatusChip tone={r.status === "FAILED" ? "danger" : r.status === "RUNNING" ? "info" : r.status === "FALLBACK" ? "warning" : "neutral"}>{r.status.toLowerCase()}</StatusChip> },
              { key: "when", label: "Started", cell: (r) => formatDate(r.started_at, true) },
              { key: "ms", label: "Duration", align: "right", cell: (r) => (r.finished_at ? `${Math.max(0, new Date(r.finished_at).getTime() - new Date(r.started_at).getTime())} ms` : "—") },
              { key: "cost", label: "Cost", align: "right", cell: (r) => `RM ${Number(r.cost_myr).toFixed(4)}` },
            ]}
          />
        </Section>
      </Body>
    </Frame>
  );
}
