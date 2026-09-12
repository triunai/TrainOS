import { cn } from "@/shared/lib/utils";

/**
 * Loading skeletons. Kit.dc.html §05: "stacked grey bars of varying width
 * simulating text lines, with a divider between groups."
 *
 * Varying width is the point. Equal bars read as a broken layout; unequal ones
 * read as text that has not arrived. The widths below are the artboard's.
 *
 * Every skeleton is `aria-hidden` and sits inside a container the caller marks
 * `aria-busy` — a screen reader should hear "loading", once, not eleven
 * anonymous boxes. `LoadingState` from the scaffold does that marking; use it
 * for a whole region and these for a shape that must hold its layout.
 */

export interface SkeletonProps {
  className?: string;
}

/** One bar. The atom the other variants stack. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("h-3 animate-pulse rounded-control bg-surface", className)}
    />
  );
}

export interface SkeletonTextProps extends SkeletonProps {
  /** How many lines. The last is short, the way a paragraph ends. */
  lines?: number;
}

/** A paragraph's worth of bars. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  const widths = ["w-full", "w-11/12", "w-4/5", "w-9/12", "w-2/3"];
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={widths[index % widths.length]} />
      ))}
    </div>
  );
}

export interface SkeletonTableProps extends SkeletonProps {
  rows?: number;
  columns?: number;
}

/**
 * A table's shape while its rows load. Holds the real row height so the page
 * does not jump when data lands — the whole reason to draw a skeleton rather
 * than a spinner.
 */
export function SkeletonTable({ rows = 5, columns = 4, className }: SkeletonTableProps) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col", className)}>
      <div className="flex gap-4 border-b border-border bg-surface px-4 py-2.5">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4 border-b border-divider px-4 py-3">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={cn("flex-1", column === 0 ? "w-1/3" : "w-1/4")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The MetricStrip's shape while its numbers load. */
export function SkeletonMetrics({ className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cn("flex gap-8 py-3", className)}>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
