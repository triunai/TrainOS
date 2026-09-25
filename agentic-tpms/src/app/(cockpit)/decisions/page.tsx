import Link from "next/link";
import { AIChip, Body, PageHeader, Section, StatusChip } from "@/components/kit";
import { gateHref } from "@/components/decisions/gateLinks";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { GATE_LABEL } from "@/server/decisions/service";
import { listDecisionRows, type DecisionRow } from "@/server/decisions/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Decisions desk" };

function sla(row: DecisionRow): { label: string; breached: boolean } {
  if (!row.slaDueAt) return { label: "no SLA", breached: false };
  const minutes = Math.round((new Date(row.slaDueAt).getTime() - Date.now()) / 60000);
  if (minutes < 0) return { label: `SLA breached ${Math.abs(Math.round(minutes / 60))}h ago`, breached: true };
  return { label: minutes < 120 ? `${minutes} min left` : `${Math.round(minutes / 60)}h left`, breached: false };
}

function DecisionItem({ row }: { row: DecisionRow }) {
  const s = sla(row);
  const desk = gateHref(row.gate, row.packageCode, row.subjectRef);
  return (
    <li className="flex items-start gap-3 border-b border-divider px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/decisions/${row.id}`} className="text-[14px] font-medium text-ink hover:underline">
            {row.title}
          </Link>
          {row.raisedByTier ? <AIChip provenance={{ tier: row.raisedByTier, agent: row.raisedBy, mode: row.raisedByTier === "L0" ? "RULE" : row.raisedByTier === "L2" ? "EXTRACTION" : "LLM" }} /> : null}
        </div>
        <p className="line-clamp-2 text-[12px] text-ink-secondary">{row.summary}</p>
        <p className="font-mono text-[11px] text-ink-muted">
          {[row.packageCode ?? row.subjectRef, row.clientName, `raised ${formatDate(row.createdAt, true)} by ${row.raisedBy}`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className={s.breached ? "text-[12px] font-medium text-danger" : "text-[12px] text-ink-muted"}>{s.label}</span>
        {desk ? (
          <Link href={desk} className="text-[12px] text-primary-hover hover:underline">
            Open desk ›
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export default async function DecisionsPage() {
  const [pending, resolved] = await Promise.all([listDecisionRows("PENDING"), listDecisionRows("RESOLVED_ANY", 30)]);
  const byGate = new Map<string, DecisionRow[]>();
  for (const row of pending) byGate.set(row.gate, [...(byGate.get(row.gate) ?? []), row]);
  const breached = pending.filter((r) => sla(r).breached).length;

  return (
    <Frame crumbs={[{ label: "Decisions desk" }]}>
      <PageHeader
        title="Decisions desk"
        summary={`${pending.length} waiting on a human · ${breached} past SLA · agents and rules propose; only a named operator disposes`}
      />
      <Body>
        {pending.length === 0 ? (
          <Section title="Inbox zero">
            <p className="text-[13px] text-ink-secondary">No gate is waiting on you. New decisions arrive as agents draft quotations, the T-14 check runs, OCR finds exceptions and claims come back.</p>
          </Section>
        ) : (
          [...byGate.entries()].map(([gate, items]) => (
            <Section key={gate} eyebrow={`${items.length} pending`} title={GATE_LABEL[gate as keyof typeof GATE_LABEL] ?? gate} flush>
              <ul>
                {items.map((row) => (
                  <DecisionItem key={row.id} row={row} />
                ))}
              </ul>
            </Section>
          ))
        )}
        <Section eyebrow="Recently decided" title="History" flush>
          {resolved.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-muted">Nothing decided yet.</p>
          ) : (
            <ul>
              {resolved.map((row) => (
                <li key={row.id} className="flex items-center gap-3 border-b border-divider px-4 py-2.5 text-[13px] last:border-b-0">
                  <Link href={`/decisions/${row.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
                    {row.title}
                  </Link>
                  <StatusChip tone={row.status === "REJECTED" ? "danger" : row.status === "EXPIRED" ? "neutral" : "success"}>
                    {row.chosenOption ? row.chosenOption.toLowerCase().replace("_", " ") : row.status.toLowerCase()}
                  </StatusChip>
                  <span className="w-[220px] shrink-0 text-right text-[12px] text-ink-muted">
                    {row.resolvedBy} · {formatDate(row.resolvedAt, true)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Body>
    </Frame>
  );
}
