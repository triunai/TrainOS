/**
 * `SEND_EMAIL` — the one job type migration 012 actually maps today.
 *
 * `app.job_type_map` routes PROPOSAL_SEND, FOLLOWUP_SEND, REMINDER_SEND,
 * BROADCAST_SEND, ENGAGEMENT_CLOSE_OUT and TRAINER_BOOK here, so this handler
 * is the busiest path in the worker and the one whose retry classification
 * matters most.
 *
 * Idempotency comes from the row, not from this file: 012 puts
 * `<idempotency_subject>#<submission_attempt>` on the job precisely so a
 * replay presents the *same* key to the provider and the provider de-duplicates
 * rather than sending twice. It is passed through as the provider's own
 * idempotency header.
 */

import type { JobContext, JobError, JobOutcome } from "../jobs/types";

export interface EmailMessage {
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  from: string;
  replyTo?: string;
  idempotencyKey?: string;
}

export interface EmailSendResult {
  providerMessageId: string;
}

/** The port. A provider is a detail; the retry classification is not. */
export interface EmailSender {
  send(message: EmailMessage, signal: AbortSignal): Promise<EmailSendResult>;
}

export interface SendEmailOptions {
  sender: EmailSender | null;
  defaultFrom: string | null;
}

export function createSendEmailHandler(opts: SendEmailOptions) {
  return async function sendEmail(ctx: JobContext): Promise<JobOutcome> {
    if (!opts.sender) {
      return notConfigured(
        "EMAIL_PROVIDER_NOT_CONFIGURED",
        "no email provider is configured (RESEND_API_KEY unset)",
      );
    }
    const message = readMessage(ctx, opts.defaultFrom);
    if ("error" in message) return { status: "FAILED", error: message.error };

    try {
      const sent = await opts.sender.send(message.value, ctx.signal);
      return {
        status: "SUCCEEDED",
        result: {
          channel: "EMAIL",
          providerMessageId: sent.providerMessageId,
          to: message.value.to,
        },
        event: {
          type: "EmailSent",
          aggregateType: "OUTBOX",
          aggregateId: ctx.job.id,
          summary: `Email sent to ${message.value.to.length} recipient(s)`,
          payload: { providerMessageId: sent.providerMessageId },
        },
      };
    } catch (cause) {
      return { status: "FAILED", error: classify(cause) };
    }
  };
}

function readMessage(
  ctx: JobContext,
  defaultFrom: string | null,
): { value: EmailMessage } | { error: JobError } {
  const payload = ctx.job.payload as Record<string, unknown>;
  const to = toRecipients(payload.to);
  const subject = typeof payload.subject === "string" ? payload.subject : null;
  const from = typeof payload.from === "string" ? payload.from : defaultFrom;
  const missing = [
    to.length === 0 ? "to" : null,
    subject === null ? "subject" : null,
    from === null ? "from" : null,
  ].filter((entry): entry is string => entry !== null);

  if (missing.length > 0) {
    // A malformed payload does not improve by waiting, so it dies now rather
    // than burning five attempts on its way to the same place.
    return {
      error: {
        code: "INVALID_EMAIL_PAYLOAD",
        message: `SEND_EMAIL payload is missing: ${missing.join(", ")}`,
        retryable: false,
      },
    };
  }

  return {
    value: {
      to,
      subject: subject as string,
      from: from as string,
      ...(typeof payload.html === "string" ? { html: payload.html } : {}),
      ...(typeof payload.text === "string" ? { text: payload.text } : {}),
      ...(typeof payload.replyTo === "string" ? { replyTo: payload.replyTo } : {}),
      ...(providerIdempotencyKey(ctx)
        ? { idempotencyKey: providerIdempotencyKey(ctx) as string }
        : {}),
    },
  };
}

/**
 * 012 M-20: the key is `<subject>#<attempt>` and is never derived from the row
 * id, because a replay is a new row with a new id that must present the key the
 * first attempt used.
 */
export function providerIdempotencyKey(ctx: JobContext): string | null {
  const { idempotency_subject: subject, submission_attempt: attempt } = ctx.job;
  if (!subject || attempt === null) return null;
  return `${subject}#${attempt}`;
}

function toRecipients(raw: unknown): string[] {
  if (typeof raw === "string" && raw.trim() !== "") return [raw.trim()];
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  }
  return [];
}

/**
 * Showroom's rule, carried over: HTTP 429 and 5xx are transient and 4xx is
 * the caller's fault. Getting this backwards is how a permanent rejection
 * burns five attempts, and how a rate limit dead-letters a real send.
 */
export function classify(cause: unknown): JobError {
  const status =
    typeof cause === "object" && cause !== null
      ? Number((cause as { status?: unknown }).status)
      : NaN;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (Number.isFinite(status)) {
    const retryable = status === 429 || status >= 500;
    return { code: `EMAIL_HTTP_${status}`, message, retryable };
  }
  // A transport error — DNS, reset, timeout — is always worth another attempt.
  return { code: "EMAIL_TRANSPORT_ERROR", message, retryable: true };
}

function notConfigured(code: string, message: string): JobOutcome {
  return { status: "FAILED", error: { code, message, retryable: false } };
}

/** Resend over `fetch`. No SDK: one POST does not earn a dependency. */
export function createResendSender(opts: {
  apiKey: string;
  endpoint: string;
  fetchImpl?: typeof fetch;
}): EmailSender {
  const call = opts.fetchImpl ?? fetch;
  return {
    async send(message, signal) {
      const response = await call(opts.endpoint, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
          ...(message.idempotencyKey ? { "idempotency-key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          subject: message.subject,
          ...(message.html ? { html: message.html } : {}),
          ...(message.text ? { text: message.text } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw Object.assign(
          new Error(`email provider returned ${response.status}: ${body.slice(0, 500)}`),
          {
            status: response.status,
          },
        );
      }
      const json = (await response.json().catch(() => ({}))) as { id?: string };
      return { providerMessageId: json.id ?? "unknown" };
    },
  };
}
