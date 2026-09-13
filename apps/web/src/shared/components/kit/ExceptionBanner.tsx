import type { ReactNode } from "react";
import type { Severity } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";

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
  className?: string;
}

export function ExceptionBanner({
  severity,
  title,
  subtitle,
  action,
  className,
}: ExceptionBannerProps) {
  return (
    <div
      role={severity === "INFO" ? "status" : "alert"}
      className={cn(
        /* 10px/14px and a 12px gap, from the M01-S01 artboard. A banner is an
           interruption; the tallest thing in it should be its own button. */
        "flex flex-wrap items-center gap-3 rounded-control border px-3.5 py-2.5",
        TONE[severity],
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {subtitle ? <p className="text-[12px] text-ink-secondary">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
