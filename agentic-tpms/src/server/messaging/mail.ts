import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { DomainError } from "@/server/domain/errors";
import { env } from "@/server/env";
import { describeAttachments, logOutboundMessage } from "./log";

/**
 * The one mail adapter. Every lane sends email through `sendMail`, so there is
 * one place that decides whether mail really leaves (SMTP_URL set) or is only
 * recorded (LOGGED — the default until an operator configures SMTP), and one
 * log of everything that went out.
 *
 * A provider refusal is recorded as a FAILED row and rethrown: the caller is
 * usually a queued task, and a transient SMTP error is exactly the kind of
 * failure the queue's retry can fix.
 */
export interface MailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  packageId?: string;
  leadId?: string;
  /** UPPER_SNAKE_CASE category for the log, e.g. "QUOTATION", "OUTBOUND_COLD". */
  kind: string;
}

export interface SendMailResult {
  status: "SENT" | "LOGGED";
  /** The outbound_messages row id. */
  id: string;
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

let cachedTransport: { url: string; transport: Transporter } | undefined;

function transportFor(url: string): Transporter {
  if (!cachedTransport || cachedTransport.url !== url) {
    cachedTransport = { url, transport: nodemailer.createTransport(url) };
  }
  return cachedTransport.transport;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const to = input.to.trim();
  if (!EMAIL.test(to)) throw new DomainError("MAIL_INVALID_RECIPIENT", `Not a deliverable email address: ${to || "(empty)"}`);
  if (!input.subject.trim()) throw new DomainError("MAIL_SUBJECT_REQUIRED", "An email needs a subject");

  const attachments = describeAttachments(input.attachments);
  const base = {
    channel: "EMAIL" as const,
    kind: input.kind,
    toAddress: to,
    subject: input.subject,
    body: input.text,
    attachments,
    packageId: input.packageId ?? null,
    leadId: input.leadId ?? null,
  };

  const { SMTP_URL, MAIL_FROM } = env();
  if (!SMTP_URL) {
    const id = await logOutboundMessage({ ...base, status: "LOGGED" });
    return { status: "LOGGED", id };
  }
  if (!MAIL_FROM) {
    // A configuration fault, not a transient one: retrying cannot fix it.
    const error = "SMTP_URL is set but MAIL_FROM is not";
    await logOutboundMessage({ ...base, status: "FAILED", error });
    throw new DomainError("MAIL_NOT_CONFIGURED", error);
  }

  try {
    const info = await transportFor(SMTP_URL).sendMail({
      from: MAIL_FROM,
      to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        contentType: a.contentType,
      })),
    });
    const providerId = typeof info.messageId === "string" && info.messageId ? info.messageId : `smtp:${Date.now()}`;
    const id = await logOutboundMessage({ ...base, status: "SENT", providerMessageId: providerId });
    return { status: "SENT", id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOutboundMessage({ ...base, status: "FAILED", error: scrubUrl(message, SMTP_URL) });
    throw new Error(`SMTP send failed: ${scrubUrl(message, SMTP_URL)}`);
  }
}

/** An SMTP URL carries a password; an error message must never echo it. */
function scrubUrl(message: string, url: string): string {
  let out = message.split(url).join("[SMTP_URL]");
  try {
    const password = decodeURIComponent(new URL(url).password);
    if (password) out = out.split(password).join("[redacted]");
  } catch {
    // Not a parseable URL; the whole-string replacement above is all we can do.
  }
  return out;
}
