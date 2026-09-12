import type { ReactNode } from "react";
import type { RequiredDocument } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { MiniBar } from "./Bar";
import { StatusChip } from "./StatusChip";
import { humanise } from "./statusTone";
import { FOCUS_RING } from "./tokens";

/**
 * The checklist family. Kit.dc.html §03 "Checklist & completeness", plus
 * §3.9's REPORT.md addition "Document checklist row" — the same item extended
 * with a document thumbnail, metadata and an attach/view action (M12-S02).
 *
 * A square box with a tick, not a circle: a circle is a radio and means "pick
 * one". A checked box is filled charcoal — done is a fact, not a status, so it
 * spends no colour.
 */

export interface ChecklistRowProps {
  label: string;
  done: boolean;
  /** One line of context under the label. */
  meta?: string;
  className?: string;
}

export function ChecklistRow({ label, done, meta, className }: ChecklistRowProps) {
  return (
    <div className={cn("flex items-start gap-2.5 py-1.5", className)}>
      <Box done={done} />
      <div className="min-w-0">
        <span className={cn("text-[13px]", done ? "text-ink" : "text-ink-muted")}>{label}</span>
        {meta ? <p className="text-[12px] text-ink-muted">{meta}</p> : null}
      </div>
    </div>
  );
}

function Box({ done }: { done: boolean }) {
  return (
    <span
      role="img"
      aria-label={done ? "done" : "not done"}
      className={cn(
        "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[9px]",
        done ? "bg-ink text-on-primary" : "border border-border-strong bg-card",
      )}
    >
      {done ? <span aria-hidden="true">✓</span> : null}
    </span>
  );
}

export interface CompletenessBarProps {
  /** 0–1. The contract sends rates as decimal fractions (§1 `Rate`). */
  value: number;
  label?: string;
  className?: string;
}

/** The label/percent row above a track. The MetricStrip's mini bar, captioned. */
export function CompletenessBar({
  value,
  label = "Completeness",
  className,
}: CompletenessBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-ink-secondary">{label}</span>
        <span className="font-mono text-ink-muted">{pct}%</span>
      </div>
      <MiniBar value={value} label={label} valueText={`${pct}%`} />
    </div>
  );
}

export interface DocumentChecklistRowProps {
  document: RequiredDocument;
  /** Rendered as the thumbnail. The pack uses a placeholder box, not imagery. */
  thumbnail?: ReactNode;
  /** Attach when missing, view when present. One action, whichever applies. */
  onAttach?: () => void;
  onView?: () => void;
  className?: string;
}

/**
 * One required document in an HRD Corp claim packet.
 *
 * Takes the contract's `RequiredDocument` whole. `meta` is a one-line context
 * string the server renders (`Locked 14 Nov · 28/30 present`) rather than
 * something this component assembles — a claim packet's rules about what counts
 * as complete are not a frontend concern.
 */
export function DocumentChecklistRow({
  document,
  thumbnail,
  onAttach,
  onView,
  className,
}: DocumentChecklistRowProps) {
  const present = document.status === "PRESENT";

  return (
    <div className={cn("flex items-center gap-3 border-t border-divider py-2.5", className)}>
      <span
        aria-hidden="true"
        className="flex h-9 w-7 shrink-0 items-center justify-center rounded-[4px] border border-border bg-surface text-[10px] text-ink-disabled"
      >
        {thumbnail ?? (present ? "DOC" : "—")}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-ink">{document.label ?? humanise(document.type)}</p>
        {document.meta ? (
          <p className="truncate font-mono text-[11px] text-ink-muted">{document.meta}</p>
        ) : null}
      </div>

      <StatusChip tone={present ? "success" : "warning"} shape="square" className="shrink-0">
        {present ? "Present" : "Missing"}
      </StatusChip>

      {present ? (
        onView ? (
          <button
            type="button"
            onClick={onView}
            className={cn(
              "shrink-0 rounded-[4px] text-[12px] text-primary-hover hover:underline",
              FOCUS_RING,
            )}
          >
            View
          </button>
        ) : null
      ) : onAttach ? (
        <button
          type="button"
          onClick={onAttach}
          className={cn(
            "shrink-0 rounded-[4px] text-[12px] text-primary-hover hover:underline",
            FOCUS_RING,
          )}
        >
          Attach
        </button>
      ) : null}
    </div>
  );
}
