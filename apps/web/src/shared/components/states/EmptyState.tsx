import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export interface EmptyStateProps {
  /** What is not here. One short noun phrase. */
  title: string;
  /** One line saying why it is empty and what would fill it. */
  description?: string;
  /**
   * The single action that resolves the emptiness. This is the view's ONE solid
   * primary button while the state is showing — do not render another.
   */
  action?: ReactNode;
  /** A glyph. The design pack uses no imagery, so keep this to a mark. */
  glyph?: ReactNode;
  className?: string;
}

/**
 * The empty state.
 *
 * Copy is always a prop. A domain sentence hardcoded in this file is the start
 * of the drift this kit exists to prevent.
 */
export function EmptyState({ title, description, action, glyph, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      {glyph ? (
        <div
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-control bg-surface text-ink-muted"
        >
          {glyph}
        </div>
      ) : null}
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description ? <p className="max-w-prose text-[13px] text-ink-muted">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
