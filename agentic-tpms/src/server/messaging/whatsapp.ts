import { DomainError } from "@/server/domain/errors";
import { env } from "@/server/env";
import { graphRequest } from "./graph";
import { logOutboundMessage } from "./log";

/**
 * WhatsApp Cloud API adapter. With WHATSAPP_ACCESS_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID set the message is sent; otherwise it is LOGGED,
 * so every flow that "sends a WhatsApp" runs end to end without credentials.
 *
 * Free-form text is only deliverable inside WhatsApp's 24-hour customer
 * service window (the lead messaged us, or a Click-to-WhatsApp ad opened the
 * thread). Outside it Meta requires a pre-approved template; the provider
 * rejects the send and it is recorded as FAILED with Meta's reason.
 */
export interface SendWhatsAppInput {
  /** E.164 with the leading +, e.g. +60123456789. */
  toE164: string;
  body: string;
  leadId?: string;
  packageId?: string;
  kind: string;
}

export interface SendWhatsAppResult {
  status: "SENT" | "LOGGED";
  id: string;
  providerMessageId: string | null;
}

const E164 = /^\+[1-9]\d{7,14}$/;
/** Cloud API hard limit for a text body. */
const MAX_BODY = 4096;

interface CloudApiSendResponse {
  messages?: Array<{ id?: string }>;
}

export async function sendWhatsAppText(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  if (!E164.test(input.toE164)) {
    throw new DomainError("WHATSAPP_INVALID_RECIPIENT", `Not an E.164 number: ${input.toE164 || "(empty)"}`);
  }
  const body = input.body.trim();
  if (!body) throw new DomainError("WHATSAPP_EMPTY_BODY", "A WhatsApp message needs a body");
  if (body.length > MAX_BODY) throw new DomainError("WHATSAPP_BODY_TOO_LONG", `WhatsApp text is capped at ${MAX_BODY} characters`);

  const base = {
    channel: "WHATSAPP" as const,
    kind: input.kind,
    toAddress: input.toE164,
    subject: null,
    body,
    leadId: input.leadId ?? null,
    packageId: input.packageId ?? null,
  };

  const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId } = env();
  if (!token || !phoneNumberId) {
    const id = await logOutboundMessage({ ...base, status: "LOGGED" });
    return { status: "LOGGED", id, providerMessageId: null };
  }

  try {
    const response = await graphRequest<CloudApiSendResponse>(`${phoneNumberId}/messages`, {
      method: "POST",
      token,
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.toE164.slice(1),
        type: "text",
        text: { preview_url: false, body },
      },
    });
    const providerMessageId = response?.messages?.[0]?.id ?? null;
    if (!providerMessageId) throw new Error("Cloud API accepted the request but returned no message id");
    const id = await logOutboundMessage({ ...base, status: "SENT", providerMessageId });
    return { status: "SENT", id, providerMessageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOutboundMessage({ ...base, status: "FAILED", error: message });
    throw new Error(`WhatsApp send failed: ${message}`);
  }
}
