import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The list toolbar: ONE row carrying the saved-view switcher and the narrowing
 * that applies to it, with the table directly beneath.
 *
 * Brief §10b (user ruling, 13 Sep, from screenshots). A list screen used to
 * stack three bands — the tab group, then a full-width filter row, then the
 * table head — so the eye crossed two horizontal rules before reaching a single
 * row of data, and the tab row's right half sat empty while the filter row's
 * left half sat empty. They are one control surface: WHICH SUBSET (the tabs)
 * and WHICH SLICE OF IT (the filters), so they share one row.
 *
 * Left is the switcher, right is the narrowing and the "N of M shown" counter.
 * The count stays on the right edge, furthest from the tabs, because it is the
 * RESULT of both and reads as the row's total.
 *
 * WRAPPING. Below 1100px the two halves stack rather than crush the filter
 * controls, which is the only width at which the old two-row shape is correct.
 * `min-[1100px]:flex-nowrap` rather than a named breakpoint: the number is the
 * width at which a four-segment track plus a search box and two selects stop
 * fitting, not one of the config's device breakpoints.
 *
 * The filter slot strips `FilterBar`'s own `px-4 py-2.5`. A `FilterBar` that
 * owns a row of its own needs that padding; one sitting inside this row would
 * double the gutter and stand 8px taller than the track beside it. Doing it
 * here rather than asking every screen for `className="px-0 py-0"` is the point
 * of naming the pattern — CLAUDE.md: the kit gains the component, the screens
 * use it.
 *
 * NO RULE OF ITS OWN, and do NOT wrap it in one. `DataTable`'s header already
 * draws `border-b border-border`, so a `border-b` on the toolbar or on a div
 * around it puts two hairlines a row apart with nothing between them — the same
 * count §10b objects to, arriving from a different pair of elements. CLAUDE.md:
 * if removing a border does not make a relationship ambiguous, remove it, and
 * nothing here is ambiguous once the table head draws the line. §10b's wording
 * is "the table directly beneath". Pass the page gutter (`px-5`, `px-6`) and
 * the bottom spacing through `className`; pass no border.
 */

export interface ListToolbarProps {
  /** The saved-view switcher, normally a `PillTabGroup`. Sits left. */
  tabs: ReactNode;
  /** The narrowing: a `FilterBar`, with its selects and its counter. Sits right. */
  filters?: ReactNode;
  /** Buttons acting on the list as a whole, after the filters. */
  actions?: ReactNode;
  className?: string;
}

export function ListToolbar({ tabs, filters, actions, className }: ListToolbarProps) {
  return (
    <div
      data-list-toolbar=""
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2.5 min-[1100px]:flex-nowrap",
        className,
      )}
    >
      <div className="min-w-0 shrink-0">{tabs}</div>

      {filters || actions ? (
        <div
          className={cn(
            "ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2",
            "min-[1100px]:flex-nowrap",
            /* The FilterBar's row padding, removed for the one case where it is
               not a row. Scoped to the element it belongs to rather than to
               every child, so an action button keeps its own geometry. */
            "[&_[aria-label='Filters']]:px-0 [&_[aria-label='Filters']]:py-0",
          )}
        >
          {filters}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
