import type { LifecycleState, LifecycleStep, PipelineStage } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { DateText } from "./DateText";
import { FOCUS_RING } from "./tokens";

/**
 * The LifecycleStepper. Kit.dc.html §04 — one progress vocabulary at four
 * densities, sharing one dot grammar:
 *
 *   filled       done
 *   ringed       current
 *   hollow       pending
 *   amber        blocked
 *   dashed       skipped
 *   red + slash  failed (Lost / Cancelled / Rejected)
 *
 * Governing rule, verbatim from the artboard: variant A in record headers,
 * variant C in any table, variant D where width is under 320px; never two
 * variants for the SAME object on one screen. A record's own chain in variant A
 * plus its related records in variant C is correct — both are one object each.
 *
 * CLAUDE.md standing rule, and the contract's own note on `LifecycleStep`:
 * "Stage names and order render from pipeline configuration, never hardcoded."
 * So this component takes `LifecycleStep[]` and renders them in the order given.
 * There is no stage list in this file, no sort, and no client-side computation
 * of which stage is current — `state` arrives from the server, including
 * `BLOCKED`, which §17 sets from a failing compliance check.
 */

export type StepperVariant = "header" | "table" | "inline";

/** The dot, at whichever size the variant asks for. The grammar lives here once. */
function StepDot({ state, size }: { state: LifecycleState; size: number }) {
  const style = { width: size, height: size };

  const common = "shrink-0 rounded-pill";

  switch (state) {
    case "DONE":
      return <span aria-hidden="true" style={style} className={cn(common, "bg-ink")} />;
    case "CURRENT":
      return (
        <span
          aria-hidden="true"
          style={style}
          className={cn(common, "border-2 border-primary bg-card")}
        />
      );
    case "BLOCKED":
      return (
        <span
          aria-hidden="true"
          style={style}
          className={cn(common, "bg-[rgb(var(--warning-accent))]")}
        />
      );
    case "SKIPPED":
      return (
        <span
          aria-hidden="true"
          style={style}
          className={cn(common, "border border-dashed border-ink-disabled bg-card")}
        />
      );
    case "FAILED":
      return (
        <span aria-hidden="true" style={style} className={cn(common, "relative bg-danger")}>
          {/* The white slash. A red dot alone reads as "urgent"; the slash is
              what makes it read as "this did not happen". */}
          <span className="absolute left-1/2 top-1/2 h-px w-[70%] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-card" />
        </span>
      );
    case "PENDING":
    default:
      return (
        <span
          aria-hidden="true"
          style={style}
          className={cn(common, "border border-border-strong bg-card")}
        />
      );
  }
}

const STATE_WORD: Record<LifecycleState, string> = {
  DONE: "done",
  CURRENT: "current",
  PENDING: "pending",
  BLOCKED: "blocked",
  SKIPPED: "skipped",
  FAILED: "failed",
};

/** The label a step shows: its own, else the pipeline's, else its key. */
function labelOf(step: LifecycleStep, stages?: PipelineStage[]): string {
  if (step.label) return step.label;
  const stage = stages?.find((candidate) => candidate.key === step.key);
  return stage?.label ?? step.key;
}

/** One sentence naming every stage and its state. The tooltip and the a11y name. */
export function describeSteps(steps: LifecycleStep[], stages?: PipelineStage[]): string {
  return steps.map((step) => `${labelOf(step, stages)}: ${STATE_WORD[step.state]}`).join(" · ");
}

export interface LifecycleStepperProps {
  /** Server-ordered. Rendered as given — this component never sorts. */
  steps: LifecycleStep[];
  /** `GET /v1/config/pipelines` stages, used to resolve labels for bare keys. */
  stages?: PipelineStage[];
  /**
   * `header` (A/B/B2) — 32px labelled row for a RecordHeader.
   * `table` (C) — 20px dense cell, whole cell tooltipped and focusable.
   * `inline` (D) — chevron strip for drawers, cards and anything under 320px.
   */
  variant?: StepperVariant;
  className?: string;
}

export function LifecycleStepper({
  steps,
  stages,
  variant = "header",
  className,
}: LifecycleStepperProps) {
  if (steps.length === 0) return null;

  const description = describeSteps(steps, stages);

  if (variant === "table") {
    /* Variant C. The tooltip carries every stage's status, and the cell is
       focusable so a keyboard reaches it — the artboard sets `tabindex="0"`
       for exactly this reason. */
    return (
      <div
        tabIndex={0}
        role="img"
        aria-label={description}
        title={description}
        className={cn("inline-flex items-center rounded-control", FOCUS_RING, className)}
      >
        {steps.map((step, index) => (
          <span key={step.key} className="flex items-center">
            {index > 0 ? <span aria-hidden="true" className="h-px w-3 bg-connector" /> : null}
            <StepDot state={step.state} size={8} />
          </span>
        ))}
      </div>
    );
  }

  if (variant === "inline") {
    /* Variant D. Chevron segments, current stage in the tint. Text, not dots —
       under 320px a dot row is unreadable and a label is not. */
    return (
      <ol
        aria-label={description}
        className={cn("flex flex-wrap items-center gap-1 text-[11px]", className)}
      >
        {steps.map((step) => (
          <li
            key={step.key}
            aria-current={step.state === "CURRENT" ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5",
              step.state === "CURRENT"
                ? "bg-ai-tint-2 font-medium text-primary-hover"
                : "text-ink-muted",
              step.state === "SKIPPED" && "line-through decoration-ink-disabled",
              step.state === "FAILED" && "text-danger",
              step.state === "BLOCKED" && "text-warning",
            )}
          >
            {labelOf(step, stages)}
          </li>
        ))}
      </ol>
    );
  }

  /* Variant A/B/B2 — the record-header chain. Dot and connector above, label
     and date below.

     Every dot sits at the LEFT edge of its own stage cell and the connector
     runs from it to the next, so each dot lines up with the label beneath it.
     Building it the other way — a connector on each side of a centred dot —
     strands the final dot at the far right of the row, a whole cell away from
     the stage it belongs to.

     The connector takes its colour from the step it LEAVES, so a finished run
     of stages draws one continuous ink line and the chain's progress is legible
     before a single label is read. A skipped step's outgoing line is dashed,
     matching its dot. */
  return (
    <ol aria-label={description} className={cn("flex w-full items-start", className)}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            key={step.key}
            aria-current={step.state === "CURRENT" ? "step" : undefined}
            className={cn("flex min-w-0 flex-col gap-1.5", last ? "shrink-0" : "flex-1")}
          >
            <div className="flex items-center gap-2 pr-2">
              <StepDot state={step.state} size={10} />
              {last ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px flex-1",
                    step.state === "DONE" ? "bg-ink" : "bg-connector",
                    step.state === "SKIPPED" &&
                      "bg-transparent [border-top:1px_dashed_rgb(var(--border-strong))]",
                  )}
                />
              )}
            </div>

            <div className="flex flex-col gap-0.5 pr-3">
              <span
                className={cn(
                  "truncate text-[12px]",
                  step.state === "CURRENT" ? "font-medium text-ink" : "text-ink-secondary",
                  step.state === "SKIPPED" && "text-ink-muted",
                )}
              >
                {labelOf(step, stages)}
              </span>
              {step.at ? (
                <DateText value={step.at} className="text-[11px] text-ink-muted" />
              ) : step.note ? (
                <span className="truncate text-[11px] text-ink-muted">{step.note}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
