import type { ReactNode } from "react";
import type { AutonomyLevel, DiffLine, Provenance } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { AIChip } from "./AIChip";
import { AutonomyChip } from "./AutonomyChip";
import { DiffBlock } from "./DiffBlock";
import { SECTION_LABEL } from "./tokens";

/**
 * The proposed-action card. Kit.dc.html §02.
 *
 * The card answers three questions in one column, in this order: what the agent
 * wants to do, what it is standing on, and what changes if you say yes. The
 * diff is last and is the widest thing on the card, because it is the only part
 * an approver is actually accountable for.
 *
 * Header takes the AI tint with a blue bottom border — tint, never a fill, so
 * the card reads as a proposal rather than as something already done.
 */

export interface ProposedMetric {
  label: string;
  value: ReactNode;
}

export interface ProposedActionCardProps {
  /** The agent proposing, e.g. "Proposal Agent". */
  agentName: string;
  /** What it wants to do, e.g. "Send proposal to Aurora Manufacturing". */
  title: string;
  /** The rung this agent holds for this action type. */
  autonomy: AutonomyLevel;
  /** Drives the AI chip and its popover. */
  provenance?: Provenance;
  /** The three cells in the artboard: value, confidence, channel. */
  metrics?: ProposedMetric[];
  /** What changes on approval. Rendered verbatim from the server. */
  diff: DiffLine[];
  /** Approve & send / Edit before use / Reject. */
  actions?: ReactNode;
  className?: string;
}

export function ProposedActionCard({
  agentName,
  title,
  autonomy,
  provenance,
  metrics,
  diff,
  actions,
  className,
}: ProposedActionCardProps) {
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-primary-border bg-ai-tint px-4 py-3">
        <AIChip provenance={provenance} label={agentName} withoutPopover={!provenance} />
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{title}</h3>
        <AutonomyChip level={autonomy} />
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        {metrics && metrics.length > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex flex-col gap-1">
                <span className={SECTION_LABEL}>{metric.label}</span>
                <span className="text-[14px] font-medium text-ink">{metric.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        <DiffBlock lines={diff} />
      </div>

      {actions ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-divider px-4 py-3">
          {actions}
        </footer>
      ) : null}
    </article>
  );
}
