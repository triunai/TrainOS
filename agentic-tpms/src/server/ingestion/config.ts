import { env } from "@/server/env";
import { emailDomain, registrableDomain } from "./text";

/**
 * Intake settings that are not (yet) in the typed env schema. They are read
 * from process.env on every call — never cached — so a test or an operator
 * changing one takes effect without a restart. Each has a safe default:
 *
 *   META_PAGE_ACCESS_TOKEN  Graph token used to fetch Lead Ads field_data.
 *                           Unset: a leadgen notification without field_data
 *                           is recorded as a minimal lead for manual triage.
 *   GOOGLE_WEBHOOK_KEY      The key configured on the Google Ads lead form
 *                           webhook; unset: google_key is not checked.
 *   LEAD_WEBHOOK_SECRET     Shared secret for the LinkedIn-sync and web-form
 *                           webhooks (header x-tpms-webhook-secret).
 *   LEAD_INBOX_ADDRESS      The virtual forwarding mailbox. Default: any
 *                           address whose local part is `inbox-leads`.
 *   SMART_BCC_ADDRESS       The smart-BCC address. Default: local part `sync`.
 *   STAFF_EMAIL_DOMAINS     Comma-separated domains of the provider's staff;
 *                           MAIL_FROM's domain is always included.
 */
function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export const intakeConfig = {
  metaPageAccessToken: () => read("META_PAGE_ACCESS_TOKEN"),
  googleWebhookKey: () => read("GOOGLE_WEBHOOK_KEY"),
  leadWebhookSecret: () => read("LEAD_WEBHOOK_SECRET"),
  /** Declared in env.ts; read through env() so the typed schema stays the one reader. */
  metaAppSecret: () => env().META_APP_SECRET,
  metaVerifyToken: () => env().META_VERIFY_TOKEN,
  whatsappVerifyToken: () => env().WHATSAPP_VERIFY_TOKEN,
  inboundMailSecret: () => env().INBOUND_MAIL_SECRET,
};

export type Mailbox = "INBOX" | "SMART_BCC";

/** Which of our intake mailboxes an address is, if any. */
export function mailboxOf(address: string): Mailbox | null {
  const lower = address.trim().toLowerCase();
  const inbox = read("LEAD_INBOX_ADDRESS")?.toLowerCase();
  const bcc = read("SMART_BCC_ADDRESS")?.toLowerCase();
  const local = lower.split("@")[0];
  if (inbox ? lower === inbox : local === "inbox-leads") return "INBOX";
  if (bcc ? lower === bcc : local === "sync") return "SMART_BCC";
  return null;
}

export function staffDomains(): string[] {
  const listed = (read("STAFF_EMAIL_DOMAINS") ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .map(registrableDomain);
  const from = env().MAIL_FROM;
  const fromAddress = from ? (/<([^>]+)>/.exec(from)?.[1] ?? from) : undefined;
  const fromDomain = fromAddress ? emailDomain(fromAddress) : null;
  return [...new Set([...listed, ...(fromDomain ? [registrableDomain(fromDomain)] : [])])];
}
