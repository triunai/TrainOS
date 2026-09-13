/**
 * The kit's one expand/collapse region, and the button that drives it.
 *
 * MECHANISM (the same one the sidebar accordion uses, stated here in classes
 * rather than in a stylesheet so the kit carries no CSS file of its own):
 *
 *   `grid-template-rows: 0fr → 1fr` animates to the content's OWN height with
 *   nobody measuring it. No `ResizeObserver`, no JS animation, and no hardcoded
 *   `max-height` that clips the region the moment a line wraps.
 *
 *   `visibility` transitions at 0s with a 200ms DELAY on close and no delay on
 *   open. That is what takes the closed region out of the tab order and out of
 *   the accessibility tree exactly when the animation finishes — with no
 *   `transitionend` listener and no `setTimeout`. The browser does the
 *   sequencing, so there is nothing to leak on unmount.
 *
 *   `inert` is set alongside it from React, for browsers that honour it, so a
 *   closed region is unreachable by either route. It is toggled through the DOM
 *   because React 18 does not know the attribute and would warn on a boolean
 *   prop. `toggleAttribute` is idempotent and leaves nothing behind: the
 *   attribute dies with the element.
 *
 *   `prefers-reduced-motion` drops the transition entirely, which also drops
 *   the visibility delay — correct, because with no animation to wait for there
 *   is nothing to wait for.
 *
 * ALL SPACING LIVES INSIDE the clipped row. Padding or a margin on the wrapper
 * survives the collapse as a residual band, which is the classic way this
 * pattern is got wrong.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { FOCUS_RING } from "./tokens";

export interface CollapseProps {
  open: boolean;
  /** Matches the `aria-controls` of the button that drives it. */
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Collapse({ open, id, className, children }: CollapseProps) {
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inner.current?.toggleAttribute("inert", !open);
  }, [open]);

  return (
    <div
      data-open={open ? "true" : "false"}
      /* The two-value duration and delay are inline because Tailwind will not
         generate them: `duration-[…]` and `delay-[…]` validate their argument
         as a single `<time>`, so `200ms, 0s` is rejected and the class silently
         resolves to the transition utility's 150ms default. Verified in the
         browser — the generated sheet has the property and rows classes and no
         duration or delay rule at all.

         `motion-reduce:transition-none` still wins over both: it sets
         `transition-property: none`, and a variant utility is ordered after the
         base `transition-[…]` it overrides. With no property transitioning,
         these durations have nothing to apply to. */
      style={{
        transitionDuration: "200ms, 0s",
        transitionDelay: open ? "0s, 0s" : "0s, 200ms",
      }}
      className={cn(
        "grid ease-out",
        "transition-[grid-template-rows,visibility]",
        "motion-reduce:transition-none",
        open ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]",
        className,
      )}
    >
      <div ref={inner} id={id} className="min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export interface DisclosureButtonProps {
  open: boolean;
  onToggle: () => void;
  /** The id of the `Collapse` this drives. */
  controls: string;
  /**
   * What is being disclosed, as a noun phrase: "the record details", "the full
   * case". The accessible name becomes "Show/Hide {label}".
   *
   * A chevron alone is not a name. The visible glyph stays a glyph — a word
   * beside it would compete with the title for the row's one focal point — so
   * the name is carried in screen-reader text instead of dropped.
   */
  label: string;
  className?: string;
}

export function DisclosureButton({
  open,
  onToggle,
  controls,
  label,
  className,
}: DisclosureButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-control",
        /* --ink-secondary, well past the 3:1 floor CLAUDE.md sets for a
           non-text affordance, in both themes. */
        "text-ink-secondary hover:bg-surface-hover hover:text-ink",
        FOCUS_RING,
        className,
      )}
    >
      <span className="sr-only">{open ? `Hide ${label}` : `Show ${label}`}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={cn(
          "h-4 w-4 transition-transform duration-200 ease-out motion-reduce:transition-none",
          open && "rotate-180",
        )}
      >
        <path
          d="M4 6.5 8 10.5 12 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
