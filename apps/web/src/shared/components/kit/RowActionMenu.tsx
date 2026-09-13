import { type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { FOCUS_RING } from "./tokens";

/**
 * The row overflow — `⋯` at the end of a table row, revealed on hover, holding
 * the actions that a row in its NORMAL state can take.
 *
 * Why the kit gains a component for one glyph: the alternative is what the
 * knowledge sources table used to do, which is render every row's full action
 * pair as buttons. A list of six rows then carries twelve buttons, all of them
 * equally loud, and the two rows that actually need something done to them are
 * indistinguishable from the four that do not. The design rule this component
 * exists to hold (tightening brief §18) is:
 *
 *   a row with a PROBLEM promotes one action into the row, where it is read;
 *   a row that is FINE keeps its actions here, where they are found.
 *
 * So the menu is not "the actions we could not fit". It is the resting place
 * for maintenance, and a row that shows one has nothing wrong with it.
 *
 * HOVER, WITHOUT A `group` CLASS. The trigger reveals itself from the row's own
 * hover (`[tr:hover_&]`) rather than from a `group` utility on the `<tr>`,
 * because `DataTable` owns that element and no screen should have to ask it for
 * a class to make a cell work. Three things un-hide it — the row's hover,
 * keyboard focus, and the menu being open — and the third is what stops the
 * trigger vanishing under its own menu when the pointer moves into it.
 *
 * It is never `display: none` or absent from the DOM: a keyboard user tabs to
 * it, and an assistive technology reads it, in both states.
 */

export interface RowAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Marks a destructive item. Danger ink on the label, nothing else. */
  danger?: boolean;
}

export interface RowActionMenuProps {
  actions: RowAction[];
  /**
   * What the actions act ON — the row's name. The accessible name becomes
   * "More actions for {label}", so a screen reader hears which row it is on
   * rather than six identical "More actions" buttons.
   */
  label: string;
  /** Replaces the `⋯` glyph. Rare; the audit trail's row uses a different one. */
  glyph?: ReactNode;
  className?: string;
}

export function RowActionMenu({ actions, label, glyph, className }: RowActionMenuProps) {
  if (actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          /* The row underneath is usually clickable — it opens the record. A
             click on the overflow is about the row, not a request to open it. */
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-control text-ink-muted",
            "opacity-0 transition-opacity",
            "[tr:hover_&]:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
            "hover:bg-surface-hover hover:text-ink",
            /* No transition for a reader who asked for none: the control would
               otherwise fade in over 150ms on a machine set to remove motion. */
            "motion-reduce:transition-none",
            FOCUS_RING,
            className,
          )}
        >
          <span className="sr-only">{`More actions for ${label}`}</span>
          <span aria-hidden="true" className="text-[15px] leading-none">
            {glyph ?? "⋯"}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[168px]">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={action.disabled}
            onClick={(event) => event.stopPropagation()}
            onSelect={() => action.onSelect()}
            className={cn("text-[13px]", action.danger && "text-danger focus:text-danger")}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
