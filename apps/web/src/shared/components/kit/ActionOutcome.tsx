import type { ReactNode } from "react";
import type { ActionResponse } from "@trainos/contract";
import { ApprovalBanner } from "./ApprovalBanner";
import { ExceptionBanner } from "./ExceptionBanner";
import { GhostButton } from "./Button";
import { humanise } from "./format";
import type { ActionError } from "./adapters";

/**
 * What `POST /v1/actions` answered, rendered.
 *
 * Contract §3 gives a governed write three documented outcomes, and they are
 * not three shades of "it worked":
 *
 *   EXECUTED            it happened, and `effects[]` says what changed
 *   QUEUED_FOR_APPROVAL it has NOT happened; a policy intercepted it
 *   SUGGESTED           it was not even attempted; an agent handed over a draft
 *
 * A queued action is a SUCCESS. Rendering it as a failure is how an approval
 * queue becomes invisible and how people learn to read the policy gate as a
 * bug. It gets the approval banner, amber, with the approver named — the same
 * component the approvals screen uses, so the thing a user sees here and the
 * thing they find in the queue are recognisably one object.
 *
 * The refusal path is the fourth surface. A domain refusal that names its
 * blockers — `ENGAGEMENT_CLOSE_OUT` while the claim checklist is incomplete —
 * renders those blockers as themselves. A generic "could not close out" throws
 * away the only part of the answer the reader can act on.
 *
 * This component takes DESCRIBED data, not a thrown value, and deliberately
 * imports nothing from the API layer. The kit is presentation: a component that
 * reaches into the data layer to unwrap an error cannot be rendered in a test,
 * a showcase, or any app that fetches differently. `describeActionError` below
 * does the unwrapping defensively, and a caller with a better sentence — its
 * own `readableMessage`, say — passes that instead.
 */

export interface ActionOutcomeProps {
  /** The response, once one has arrived. */
  response?: ActionResponse;
  /** A described failure. Pass `describeActionError(thrown)` if you have no better. */
  error?: ActionError;
  /**
   * What was asked for, e.g. "Collections reminder · INV-2026-0288".
   *
   * Required, because a `QUEUED_FOR_APPROVAL` response carries only the compact
   * `ApprovalRequestRef` — no subject — and an approval banner that cannot say
   * what is being approved is worse than no banner.
   */
  subject: string;
  /** Renders a Dismiss affordance on every branch. */
  onDismiss?: () => void;
  className?: string;
}

export function ActionOutcome({
  response,
  error,
  subject,
  onDismiss,
  className,
}: ActionOutcomeProps) {
  const dismiss: ReactNode = onDismiss ? (
    <GhostButton onClick={onDismiss}>Dismiss</GhostButton>
  ) : undefined;

  if (error) {
    const blockers = error.blockers ?? [];
    return (
      <ExceptionBanner
        severity="DANGER"
        title={error.message}
        subtitle={
          blockers.length > 0
            ? `Blocked by ${blockers.length}: ${blockers.map(humanise).join(" · ")}`
            : error.code
        }
        action={dismiss}
        className={className}
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
        actions={dismiss}
        className={className}
      />
    );
  }

  if (response.status === "SUGGESTED") {
    return (
      <ExceptionBanner
        severity="INFO"
        title="Returned as a draft, not executed"
        subtitle={response.draft.body}
        action={dismiss}
        className={className}
      />
    );
  }

  /* EXECUTED. The effects are the receipt: §7 requires them to match the diff
     the user approved, so listing them is what lets a reader check that. */
  return (
    <ExceptionBanner
      severity="INFO"
      title={`${subject} · done`}
      subtitle={response.result.effects.map((effect) => effect.description).join(" · ")}
      action={dismiss}
      className={className}
    />
  );
}
