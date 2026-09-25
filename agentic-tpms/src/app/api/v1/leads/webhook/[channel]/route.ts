import { handleLeadWebhookGet, handleLeadWebhookPost } from "@/server/ingestion/http";

/**
 * Lead webhooks: /api/v1/leads/webhook/{meta|google|linkedin|web}.
 * GET is Meta's subscription handshake; POST ingests. Thin by design — the
 * handlers in src/server/ingestion/http.ts own verification and parsing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { channel: string } }): Promise<Response> {
  return handleLeadWebhookGet(params.channel, request);
}

export async function POST(request: Request, { params }: { params: { channel: string } }): Promise<Response> {
  return handleLeadWebhookPost(params.channel, request);
}
