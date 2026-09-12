import { cn } from "@/shared/lib/utils";

export interface LoadingStateProps {
  /**
   * A skeleton shaped like the content that is coming, not a centred spinner.
   * `rows` is how many lines of that content to imply.
   */
  rows?: number;
  /** Announced to assistive technology while the region is busy. */
  label?: string;
  className?: string;
}

/**
 * The loading state.
 *
 * A skeleton in the shape of the answer, because a spinner over an empty page
 * tells a reader nothing about what is about to appear and makes every wait
 * feel identical.
 */
export function LoadingState({ rows = 4, label = "Loading", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("flex flex-col gap-3 p-4", className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="h-4 w-4 shrink-0 animate-pulse rounded-sm bg-surface-hover" />
          <div
            className="h-4 animate-pulse rounded-sm bg-surface-hover"
            style={{ width: `${70 - index * 8}%` }}
          />
        </div>
      ))}
    </div>
  );
}
