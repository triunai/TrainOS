import type { ReactNode } from "react";
import type { MetricDelta, Money, ReceivablesAging, Severity } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { MiniBar, type BarState } from "./Bar";
import { formatPeriod } from "./format";
import { MoneyText } from "./Money";
import { FOCUS_RING, SECTION_LABEL } from "./tokens";

/**
 * The MetricStrip. Kit.dc.html §09, items 4–10.
 *
 * One cell component repeated at three, five or six counts — the strip does not
 * change with the entity, only its cells do. Divider rules between cells, never
 * boxes: hierarchy comes from alignment and separators before borders.
 *
 * The cell-state rule is the interesting part, verbatim from the artboard: "a
 * cell with no meaningful drill-through gets no hover... behaviour, not
 * decoration, tells you which numbers open something." So an actionable cell is
 * a real `<button>` with a hover fill, a `›` chevron and a focus ring, and an
 * informational cell is a `<div>` with none of those. There is no third state
 * where a cell looks clickable and is not.
 *
 * The chevron appears on hover AND on keyboard focus. A hover-only affordance
 * is invisible to half the people using it.
 */

export interface MetricCellProps {
  /** Mono uppercase caption, e.g. "Lifetime value". */
  label: string;
  /** A `Money` formats itself; anything else renders as given. */
  value: Money | ReactNode;
  /** The muted line under the number, e.g. "1 opportunity", "34 days". */
  sub?: string;
  /**
   * 0–1. Renders the 64px mini bar beside the value — the health, attendance
   * and claim-completeness cells in §3.9's "MetricStrip mini bar" addition.
   */
  bar?: number;
  /** Bar colour state. Server-computed; the bar stays ink unless told otherwise. */
  barState?: BarState;
  /**
   * Makes the cell actionable. The contract puts `drillTo` on `MetricValue` so
   * the route is data, never hardcoded here — pass a handler that navigates to it.
   */
  onDrill?: () => void;
  /**
   * Period-over-period movement, straight from the contract's `MetricValue`.
   * Rendered under the value as `▲ 18% vs Oct`; `severity` picks the ink.
   */
  delta?: MetricDelta;
  /**
   * Marks the number as an estimate. Contract §10 and DECISIONS: the
   * admin-hours-saved tile must say it is illustrative rather than imply a
   * measured figure.
   *
   * Pass `true` for the kit's own sentence, or a string to say it your way —
   * `EmptyState` already holds the line that copy is a prop, and a metric whose
   * caveat is hardcoded here cannot be reworded without a kit release.
   */
  estimate?: boolean | string;
}

const ESTIMATE_DEFAULT = "illustrative · baseline not yet measured";

const DELTA_ARROW: Record<MetricDelta["direction"], string> = {
  UP: "▲",
  DOWN: "▼",
  FLAT: "–",
};

const DELTA_WORD: Record<MetricDelta["direction"], string> = {
  UP: "up",
  DOWN: "down",
  FLAT: "flat",
};

/**
 * A delta's ink.
 *
 * This is the one place in the kit where status colour lands on text rather
 * than inside a chip, and it is a considered exception rather than an
 * oversight. The artboard colours the AR-overdue delta on M01-S01, and a chip
 * here would be wrong twice over: it would read as the metric's status when it
 * is only the movement, and a row of five chipped metrics would spend more
 * accent than the whole rest of the dashboard.
 *
 * The exception is kept narrow. Colour arrives only when the SERVER sends a
 * severity — a rise is not bad news by itself, and `UP` on revenue and `UP` on
 * overdue receivables are opposite facts that only the server can tell apart.
 * Without a severity the delta is muted like any other secondary line.
 */
const DELTA_INK: Record<Severity, string> = {
  INFO: "text-ink-muted",
  WARN: "text-warning",
  DANGER: "text-danger",
  ALERT: "text-danger",
};

function isMoney(value: unknown): value is Money {
  return typeof value === "object" && value !== null && "amount" in value && "currency" in value;
}

export function MetricCell({
  label,
  value,
  sub,
  bar,
  barState,
  onDrill,
  delta,
  estimate,
  onAccent,
}: MetricCellProps & {
  /**
     Renders the cell for the accent band: full white throughout, because the
     band is vivid and every muted step fails AA on it. Set by the band, never
     by a screen — a cell does not decide what it is sitting on.
   */
  onAccent?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          SECTION_LABEL,
          "whitespace-nowrap",
          /* On the accent band the muted step cannot be a lighter ink or a
             lower opacity — both fail AA at this size over #1F5BFF. Full
             white, and the caption/value hierarchy is carried by the size and
             weight difference SECTION_LABEL leaves against the value below:
             12px medium muted under 16px semibold ink. */
          onAccent && "text-[rgb(var(--on-accent))]",
        )}
      >
        {label}
      </span>

      <span className="flex items-center gap-2">
        {typeof bar === "number" ? (
          <MiniBar value={bar} state={barState} width="64px" size="md" label={label} />
        ) : null}
        <span
          className={cn(
            /* Brief §1: a number aligns with `tabular-nums`, not with a
               monospace face. The value was `font-mono` purely so a column of
               metric cells lined up; tabular figures in the UI font line up
               the same way and keep the app in one voice. */
            "whitespace-nowrap text-[16px] font-semibold tabular-nums tracking-[-0.01em] text-ink",
            onAccent && "text-[rgb(var(--on-accent))]",
          )}
        >
          {isMoney(value) ? <MoneyText value={value} compact /> : value}
        </span>
        {/* The drill affordance. Hidden until hover OR keyboard focus — a
            hover-only chevron is invisible to half the people using it. It
            occupies its width at all times so the number never shifts. */}
        {onDrill ? (
          <span
            aria-hidden="true"
            className={cn(
              "opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
              onAccent ? "text-[rgb(var(--on-accent))]" : "text-ink-muted",
            )}
          >
            ›
          </span>
        ) : null}
      </span>

      {/* ONE line under the number, never two.
          The artboards give every cell a caption, a value and a single muted
          line, and the strip's whole job is that five of them scan as one row.
          A cell that prints the movement AND the count on separate lines is
          taller than its neighbours, and a strip of ragged cells is a strip
          with no baseline to read along. So the movement and the count sit on
          the same line, separated by the pack's middot — both facts kept, one
          line spent. */}
      {delta || sub || estimate ? (
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
          {delta ? (
            <span className={cn("whitespace-nowrap", DELTA_INK[delta.severity ?? "INFO"])}>
              {/* The arrow is decoration; the direction is a word in the
                  accessible text. An arrow glyph on its own is not a reading. */}
              <span aria-hidden="true">{DELTA_ARROW[delta.direction]} </span>
              <span className="sr-only">{DELTA_WORD[delta.direction]} </span>
              {Math.abs(Math.round(delta.rate * 100))}%
              {delta.comparedTo ? ` vs ${formatPeriod(delta.comparedTo)}` : ""}
            </span>
          ) : null}

          {delta && (sub || estimate) ? (
            <span
              aria-hidden="true"
              className={onAccent ? "text-[rgb(var(--on-accent))]" : "text-ink-muted"}
            >
              ·
            </span>
          ) : null}

          {sub ? (
            <span
              className={cn(
                "whitespace-nowrap",
                onAccent ? "text-[rgb(var(--on-accent))]" : "text-ink-muted",
              )}
            >
              {sub}
            </span>
          ) : null}

          {estimate ? (
            <span className={onAccent ? "text-[rgb(var(--on-accent))]" : "text-ink-muted"}>
              {typeof estimate === "string" ? estimate : ESTIMATE_DEFAULT}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  /* 2px 16px 2px 8px with the left padding pulled back out, from the artboard.
     The hover fill needs the padding to land on; the row does not need the
     height, and `py-1.5` was adding 8px to a strip that is meant to read as a
     single line of facts. */
  const shape =
    "group -ml-2 flex flex-col items-start gap-[3px] rounded-control py-0.5 pl-2 pr-4 text-left";

  if (!onDrill) {
    /* Informational-only: no hover, no pointer, no chevron. */
    return <div className={shape}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onDrill}
      className={cn(shape, "hover:bg-surface-hover", FOCUS_RING)}
    >
      {body}
    </button>
  );
}

export interface MetricStripProps {
  cells: MetricCellProps[];
  /** Drop the top rule where the strip is not sitting under a RecordHeader. */
  bare?: boolean;
  /**
   * `"default"` is the hairline-separated row this component has always been:
   * cells packed from the left, a rule above, nothing around it.
   *
   * `"accent"` is the same strip re-inked for the blue record card (§15a):
   * full white, white hairlines, cells spread EVENLY across the card width
   * rather than clustered left, and no background of its own. It is not a card
   * and owns no chevron — `RecordHeader accent` is the card, and §15a allows
   * exactly one chevron, which belongs to the card. Passing this variant
   * outside an accented header gets you white text on whatever is behind it.
   */
  variant?: "default" | "accent";
  className?: string;
}

export function MetricStrip({ cells, bare, variant = "default", className }: MetricStripProps) {
  if (variant === "accent") {
    return <AccentMetricRow cells={cells} className={className} />;
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-stretch gap-y-2.5",
        !bare && "border-t border-divider pb-0.5 pt-3",
        className,
      )}
    >
      {cells.map((cell, index) => (
        <div key={cell.label} className="flex items-stretch">
          {index > 0 ? (
            <div aria-hidden="true" className="my-0.5 ml-1 mr-5 w-px shrink-0 bg-border" />
          ) : null}
          <MetricCell {...cell} />
        </div>
      ))}
    </div>
  );
}

/**
 * The metric row as it renders INSIDE the blue record card (§15a).
 *
 * Not a card. It owns no background, no radius and no chevron — the card is the
 * `RecordHeader` around it and the one chevron belongs to the card, because
 * §15a is explicit that there is exactly one. This is the strip, re-inked.
 *
 * WHAT CHANGES from the default strip is only ink and rules: full white
 * throughout (a translucent muted step fails AA on this blue — 70% white over
 * #1F5BFF is 3.35:1 at the 11px the captions use), and a single white-at-15%
 * vertical hairline between cells instead of the `--border` rule, because a
 * neutral grey line over a saturated blue reads as a seam between two surfaces
 * rather than a division within one.
 *
 * WHAT DOES NOT CHANGE is the cell: same component, same caption/value/subline
 * anatomy, same mini bar, same drill rules. §15a's "no per-cell slabs" is honoured
 * by giving the cells no background at all, so the gradient runs unbroken
 * beneath all five rather than restarting in each.
 *
 * THE SPREAD. `repeat(n, minmax(0, 1fr))` is an inline style because `n` is
 * data: a class name assembled from a runtime number is a class Tailwind never
 * saw and never generated. `minmax(0, …)` rather than bare `1fr` so a long agent
 * name truncates inside its column instead of widening it.
 *
 * Note this is the one place the build departs from the artboard on purpose.
 * Kit.dc.html §11-13 and §M04-S02 both pack the cells to the left and leave the
 * right half of the band empty; §15's "spread the metrics out: equal-width grid
 * across the full band, not clustered left" is a correction OF those artboards
 * and has never been withdrawn, so the grid wins.
 */
function AccentMetricRow({ cells, className }: { cells: MetricCellProps[]; className?: string }) {
  return (
    <div
      className={cn("grid min-w-0", className)}
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map((cell, index) => (
        <div
          key={cell.label}
          className={cn(
            /* Top-aligned, not centred. A cell whose value is a chip is taller
               than one whose value is text, and centring cells of two different
               heights puts their captions on different baselines — the exact
               raggedness the strip exists to avoid. */
            "flex min-w-0 flex-col justify-start py-0.5 pl-4 pr-3 first:pl-0",
            index > 0 && "border-l border-[rgb(var(--on-accent)/0.15)]",
          )}
        >
          <MetricCell {...cell} onAccent />
        </div>
      ))}
    </div>
  );
}

/**
 * The aging strip — the MetricStrip configured with AR ageing buckets, listed
 * in §3.9 as a REPORT.md kit addition (M13-S05).
 *
 * A configuration, not a new component: it maps the contract's
 * `ReceivablesAging` onto the same cells, which is the whole point of the
 * "one component, configured per entity" rule. Buckets read left to right from
 * current to worst, so the shape of the row is itself the diagnosis.
 */
export interface AgingStripProps {
  aging: ReceivablesAging;
  /** Called with the bucket key when a cell is drilled. */
  onDrill?: (bucket: keyof Omit<ReceivablesAging, "dsoDays">) => void;
  className?: string;
}

export function AgingStrip({ aging, onDrill, className }: AgingStripProps) {
  const buckets: { key: keyof Omit<ReceivablesAging, "dsoDays">; label: string }[] = [
    { key: "current", label: "Current" },
    { key: "d1_30", label: "1–30 days" },
    { key: "d31_60", label: "31–60 days" },
    { key: "d60_plus", label: "60+ days" },
  ];

  return (
    <MetricStrip
      bare
      className={className}
      cells={[
        ...buckets.map((bucket) => ({
          label: bucket.label,
          value: aging[bucket.key],
          onDrill: onDrill ? () => onDrill(bucket.key) : undefined,
        })),
        { label: "DSO", value: `${aging.dsoDays}`, sub: "days" },
      ]}
    />
  );
}
