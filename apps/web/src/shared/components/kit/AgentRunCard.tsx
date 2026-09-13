import type { ReactNode } from "react";
import type { AutomationRun } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { formatDuration } from "./format";
import { MoneyText } from "./Money";
import { StatusChip } from "./StatusChip";
import { RUN_TONE } from "./statusTone";
import { TierChip } from "./TierChip";
import { RunStepRow } from "./RunStepRow";
import { SECTION_LABEL } from "./tokens";

/**
 * The agent-run card. Kit.dc.html §05 "Agent-run card (AutomationRun)".
 *
 * Two variants from one component and one contract type. A succeeded run shows
 * its four metrics and its tool log; a failed run additionally shows the error
 * code and attempt count, and takes a danger-tinted border — REPORT.md confirms
 * "the failed variant is the row shape used by the failures queue (M18-S07) and
 * the dead-letter list", so the failure treatment has to survive being put in a
 * list, not just being looked at on its own.
 *
 * `HALTED` is neither: a policy stopped the run on purpose, which is a success
 * of the policy gate and is coloured warning rather than danger.
 */

export interface AgentRunCardProps {
  run: AutomationRun;
  /** The agent's display name. `run.agentId` is an id, not a label. */
  agentName: string;
  /** Retry / Dismiss to dead letter. Omitted on a read-only view. */
  actions?: ReactNode;
  /** Render the tool-call log. Off in a dense failures queue. */
  withSteps?: boolean;
  className?: string;
}

export function AgentRunCard({
  run,
  agentName,
  actions,
  withSteps = true,
  className,
}: AgentRunCardProps) {
  const failed = run.status === "FAILED";

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-card border bg-card",
        failed ? "border-danger-border bg-danger-fill" : "border-border",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-divider px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink">{agentName}</h3>
        <span className="font-mono text-[11px] text-ink-muted">{run.ref}</span>
        <StatusChip tone={RUN_TONE[run.status]} live>
          {failed && run.failure
            ? `Failed · attempt ${run.failure.attempts}`
            : run.status.charAt(0) + run.status.slice(1).toLowerCase()}
        </StatusChip>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
        <Metric label="Trigger" value={run.trigger.type} />
        <Metric label="Duration" value={formatDuration(run.durationMs)} />
        <Metric label="Cost" value={<MoneyText value={run.cost} />} />
        <Metric
          label="Model"
          value={
            run.tiersUsed?.[0] ? (
              <TierChip tier={run.tiersUsed[0]} model={run.model} />
            ) : (
              (run.model ?? "—")
            )
          }
        />
      </dl>

      {/* A failure states its code and whether retrying is even possible.
          "Failed" with no code sends the reader to the logs, which is exactly
          the trip this card exists to save. */}
      {failed && run.failure ? (
        <p className="border-t border-danger-border px-4 py-2.5 font-mono text-[12px] text-danger">
          {run.failure.code}
          <span className="text-ink-secondary"> · {run.failure.message}</span>
          {run.failure.deadLettered ? (
            <span className="text-ink-muted"> · dead-lettered</span>
          ) : run.failure.retryable ? (
            <span className="text-ink-muted"> · retryable</span>
          ) : (
            <span className="text-ink-muted"> · not retryable</span>
          )}
        </p>
      ) : null}

      {withSteps && run.steps && run.steps.length > 0 ? (
        <div className="border-t border-divider">
          {run.steps.map((step) => (
            <RunStepRow key={step.seq} step={step} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className={SECTION_LABEL}>{label}</dt>
      <dd className="truncate text-[13px] text-ink">{value}</dd>
    </div>
  );
}
