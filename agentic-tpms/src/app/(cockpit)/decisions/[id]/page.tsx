import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { AIChip, Banner, Body, DefinitionList, LINK_BUTTON, RecordHeader, Section, StatusChip } from "@/components/kit";
import { gateHref } from "@/components/decisions/gateLinks";
import { AuditTimeline } from "@/components/packages/AuditTimeline";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { listAudit } from "@/server/audit/ledger";
import { db, schema } from "@/server/db/client";
import { GATE_LABEL } from "@/server/decisions/service";

export const dynamic = "force-dynamic";

export default async function DecisionDetailPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const [d] = await db().select().from(schema.decisions).where(eq(schema.decisions.id, params.id));
  if (!d) notFound();
  const [pkg] = d.packageId ? await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, d.packageId)) : [];
  const trail = await listAudit({ entityId: d.id, limit: 20 });
  const desk = gateHref(d.gate, pkg?.packageCode ?? null, d.subjectRef);
  const gateLabel = GATE_LABEL[d.gate as keyof typeof GATE_LABEL] ?? d.gate;

  return (
    <Frame crumbs={[{ label: "Decisions desk", href: "/decisions" }, { label: gateLabel }]}>
      <RecordHeader
        title={d.title}
        chips={<StatusChip tone={d.status === "PENDING" ? "warning" : d.status === "REJECTED" ? "danger" : "success"} live>{d.status === "PENDING" ? "Awaiting your decision" : d.status.toLowerCase()}</StatusChip>}
        meta={[d.subjectRef, pkg?.packageCode, `raised ${formatDate(d.createdAt, true)}`, d.slaDueAt ? `SLA ${formatDate(d.slaDueAt, true)}` : null]}
        actions={desk && d.status === "PENDING" ? <Link href={desk} className={LINK_BUTTON.primary}>Open the desk</Link> : null}
      />
      <Body>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Section eyebrow="Why this needs you" title={gateLabel}>
              <div className="flex flex-col gap-3">
                <p className="text-[14px] leading-relaxed text-ink">{d.summary}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-ink-muted">Raised by</span>
                  {d.raisedByTier ? <AIChip provenance={{ tier: d.raisedByTier, agent: d.raisedBy, mode: d.raisedByTier === "L0" ? "RULE" : d.raisedByTier === "L2" ? "EXTRACTION" : "LLM" }} /> : null}
                  <span className="font-mono text-[12px] text-ink-secondary">{d.raisedBy}</span>
                </div>
              </div>
            </Section>
            {d.options.length > 0 ? (
              <Section eyebrow="Options" title="What you can choose">
                <ul className="flex flex-col gap-2">
                  {d.options.map((o) => (
                    <li key={o.id} className={`rounded-panel border p-3 ${d.chosenOption === o.id ? "border-primary bg-ai-tint-2" : "border-border"}`}>
                      <p className="text-[13px] font-semibold text-ink">
                        {o.label} {d.chosenOption === o.id ? <span className="text-[12px] font-normal text-primary-hover">· chosen</span> : null}
                      </p>
                      <p className="text-[12px] text-ink-secondary">{o.description}</p>
                      {o.consequence ? <p className="text-[12px] text-ink-muted">{o.consequence}</p> : null}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
            <Section eyebrow="Evidence" title="Payload" flush>
              <pre className="max-h-[420px] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-secondary">{JSON.stringify(d.payload, null, 2)}</pre>
            </Section>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {d.status !== "PENDING" ? (
              <Banner tone="neutral" title={`Decided by ${d.resolvedBy}`}>
                {formatDate(d.resolvedAt, true)}
                {d.resolutionNote ? ` — “${d.resolutionNote}”` : ""}
              </Banner>
            ) : null}
            <Section eyebrow="What is being decided" title={pkg?.title ?? d.subjectRef}>
              <DefinitionList
                items={[
                  ["Gate", gateLabel],
                  ["Subject", d.subjectRef],
                  ["Package", pkg ? <Link key="p" href={`/operations/${pkg.packageCode}`} className="text-primary-hover hover:underline">{pkg.packageCode}</Link> : "—"],
                  ["Stage", pkg ? `${pkg.operationalStage.toLowerCase().replace(/_/g, " ")} / ${pkg.financialStage.toLowerCase().replace(/_/g, " ")}` : "—"],
                ]}
              />
            </Section>
            <Section eyebrow="Append-only ledger" title="Audit trail">
              <AuditTimeline rows={trail} compact />
            </Section>
          </div>
        </div>
      </Body>
    </Frame>
  );
}
