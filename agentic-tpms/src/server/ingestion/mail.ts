/**
 * Inbound-mail intake: which of our two mailboxes a message reached, and who
 * the lead is. Kept apart from the form normalisers because mail is read by
 * its addresses and headers, not by named fields.
 */
import { DomainError } from "@/server/domain/errors";
import { mailboxOf, staffDomains } from "./config";
import { UNKNOWN_COMPANY, emptyLead, ids, nameFromEmail, obj, str } from "./fields";
import { bestPhone, findPhoneNumbers } from "./phone";
import {
  cleanEmail,
  clip,
  companyNameFromDomain,
  corporateDomainOf,
  emailDomain,
  extractCompanyName,
  extractDeliveryPreference,
  extractPax,
  extractSsm,
  extractTopic,
  registrableDomain,
  stripHtml,
} from "./text";
import type { LeadOwner, NormalisedLead } from "./types";

export interface MailAddress {
  email: string;
  name: string | null;
}

/** "A <a@x>, b@y" | ["A <a@x>"] | [{address, name}] | {value: [...]} (mailparser) -> addresses. */
export function parseAddressList(value: unknown): MailAddress[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(parseAddressList);
  if (typeof value === "object") {
    const o = obj(value);
    if (Array.isArray(o.value)) return parseAddressList(o.value);
    const email = cleanEmail(o.address ?? o.email);
    return email ? [{ email, name: str(o.name) }] : [];
  }
  if (typeof value !== "string") return [];
  const out: MailAddress[] = [];
  for (const part of value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const angle = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(part);
    const email = cleanEmail(angle ? angle[2] : part);
    if (email) out.push({ email, name: angle && angle[1].trim() ? angle[1].trim() : null });
  }
  return out;
}

function header(payload: Record<string, unknown>, name: string): unknown {
  const headers = payload.headers;
  if (!headers) return undefined;
  if (typeof headers === "string") {
    const match = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(headers);
    return match?.[1];
  }
  if (Array.isArray(headers)) {
    const hit = headers.map(obj).find((h) => str(h.name ?? h.key)?.toLowerCase() === name.toLowerCase());
    return hit?.value;
  }
  const o = obj(headers);
  const key = Object.keys(o).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? o[key] : undefined;
}

export type MailMode = "INBOUND_MAIL" | "SMART_BCC";

/** Which intake the message was addressed to. Null when neither of our mailboxes is a recipient. */
export function detectMailMode(raw: unknown): MailMode | null {
  const payload = obj(raw);
  const recipients = [
    ...parseAddressList(payload.to),
    ...parseAddressList(payload.cc),
    ...parseAddressList(payload.bcc),
    ...parseAddressList(obj(payload.envelope).to),
  ];
  const boxes = recipients.map((r) => mailboxOf(r.email));
  if (boxes.includes("SMART_BCC")) return "SMART_BCC";
  if (boxes.includes("INBOX")) return "INBOUND_MAIL";
  return null;
}

/**
 * Inbound-parse JSON `{from, to, cc, bcc, subject, text, html, headers}`.
 *
 *   INBOUND_MAIL — mail to the virtual forwarding mailbox. The SENDER is the
 *   lead; when the sender is our own staff forwarding a message by hand, the
 *   original sender in the forwarded block is, and a contact-form
 *   notification's Reply-To beats its no-reply From.
 *
 *   SMART_BCC — a staff email with the smart-BCC address in BCC. The first
 *   external RECIPIENT is the lead and the staff sender is its owner. The
 *   body is the staff member's own writing, so their signature's phone
 *   number and company are never read as the lead's.
 */
export function normaliseInboundMail(raw: unknown, mode: MailMode): NormalisedLead {
  const payload = obj(raw);
  const subject = str(payload.subject) ?? "";
  const text = str(payload.text) ?? (str(payload.html) ? stripHtml(String(payload.html)) : "");
  const from = parseAddressList(payload.from)[0] ?? null;
  const staff = staffDomains();
  const isOurs = (a: MailAddress) => mailboxOf(a.email) !== null;
  const isStaff = (a: MailAddress) => {
    const d = emailDomain(a.email);
    return !!d && staff.includes(registrableDomain(d));
  };
  const messageId = str(header(payload, "message-id"));
  const body = [subject, text].filter(Boolean).join("\n\n");

  if (mode === "SMART_BCC") {
    if (!from) throw new DomainError("LEAD_PAYLOAD_INVALID", "Smart-BCC mail has no sender");
    const ownerDomain = emailDomain(from.email);
    const external = [...parseAddressList(payload.to), ...parseAddressList(payload.cc)].find((a) => {
      const d = emailDomain(a.email);
      return !isOurs(a) && !isStaff(a) && !!d && (!ownerDomain || registrableDomain(d) !== registrableDomain(ownerDomain));
    });
    if (!external) throw new DomainError("MAIL_NO_EXTERNAL_RECIPIENT", "Smart-BCC mail has no external recipient to record as the lead");
    const companyDomain = corporateDomainOf(external.email);
    const owner: LeadOwner = { email: from.email, name: from.name };
    return {
      ...emptyLead(),
      companyName: companyDomain ? companyNameFromDomain(companyDomain) : UNKNOWN_COMPANY,
      companyDomain,
      picName: clip(external.name ?? nameFromEmail(external.email), 150) ?? "",
      picEmail: external.email,
      topic: clip(extractTopic(body), 255),
      message: clip(body, 20_000),
      estimatedPax: extractPax(body),
      deliveryPreference: extractDeliveryPreference(body),
      platformIds: ids({ message_id: messageId }),
      owner,
    };
  }

  const replyTo = parseAddressList(header(payload, "reply-to") ?? payload.reply_to ?? payload.replyTo)[0] ?? null;
  const forwarded = from && isStaff(from) ? forwardedSender(text) : null;
  let lead: MailAddress | null = from;
  if (replyTo && !isOurs(replyTo) && !isStaff(replyTo) && (!from || replyTo.email !== from.email)) lead = replyTo;
  else if (forwarded) lead = forwarded;
  if (!lead || isOurs(lead)) throw new DomainError("LEAD_NO_CONTACT", "Inbound mail has no usable sender");

  const bodyForLead = forwarded ? text.slice(text.search(FORWARD_MARKER)) : text;
  const companyDomain = corporateDomainOf(lead.email);
  const phone = bestPhone(findPhoneNumbers(bodyForLead));
  return {
    ...emptyLead(),
    companyName:
      clip(extractCompanyName(bodyForLead) ?? (companyDomain ? companyNameFromDomain(companyDomain) : UNKNOWN_COMPANY), 255) ?? UNKNOWN_COMPANY,
    companyDomain,
    ssm: extractSsm(bodyForLead),
    picName: clip(lead.name ?? nameFromEmail(lead.email), 150) ?? "",
    picEmail: lead.email,
    picPhoneE164: phone ?? "",
    topic: clip(extractTopic(body), 255),
    message: clip(body, 20_000),
    estimatedPax: extractPax(body),
    deliveryPreference: extractDeliveryPreference(body),
    platformIds: ids({ message_id: messageId }),
    owner: forwarded && from ? { email: from.email, name: from.name } : null,
  };
}

const FORWARD_MARKER = /-{2,}\s*(?:Forwarded message|Original Message)\s*-{2,}|^Begin forwarded message:/im;

function forwardedSender(text: string): MailAddress | null {
  const at = text.search(FORWARD_MARKER);
  if (at < 0) return null;
  const block = text.slice(at, at + 1500);
  const line = /^\s*From:\s*(.+)$/im.exec(block);
  return line ? (parseAddressList(line[1].trim())[0] ?? null) : null;
}
