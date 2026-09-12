import type { AutonomyLevel } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";

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

const RUNG: Record<AutonomyLevel, { label: string; caption: string; className: string }> = {
  OBSERVE: {
    label: "Observe",
    caption: "logs only",
    className: "bg-surface text-ink-secondary border border-border",
  },
  SUGGEST: {
    label: "Suggest",
    caption: "drafts, human sends",
    className: "bg-ai-tint text-primary-hover border border-primary-border",
  },
  ACT_WITH_APPROVAL: {
    label: "Act w/ approval",
    caption: "queued to Approvals",
    className: "bg-ai-tint text-primary-hover border border-primary-border",
  },
  AUTONOMOUS: {
    label: "Autonomous",
    caption: "acts, notifies after",
    className: "bg-ai-tint text-primary-hover border-[1.5px] border-primary font-semibold",
  },
};

/** The ladder in order, lowest rung first. Drives the matrix and the showcase. */
export const AUTONOMY_LADDER: AutonomyLevel[] = [
  "OBSERVE",
  "SUGGEST",
  "ACT_WITH_APPROVAL",
  "AUTONOMOUS",
];

/** The wording each rung uses. Exported so a screen's copy cannot drift from the chip's. */
export function autonomyCaption(level: AutonomyLevel): string {
  return RUNG[level].caption;
}

export interface AutonomyChipProps {
  level: AutonomyLevel;
  /** Render the trailing explanation, e.g. "queued to Approvals". */
  withCaption?: boolean;
  /** Drop the 118px floor where the chip sits inline in prose rather than in a column. */
  fluid?: boolean;
  className?: string;
}

export function AutonomyChip({ level, withCaption, fluid, className }: AutonomyChipProps) {
  const rung = RUNG[level];

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
