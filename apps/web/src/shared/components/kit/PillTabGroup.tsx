import { cn } from "@/shared/lib/utils";
import type { PillTab } from "./adapters";
import { FOCUS_RING } from "./tokens";

/**
 * The pill tab group. Kit.dc.html §03 "Saved-view switcher" and §08's view row.
 *
 * These are saved views, which the contract makes server-side "so pill tabs and
 * their counts stay consistent across devices" (§2 note on `SavedView`). The
 * count is part of the tab, not a badge bolted on: a view with no rows is worth
 * knowing about before you click it.
 *
 * A tab list, not a nav — `role="tablist"` with arrow-key movement, because
 * these switch what is shown in place rather than navigating anywhere.
 */

export interface PillTabGroupProps {
  tabs: PillTab[];
  activeId: string;
  onSelect: (id: string) => void;
  /** What the group switches between, for the accessible name. */
  label?: string;
  className?: string;
}

export function PillTabGroup({
  tabs,
  activeId,
  onSelect,
  label = "Views",
  className,
}: PillTabGroupProps) {
  /* Arrow keys move between tabs; the browser's default is to require a Tab
     press per pill, which turns an eight-view switcher into eight stops. */
  const move = (index: number, delta: number) => {
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) onSelect(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(index, 1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(index, -1);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
              active
                ? "border-primary-border bg-ai-tint-2 font-medium text-primary-hover"
                : "border-transparent text-ink-secondary hover:bg-surface-hover",
              FOCUS_RING,
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "font-mono text-[11px]",
                  active ? "text-primary-hover" : "text-ink-muted",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
