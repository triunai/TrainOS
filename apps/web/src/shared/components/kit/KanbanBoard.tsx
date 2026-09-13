import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { FOCUS_RING } from "./tokens";

/**
 * The board: fixed-width lanes on a horizontal scroller, each lane a drop
 * target, each card draggable between them.
 *
 * Brief §19 (user ruling, 13 Sep). The board this replaces tried to fit seven
 * stages inside 1440px and answered with 240px columns that truncated every
 * company name on it — the one string a sales manager reads first. So the lane
 * width is a FLOOR, not a share of the viewport: `clamp(280px, 300px, 320px)`
 * per lane and the board scrolls sideways past the seventh. A board that scrolls
 * is a board you can read; a board that fits is a board of abbreviations.
 *
 * There is no enclosing card. The lanes sit on the page surface, and the lane's
 * own surface (L1 tint, no border) is what separates one column from the next —
 * CLAUDE.md's rule that hierarchy comes from spacing and surface before borders,
 * applied to the one layout where seven vertical rules would otherwise read as
 * a spreadsheet.
 *
 * WHY THE LANE SURFACE RUNS TO THE BOTTOM. It is the drop target. A target
 * sized to its contents means the empty lane — the one you most want to drop
 * into — is the smallest thing on the screen, and a lane holding one card
 * accepts a drop for 90px and rejects it for the rest. The surface is the
 * affordance, so it fills the column.
 *
 * WHAT THIS COMPONENT DOES NOT KNOW. It has no idea what a card is. `renderItem`
 * draws it, `itemKey` identifies it, and `onMove` is told which item went from
 * which lane to which — the screen decides whether that is a governed write, an
 * approval, or a refusal. That is what keeps the kit's one board usable by the
 * next pipeline rather than being the opportunity board with a generic name.
 *
 * DRAG IS NOT THE ONLY WAY. A pointer drag is unreachable by keyboard and by
 * most assistive technology, so a screen using this MUST offer the same move
 * some other way — the opportunity board puts a stage list in each card's
 * action menu. This component renders `laneMenu` beside the lane heading and
 * leaves the per-card route to `renderItem`; it does not pretend the drag alone
 * is accessible.
 */

export interface KanbanLane<T> {
  /** Stable identity. Sent to `onMove` as the source and the destination. */
  id: string;
  /** The lane heading. UI type, medium weight — never a mono uppercase eyebrow. */
  label: string;
  /**
   * The muted line beneath the heading: "1 deal · RM 67,200". The caller folds
   * it, because only the caller knows what the items are worth.
   */
  summary?: ReactNode;
  items: T[];
  /**
   * A terminal lane — one that ends the pipeline. Rendered last by the caller's
   * own ordering; this only decides that the lane may collapse to a rail.
   */
  collapsible?: boolean;
  /** Starts collapsed. Only read when `collapsible`. */
  defaultCollapsed?: boolean;
}

export interface KanbanBoardProps<T> {
  /** Accessible name for the board, e.g. "Pipeline stages". */
  label: string;
  lanes: KanbanLane<T>[];
  itemKey: (item: T) => string;
  renderItem: (item: T, lane: KanbanLane<T>) => ReactNode;
  /**
   * A card was dropped on another lane. Never called for a drop on the lane the
   * card already sits in — that is a no-op the caller should not have to filter.
   */
  onMove?: (itemKey: string, fromLaneId: string, toLaneId: string) => void;
  /** The empty lane's first line. Defaults to "Nothing here". */
  emptyLabel?: string;
  /** The empty lane's second line, inside the dashed zone. Omitted when no `onMove`. */
  emptyHint?: string;
  /** Rendered at the right of every lane heading row, e.g. a lane action menu. */
  laneMenu?: (lane: KanbanLane<T>) => ReactNode;
  className?: string;
}

/** What a drag carries. One key, so a stray drop from elsewhere cannot parse. */
const DRAG_TYPE = "application/x-trainos-kanban";

export function KanbanBoard<T>({
  label,
  lanes,
  itemKey,
  renderItem,
  onMove,
  emptyLabel = "Nothing here",
  emptyHint,
  laneMenu,
  className,
}: KanbanBoardProps<T>) {
  const [dragging, setDragging] = useState<{ key: string; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      lanes
        .filter((lane) => lane.collapsible && lane.defaultCollapsed)
        .map((lane) => [lane.id, true]),
    ),
  );

  const draggable = Boolean(onMove);

  const drop = useCallback(
    (toLaneId: string) => {
      setOver(null);
      const moved = dragging;
      setDragging(null);
      /* A drop back where it started is not a move. Filtering it here rather
         than in the caller means no screen has to remember to. */
      if (!moved || !onMove || moved.from === toLaneId) return;
      onMove(moved.key, moved.from, toLaneId);
    },
    [dragging, onMove],
  );

  return (
    <div
      className={cn(
        /* `min-h-0` is load-bearing: without it the flex parent refuses to
           shrink below the tallest lane and the page scrolls instead. */
        "flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-hidden",
        className,
      )}
    >
      <ol aria-label={label} className="flex min-h-0 flex-1 items-stretch gap-4">
        {lanes.map((lane) => {
          const isCollapsed = Boolean(lane.collapsible && collapsed[lane.id]);

          if (isCollapsed) {
            return (
              <li
                key={lane.id}
                aria-label={lane.label}
                data-lane-id={lane.id}
                className="flex min-h-0 w-[56px] shrink-0 flex-col"
              >
                <button
                  type="button"
                  aria-expanded={false}
                  onClick={() => setCollapsed((state) => ({ ...state, [lane.id]: false }))}
                  className={cn(
                    "flex min-h-0 flex-1 items-center justify-center rounded-panel bg-surface",
                    "hover:bg-surface-hover",
                    FOCUS_RING,
                  )}
                >
                  <span
                    /* Rotated so the label reads bottom-to-top, which is the
                       direction a vertical rail is read in every board that
                       has one. `writing-mode` rather than a transform: a
                       transform would leave the button's hit box the wrong
                       shape. */
                    className="whitespace-nowrap text-[13px] font-medium text-ink-secondary [writing-mode:vertical-rl] [text-orientation:mixed]"
                  >
                    {lane.label}
                    <span className="pl-2 tabular-nums text-ink-muted">{lane.items.length}</span>
                  </span>
                </button>
              </li>
            );
          }

          return (
            <li
              key={lane.id}
              aria-label={lane.label}
              data-lane-id={lane.id}
              /* The width IS the ruling: 300px, never under 280, never over
                 320. `w-[300px]` alone would be squeezed by the flex row. */
              className="flex min-h-0 w-[300px] min-w-[280px] max-w-[320px] shrink-0 flex-col"
            >
              <div className="flex items-start gap-2 pb-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <h3 className="truncate text-[13px] font-medium text-ink">{lane.label}</h3>
                  {lane.summary ? (
                    <p className="truncate text-[12px] tabular-nums text-ink-muted">
                      {lane.summary}
                    </p>
                  ) : null}
                </div>

                {lane.collapsible ? (
                  <button
                    type="button"
                    aria-expanded
                    aria-label={`Collapse ${lane.label}`}
                    onClick={() => setCollapsed((state) => ({ ...state, [lane.id]: true }))}
                    className={cn(
                      "rounded-control px-1 text-[12px] text-ink-muted hover:text-ink",
                      FOCUS_RING,
                    )}
                  >
                    ›
                  </button>
                ) : null}

                {laneMenu?.(lane)}
              </div>

              {/* The one hairline per lane. Removing it makes the heading and
                  the first card read as one block, which is the test
                  CLAUDE.md sets for keeping a border at all. */}
              <div className="h-px shrink-0 bg-border" />

              <div
                data-lane={lane.id}
                data-over={over === lane.id ? "" : undefined}
                onDragOver={
                  draggable
                    ? (event) => {
                        if (!dragging) return;
                        /* Without `preventDefault` the browser refuses the
                           drop and the whole gesture silently does nothing. */
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setOver(lane.id);
                      }
                    : undefined
                }
                onDragLeave={
                  draggable
                    ? (event) => {
                        /* Only when the pointer actually left the lane, not
                           when it crossed onto a card inside it. */
                        if (event.currentTarget.contains(event.relatedTarget as Node | null))
                          return;
                        setOver((current) => (current === lane.id ? null : current));
                      }
                    : undefined
                }
                onDrop={
                  draggable
                    ? (event) => {
                        event.preventDefault();
                        drop(lane.id);
                      }
                    : undefined
                }
                className={cn(
                  /* Runs to the bottom of the scroller: the lane surface IS
                     the drop target, so it cannot be sized to its contents. */
                  "mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-panel bg-surface p-2",
                  /* The drop highlight is the surface stepping up plus one
                     inset ring — NOT the AI tint, which means an agent did
                     something, and not a fourth accent. */
                  over === lane.id ? "bg-surface-hover ring-1 ring-inset ring-primary" : null,
                )}
              >
                {lane.items.length === 0 ? (
                  <div
                    className={cn(
                      "flex flex-1 flex-col items-center justify-center gap-1 rounded-panel p-4 text-center",
                      /* Dashed, and only when a drop is possible. A dashed
                         box on a board with no drag is an affordance that
                         answers nothing. */
                      draggable ? "border border-dashed border-border" : null,
                    )}
                  >
                    <p className="text-[13px] text-ink-secondary">{emptyLabel}</p>
                    {draggable && emptyHint ? (
                      <p className="text-[12px] text-ink-muted">{emptyHint}</p>
                    ) : null}
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {lane.items.map((item) => {
                      const key = itemKey(item);
                      return (
                        <li
                          key={key}
                          draggable={draggable}
                          data-dragging={dragging?.key === key ? "" : undefined}
                          onDragStart={
                            draggable
                              ? (event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData(DRAG_TYPE, key);
                                  setDragging({ key, from: lane.id });
                                }
                              : undefined
                          }
                          onDragEnd={
                            draggable
                              ? () => {
                                  setDragging(null);
                                  setOver(null);
                                }
                              : undefined
                          }
                          className={dragging?.key === key ? "opacity-50" : undefined}
                        >
                          {renderItem(item, lane)}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
