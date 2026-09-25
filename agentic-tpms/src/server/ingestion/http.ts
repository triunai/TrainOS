import { createHmac } from "node:crypto";
import { DomainError, isDomainError } from "@/server/domain/errors";
import { safeEqual } from "@/server/lib/crypto";
import { isStopReply, suppressAddress } from "@/server/outbound/suppression";
import { intakeConfig } from "./config";
import { type IngestResult, ingestLead, ingestWebhook } from "./ingest";
import { handleWhatsAppReply } from "./microTna";
import { detectMailMode, parseAddressList, splitWhatsAppWebhook, whatsAppText } from "./normalise";
import type { LeadChannel } from "./types";

/**
 * Plain request handlers behind the webhook routes. Each takes a standard
 * `Request` and returns a `Response`, so a test drives exactly what Next.js
 * would, without a server.
 *
 * Authentication, per channel, whenever its secret is configured:
 *   meta, whatsapp  X-Hub-Signature-256 = HMAC-SHA256(raw body, META_APP_SECRET)
 *   google          body.google_key = GOOGLE_WEBHOOK_KEY
 *   linkedin, web   header x-tpms-webhook-secret = LEAD_WEBHOOK_SECRET
 *   mail            header x-tpms-mail-secret = INBOUND_MAIL_SECRET
 * A failed check is a 401 before anything is stored. With no secret
 * configured the payload is accepted and recorded as unverified — set the
 * secrets in production.
 *
 * A stored-but-unusable payload still returns 200 to Meta/Google/WhatsApp:
 * their retry would deliver the same bytes and fail the same way. Anything
 * unexpected is a 500, which is exactly when a platform retry can help.
 */
export const LEAD_WEBHOOK_CHANNELS: Readonly<Record<string, LeadChannel>> = {
  meta: "META_LEADGEN",
  google: "GOOGLE_WEBHOOK",
  linkedin: "LINKEDIN_SYNC",
  web: "WEB_FORM",
};

const MAX_BODY_BYTES = 1_000_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function verifyMetaSignature(rawBody: Uint8Array, header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(header.slice("sha256=".length).trim().toLowerCase(), expected);
}

async function readBody(request: Request): Promise<Uint8Array | Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);
  return bytes;
}

/** JSON, or an HTML form post (urlencoded / multipart) flattened to an object. */
async function parseBody(bytes: Uint8Array, contentType: string | null): Promise<unknown> {
  const text = new TextDecoder().decode(bytes);
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  if (type.includes("multipart/form-data")) {
    const form = await new Response(bytes, { headers: { "content-type": contentType ?? "" } }).formData();
    const out: Record<string, string> = {};
    form.forEach((value, key) => {
      if (typeof value === "string") out[key] = value;
    });
    return out;
  }
  return JSON.parse(text) as unknown;
}

function summarise(results: IngestResult[]) {
  return {
    leadIds: results.map((r) => r.leadId).filter((id): id is string => !!id),
    results: results.map((r) => ({
      status: r.status,
      reason: r.reason,
      leadId: r.leadId,
      ...(r.status === "DUPLICATE" ? { duplicateOf: r.duplicateOf } : {}),
      ...(r.status === "REJECTED" ? { code: r.code, message: r.message } : {}),
    })),
  };
}

function failure(error: unknown, where: string): Response {
  if (isDomainError(error)) return json({ ok: false, code: error.code, message: error.message }, 422);
  // Never log a payload: it is personal data. The message is enough to debug.
  console.error(`[ingestion] ${where} failed: ${error instanceof Error ? error.message : String(error)}`);
  return json({ ok: false, code: "INTERNAL_ERROR" }, 500);
}

/** Meta/WhatsApp subscription handshake: echo hub.challenge when hub.verify_token matches. */
function verifyHandshake(request: Request, token: string | undefined): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const given = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (!token || mode !== "subscribe" || !safeEqual(given, token)) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

// ---------------------------------------------------------------- /api/v1/leads/webhook/[channel]

export async function handleLeadWebhookGet(slug: string, request: Request): Promise<Response> {
  if (slug !== "meta") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  return verifyHandshake(request, intakeConfig.metaVerifyToken());
}

export async function handleLeadWebhookPost(slug: string, request: Request): Promise<Response> {
  const channel = LEAD_WEBHOOK_CHANNELS[slug];
  if (!channel) return json({ ok: false, code: "UNKNOWN_CHANNEL", message: `Unknown lead channel "${slug}"` }, 404);
  try {
    const bytes = await readBody(request);
    if (bytes instanceof Response) return bytes;

    let verified = false;
    if (channel === "META_LEADGEN") {
      const secret = intakeConfig.metaAppSecret();
      if (secret) {
        if (!verifyMetaSignature(bytes, request.headers.get("x-hub-signature-256"), secret)) {
          return json({ ok: false, code: "INVALID_SIGNATURE" }, 401);
        }
        verified = true;
      }
    } else if (channel === "LINKEDIN_SYNC" || channel === "WEB_FORM") {
      const secret = intakeConfig.leadWebhookSecret();
      if (secret) {
        if (!safeEqual(request.headers.get("x-tpms-webhook-secret") ?? "", secret)) return json({ ok: false, code: "INVALID_SECRET" }, 401);
        verified = true;
      }
    }

    let body: unknown;
    try {
      body = await parseBody(bytes, request.headers.get("content-type"));
    } catch {
      return json({ ok: false, code: "INVALID_JSON" }, 400);
    }

    if (channel === "GOOGLE_WEBHOOK") {
      const key = intakeConfig.googleWebhookKey();
      if (key) {
        const given = (body as { google_key?: unknown } | null)?.google_key;
        if (typeof given !== "string" || !safeEqual(given, key)) return json({ ok: false, code: "INVALID_GOOGLE_KEY" }, 401);
        verified = true;
      }
    }

    const results = await ingestWebhook(channel, body, { verified });
    // Our own web form can show the visitor an error; the ad platforms cannot.
    if (channel === "WEB_FORM" && results.length > 0 && results.every((r) => r.status === "REJECTED")) {
      return json({ ok: false, ...summarise(results) }, 422);
    }
    return json({ ok: true, ...summarise(results) });
  } catch (error) {
    return failure(error, `lead webhook ${slug}`);
  }
}

// ---------------------------------------------------------------- /api/v1/whatsapp/webhook

export async function handleWhatsAppWebhookGet(request: Request): Promise<Response> {
  return verifyHandshake(request, intakeConfig.whatsappVerifyToken());
}

export async function handleWhatsAppWebhookPost(request: Request): Promise<Response> {
  try {
    const bytes = await readBody(request);
    if (bytes instanceof Response) return bytes;
    const secret = intakeConfig.metaAppSecret();
    if (secret && !verifyMetaSignature(bytes, request.headers.get("x-hub-signature-256"), secret)) {
      return json({ ok: false, code: "INVALID_SIGNATURE" }, 401);
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      return json({ ok: false, code: "INVALID_JSON" }, 400);
    }

    const handled: Array<Record<string, unknown>> = [];
    for (const item of splitWhatsAppWebhook(body)) {
      const from = typeof item.message.from === "string" ? `+${item.message.from.replace(/^\+/, "")}` : "";
      const messageId = typeof item.message.id === "string" ? item.message.id : undefined;
      const reply = from ? await handleWhatsAppReply(from, whatsAppText(item.message), { messageId }) : null;
      if (reply) {
        handled.push({ kind: "TNA_REPLY", leadId: reply.leadId, status: reply.status, answer: reply.answer, replayed: reply.replayed ?? false });
        continue;
      }
      const result = await ingestLead("WHATSAPP_INBOUND", item, { verified: !!secret });
      handled.push({ kind: "LEAD", ...summarise([result]).results[0] });
    }
    // Delivery/read status callbacks carry no messages; they are acknowledged and dropped.
    return json({ ok: true, handled });
  } catch (error) {
    return failure(error, "whatsapp webhook");
  }
}

// ---------------------------------------------------------------- /api/v1/mail/inbound

export const MAIL_SYSTEM_ACTOR = { type: "SYSTEM" as const, id: "sys_inbound_mail" };

export async function handleInboundMail(request: Request): Promise<Response> {
  try {
    const secret = intakeConfig.inboundMailSecret();
    if (secret && !safeEqual(request.headers.get("x-tpms-mail-secret") ?? "", secret)) {
      return json({ ok: false, code: "INVALID_SECRET" }, 401);
    }
    const bytes = await readBody(request);
    if (bytes instanceof Response) return bytes;
    let payload: unknown;
    try {
      payload = await parseBody(bytes, request.headers.get("content-type"));
    } catch {
      return json({ ok: false, code: "INVALID_BODY" }, 400);
    }
    const mail = (payload ?? {}) as Record<string, unknown>;

    const mode = detectMailMode(mail);
    // A reply of "STOP" to an outbound email is an opt-out, not a lead. Smart-BCC
    // mail is written by our own staff, so it is never read as an opt-out.
    const stop = isStopReply(typeof mail.subject === "string" ? mail.subject : null, typeof mail.text === "string" ? mail.text : null);
    if (mode !== "SMART_BCC" && stop) {
      const sender = parseAddressList(mail.from)[0];
      if (sender) {
        const { created } = await suppressAddress(sender.email, "STOP_REPLY", "Inbound mail STOP reply", MAIL_SYSTEM_ACTOR);
        return json({ ok: true, kind: "OPT_OUT", created });
      }
    }

    if (!mode) {
      return json({ ok: false, code: "UNKNOWN_MAILBOX", message: "Not addressed to the lead inbox or the smart-BCC address" }, 422);
    }
    const result = await ingestLead(mode, mail, { verified: !!secret });
    // Stored but unusable: 200, because a provider retry would resend the same message.
    return json({ ok: result.status !== "REJECTED", mode, ...summarise([result]) });
  } catch (error) {
    if (error instanceof DomainError) return json({ ok: false, code: error.code, message: error.message }, 422);
    return failure(error, "inbound mail");
  }
}
