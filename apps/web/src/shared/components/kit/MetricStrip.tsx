import type { ReactNode } from "react";
import type { Money, ReceivablesAging } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { MiniBar, type BarState } from "./Bar";
import { MoneyText } from "./Money";
import { FOCUS_RING, MONO_LABEL } from "./tokens";

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
   * Marks the number as an estimate. Contract §10 and DECISIONS: the
   * admin-hours-saved tile must say "illustrative · baseline not yet measured"
   * rather than imply a measured figure.
   */
  estimate?: boolean;
}

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
  estimate,
}: MetricCellProps) {
  const body = (
    <>
      <span className={cn(MONO_LABEL, "whitespace-nowrap")}>{label}</span>

      <span className="flex items-center gap-2">
        {typeof bar === "number" ? (
          <MiniBar value={bar} state={barState} width="64px" size="md" label={label} />
        ) : null}
        <span className="whitespace-nowrap font-mono text-[16px] font-semibold tracking-[-0.01em] text-ink">
          {isMoney(value) ? <MoneyText value={value} compact /> : value}
        </span>
        {/* The drill affordance. Hidden until hover OR keyboard focus — a
            hover-only chevron is invisible to half the people using it. It
            occupies its width at all times so the number never shifts. */}
        {onDrill ? (
          <span
            aria-hidden="true"
            className="text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            ›
          </span>
        ) : null}
      </span>

      {sub ? <span className="whitespace-nowrap text-[12px] text-ink-muted">{sub}</span> : null}
      {estimate ? (
        <span className="text-[11px] text-ink-muted">illustrative · baseline not yet measured</span>
      ) : null}
    </>
  );

  const shape = "group flex flex-col items-start gap-[3px] rounded-control px-2 py-1.5 text-left";

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
  className?: string;
}

export function MetricStrip({ cells, bare, className }: MetricStripProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-stretch gap-y-2.5",
        !bare && "border-t border-divider pt-3",
        className,
      )}
    >
      {cells.map((cell, index) => (
        <div key={cell.label} className="flex items-stretch">
          {index > 0 ? (
            <div aria-hidden="true" className="mx-5 my-0.5 w-px shrink-0 bg-border" />
          ) : null}
          <MetricCell {...cell} />
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
