import type { ActionRequest, ActionResponse } from "@trainos/contract";
import { extraCreatedRefs, summariseEffects, type ActionError } from "./adapters";
import { humanise } from "./format";

/**
 * The toast for one `POST /v1/actions` reply, composed with the SAME rules
 * `ActionOutcome`'s inline banner uses (`summariseEffects`, `extraCreatedRefs`)
 * — so a reader who glances at the toast and one who stays on the page to read
 * the banner are never told two different stories about the same write.
 *
 * Takes the response/error pair `ActionOutcome` already takes, not a new
 * "outcome" union, so a caller with one already has the other for free.
 */
export interface ActionToastMessage {
  variant: "success" | "info" | "error";
  title: string;
  description?: string;
}

export interface ActionToastInput {
  response?: ActionResponse;
  error?: ActionError;
}

/**
 * A plain-words label for what was asked, when no caller-supplied `subject`
 * is available. `useAction` has no subject by default — most call sites pass
 * one, the way they already do for `ActionOutcome` — so this is the fallback,
 * not the norm: `humanise("OPPORTUNITY_CONVERT")` reads as "Opportunity
 * convert", which is honest even when nobody wrote better copy for it.
 */
export function defaultActionSubject(request: Pick<ActionRequest, "type" | "targetRef">): string {
  return [humanise(request.type), request.targetRef].filter(Boolean).join(" · ");
}

export function describeActionToast(
  subject: string,
  outcome: ActionToastInput,
): ActionToastMessage {
  if (outcome.error) {
    const blockers = outcome.error.blockers ?? [];
    return {
      variant: "error",
      title: outcome.error.message,
      ...(blockers.length > 0
        ? { description: `Blocked by ${blockers.map(humanise).join(" · ")}` }
        : {}),
    };
  }

  const response = outcome.response;
  if (!response) {
    /* Nothing settled yet — the caller should not have reached for a toast
       message, but the composer stays defensive rather than throw mid-render. */
    return { variant: "info", title: subject };
  }

  if (response.status === "QUEUED_FOR_APPROVAL") {
    return {
      variant: "info",
      title: `${subject} · sent for approval`,
      description: `Approval ${response.approvalRequest.ref}`,
    };
  }

  if (response.status === "SUGGESTED") {
    return {
      variant: "info",
      title: `${subject} · saved as a suggestion`,
      description: response.draft.body,
    };
  }

  /* EXECUTED. */
  const { effects } = response.result;
  const extras = extraCreatedRefs(response.result)
    .filter((extra) => !effects.some((effect) => effect.ref === extra.ref))
    .map((extra) => `${humanise(extra.entity)} ${extra.ref}`);
  const description = [summariseEffects(effects), ...extras].filter(Boolean).join(" · ");

  return {
    variant: "success",
    title: subject,
    ...(description ? { description } : {}),
  };
}
