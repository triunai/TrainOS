import { handleWhatsAppWebhookGet, handleWhatsAppWebhookPost } from "@/server/ingestion/http";

/**
 * WhatsApp Cloud API webhook. GET is the subscription handshake
 * (WHATSAPP_VERIFY_TOKEN); POST routes each inbound message to the micro-TNA
 * reply parser when the number has an open lead, else ingests a new lead.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleWhatsAppWebhookGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleWhatsAppWebhookPost(request);
}
