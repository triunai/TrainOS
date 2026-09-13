/**
 * Dispatch by job type.
 *
 * The registry is a plain map so "which types does this deployment serve" is
 * answerable by reading one object, and so `WORKER_JOB_TYPES` can be checked
 * against it at boot instead of discovering a typo when the queue silently
 * never drains.
 *
 * A type with no handler fails as **not retryable**. The alternative — a
 * retryable failure — spends five attempts and a day of backoff arriving at
 * the same dead letter, with the real reason buried under the retries.
 */

import { createLogger } from "../logging";
import {
  UNKNOWN_JOB_TYPE_ERROR_CODE,
  type JobContext,
  type JobHandler,
  type JobOutcome,
} from "../jobs/types";
import { createAgentRunSliceHandler, type AgentRunSliceOptions } from "./agent-run-slice";
import { createOutboxPublishHandler } from "./outbox-publish";
import { createResendSender, createSendEmailHandler, type EmailSender } from "./send-email";
import { createWhatsAppSendHandler } from "./whatsapp-send";

export const JOB_TYPES = {
  AGENT_RUN_SLICE: "AGENT_RUN_SLICE",
  SEND_EMAIL: "SEND_EMAIL",
  WHATSAPP_SEND: "WHATSAPP_SEND",
  OUTBOX_PUBLISH: "OUTBOX_PUBLISH",
} as const;

/**
 * Job types `app.job_type_map` produces today that this worker does not serve.
 *
 * Listed rather than left implicit: these rows WILL be enqueued by 011 the
 * moment the matching action runs, and a worker that claims every type would
 * dead-letter them. A deployment that sets `WORKER_JOB_TYPES` to the four
 * implemented types leaves them QUEUED instead, which is the honest state.
 */
export const UNIMPLEMENTED_012_JOB_TYPES = [
  "NOTIFY_OWNER",
  "PUSH_INVOICE",
  "HRDC_PACKET_ASSEMBLE",
  "COMPLIANCE_CHECK_EVALUATE",
  "USAGE_ROLLUP",
] as const;

export type HandlerRegistry = Readonly<Record<string, JobHandler>>;

export interface BuildHandlersOptions {
  sliceWallClockMs: number;
  email: { apiKey: string | null; from: string | null; endpoint: string };
  whatsapp: { enabled: boolean };
  agentRun?: Partial<AgentRunSliceOptions>;
  /** Injected by the suite so no network call is ever made. */
  emailSender?: EmailSender | null;
}

export function buildHandlers(opts: BuildHandlersOptions): HandlerRegistry {
  const sender =
    opts.emailSender !== undefined
      ? opts.emailSender
      : opts.email.apiKey
        ? createResendSender({ apiKey: opts.email.apiKey, endpoint: opts.email.endpoint })
        : null;

  return Object.freeze({
    [JOB_TYPES.AGENT_RUN_SLICE]: createAgentRunSliceHandler({
      sliceWallClockMs: opts.sliceWallClockMs,
      ...opts.agentRun,
    }),
    [JOB_TYPES.SEND_EMAIL]: createSendEmailHandler({ sender, defaultFrom: opts.email.from }),
    [JOB_TYPES.WHATSAPP_SEND]: createWhatsAppSendHandler({ enabled: opts.whatsapp.enabled }),
    [JOB_TYPES.OUTBOX_PUBLISH]: createOutboxPublishHandler(),
  });
}

/** Run one job through its handler, or report that there is no handler. */
export async function dispatch(registry: HandlerRegistry, ctx: JobContext): Promise<JobOutcome> {
  const handler = registry[ctx.job.job_type];
  if (!handler) {
    return {
      status: "FAILED",
      error: {
        code: UNKNOWN_JOB_TYPE_ERROR_CODE,
        message: `no handler for job type ${ctx.job.job_type}`,
        retryable: false,
        detail: { known: Object.keys(registry) },
      },
    };
  }
  return handler(ctx);
}

/** A logger for a deployment that did not supply one. Keeps `buildHandlers` pure. */
export const defaultHandlerLogger = createLogger({ bindings: { component: "handler" } });

export {
  createAgentRunSliceHandler,
  createOutboxPublishHandler,
  createSendEmailHandler,
  createWhatsAppSendHandler,
};
export type { EmailSender };
