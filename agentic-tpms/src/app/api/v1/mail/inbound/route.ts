import { handleInboundMail } from "@/server/ingestion/http";

/**
 * Inbound-parse webhook for the virtual forwarding mailbox (inbox-leads@)
 * and the smart-BCC address (sync@). Authenticated by x-tpms-mail-secret
 * when INBOUND_MAIL_SECRET is set.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleInboundMail(request);
}
