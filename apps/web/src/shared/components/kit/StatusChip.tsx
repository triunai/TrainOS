import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The status chip. The only status chip in TrainOS — every workflow status,
 * sync state, lock and stage renders through this one component.
 *
 * CLAUDE.md: "Three colours: ink neutrals, electric blue #1F5BFF, charcoal
 * #181A1F. Status colour lives on chips only." What that rule protects is the
 * reading surface: green, amber and red never fill a panel, a row of content or
 * a button a user is reading THROUGH. It does not mean the three status tokens
 * appear in exactly one file, and they do not. Outside this component they are
 * allowed in precisely three shapes, all of which are the status rather than
 * decoration on top of it:
 *
 *   1. A banner whose whole row IS the state — `ApprovalBanner`,
 *      `ExceptionBanner`, and the failed variant of `AgentRunCard`.
 *   2. A single mark that encodes a state and carries no text — a stepper dot,
 *      a run-step or trace glyph, a diff's plus and minus, a bar's fill.
 *   3. An error that must reach the eye at the field — `MoneyInput`'s invalid
 *      border, `DangerButton`'s label.
 *
 * Anything else — a coloured table row, a tinted card, a green heading — is a
 * defect. The check that matters is therefore not a grep for the tokens but
 * this one, which must return nothing:
 *
 *   grep -rn 'bg-\(success\|warning\|danger\|info\)-fill' \
 *     apps/web/src/screens
 *
 * A screen reaching for a status fill has skipped the chip.
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
