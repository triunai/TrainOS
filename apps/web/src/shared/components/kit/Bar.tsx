import { cn } from "@/shared/lib/utils";

/**
 * The one progress bar in the system.
 *
 * Kit.dc.html draws this track/fill pair five times — the MetricStrip health
 * cell (64×6px), the budget bar (5px), the state-card token budget (5px), the
 * checklist completeness bar and the table's Score column (44×5px). One
 * component, three sizes, one rule about colour.
 *
 * That rule, verbatim from §10: "Budget bars stay ink until they near or hit a
 * cap." Ink is the default fill. Amber and red are reached only by passing a
 * `state`, which is a fact the server computed (`BudgetState`), never something
 * this component infers from the percentage — a bar at 87% of a soft target is
 * not the same event as a bar at 87% of a hard cap.
 */

export type BarState = "within" | "near" | "over";

const FILL: Record<BarState, string> = {
  within: "bg-ink",
  near: "bg-[rgb(var(--warning-accent))]",
  over: "bg-danger",
};

const HEIGHT = { sm: "h-[5px]", md: "h-1.5" } as const;

export interface MiniBarProps {
  /** 0–1. Clamped, so a 1.4 over-spend still renders as a full bar. */
  value: number;
  /** Defaults to `within` — ink. Pass `near`/`over` only from server state. */
  state?: BarState;
  size?: keyof typeof HEIGHT;
  /** Track width. Omit to fill the parent; the artboards use 64px and 44px. */
  width?: string;
  /**
   * What the bar measures, for a screen reader. The bar is a `progressbar`, so
   * this is its accessible name — "Health", "Monthly spend", "Completeness".
   */
  label: string;
  /** Overrides the announced value text, e.g. "RM 96 of RM 150". */
  valueText?: string;
  className?: string;
}

export function MiniBar({
  value,
  state = "within",
  size = "sm",
  width,
  label,
  valueText,
  className,
}: MiniBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText}
      style={width ? { width } : undefined}
      className={cn(
        "overflow-hidden rounded-pill bg-divider",
        HEIGHT[size],
        width ? "shrink-0" : "w-full",
        className,
      )}
    >
      <div className={cn("h-full rounded-pill", FILL[state])} style={{ width: `${pct}%` }} />
    </div>
  );
}
