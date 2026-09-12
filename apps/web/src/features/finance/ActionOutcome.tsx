import type { ActionResponse } from "@trainos/contract";
import { ApprovalBanner, ExceptionBanner } from "@/shared/components/kit";
import { isDomainError, toApiError, type ApiError } from "@/shared/api";

/**
 * What `POST /v1/actions` answered, rendered.
 *
 * The three §3 outcomes are not variations on "it worked": a queued action has
 * NOT happened, and a suggestion has not even been requested. Each gets its own
 * surface, composed from kit banners rather than invented here.
 *
 * `ApprovalBanner` wants an `ApprovalRequest`, but a `QUEUED_FOR_APPROVAL`
 * response carries only the compact `ApprovalRequestRef` — no subject, no
 * status — so the screen supplies the subject it just asked for. Asked kit to
 * own this as one `ActionOutcomeBanner`; until then this is the composition.
 */

export interface ActionOutcomeProps {
  /** The response, once one has arrived. */
  response?: ActionResponse;
  /** Whatever the mutation threw. A domain refusal renders its own sentence. */
  error?: unknown;
  /** What was asked for, e.g. "Collections reminder · INV-2026-0288". */
  subject: string;
  /** Wording for the executed case, e.g. "Payment recorded". */
  executedTitle: string;
  executedSubtitle?: string;
  className?: string;
}

/** The blocker list a `VALIDATION_FAILED` carries, as one readable line. */
function blockersOf(error: ApiError): string | undefined {
  if (!isDomainError(error)) return undefined;
  const blockers = (error.details as { blockers?: unknown } | undefined)?.blockers;
  if (!Array.isArray(blockers) || blockers.length === 0) return undefined;
  return blockers.map((blocker) => String(blocker).replace(/_/g, " ").toLowerCase()).join(" · ");
}

export function ActionOutcome({
  response,
  error,
  subject,
  executedTitle,
  executedSubtitle,
  className,
}: ActionOutcomeProps) {
  if (error !== undefined && error !== null) {
    const apiError = toApiError(error);
    const blockers = blockersOf(apiError);
    return (
      <ExceptionBanner
        className={className}
        severity="DANGER"
        title={isDomainError(apiError) ? "Refused" : "Could not complete"}
        subtitle={blockers ? `${apiError.message} Outstanding: ${blockers}.` : apiError.message}
      />
    );
  }

  if (!response) return null;

  if (response.status === "QUEUED_FOR_APPROVAL") {
    const { approvalRequest } = response;
    return (
      <ApprovalBanner
        className={className}
        approval={{
          subject,
          slaDueAt: approvalRequest.slaDueAt,
          slaBreached: false,
          status: "PENDING",
        }}
        approverRole={approvalRequest.approverRole}
      />
    );
  }

  if (response.status === "SUGGESTED") {
    return (
      <ExceptionBanner
        className={className}
        severity="INFO"
        title="Returned as a draft"
        subtitle={`${subject} was not sent. ${response.draft.body}`}
      />
    );
  }

  return (
    <ExceptionBanner
      className={className}
      severity="INFO"
      title={executedTitle}
      subtitle={
        executedSubtitle ?? response.result.effects.map((effect) => effect.description).join(" · ")
      }
    />
  );
}
