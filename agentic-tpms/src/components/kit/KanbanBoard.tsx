"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * FORKED FROM TrainOS kit/KanbanBoard.tsx — lanes on the recessed surface,
 * a hairline under each lane head, cards on the white card plane. Moving a
 * card is NOT drag-and-drop here on purpose: every stage change is a guarded,
 * audited FSM transition with a reason, so moves happen on the record.
 */
export interface KanbanLane<T> {
  id: string;
  label: string;
  summary?: ReactNode;
  items: T[];
}

export function KanbanBoard<T>({
  label,
  lanes,
  itemKey,
  renderItem,
  emptyLabel = "Nothing here",
  className,
}: {
  label: string;
  lanes: KanbanLane<T>[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  emptyLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-hidden", className)}>
      <ol aria-label={label} className="flex min-h-0 flex-1 items-stretch gap-4">
        {lanes.map((lane) => (
          <li key={lane.id} aria-label={lane.label} data-lane-id={lane.id} className="flex min-h-0 w-[288px] min-w-[272px] shrink-0 flex-col">
            <div className="flex flex-col gap-0.5 pb-2">
              <h3 className="truncate text-[13px] font-medium text-ink">{lane.label}</h3>
              {lane.summary ? <p className="truncate text-[12px] tabular-nums text-ink-muted">{lane.summary}</p> : null}
            </div>
            <div className="h-px shrink-0 bg-border" />
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-panel bg-surface p-2">
              {lane.items.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-panel p-4 text-center">
                  <p className="text-[13px] text-ink-muted">{emptyLabel}</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lane.items.map((item) => (
                    <li key={itemKey(item)}>{renderItem(item)}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
