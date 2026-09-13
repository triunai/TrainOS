import { useId, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The paired column chart. M01 Dashboards.dc.html, M01-S01 "Proposals sent vs
 * won · 6 months", drawn verbatim: a 150px band of two columns per period, a
 * baseline rule under them, the period label beneath, and a legend row with the
 * drill link pushed to its right edge.
 *
 * Why a column chart and not `MiniBar` repeated. A horizontal bar per series
 * per period is twelve rules stacked down a column: the eye reads each row in
 * isolation and the trend across periods — the only thing this chart exists to
 * show — disappears. Paired columns put the periods on one axis, so the gap
 * between sent and won is a shape rather than an arithmetic exercise.
 *
 * The palette is the kit's, not a chart palette. The quiet series is the
 * divider fill and the loud one is ink; `primary` exists for a series that is
 * genuinely the accent, and there is no third hue and no green — the same rule
 * `Bar` states at length. A chart that needs four colours needs fewer series.
 *
 * Accessibility. The columns are decoration (`aria-hidden`) and every value is
 * also written as text, visually hidden beside its period. That is deliberate:
 * a `progressbar` per column announces "31 percent" — a proportion of a peak
 * nobody said out loud — where the sr-only line reads "Jun, 52 sent, 31 won".
 * The same strings are the columns' `title`, so a mouse gets them too.
 */

/** A series' fill. Quiet, loud, accent — see the note above on the palette. */
export type PairedBarsTone = "track" | "ink" | "primary";

const TONE: Record<PairedBarsTone, string> = {
  track: "bg-divider",
  ink: "bg-ink",
  primary: "bg-primary",
};

export interface PairedBarsSeries {
  /** Legend label, e.g. "Sent". Also the word in the accessible value text. */
  label: string;
  tone: PairedBarsTone;
}

export interface PairedBarsPoint {
  /** Stable key, e.g. "2026-06". */
  key: string;
  /** Axis label, e.g. "Jun". */
  label: string;
  /** One value per series, in the same order as `series`. */
  values: [number, number];
}

export interface PairedBarsProps {
  points: PairedBarsPoint[];
  /** Exactly two. A third column per period stops being readable at this width. */
  series: [PairedBarsSeries, PairedBarsSeries];
  /** Accessible name for the chart, e.g. "Proposals sent versus won". */
  label: string;
  /**
   * Turns a value into its accessible text. Defaults to `52 sent` — the number
   * and the series word, which is what a reader needs and what a bare percentage
   * is not.
   */
  formatValue?: (value: number, series: PairedBarsSeries) => string;
  /** Sits at the right of the legend row. The artboard's "Open filtered list ›". */
  action?: ReactNode;
  /** Column band height. The artboard's 150px; the frame adds the axis label. */
  bandHeight?: number;
  className?: string;
}

function defaultFormat(value: number, series: PairedBarsSeries) {
  return `${value} ${series.label.toLowerCase()}`;
}

export function PairedBars({
  points,
  series,
  label,
  formatValue = defaultFormat,
  action,
  bandHeight = 150,
  className,
}: PairedBarsProps) {
  /* One scale across both series, so the sent/won gap is a real comparison.
     Guarded at 1 rather than 0 — an all-zero series renders flat, not NaN. */
  const peak = Math.max(1, ...points.flatMap((point) => point.values));
  /* Named by its own caption. `<figcaption>` is the right element and browsers
     do derive the name from it, but not every accessibility tree does — and a
     chart whose name depends on which engine is asking has no name. */
  const captionId = useId();

  return (
    <figure aria-labelledby={captionId} className={cn("m-0 flex min-w-0 flex-col", className)}>
      <figcaption id={captionId} className="sr-only">
        {label}
      </figcaption>

      <ol
        className="flex items-end gap-[18px] border-b border-divider px-0.5 pt-1.5"
        style={{ height: `${bandHeight + 30}px` }}
      >
        {points.map((point) => (
          <li key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div
              aria-hidden="true"
              className="flex items-end gap-[5px]"
              style={{ height: `${bandHeight}px` }}
            >
              {series.map((entry, index) => (
                <div
                  key={entry.label}
                  title={`${point.label} · ${formatValue(point.values[index] as number, entry)}`}
                  className={cn("w-[22px] shrink-0 rounded-t-[3px]", TONE[entry.tone])}
                  style={{ height: `${((point.values[index] as number) / peak) * 100}%` }}
                />
              ))}
            </div>

            <span className="truncate text-[12px] text-ink-secondary">{point.label}</span>

            {/* The values as text. Visually hidden, genuinely present. */}
            {series.map((entry, index) => (
              <span key={entry.label} className="sr-only">
                {formatValue(point.values[index] as number, entry)}
              </span>
            ))}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-4 pt-2 text-[12px] text-ink-secondary">
        {series.map((entry) => (
          <span key={entry.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("h-2.5 w-2.5 rounded-[2px]", TONE[entry.tone])}
            />
            {entry.label}
          </span>
        ))}
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
    </figure>
  );
}
