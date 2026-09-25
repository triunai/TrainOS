import { formatDate } from "@/lib/dates";
import type { AuditRow } from "@/server/db/schema";
import { cn } from "@/lib/cn";

/**
 * Audit rows as a timeline. Every row shows who (actor type + id), why (the
 * reason code, verbatim) and its hash-chain checkpoint, because the point of
 * the ledger is that a reader can check a claim against it.
 */
const ACTOR_INK: Record<string, string> = { USER: "text-ink", SYSTEM: "text-ink-secondary", AGENT: "text-primary-hover" };

export function AuditTimeline({ rows, compact }: { rows: AuditRow[]; compact?: boolean }) {
  if (rows.length === 0) return <p className="text-[13px] text-ink-muted">No ledger entries yet.</p>;
  return (
    <ol className="flex flex-col">
      {rows.map((r) => {
        const context = (r.metadataDiff as Record<string, unknown>)?.context as Record<string, unknown> | undefined;
        const changed = Object.keys(r.metadataDiff ?? {}).filter((k) => !["context", "created"].includes(k));
        return (
          <li key={r.logId} className="flex gap-3 border-b border-divider py-2.5 last:border-b-0">
            <span className="w-[54px] shrink-0 pt-0.5 text-right font-mono text-[11px] text-ink-muted">#{r.seq}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono text-[12px] font-medium text-ink">{r.reasonCode}</span>
                {r.machine ? (
                  <span className="text-[12px] text-ink-secondary">
                    {r.machine === "OPERATIONAL" ? "Ops" : "Fin"} · {r.fromStage ?? "∅"} → {r.toStage}
                  </span>
                ) : (
                  <span className="text-[12px] text-ink-muted">{r.entityType.toLowerCase().replace(/_/g, " ")}</span>
                )}
              </div>
              {r.reasonDetails ? <p className="text-[12px] text-ink-secondary">{r.reasonDetails}</p> : null}
              {!compact && (changed.length > 0 || context) ? (
                <p className="truncate font-mono text-[11px] text-ink-muted" title={JSON.stringify(r.metadataDiff)}>
                  {changed.length ? `Δ ${changed.join(", ")}` : ""}
                  {context ? `${changed.length ? " · " : ""}context ${Object.keys(context).join(", ")}` : ""}
                </p>
              ) : null}
            </div>
            <div className="flex w-[180px] shrink-0 flex-col items-end gap-0.5 text-right">
              <span className={cn("text-[12px]", ACTOR_INK[r.actorType] ?? "text-ink")}>
                {r.actorType.toLowerCase()} · {r.actorId}
              </span>
              <span className="text-[11px] text-ink-muted">{formatDate(r.createdAt, true)}</span>
              {!compact ? <span className="font-mono text-[10px] text-ink-muted" title={r.sha256Checkpoint}>⛓ {r.sha256Checkpoint.slice(0, 12)}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
