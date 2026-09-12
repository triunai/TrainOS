import type { RunEvent, RunEventType } from "@trainos/contract";
import { AI_GLYPH, DateText, humanise } from "@/shared/components/kit";
import { cn } from "@/shared/lib/utils";

/**
 * One row of a run's event log — M18-S04's "Events" block.
 *
 * BELONGS IN THE KIT. §4 names "event rows" as a component of M18-S04 and the
 * kit barrel has no equivalent: `RunStepRow` renders a tool call and
 * `TraceTreeNode` renders a node, and an event is neither. It is written here
 * so the screen can ship, with the same grammar `TraceTreeNode` and
 * `RunStepRow` already use — glyph carries the status, the detail line carries
 * the numbers, the timestamp is right-aligned mono — so the three read as
 * siblings. Prop shape sent to the `kit` agent; migrate and delete this file.
 *
 * `detail` is a per-type bag in the contract, so the summary is written once
 * per type here rather than by the screen. A screen formatting an escalation's
 * confidence threshold is how two screens end up disagreeing about what 0.62
 * means.
 */

const GLYPH: Record<RunEventType, { mark: string; className: string }> = {
  ESCALATION: { mark: "↑", className: "text-warning" },
  /* The AI tint, not a status colour: a jury is model behaviour. */
  JURY: { mark: AI_GLYPH, className: "text-primary-hover" },
  TRUNCATION: { mark: "✂", className: "text-ink-muted" },
  HANDOFF: { mark: "⇄", className: "text-ink-muted" },
  CHECKPOINT: { mark: "⎘", className: "text-ink-muted" },
  /* A halt is the policy gate working, so it takes the same AI tint the trace
     tree gives a halted node: "policy interception is the thing worth seeing." */
  POLICY_HALT: { mark: "⏸", className: "text-primary-hover" },
  CACHE_HIT: { mark: "≡", className: "text-ink-muted" },
  BUDGET_EXCEEDED: { mark: "!", className: "text-danger" },
};

function title(event: RunEvent): string {
  const detail = event.detail;
  switch (event.type) {
    case "ESCALATION":
      return `Escalated ${tier(detail.from)} → ${tier(detail.to)}`;
    case "JURY":
      return `Jury: ${detail.quorum ?? "?"} of ${detail.of ?? "?"} agree`;
    case "TRUNCATION":
      return `Truncated ${detail.tool ?? "a tool result"}`;
    case "HANDOFF":
      return "Context handoff — restarted from the state card";
    case "CHECKPOINT":
      return `Checkpoint written at step ${detail.step ?? "?"}`;
    case "POLICY_HALT":
      return `Halted by policy ${detail.policyId ?? ""}`.trim();
    default:
      return humanise(event.type);
  }
}

function summary(event: RunEvent): string {
  const detail = event.detail;
  switch (event.type) {
    case "ESCALATION":
      return [
        typeof detail.confidence === "number" ? `confidence ${detail.confidence}` : null,
        typeof detail.threshold === "number" ? `below the ${detail.threshold} threshold` : null,
        detail.node ? `node ${detail.node}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "JURY": {
      const votes = detail.votes ?? [];
      const agreed = votes.filter((vote) => vote.agrees).map((vote) => vote.model);
      const dissented = votes.filter((vote) => !vote.agrees);
      const parts = [agreed.length > 0 ? `${agreed.join(" and ")} agree` : null];
      for (const vote of dissented) {
        parts.push(`${vote.model} dissented${vote.dissent ? `: ${vote.dissent}` : ""}`);
      }
      return parts.filter(Boolean).join(" · ");
    }
    case "TRUNCATION":
      return [
        typeof detail.storedTokens === "number" ? `${detail.storedTokens} tokens stored` : null,
        detail.fetchMoreAvailable ? "the rest is fetchable on demand" : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "HANDOFF":
      return [
        typeof detail.atContextPct === "number"
          ? `at ${Math.round(detail.atContextPct * 100)}% of context`
          : null,
        detail.restartedNodes?.length ? `restarted ${detail.restartedNodes.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "CHECKPOINT":
      return detail.replayable ? "replayable — a retry resumes from here" : "not replayable";
    case "POLICY_HALT":
      return detail.approvalRequestRef
        ? `approval ${detail.approvalRequestRef} was raised instead`
        : "the action was not performed";
    default:
      return "";
  }
}

function tier(value: unknown): string {
  return typeof value === "string" ? value.replace(/_(\d)$/, "-$1").replace(/_/g, " ") : "—";
}

export interface RunEventRowProps {
  event: RunEvent;
  className?: string;
}

export function RunEventRow({ event, className }: RunEventRowProps) {
  const glyph = GLYPH[event.type];
  const detailLine = summary(event);

  return (
    <li
      className={cn(
        "flex items-start gap-2.5 border-t border-divider px-4 py-2.5",
        event.type === "POLICY_HALT" || event.type === "JURY" ? "bg-ai-tint" : null,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("w-3.5 shrink-0 text-center font-mono text-[13px]", glyph.className)}
      >
        {glyph.mark}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-ink">{title(event)}</span>
        {detailLine ? (
          <span className="block pt-0.5 text-[12px] leading-relaxed text-ink-muted">
            {detailLine}
          </span>
        ) : null}
      </span>

      {event.at ? (
        <DateText
          value={event.at}
          withTime
          className="shrink-0 font-mono text-[11px] text-ink-muted"
        />
      ) : null}
    </li>
  );
}
