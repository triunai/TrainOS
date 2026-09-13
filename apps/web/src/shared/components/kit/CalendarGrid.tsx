import { type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/components/states";
import { FOCUS_RING, SELECTED_TINT } from "./tokens";
import {
  WEEKDAY_LABELS,
  calendarDays,
  dayOfMonth,
  isSameMonth,
  periodLabel,
  type CalendarView,
} from "./calendar";

/**
 * The month and week grid. New to the kit on 13 Sep 2026.
 *
 * No artboard draws a calendar, and `/dev/kit` had no grid, so CLAUDE.md's
 * consolidation rule decides the shape rather than a reference does: the
 * calendar is one component that takes dated entries, because a second screen
 * that ever needs a month view must not draw its own.
 *
 * Built from the same vocabulary as everything else and nothing new:
 *
 * - Hierarchy from typography, alignment and hairlines — the §7 surface
 *   architecture, not a border per cell. The grid's rules are `divider`, the
 *   outer edge is `border`, and there is no second frame around it.
 * - Selection is the DataTable's treatment exactly: the primary tint plus a 2px
 *   inset rule. Two selection languages for one meaning is the divergence
 *   CLAUDE.md calls a defect.
 * - Today is a weight change and a small primary ring on the number, not a
 *   filled cell. A filled cell would spend most of the screen's blue budget on
 *   a fact the reader already knows.
 * - Status colour stays on chips. An entry passes its chip through `badge`;
 *   this component colours nothing by status itself.
 *
 * Six rows always in month view (see `calendarDays`), so the page below the
 * grid does not move when the month changes.
 */

export interface CalendarEntry {
  /** Stable key, and what `selectedId` compares against. */
  id: string;
  /** The day this entry sits on, `YYYY-MM-DD`. */
  day: string;
  /** The strongest line. 12/550, truncated to one line. */
  title: string;
  /** The muted second line — a venue, a ref, a trainer. */
  meta?: string;
  /** A chip, rendered under the title. Status colour lives here, not on the cell. */
  badge?: ReactNode;
}

export interface CalendarGridProps {
  /** Any day inside the period to draw. */
  anchor: string;
  view: CalendarView;
  entries: CalendarEntry[];
  /** Today, as the grid should mark it. Pass the server's day, not the browser's. */
  today?: string;
  selectedId?: string;
  onSelect?: (entry: CalendarEntry) => void;
  /**
   * Rendered inside the grid when the period holds nothing at all. A month with
   * no deliveries is a real answer and gets a real empty state, not 42 blank
   * cells the reader has to scan before believing them.
   */
  empty?: ReactNode;
  /** Accessible name for the grid. */
  label: string;
  className?: string;
}

export function CalendarGrid({
  anchor,
  view,
  entries,
  today,
  selectedId,
  onSelect,
  empty,
  label,
  className,
}: CalendarGridProps) {
  const days = calendarDays(anchor, view);

  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const bucket = byDay.get(entry.day);
    if (bucket) bucket.push(entry);
    else byDay.set(entry.day, [entry]);
  }

  const inPeriod = days.some((day) => (byDay.get(day)?.length ?? 0) > 0);

  if (!inPeriod && empty) {
    return (
      <section aria-label={label} className={cn("rounded-panel border border-border", className)}>
        <Weekdays />
        {empty}
      </section>
    );
  }

  return (
    <section
      aria-label={`${label} · ${periodLabel(anchor, view)}`}
      className={cn("overflow-hidden rounded-panel border border-border bg-card", className)}
    >
      <Weekdays />

      <div
        className={cn(
          "grid grid-cols-7",
          /* One rule per seam rather than a border per cell: the cells share
             edges, so a border each would double every interior line. */
          "[&>*]:border-l [&>*]:border-t [&>*]:border-divider",
          "[&>*:nth-child(7n+1)]:border-l-0",
        )}
      >
        {days.map((day) => {
          const dayEntries = byDay.get(day) ?? [];
          const outside = view === "month" && !isSameMonth(day, anchor);
          const isToday = day === today;

          return (
            <div
              key={day}
              className={cn(
                "flex flex-col gap-1 p-1.5",
                view === "week" ? "min-h-[280px]" : "min-h-[104px]",
                outside && "bg-surface/40",
              )}
            >
              <div className="flex items-center gap-1.5 px-1">
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-pill px-1 text-[12px] tabular-nums",
                    outside ? "text-ink-disabled" : "text-ink-secondary",
                    isToday && "border border-primary-border font-semibold text-primary-hover",
                  )}
                >
                  {dayOfMonth(day)}
                </span>
                {isToday ? <span className="sr-only">Today</span> : null}
              </div>

              {dayEntries.map((entry) => (
                <EntryButton
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === selectedId}
                  {...(onSelect ? { onSelect } : {})}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The seven captions. UI font, sentence case — brief rule 1 and §9. */
function Weekdays() {
  return (
    <div className="grid grid-cols-7 border-b border-divider bg-surface/60">
      {WEEKDAY_LABELS.map((weekday) => (
        <div key={weekday} className="px-2.5 py-2 text-[12px] font-medium text-ink-muted">
          {weekday}
        </div>
      ))}
    </div>
  );
}

/**
 * One entry.
 *
 * A `<button>` when the caller can act on it and a plain block when it cannot,
 * rather than a button with no handler: an unactionable control that still
 * takes focus is a dead stop for a keyboard reader.
 */
function EntryButton({
  entry,
  selected,
  onSelect,
}: {
  entry: CalendarEntry;
  selected: boolean;
  onSelect?: (entry: CalendarEntry) => void;
}) {
  const body = (
    <>
      <span className="block truncate text-[12px] font-medium text-ink">{entry.title}</span>
      {entry.meta ? (
        <span className="block truncate text-[11px] text-ink-muted">{entry.meta}</span>
      ) : null}
      {entry.badge ? <span className="mt-1 flex">{entry.badge}</span> : null}
    </>
  );

  const shape = cn(
    "w-full rounded-control px-2 py-1.5 text-left transition-colors",
    selected
      ? cn(SELECTED_TINT, "shadow-[inset_2px_0_0_rgb(var(--primary))]")
      : "bg-surface hover:bg-surface-hover",
  );

  if (!onSelect) return <div className={shape}>{body}</div>;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(entry)}
      className={cn(shape, FOCUS_RING)}
    >
      {body}
    </button>
  );
}

/**
 * The list fallback: the same entries, in date order, as rows.
 *
 * Not a second design for the same problem — it is the grid's own answer at a
 * width where 7 columns cannot hold a legible title, and on the screens that
 * offer it as a deliberate view. It takes the same `CalendarEntry`, so a screen
 * builds its data once and chooses the rendering.
 */
export interface CalendarListProps {
  entries: CalendarEntry[];
  selectedId?: string;
  onSelect?: (entry: CalendarEntry) => void;
  /** Renders the day key as the reader should read it, e.g. `formatDate`. */
  formatDay: (day: string) => string;
  empty?: ReactNode;
  label: string;
  className?: string;
}

export function CalendarList({
  entries,
  selectedId,
  onSelect,
  formatDay,
  empty,
  label,
  className,
}: CalendarListProps) {
  const ordered = [...entries].sort((a, b) => a.day.localeCompare(b.day));

  if (ordered.length === 0) {
    return (
      <section aria-label={label} className={cn("rounded-panel border border-border", className)}>
        {empty ?? <EmptyState title="Nothing scheduled" />}
      </section>
    );
  }

  return (
    <section
      aria-label={label}
      className={cn("overflow-hidden rounded-panel border border-border bg-card", className)}
    >
      <ul className="divide-y divide-divider">
        {ordered.map((entry) => {
          const row = (
            <>
              <span className="w-[104px] shrink-0 text-[12px] tabular-nums text-ink-muted">
                {formatDay(entry.day)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">
                  {entry.title}
                </span>
                {entry.meta ? (
                  <span className="block truncate text-[12px] text-ink-muted">{entry.meta}</span>
                ) : null}
              </span>
              {entry.badge ? <span className="shrink-0">{entry.badge}</span> : null}
            </>
          );

          return (
            <li key={entry.id}>
              {onSelect ? (
                <button
                  type="button"
                  aria-pressed={entry.id === selectedId}
                  onClick={() => onSelect(entry)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                    entry.id === selectedId
                      ? cn(SELECTED_TINT, "shadow-[inset_2px_0_0_rgb(var(--primary))]")
                      : "hover:bg-surface-hover",
                    FOCUS_RING,
                  )}
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
