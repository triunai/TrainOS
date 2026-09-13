import { cn } from "@/shared/lib/utils";
import { useOnAccent } from "./onAccent";

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
 * `state`, which is a fact the server computed, never something this component
 * infers from the percentage — a bar at 87% of a soft target is not the same
 * event as a bar at 87% of a hard cap.
 *
 * THERE IS NO GREEN, and that is deliberate rather than an omission.
 *
 * Every bar the design pack draws is ink: the health cell at 74, the budget bar
 * under its cap, the token budget, the completeness bar. Amber and red appear
 * only as a limit approaches. Green never appears on a bar anywhere in the
 * artboards, and adding it would say something the pack never says — that a
 * full bar is good news. A completeness bar at 100% is not an achievement to
 * celebrate, it is a blocker that is no longer blocking, and ink says that
 * correctly. A screen reaching for green wants `"neutral"`.
 *
 * Two vocabularies, one meaning, because the first one was named after its
 * first caller. `neutral` / `warning` / `danger` is the general form and is
 * what new code should use. `within` / `near` / `over` is the budget form, kept
 * because `BudgetBar` and existing screens speak it; they map onto the same
 * three fills.
 */

export type BarState =
  | "neutral"
  /**
   * The accent fill. Reserved for a slice that IS the AI story rather than a
   * quantity beside it — M01-S01 paints the autonomous share of the autonomy
   * mix in accent and leaves the other three rungs ink, so the one number the
   * screen is really reporting is the one that carries colour. It is not a
   * severity and it is not a fourth status hue; a bar reaching for emphasis
   * for any other reason wants `neutral`.
   */
  | "primary"
  | "warning"
  | "danger"
  /** Budget vocabulary. Same three fills; prefer the general names above. */
  | "within"
  | "near"
  | "over";

const FILL: Record<BarState, string> = {
  neutral: "bg-ink",
  primary: "bg-primary",
  warning: "bg-warning-accent",
  danger: "bg-danger",
  within: "bg-ink",
  near: "bg-warning-accent",
  over: "bg-danger",
};

const HEIGHT = { sm: "h-[5px]", md: "h-1.5" } as const;

export interface MiniBarProps {
  /** 0–1. Clamped, so a 1.4 over-spend still renders as a full bar. */
  value: number;
  /**
   * Defaults to ink. Reach for `warning` or `danger` only from a fact the
   * server sent, not from the percentage — see the note above about why the
   * bar cannot decide this for itself. There is no green.
   */
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
  state = "neutral",
  size = "sm",
  width,
  label,
  valueText,
  className,
}: MiniBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);

  /* On the blue record card the bar is white on white-at-25%. The state hues go
     with the ink for the same reason the chips' do: amber and red are
     unreadable on saturated blue, and a bar that changes colour to say
     "warning" says nothing there. The FILL LENGTH is the reading either way,
     and `aria-valuetext` carries the rest for anyone not reading colour at all. */
  const onAccent = useOnAccent();

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
        "overflow-hidden rounded-pill",
        onAccent ? "bg-[rgb(var(--on-accent)/0.25)]" : "bg-divider",
        HEIGHT[size],
        width ? "shrink-0" : "w-full",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-pill", onAccent ? "bg-[rgb(var(--on-accent))]" : FILL[state])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
