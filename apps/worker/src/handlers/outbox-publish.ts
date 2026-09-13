/**
 * `OUTBOX_PUBLISH` — turn a queued row into a durable domain event.
 *
 * This is the transactional-outbox half of 012 and it needs no outbound call
 * at all: `app.complete_job` takes a `p_event` and emits it through
 * `app.emit_event` *inside the same transaction* as the state change. So the
 * handler's whole job is to produce a well-formed event and let the seam
 * write it. An event published by a second statement after the completion
 * could be lost between the two; one published by `complete_job` cannot.
 *
 * 012 requires `type`, `aggregateType`, `aggregateId` and `summary`, and
 * refuses the call without all four, so the handler validates them here where
 * the error can name the payload rather than at the seam where it cannot.
 * Correlation and causation are not passed: `complete_job` takes them from the
 * job row itself, which is the only place they are certainly right.
 */

import type { JobContext, JobEvent, JobOutcome } from "../jobs/types";

export function createOutboxPublishHandler() {
  return async function outboxPublish(ctx: JobContext): Promise<JobOutcome> {
    const payload = ctx.job.payload as { event?: unknown };
    const event = readEvent(payload.event, ctx.job.id);
    if (!event) {
      return {
        status: "FAILED",
        error: {
          code: "INVALID_OUTBOX_EVENT",
          message:
            "OUTBOX_PUBLISH payload.event needs type, aggregateType, aggregateId and summary",
          retryable: false,
        },
      };
    }
    return {
      status: "SUCCEEDED",
      result: { published: true, eventType: event.type },
      event,
    };
  };
}

export function readEvent(raw: unknown, jobId: string): JobEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const type = str(candidate.type);
  const aggregateType = str(candidate.aggregateType);
  const summary = str(candidate.summary);
  // The aggregate defaults to the job itself: an event that only records that
  // this row was published still has a subject, and the audit drawer indexes
  // on it.
  const aggregateId = str(candidate.aggregateId) ?? jobId;
  if (!type || !aggregateType || !summary) return null;
  return {
    type,
    aggregateType,
    aggregateId,
    summary,
    ...(str(candidate.aggregateRef) ? { aggregateRef: str(candidate.aggregateRef) as string } : {}),
    ...(isObject(candidate.payload) ? { payload: candidate.payload } : {}),
    ...(isObject(candidate.actor) ? { actor: candidate.actor } : {}),
    ...(Array.isArray(candidate.related) ? { related: candidate.related } : {}),
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
