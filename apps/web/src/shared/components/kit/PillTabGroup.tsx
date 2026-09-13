import { useRef } from "react";
import { cn } from "@/shared/lib/utils";
import type { PillTab } from "./adapters";
import { FOCUS_RING } from "./tokens";

/**
 * The saved-view switcher. Kit.dc.html §03 and §08's view row, rebuilt as the
 * BOUNDED SEGMENTED CONTROL the tightening brief §10 / §10a specifies.
 *
 * It kept the name `PillTabGroup` deliberately. The component is used on eleven
 * screens; renaming it would have meant eleven diffs and, for as long as the
 * migration was half done, two visual languages for one job — which CLAUDE.md
 * calls a defect rather than a style. One file changed, every screen moved.
 *
 * WHAT CHANGED, AND WHY:
 *
 * - The pills are gone. Free-floating pills read as decoration and give the eye
 *   no edge to stop at; a switcher is one control with N states, so it is drawn
 *   as one TRACK containing the states. §10: "one full-width track ... segments
 *   separated by 1px hairline dividers".
 * - The rounding is pulled back hard (§10a, the user's "20-40px of rounding"
 *   note read as a fraction of full-round): track at `--radius-panel` (10px),
 *   the selected segment at `--radius-control` (8px) inset 2px inside it. Not
 *   `--radius-pill` — the pill radius is reserved for status and tag chips.
 * - Sentence case, UI font, 13px/500. No uppercase tracking: §9 names that
 *   combination as the thing that reads as generated.
 * - The count is muted and TABULAR, not mono. Brief rule 1: numbers get
 *   `font-variant-numeric: tabular-nums`, mono is for machine-ish values like
 *   `PRG-0031`. Counts stay server-driven, because saved-view counts are
 *   server-side per contract §2 so they agree across devices.
 *
 * A tab list, not a nav — `role="tablist"` with a roving tabindex, because
 * these switch what is shown in place rather than navigating anywhere.
 *
 * The "+" add-a-view affordance is a button, not a tab, so it sits OUTSIDE the
 * `tablist` element while staying inside the visual track: the tablist is a
 * `display: contents` wrapper, which keeps the ARIA structure legal (a tablist
 * whose only children are tabs) without a second row of boxes in the layout.
 */

export interface PillTabGroupProps {
  tabs: PillTab[];
  activeId: string;
  onSelect: (id: string) => void;
  /** What the group switches between, for the accessible name. */
  label?: string;
  /** Renders the trailing "+" segment. Without it there is no add affordance. */
  onAdd?: () => void;
  /** Accessible name for the "+" segment. */
  addLabel?: string;
  className?: string;
}

/** One segment's own geometry, shared by the tabs and by the "+". */
const SEGMENT =
  "relative flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-control px-3 text-[13px] font-medium transition-colors";

export function PillTabGroup({
  tabs,
  activeId,
  onSelect,
  label = "Views",
  onAdd,
  addLabel = "Add a view",
  className,
}: PillTabGroupProps) {
  /* Arrow keys move between segments, and focus moves with the selection. A
     roving tabindex hands focus to whichever segment is selected, so selecting
     without moving focus would strand the keyboard on a segment that is no
     longer reachable by Tab. The refs exist only to do that move. */
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const go = (index: number) => {
    const next = tabs[index];
    if (!next) return;
    onSelect(next.id);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index === last ? 0 : index + 1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index === 0 ? last : index - 1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      go(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      go(last);
    }
  };

  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);

  /* A divider between two segments is noise when either neighbour is already
     drawn as a filled surface — the fill is the separation. So the hairline is
     rendered for every seam and hidden at the two seams the selection owns. */
  const seamHidden = (index: number) => index === activeIndex || index - 1 === activeIndex;

  return (
    <div
      className={cn(
        /* No `overflow-hidden`: the kit's focus ring carries a 2px offset and a
           clipped focus ring is an accessibility defect. The selected segment's
           radius is a step below the track's, so nothing spills anyway. */
        "inline-flex w-fit max-w-full items-center rounded-panel border border-border bg-surface p-0.5",
        className,
      )}
    >
      {/* `contents` keeps this element out of the box layout while keeping it in
          the accessibility tree, so the tablist owns exactly its tabs. */}
      <div role="tablist" aria-label={label} aria-orientation="horizontal" className="contents">
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;

          return (
            <div key={tab.id} className="contents">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "my-1.5 w-px shrink-0 self-stretch bg-border",
                    seamHidden(index) && "bg-transparent",
                  )}
                />
              ) : null}

              <button
                ref={(node) => {
                  buttons.current[index] = node;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  SEGMENT,
                  "min-w-[120px]",
                  active
                    ? "border border-primary-border bg-ai-tint-2 text-primary-hover"
                    : "border border-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink",
                  FOCUS_RING,
                )}
              >
                <span className="truncate">{tab.label}</span>
                {typeof tab.count === "number" ? (
                  <span
                    className={cn(
                      "text-[12px] font-normal tabular-nums",
                      active ? "text-primary-hover" : "text-ink-muted",
                    )}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>

      {onAdd ? (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "my-1.5 w-px shrink-0 self-stretch bg-border",
              activeIndex === tabs.length - 1 && "bg-transparent",
            )}
          />
          <button
            type="button"
            onClick={onAdd}
            aria-label={addLabel}
            title={addLabel}
            className={cn(
              SEGMENT,
              "w-9 px-0 text-[15px] font-normal text-ink-muted hover:bg-surface-hover hover:text-ink",
              FOCUS_RING,
            )}
          >
            +
          </button>
        </>
      ) : null}
    </div>
  );
}
