import { cn } from "@/shared/lib/utils";

/**
 * The nav count badge (§2.3).
 *
 * Two variants, and only two: a neutral informational count, and the alert
 * count a parent shows when one of its children is `Failures`. Status colour
 * lives on chips like this one and nowhere else.
 */
export function NavBadge({ count, alert = false }: { count: number; alert?: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto inline-flex min-w-[20px] items-center justify-center rounded-pill border px-1.5",
        "font-mono text-[11px] leading-[18px]",
        alert
          ? "border-danger-border bg-danger-fill text-danger"
          : "border-primary-border bg-ai-tint text-primary-hover",
      )}
    >
      {count}
    </span>
  );
}
