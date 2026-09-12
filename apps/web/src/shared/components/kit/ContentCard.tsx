import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { FOCUS_RING } from "./tokens";

/**
 * The single white content card every internal screen sits in, and its page
 * header row. Kit.dc.html §07 "Card header / empty state / FAB".
 *
 * The scaffold's `AppShell` already paints the card that holds a route. This is
 * the card for a SECTION inside that route — a relationship panel, a table
 * block, a right rail — so the two nest without either inventing a border.
 */

export interface ContentCardProps {
  children: ReactNode;
  /** The section's name. 20/600 per the type scale. */
  title?: ReactNode;
  /** A mono eyebrow above the title, e.g. "SESSIONS". */
  eyebrow?: string;
  /** Chips and buttons, right-aligned in the header row. */
  actions?: ReactNode;
  /** Remove the card's own padding, for a table that should meet the edges. */
  flush?: boolean;
  className?: string;
}

export function ContentCard({
  children,
  title,
  eyebrow,
  actions,
  flush,
  className,
}: ContentCardProps) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-card",
        className,
      )}
    >
      {title || eyebrow || actions ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {eyebrow ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                {eyebrow}
              </span>
            ) : null}
            {title ? (
              <h2 className="truncate text-[15px] font-semibold text-ink">{title}</h2>
            ) : null}
          </div>
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      <div className={cn("min-w-0", flush ? "" : "p-4")}>{children}</div>
    </section>
  );
}

export interface FabProps {
  /** Defaults to the pack's wording. */
  label?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * The "Ask TrainOS" FAB. §07: 44×44px, circular, blue-TINTED — not a solid blue
 * fill, because solid blue is reserved for an action a human is committing to
 * and this only opens a conversation. Bottom-right, present on every internal
 * screen unless the screen opts out (locked and external screens do).
 */
export function Fab({ label = "Ask TrainOS", onClick, className }: FabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-pill border border-primary-border bg-ai-tint text-[18px] text-primary-hover shadow-raised hover:bg-ai-tint-2",
        FOCUS_RING,
        className,
      )}
    >
      <span aria-hidden="true">✦</span>
    </button>
  );
}
