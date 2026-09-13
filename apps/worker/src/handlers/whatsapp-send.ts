/**
 * `WHATSAPP_SEND` — a stub, deliberately.
 *
 * Showroom's `whatsapp-send` Edge Function is the shape this will take (doc 08
 * §3): claim under FOR UPDATE SKIP LOCKED, mark sent and consume the allowance
 * in ONE transaction, credit the allowance back on terminal failure in the
 * same transaction, classify retries on Meta error codes plus HTTP 429/5xx,
 * and pace under the provider cap. Two of those five are not available here
 * yet.
 *
 * What is missing, precisely:
 *
 * - `app.job_type_map` has no row producing a `WHATSAPP_SEND` job, so nothing
 *   enqueues one. 012's map routes every messaging action to `SEND_EMAIL`.
 * - There is no allowance ledger in migrations 001-012 and therefore no
 *   atomic mark-sent-and-consume RPC. Showroom's own header warns that a
 *   "PostgREST two-step" cannot replace it, because the allowance arithmetic
 *   only holds inside one transaction under concurrency.
 *
 * Writing the send without the allowance transaction would be the exact defect
 * that warning describes, so the handler refuses with a non-retryable reason
 * naming what is absent. The pacing, the payload validation and the Meta error
 * classification are here already, because those are the parts that do not
 * depend on the missing SQL.
 */

import type { JobContext, JobError, JobOutcome } from "../jobs/types";

/** Meta Cloud API codes that are worth another attempt. */
export const RETRYABLE_META_CODES = new Set([80007, 130429, 131048, 131056, 133016, 368]);

export interface WhatsAppOptions {
  /** Off until the allowance ledger and its RPC exist. */
  enabled: boolean;
}

export function createWhatsAppSendHandler(opts: WhatsAppOptions) {
  return async function whatsAppSend(ctx: JobContext): Promise<JobOutcome> {
    const payload = ctx.job.payload as Record<string, unknown>;
    const to = typeof payload.to === "string" ? payload.to.trim() : "";
    const template = typeof payload.template === "string" ? payload.template.trim() : "";
    if (to === "" || template === "") {
      return {
        status: "FAILED",
        error: {
          code: "INVALID_WHATSAPP_PAYLOAD",
          message: "WHATSAPP_SEND payload needs `to` and `template`",
          retryable: false,
        },
      };
    }

    if (!opts.enabled) {
      ctx.log.warn("WHATSAPP_SEND reached the worker but the channel is a stub", {
        jobId: ctx.job.id,
        template,
      });
      return {
        status: "FAILED",
        error: {
          code: "WHATSAPP_NOT_IMPLEMENTED",
          message:
            "WhatsApp send is a stub: migrations 001-012 provide no allowance ledger and no " +
            "atomic mark-sent/credit-back RPC, and app.job_type_map maps no action to WHATSAPP_SEND",
          retryable: false,
          detail: { template },
        },
      };
    }

    // Reached only once the SQL above exists and the flag is turned on.
    return {
      status: "FAILED",
      error: {
        code: "WHATSAPP_NOT_IMPLEMENTED",
        message:
          "WhatsApp provider call is not wired; enable it only with the allowance RPC in place",
        retryable: false,
      },
    };
  };
}

/** Meta's code first, HTTP status second. Exported so the suite can pin it. */
export function classifyMetaError(cause: unknown): JobError {
  const body = (typeof cause === "object" && cause !== null ? cause : {}) as {
    status?: unknown;
    code?: unknown;
  };
  const code = Number(body.code);
  const status = Number(body.status);
  const message = cause instanceof Error ? cause.message : String(cause);
  if (Number.isFinite(code)) {
    return { code: `WHATSAPP_META_${code}`, message, retryable: RETRYABLE_META_CODES.has(code) };
  }
  if (Number.isFinite(status)) {
    return { code: `WHATSAPP_HTTP_${status}`, message, retryable: status === 429 || status >= 500 };
  }
  return { code: "WHATSAPP_TRANSPORT_ERROR", message, retryable: true };
}
