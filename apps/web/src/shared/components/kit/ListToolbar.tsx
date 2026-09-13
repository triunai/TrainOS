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
 * WRAPPING is driven by CONTENT, not by a breakpoint. The two halves stack when
 * they do not both fit, which for a typical three- or four-segment track plus a
 * search box and two selects happens below about 1100px — the number the ruling
 * quotes.
 *
 * It was written as `min-[1100px]:flex-nowrap` first, and that was a bug. A
 * pinned single row cannot wrap, so the right half is handed whatever width the
 * track leaves and its contents spill out of it: on the engagements list, whose
 * status track carries EIGHT segments, the filter group was squeezed to 155px
 * and `justify-end` pushed the search box leftward straight across the "Closed"
 * and "Cancelled" tabs. A breakpoint cannot know how many segments a screen's
 * track has; `flex-wrap` measures the real thing, and stacks rather than
 * overlaps when the answer is too many.
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
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2.5", className)}
    >
      <div className="min-w-0 shrink-0">{tabs}</div>

      {filters || actions ? (
        <div
          className={cn(
            /* `grow basis-[300px]` is what decides the wrap. Flex breaks a line
               on an item's BASIS, so the filters stay on the tabs' row while at
               least 300px is left for them and take a row of their own when it
               is not — no breakpoint, and no squeezing them into 155px. `grow`
               then spends whatever is actually left, and `justify-end` keeps
               the count on the right edge on either row.

               300, not the 360 this shipped with and not the 320 the ruling
               reached for first. Both were measured at 1440 and both left
               participants on a second row: its eight status segments are
               806px wide because its counts run to three digits, and the main
               scroller takes a 13px gutter on a list that long, so the row has
               1133px to spend rather than engagements' 1144px. 806 + the 16px
               gap leaves 311, which 360 misses by 49 and 320 still misses by
               9. At 300 there is 11px of headroom and the filters stay put.

               The floor under this is `FilterSearch`'s own: the input prefers
               184px and may shrink to 160, so a 300px group holds the search,
               the selects and the counter without any of them collapsing. Do
               not lower this further without lowering that first — a basis
               below the group's real minimum stops being a wrap rule and goes
               back to squeezing, which is the 155px bug §10b was written for. */
            "flex min-w-0 grow basis-[300px] flex-wrap items-center justify-end gap-x-3 gap-y-2",
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
