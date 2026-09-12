import type { AutonomyLevel } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { AUTONOMY_RUNGS } from "./adapters";

/**
 * The autonomy ladder. Kit.dc.html §02 "Autonomy chip — the ladder".
 *
 * Four rungs, one hue, and the border weight rises with the rung — verbatim
 * from the artboard: "Border weight rises with autonomy, so the riskiest state
 * reads hardest at a glance without a second hue." `OBSERVE` is neutral because
 * observing is not an AI action a user needs to weigh; the three that act take
 * the AI tint, and only `AUTONOMOUS` gets the 1.5px solid-accent border.
 *
 * Fixed 118px width, from the artboard. The rungs line up in a column on the
 * autonomy matrix (M18-S01), and a ragged left edge there makes a ladder look
 * like a list.
 *
 * REPORT.md and DECISIONS §1/§2: money-moving action types can never be granted
 * `AUTONOMOUS`. That ceiling is a server rule, not a render rule, so this
 * component does not police it — but `caption` exists so a screen can say why a
 * rung is unavailable rather than silently omitting it.
 */

export interface AutonomyChipProps {
  level: AutonomyLevel;
  /** Render the trailing explanation, e.g. "queued to Approvals". */
  withCaption?: boolean;
  /** Drop the 118px floor where the chip sits inline in prose rather than in a column. */
  fluid?: boolean;
  className?: string;
}

export function AutonomyChip({ level, withCaption, fluid, className }: AutonomyChipProps) {
  const rung = AUTONOMY_RUNGS[level];

  const chip = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[6px] px-2.5 py-[3px] text-[12px] font-medium",
        !fluid && "min-w-[118px]",
        rung.className,
        className,
      )}
    >
      {rung.label}
    </span>
  );

  if (!withCaption) return chip;

  return (
    <span className="inline-flex items-center gap-2.5">
      {chip}
      <span className="text-[12px] text-ink-secondary">{rung.caption}</span>
    </span>
  );
}
