import { useState } from "react";
import type { RunStep, RunStepStatus } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { formatDuration } from "./format";
import { MoneyText } from "./Money";
import { FOCUS_RING, SECTION_LABEL } from "./tokens";

/**
 * One tool call in a run's log. Kit.dc.html §05 (inside the agent-run card) and
 * §3.9's REPORT.md addition "Run step row", shown standalone in the trace
 * viewer with its arguments and outputs expandable.
 *
 * The glyph carries the status — ✓ ok, ↻ retried, ✕ failed, ⏸ halted — and it
 * is the only coloured thing in the row. §10's grammar: depth by indent, status
 * by glyph, cost and duration right-aligned in mono. The same three rules apply
 * to `TraceTreeNode`, which is why the two look like siblings.
 *
 * A halted step takes the AI tint, for the reason the artboard gives about
 * trace nodes: "policy interception is the thing worth seeing." A halt is the
 * policy gate working, and it should be the most visible row in the log.
 */

const GLYPH: Record<RunStepStatus, { mark: string; className: string; word: string }> = {
  OK: { mark: "✓", className: "text-success", word: "succeeded" },
  RETRIED: { mark: "↻", className: "text-warning", word: "retried" },
  FAILED: { mark: "✕", className: "text-danger", word: "failed" },
  HALTED: { mark: "⏸", className: "text-primary-hover", word: "halted by policy" },
};

export interface RunStepRowProps {
  step: RunStep;
  /** Allow expanding to arguments and result. On by default when either exists. */
  expandable?: boolean;
  className?: string;
}

export function RunStepRow({ step, expandable, className }: RunStepRowProps) {
  const [open, setOpen] = useState(false);
  const glyph = GLYPH[step.status];
  const hasDetail = Boolean(step.args || step.result || step.haltedBy || step.error);
  const canExpand = expandable ?? hasDetail;

  const summary = (
    <>
      <span
        aria-hidden="true"
        className={cn("w-3.5 shrink-0 text-center font-mono text-[13px]", glyph.className)}
      >
        {glyph.mark}
      </span>

      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-mono text-[12px] text-ink">{step.tool}</span>
        {step.haltedBy ? (
          <span className="block truncate text-[11px] text-ink-muted">
            {step.haltedBy.reason} → {step.haltedBy.approvalRequestRef}
          </span>
        ) : step.error ? (
          <span className="block truncate text-[11px] text-danger">{step.error.code}</span>
        ) : null}
      </span>

      <span className="shrink-0 whitespace-nowrap text-right tabular-nums text-[11px] text-ink-muted">
        {formatDuration(step.durationMs)}
        {step.cost ? (
          <>
            {" · "}
            <MoneyText value={step.cost} />
          </>
        ) : null}
      </span>

      {canExpand ? (
        <span aria-hidden="true" className="w-3 shrink-0 text-[11px] text-ink-disabled">
          {open ? "▾" : "▸"}
        </span>
      ) : null}
    </>
  );

  const rowClass = cn(
    "flex w-full items-start gap-2.5 border-t border-divider px-4 py-2",
    step.status === "HALTED" && "bg-ai-tint",
    className,
  );

  if (!canExpand) {
    return (
      <div className={rowClass}>
        <span className="sr-only">{`${step.tool} ${glyph.word}`}</span>
        {summary}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className={cn(rowClass, "hover:bg-surface-hover", FOCUS_RING)}
      >
        <span className="sr-only">{`${step.tool} ${glyph.word}`}</span>
        {summary}
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-divider bg-surface px-4 py-3">
          {step.args ? <Payload label="Arguments" value={step.args} /> : null}
          {step.result ? <Payload label="Result" value={step.result} /> : null}
          {step.error ? <Payload label="Error" value={step.error} /> : null}
          {step.haltedBy ? <Payload label="Halted by" value={step.haltedBy} /> : null}
        </div>
      ) : null}
    </>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={SECTION_LABEL}>{label}</span>
      <pre className="overflow-x-auto rounded-control border border-border bg-card p-2 font-mono text-[11px] leading-relaxed text-ink-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
