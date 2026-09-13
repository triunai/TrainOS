import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The master/detail workspace: a list pane and a detail pane that scroll
 * INDEPENDENTLY.
 *
 * Brief §16b (user ruling, 13 Sep, reversing the morning's §16 alignment
 * clause). §16 asked the two panes to share one hairline, and the kit answered
 * with `SPLIT_HEADER_HEIGHT` — one 72px row both panes pinned their header
 * block to. That premise is withdrawn. The two panes are not one composition:
 * the list is a queue the user scans and the detail is a record the user reads,
 * and pinning them to a shared grid row forced a header onto the list pane that
 * had nothing to say, then forced that header to hold a count the tab group was
 * already printing.
 *
 * So:
 *
 * - The LIST PANE has no header block. The list begins immediately under the
 *   page's tabs and filters, which live above this component in the page's own
 *   `ListToolbar`. A count belongs in that toolbar, and only when a filter has
 *   actually narrowed the set — "All 18" on the tab already answers the
 *   unfiltered case.
 * - The DETAIL PANE owns its header, `sticky` at the top of its OWN scroll. The
 *   header keeps the record's identity in view while its body scrolls, which is
 *   what a shared static row could never do.
 *
 * `minmax(360px, 40%)` rather than a fixed pixel width: 360px is the narrowest
 * a two-line row with a right-aligned money column stays readable at, and 40%
 * keeps the detail pane the larger half at every width above that.
 *
 * `min-h-0` on the grid and `min-w-0` on the detail pane are load-bearing. A
 * grid item's default `min-height: auto` refuses to shrink below its content,
 * so without them the panes grow the page instead of scrolling, and a long
 * unbroken subject line in the detail pushes the list pane off its track.
 *
 * The one hairline this component draws is the seam between the panes, plus one
 * under the sticky header. CLAUDE.md keeps a border only where removing it
 * makes a relationship ambiguous, and content sliding under a sticky header
 * with nothing marking the edge is exactly that case.
 */

export interface SplitWorkspaceProps {
  /** Accessible name for the list pane, e.g. "Enquiry queue". */
  listLabel: string;
  /** The rows. Owns no header — the page's toolbar sits above this component. */
  list: ReactNode;
  /** Accessible name for the detail pane, e.g. "Enquiry preview". */
  detailLabel: string;
  /**
   * Title, meta line and actions for the selected record. Rendered sticky at
   * the top of the detail pane's scroll. Omitted when nothing is selected, so
   * an empty pane does not draw a hairline under nothing.
   */
  detailHeader?: ReactNode;
  /** The detail body: blocks separated by spacing, not by rules. */
  detail: ReactNode;
  className?: string;
}

export function SplitWorkspace({
  listLabel,
  list,
  detailLabel,
  detailHeader,
  detail,
  className,
}: SplitWorkspaceProps) {
  return (
    <div
      data-split-workspace=""
      className={cn("grid min-h-0 flex-1 grid-cols-[minmax(360px,40%)_1fr]", className)}
    >
      <section
        aria-label={listLabel}
        data-split-list=""
        className="min-h-0 min-w-0 overflow-y-auto border-r border-border"
      >
        {list}
      </section>

      <section
        aria-label={detailLabel}
        data-split-detail=""
        className="min-h-0 min-w-0 overflow-y-auto"
      >
        {detailHeader ? (
          <div
            data-split-detail-header=""
            className="sticky top-0 z-10 border-b border-border bg-card px-5 py-3.5"
          >
            {detailHeader}
          </div>
        ) : null}

        {detail}
      </section>
    </div>
  );
}
