"use client";

import { cn } from "@/lib/cn";
import { useOnAccent } from "./onAccent";

/**
 * FORKED FROM TrainOS kit/LifecycleStepper.tsx. Stage names come from the
 * caller (which reads them from the FSM vocabulary), never hardcoded here.
 */
export type StepState = "DONE" | "CURRENT" | "PENDING" | "BLOCKED" | "SKIPPED" | "FAILED";

export interface Step {
  key: string;
  label: string;
  state: StepState;
  caption?: string;
}

function Dot({ state, size }: { state: StepState; size: number }) {
  const onAccent = useOnAccent();
  const style = { width: size, height: size };
  const common = "shrink-0 rounded-pill";
  if (onAccent) {
    const map: Record<StepState, string> = {
      DONE: "bg-[rgb(var(--on-accent))]",
      CURRENT: "border-2 border-[rgb(var(--on-accent))] bg-transparent",
      BLOCKED: "border-2 border-[rgb(var(--on-accent))] bg-[rgb(var(--on-accent))]",
      SKIPPED: "border border-dashed border-[rgb(var(--on-accent)/0.7)]",
      FAILED: "bg-[rgb(var(--on-accent))]",
      PENDING: "border border-[rgb(var(--on-accent)/0.55)]",
    };
    return <span aria-hidden="true" style={style} className={cn(common, map[state])} />;
  }
  const map: Record<StepState, string> = {
    DONE: "bg-ink",
    CURRENT: "border-2 border-primary bg-card",
    BLOCKED: "bg-warning-accent",
    SKIPPED: "border border-dashed border-ink-disabled bg-card",
    FAILED: "bg-danger",
    PENDING: "border border-border-strong bg-card",
  };
  return <span aria-hidden="true" style={style} className={cn(common, map[state])} />;
}

export function LifecycleStepper({ steps, variant = "header", className }: { steps: Step[]; variant?: "header" | "table"; className?: string }) {
  const onAccent = useOnAccent();
  if (steps.length === 0) return null;
  const description = steps.map((s) => `${s.label}: ${s.state.toLowerCase()}`).join(", ");
  if (variant === "table") {
    return (
      <div role="img" aria-label={description} title={description} className={cn("inline-flex items-center", className)}>
        {steps.map((step, index) => (
          <span key={step.key} className="flex items-center">
            {index > 0 ? <span aria-hidden="true" className="h-px w-3 bg-connector" /> : null}
            <Dot state={step.state} size={8} />
          </span>
        ))}
      </div>
    );
  }
  return (
    <ol aria-label={description} className={cn("flex w-full items-start", className)}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={step.key} aria-current={step.state === "CURRENT" ? "step" : undefined} className={cn("flex min-w-0 flex-col gap-1.5", last ? "shrink-0" : "flex-1")}>
            <div className="flex items-center gap-2 pr-2">
              <Dot state={step.state} size={10} />
              {last ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px flex-1",
                    onAccent
                      ? step.state === "DONE"
                        ? "bg-[rgb(var(--on-accent))]"
                        : "bg-[rgb(var(--on-accent)/0.45)]"
                      : step.state === "DONE"
                        ? "bg-ink"
                        : "bg-connector",
                  )}
                />
              )}
            </div>
            <div className="flex flex-col gap-0.5 pr-3">
              <span
                className={cn(
                  "truncate text-[12px]",
                  onAccent
                    ? cn("text-[rgb(var(--on-accent))]", step.state === "CURRENT" && "font-medium")
                    : step.state === "CURRENT"
                      ? "font-medium text-ink"
                      : step.state === "FAILED"
                        ? "text-danger"
                        : "text-ink-secondary",
                )}
              >
                {step.label}
              </span>
              {step.caption ? (
                <span className={cn("truncate text-[11px] tabular-nums", onAccent ? "text-[rgb(var(--on-accent))]" : "text-ink-muted")}>{step.caption}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
