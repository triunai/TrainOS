import type { ActionResponse } from "@trainos/contract";
import { ApprovalBanner, ExceptionBanner, GhostButton, humanise } from "@/shared/components/kit";
import { readableMessage, type ApiError } from "@/shared/api";
import { blockersOf } from "./api";

/**
 * What the §3 envelope looks like on screen.
 *
 * A governed write has three documented outcomes and a caller must handle all
 * three — `QUEUED_FOR_APPROVAL` is a SUCCESS, not an error, and rendering it as
 * a failure is how an approval queue becomes invisible. `SUGGESTED` is the
 * agent-autonomy case: the action was not taken, a draft was returned.
 *
 * The refusal path is the fourth surface and the one M09-S02 exists to show:
 * `ENGAGEMENT_CLOSE_OUT` refuses while the claim checklist is incomplete and
 * names every blocker in `details.blockers[]`. Those blockers are rendered as
 * themselves. A generic "could not close out" throws away the only part of the
 * answer the reader can act on.
 */

export interface ActionOutcomeProps {
  response?: ActionResponse;
  error?: ApiError;
  /** What was attempted, for the queued banner's subject line. */
  subject: string;
  onDismiss?: () => void;
}

export function ActionOutcome({ response, error, subject, onDismiss }: ActionOutcomeProps) {
  if (error) {
    const blockers = blockersOf(error);
    return (
      <ExceptionBanner
        severity="DANGER"
        title={readableMessage(error)}
        subtitle={
          blockers.length > 0
            ? `Blocked by ${blockers.length}: ${blockers.map(humanise).join(" · ")}`
            : error.kind === "domain"
              ? error.code
              : undefined
        }
        {...(onDismiss ? { action: <GhostButton onClick={onDismiss}>Dismiss</GhostButton> } : {})}
      />
    );
  }

  if (!response) return null;

  if (response.status === "QUEUED_FOR_APPROVAL") {
    const queued = response.approvalRequest;
    return (
      <ApprovalBanner
        approval={{
          subject,
          slaDueAt: queued.slaDueAt,
          slaBreached: false,
          status: "PENDING",
        }}
        approverRole={queued.approverRole}
        {...(queued.assignedTo?.name ? { approverName: queued.assignedTo.name } : {})}
        {...(onDismiss ? { actions: <GhostButton onClick={onDismiss}>Dismiss</GhostButton> } : {})}
      />
    );
  }

  if (response.status === "SUGGESTED") {
    return (
      <ExceptionBanner
        severity="INFO"
        title="Returned as a draft, not executed"
        subtitle={response.draft.body}
        {...(onDismiss ? { action: <GhostButton onClick={onDismiss}>Dismiss</GhostButton> } : {})}
      />
    );
  }

  return (
    <ExceptionBanner
      severity="INFO"
      title={`${subject} · done`}
      subtitle={response.result.effects.map((effect) => effect.description).join(" · ")}
      {...(onDismiss ? { action: <GhostButton onClick={onDismiss}>Dismiss</GhostButton> } : {})}
    />
  );
}
