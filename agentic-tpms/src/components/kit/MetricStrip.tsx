"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MiniBar, type BarState } from "./Bar";
import { SECTION_LABEL } from "./tokens";

/**
 * FORKED FROM TrainOS kit/MetricStrip.tsx. A row of captioned numbers
 * separated by hairlines; the accent variant sits on the RecordHeader card.
 */
export interface MetricCellProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  bar?: number;
  barState?: BarState;
  estimate?: boolean;
}

export function MetricCell({ label, value, sub, bar, barState, estimate, onAccent }: MetricCellProps & { onAccent?: boolean }) {
  const ink = onAccent ? "text-[rgb(var(--on-accent))]" : undefined;
  return (
    <div className="-ml-2 flex flex-col items-start gap-[3px] rounded-control py-0.5 pl-2 pr-4 text-left">
      <span className={cn(SECTION_LABEL, "whitespace-nowrap", ink)}>{label}</span>
      <span className="flex items-center gap-2">
        {typeof bar === "number" ? <MiniBar value={bar} state={barState} width="64px" label={label} /> : null}
        <span className={cn("whitespace-nowrap text-[16px] font-semibold tabular-nums tracking-[-0.01em] text-ink", ink)}>{value}</span>
      </span>
      {sub || estimate ? (
        <span className={cn("flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-ink-muted", ink)}>
          {sub ? <span className="whitespace-nowrap">{sub}</span> : null}
          {estimate ? <span>estimate</span> : null}
        </span>
      ) : null}
    </div>
  );
}

export function MetricStrip({
  cells,
  bare,
  variant = "default",
  className,
}: {
  cells: MetricCellProps[];
  bare?: boolean;
  variant?: "default" | "accent";
  className?: string;
}) {
  if (variant === "accent") {
    return (
      <div className={cn("grid min-w-0", className)} style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((cell, index) => (
          <div key={cell.label} className={cn("flex min-w-0 flex-col py-0.5 pl-4 pr-3 first:pl-0", index > 0 && "border-l border-[rgb(var(--on-accent)/0.15)]")}>
            <MetricCell {...cell} onAccent />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-stretch gap-y-2.5", !bare && "border-t border-divider pb-0.5 pt-3", className)}>
      {cells.map((cell, index) => (
        <div key={cell.label} className="flex items-stretch">
          {index > 0 ? <div aria-hidden="true" className="my-0.5 ml-1 mr-5 w-px shrink-0 bg-border" /> : null}
          <MetricCell {...cell} />
        </div>
      ))}
    </div>
  );
}
