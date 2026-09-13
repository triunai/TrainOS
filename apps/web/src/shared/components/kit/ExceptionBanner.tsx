import { useId, useState, type ReactNode } from "react";
import type { Severity } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { Collapse } from "./Collapse";
import { FOCUS_RING } from "./tokens";

/**
 * The exception / SLA banner. Kit.dc.html §05: a danger variant for a deadline
 * or compliance risk, a warning variant for an SLA escalation, and either with
 * a trailing fix action.
 *
 * One banner per page, at the top of the content card and outside any internal
 * scroll pane — REPORT.md's note on M20-S20 is explicit that a page-level banner
 * must not scroll away inside a tall matrix. Stacking three of these is how a
 * page teaches people to ignore all of them.
 *
 * Takes the contract's `Severity` so a server-sent severity maps straight
 * through with no translation table on the screen.
 *
 * `why` is how a banner stays one sentence long without throwing away the
 * mechanics behind it. The knowledge sources banner is the case the prop was
 * built for (tightening brief §18): the reader needs to know that a changed
 * source is quarantined from rule extraction and still searchable, and needs
 * that on the SECOND read, not on the first. Printed inline it is an
 * architecture essay above the table; deleted it is a rule nobody can find.
 * Behind a "Why?" the banner asks for a decision and answers the question the
 * decision raises, in that order.
 */

const TONE: Record<Severity, string> = {
  INFO: "border-info-border bg-info-fill text-info",
  WARN: "border-warning-border bg-warning-fill text-warning",
  DANGER: "border-danger-border bg-danger-fill text-danger",
  /** ALERT is DANGER that has already breached; same paint, different word. */
  ALERT: "border-danger-border bg-danger-fill text-danger",
};

export interface ExceptionBannerProps {
  severity: Severity;
  title: string;
  /** One line of context. What happened, and by when it matters. */
  subtitle?: string;
  /** The fix — a button or a link. One only. */
  action?: ReactNode;
  /**
   * The mechanics behind the banner, revealed by a "Why?" the banner owns.
   * Prose, normally one short paragraph. Omit it and no disclosure is drawn.
   */
  why?: ReactNode;
  className?: string;
}

export function ExceptionBanner({
  severity,
  title,
  subtitle,
  action,
  why,
  className,
}: ExceptionBannerProps) {
  const [open, setOpen] = useState(false);
  const whyId = useId();

  return (
    <div
      role={severity === "INFO" ? "status" : "alert"}
      className={cn(
        /* 10px/14px and a 12px gap, from the M01-S01 artboard. A banner is an
           interruption; the tallest thing in it should be its own button. */
        "rounded-control border px-3.5 py-2.5",
        TONE[severity],
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[13px] font-semibold text-ink">{title}</p>
          {subtitle ? <p className="text-[12px] text-ink-secondary">{subtitle}</p> : null}

          {why ? (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={whyId}
              className={cn(
                "mt-0.5 self-start rounded-[4px] text-[12px] font-medium text-ink-secondary underline underline-offset-2 hover:text-ink",
                FOCUS_RING,
              )}
            >
              Why?
            </button>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {why ? (
        <Collapse open={open} id={whyId}>
          {/* All spacing inside the clipped row — a margin out here survives
              the collapse as a residual band. See `Collapse`. */}
          <div className="pt-2 text-[12px] leading-relaxed text-ink-secondary">{why}</div>
        </Collapse>
      ) : null}
    </div>
  );
}
