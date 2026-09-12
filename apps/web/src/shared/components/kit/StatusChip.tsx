import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The status chip — and the ONLY place in TrainOS where status colour exists.
 *
 * CLAUDE.md: "Three colours: ink neutrals, electric blue #1F5BFF, charcoal
 * #181A1F. Status colour lives on chips only." Green, amber and red appear in
 * this file and nowhere else in the kit. That is grep-checkable:
 *
 *   grep -rln 'success\|warning\|danger\|text-info' \
 *     apps/web/src/shared/components/kit --include=*.tsx
 *
 * should return this file, `RuleCheckRow` (whose verdict pill IS a StatusChip
 * and delegates to it), and the banner components, which tint a whole row
 * because the row is itself the status. Anything else is a defect.
 *
 * Kit.dc.html §02 draws three shapes from one component:
 *   · workflow status — pill (999px), e.g. Draft / Accepted / Lost
 *   · sync + lock     — rounded rect (6px), e.g. `Sync · Error`, `🔒 Locked`
 *   · stage           — pill on the card surface, e.g. `Stage · Proposal sent`
 * Shape carries the category, colour carries the verdict, and the two are
 * independent props for that reason.
 */

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * Fill / text / border, one triple per tone, quoted from the artboards.
 * `neutral` deliberately spends nothing: most statuses are not events.
 */
const TONE: Record<StatusTone, string> = {
  neutral: "bg-surface text-ink-secondary border-border",
  info: "bg-info-fill text-info border-info-border",
  success: "bg-success-fill text-success border-success-border",
  warning: "bg-warning-fill text-warning border-warning-border",
  danger: "bg-danger-fill text-danger border-danger-border",
};

const SHAPE = {
  /** Workflow status and stage. */
  pill: "rounded-pill",
  /** Sync state and lock. A squarer chip reads as a machine fact. */
  square: "rounded-[6px]",
} as const;

export interface StatusChipProps {
  /** The label. Always a word a user would say — "Awaiting approval", not `AWAITING_APPROVAL`. */
  children: ReactNode;
  /** Defaults to `neutral`. Spend a colour only when the state is an event. */
  tone?: StatusTone;
  shape?: keyof typeof SHAPE;
  /** A glyph before the label, e.g. the lock chip's 🔒. Decorative. */
  glyph?: ReactNode;
  /**
   * Announce the chip as a status region so a change is read out without the
   * user hunting for it. Use on the one chip that carries the record's state,
   * not on every chip in a row.
   */
  live?: boolean;
  className?: string;
}

export function StatusChip({
  children,
  tone = "neutral",
  shape = "pill",
  glyph,
  live,
  className,
}: StatusChipProps) {
  return (
    <span
      role={live ? "status" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border px-2.5 py-[3px] text-[12px] font-medium",
        TONE[tone],
        SHAPE[shape],
        className,
      )}
    >
      {glyph ? <span aria-hidden="true">{glyph}</span> : null}
      {children}
    </span>
  );
}
