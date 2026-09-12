import type { ActionResponse } from "@trainos/contract";
import { AI_GLYPH, ApprovalBanner, ExceptionBanner, StatusChip } from "@/shared/components/kit";

/**
 * The three outcomes of `POST /v1/actions`, rendered.
 *
 * TEMPORARY SHAPE — this belongs in the kit as `ActionOutcome`; it is requested
 * of the `kit` agent and duplicated per feature only because a feature may not
 * write outside its own folder. Delete this file and import the kit component
 * the moment it exists. The composition below uses nothing but kit pieces, so
 * the swap is an import change.
 *
 * R2: an approval is a SUCCESS, not an error. The queued branch must never read
 * as a failure, or people learn to treat the gate as a bug.
 */

export type Outcome =
  { kind: "response"; response: ActionResponse } | { kind: "error"; message: string } | null;

export function ActionOutcome({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;

  if (outcome.kind === "error") {
    return (
      <ExceptionBanner
        severity="DANGER"
        title="That did not go through"
        subtitle={outcome.message}
      />
    );
  }

  const { response } = outcome;

  if (response.status === "EXECUTED") {
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-control border border-border bg-surface px-3.5 py-3"
      >
        <div className="flex items-center gap-2">
          <StatusChip tone="success" live>
            Done
          </StatusChip>
          <span className="text-[13px] font-medium text-ink">
            {`${response.result.effects.length} ${
              response.result.effects.length === 1 ? "change" : "changes"
            } recorded`}
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {response.result.effects.map((effect, index) => (
            <li key={`${effect.entity}-${index}`} className="text-[12px] text-ink-secondary">
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                {effect.op} {effect.entity}
              </span>{" "}
              — {effect.description}
              {effect.ref ? ` (${effect.ref})` : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (response.status === "QUEUED_FOR_APPROVAL") {
    const request = response.approvalRequest;
    return (
      <ApprovalBanner
        approval={{
          subject: `Queued as ${request.ref}`,
          slaDueAt: request.slaDueAt,
          slaBreached: false,
          status: "PENDING",
        }}
        approverRole={request.approverRole}
        approverName={request.assignedTo?.name}
      />
    );
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-control border border-primary-border bg-ai-tint px-3.5 py-3"
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold text-primary-hover">
        <span aria-hidden="true">{AI_GLYPH}</span>
        <span>Draft suggested — nothing has been sent</span>
      </div>
      <p className="max-w-[70ch] whitespace-pre-wrap text-[13px] leading-[1.6] text-ink">
        {response.draft.body}
      </p>
    </div>
  );
}
