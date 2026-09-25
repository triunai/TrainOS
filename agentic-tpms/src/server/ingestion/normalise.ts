/**
 * Per-channel normalisers: one raw platform payload in, one NormalisedLead
 * out. Every channel is first flattened into a "field bag" (normalised key ->
 * string value) and then read by one shared function, so a new form question
 * or a renamed column is a new alias, not a new code path. Anything the bag
 * cannot place is kept as a "Question: answer" line in the message, where the
 * L1 classifier can still read it ("Is your company HRD Corp registered?: Yes").
 * Inbound mail has its own parser in ./mail (addresses, not fields).
 */
import { DELIVERY_MODES, type DeliveryMode } from "@/server/domain/stages";
import { DomainError } from "@/server/domain/errors";
import { UNKNOWN_COMPANY, emptyLead, ids, nameFromEmail, obj, str } from "./fields";
import { normaliseInboundMail } from "./mail";
import { bestPhone, findPhoneNumbers, normaliseMalaysianPhone } from "./phone";
import {
  cleanEmail,
  clip,
  companyNameFromDomain,
  corporateDomainOf,
  extractCompanyName,
  extractDeliveryPreference,
  extractPax,
  extractSsm,
  extractTopic,
  findEmails,
  isFreeMailDomain,
  parsePaxField,
  registrableDomain,
  truthy,
} from "./text";
import type { AdClickIds, LeadChannel, NormalisedLead } from "./types";

// Mail parsing lives in ./mail; re-exported so callers keep one import site.
export { detectMailMode, normaliseInboundMail, parseAddressList, type MailAddress, type MailMode } from "./mail";

type Bag = Map<string, { label: string; value: string }>;

/** `firstName` / `First Name` / `first-name?` -> `first_name`. */
export function normKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const parts = value.map(scalar).filter((v): v is string => !!v);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") return null;
  const text = String(value).trim();
  return text ? text : null;
}

function put(bag: Bag, label: string, value: unknown): void {
  const text = scalar(value);
  const key = normKey(label);
  if (!text || !key || bag.has(key)) return;
  bag.set(key, { label, value: text });
}

// ---------------------------------------------------------------- field aliases

const ALIASES = {
  fullName: ["full_name", "name", "fullname", "your_name", "nama", "nama_penuh", "contact_name", "pic_name", "contact_person"],
  firstName: ["first_name", "firstname", "given_name"],
  lastName: ["last_name", "lastname", "surname", "family_name"],
  email: ["work_email", "business_email", "email", "email_address", "e_mail", "emel", "contact_email", "pic_email"],
  phone: [
    "work_phone_number", "work_phone", "phone_number", "phone", "mobile", "mobile_number", "mobile_phone",
    "contact_number", "tel", "telephone", "whatsapp_number", "no_telefon", "pic_phone",
  ],
  company: ["company_name", "company", "organisation", "organization", "organisation_name", "organization_name", "employer", "syarikat", "nama_syarikat"],
  website: ["company_domain", "website", "company_website", "web"],
  message: ["message", "comments", "comment", "enquiry", "inquiry", "notes", "note", "details", "additional_info", "description", "mesej", "remarks"],
  jobTitle: ["job_title", "position", "designation", "jawatan", "title"],
  campaignId: ["campaign_id", "utm_campaign", "campaign"],
  adId: ["ad_id", "creative_id", "utm_content"],
  gclid: ["gclid", "gcl_id"],
  fbclid: ["fbclid"],
  liFatId: ["li_fat_id"],
} as const;

const PATTERNS = {
  ssm: /(^|_)(ssm|company_reg|company_registration|registration_no|registration_number|roc|brn|business_registration)(_|$)/,
  pax: /(^|_)(pax|participants?|headcount|no_of|number_of|how_many|staff|employees|peserta|cohort|team_size|group_size|class_size|cohort_size)(_|$)/,
  delivery: /(^|_)(delivery|mode|format|method|venue_type|training_mode|training_format)(_|$)/,
  topic: /(^|_)(topic|training|course|programme|program|interest|interested|subject|kursus|latihan)(_|$)/,
  whatsapp: /whatsapp/,
};

function take(bag: Bag, used: Set<string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const hit = bag.get(key);
    if (hit) {
      used.add(key);
      return hit.value;
    }
  }
  return null;
}

function takeMatching(bag: Bag, used: Set<string>, pattern: RegExp, exclude?: RegExp): string | null {
  for (const [key, hit] of bag) {
    if (used.has(key) || !pattern.test(key) || (exclude && exclude.test(key))) continue;
    used.add(key);
    return hit.value;
  }
  return null;
}

export function mapDeliveryMode(value: string | null | undefined): DeliveryMode | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((DELIVERY_MODES as readonly string[]).includes(upper)) return upper as DeliveryMode;
  return extractDeliveryPreference(value);
}

interface BagExtras {
  adClickIds?: AdClickIds;
  campaignId?: string | null;
  adId?: string | null;
  platformIds?: Record<string, string>;
  isTest?: boolean;
}

/** The one reader every channel shares. */
function fromBag(bag: Bag, extras: BagExtras = {}): NormalisedLead {
  const used = new Set<string>();
  const fullName = take(bag, used, ALIASES.fullName);
  const first = take(bag, used, ALIASES.firstName);
  const last = take(bag, used, ALIASES.lastName);
  const email = cleanEmail(take(bag, used, ALIASES.email));
  const phoneRaw = take(bag, used, ALIASES.phone);
  const company = take(bag, used, ALIASES.company);
  const website = take(bag, used, ALIASES.website);
  const freeMessage = take(bag, used, ALIASES.message);
  const jobTitle = take(bag, used, ALIASES.jobTitle);
  const campaignId = take(bag, used, ALIASES.campaignId);
  const adId = take(bag, used, ALIASES.adId);
  const gclid = take(bag, used, ALIASES.gclid);
  const fbclid = take(bag, used, ALIASES.fbclid);
  const liFatId = take(bag, used, ALIASES.liFatId);
  const optInRaw = takeMatching(bag, used, PATTERNS.whatsapp, /number|phone/);
  const ssmRaw = takeMatching(bag, used, PATTERNS.ssm);
  const paxRaw = takeMatching(bag, used, PATTERNS.pax);
  const deliveryRaw = takeMatching(bag, used, PATTERNS.delivery);
  const topicRaw = takeMatching(bag, used, PATTERNS.topic, /(date|when|hrd|levy|budget)/);

  // Every answer nobody mapped stays visible, as a line the classifier reads.
  const extraLines = [...bag]
    .filter(([key]) => !used.has(key) && !/^(utm_|platform|form_id|lead_id|is_organic|created_time|page_id|adgroup|adset|google_key|api_version|is_test)/.test(key))
    .map(([, hit]) => `${hit.label.replace(/_/g, " ").replace(/\?$/, "")}: ${hit.value}`);
  const message = [freeMessage, jobTitle ? `Job title: ${jobTitle}` : null, ...extraLines]
    .filter((line): line is string => !!line && !!line.trim())
    .join("\n");
  const text = [topicRaw, message].filter(Boolean).join("\n");

  const websiteDomain = website ? hostOf(website) : null;
  const companyDomain = corporateDomainOf(email) ?? (websiteDomain && !isFreeMailDomain(websiteDomain) ? registrableDomain(websiteDomain) : null);
  const picName = fullName ?? ([first, last].filter(Boolean).join(" ") || nameFromEmail(email));
  const companyName = company ?? extractCompanyName(text) ?? (companyDomain ? companyNameFromDomain(companyDomain) : UNKNOWN_COMPANY);
  const phone = normaliseMalaysianPhone(phoneRaw) ?? bestPhone(findPhoneNumbers(message)) ?? "";

  const adClickIds: AdClickIds = { ...(extras.adClickIds ?? {}) };
  if (gclid) adClickIds.gclid ??= gclid;
  if (fbclid) adClickIds.fbclid ??= fbclid;
  if (liFatId) adClickIds.li_fat_id ??= liFatId;

  return {
    companyName: clip(companyName, 255) ?? UNKNOWN_COMPANY,
    companyDomain: clip(companyDomain, 100),
    ssm: clip(ssmRaw ?? extractSsm(text), 50),
    picName: clip(picName, 150) ?? "",
    picEmail: email.length <= 150 ? email : "",
    picPhoneE164: phone,
    topic: clip(topicRaw && topicRaw.length <= 120 ? topicRaw : extractTopic(text), 255),
    message: clip(message, 20_000),
    estimatedPax: parsePaxField(paxRaw) ?? extractPax(text),
    deliveryPreference: mapDeliveryMode(deliveryRaw) ?? extractDeliveryPreference(text),
    adClickIds,
    campaignId: clip(extras.campaignId ?? campaignId, 100),
    adId: clip(extras.adId ?? adId, 100),
    whatsappOptIn: truthy(optInRaw),
    platformIds: extras.platformIds ?? {},
    owner: null,
    isTest: extras.isTest ?? false,
    needsEnrichment: false,
  };
}

function hostOf(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Meta Lead Ads

/**
 * One leadgen change value: `{leadgen_id, form_id, ad_id, adgroup_id, page_id,
 * created_time}`, optionally already carrying `field_data` (or a Graph lead
 * object `{id, field_data, ...}` fetched later). Without field_data the lead
 * is minimal and flagged for enrichment.
 */
export function normaliseMetaLeadgen(raw: unknown): NormalisedLead {
  const value = obj(raw);
  const leadgenId = str(value.leadgen_id) ?? str(value.id);
  const platformIds = ids({
    leadgen_id: leadgenId,
    form_id: value.form_id,
    page_id: value.page_id,
    adgroup_id: value.adgroup_id ?? value.adset_id,
  });
  const fieldData = Array.isArray(value.field_data) ? value.field_data : null;
  if (!fieldData) {
    if (!leadgenId) throw new DomainError("LEAD_PAYLOAD_INVALID", "Meta leadgen payload has neither leadgen_id nor field_data");
    return {
      ...emptyLead(),
      campaignId: clip(str(value.campaign_id), 100),
      adId: clip(str(value.ad_id), 100),
      platformIds,
      needsEnrichment: true,
    };
  }
  const bag: Bag = new Map();
  for (const field of fieldData) {
    const f = obj(field);
    const name = str(f.name);
    if (name) put(bag, name, f.values ?? f.value);
  }
  return fromBag(bag, {
    campaignId: str(value.campaign_id),
    adId: str(value.ad_id),
    platformIds,
  });
}

// ---------------------------------------------------------------- Google Ads lead forms

/** `user_column_data: [{column_id | column_name, string_value}]`, `gcl_id`, `campaign_id`, `is_test`. */
export function normaliseGoogleLeadForm(raw: unknown): NormalisedLead {
  const value = obj(raw);
  const columns = Array.isArray(value.user_column_data) ? value.user_column_data : null;
  if (!columns) throw new DomainError("LEAD_PAYLOAD_INVALID", "Google lead form payload has no user_column_data");
  const bag: Bag = new Map();
  for (const column of columns) {
    const c = obj(column);
    const id = str(c.column_id);
    const name = str(c.column_name);
    const label = name && id && /^[A-Z_]+$/.test(id) && normKey(id) in KNOWN_GOOGLE_COLUMNS ? id : (name ?? id);
    if (label) put(bag, label, c.string_value);
  }
  const gclid = str(value.gcl_id) ?? str(value.gclid);
  return fromBag(bag, {
    adClickIds: gclid ? { gclid } : {},
    campaignId: str(value.campaign_id),
    adId: str(value.creative_id) ?? str(value.ad_id),
    platformIds: ids({ lead_id: value.lead_id, form_id: value.form_id, adgroup_id: value.adgroup_id }),
    isTest: value.is_test === true || value.is_test === "true",
  });
}

/** Google's standard column ids; custom questions are read by their column_name instead. */
const KNOWN_GOOGLE_COLUMNS: Record<string, true> = {
  full_name: true, first_name: true, last_name: true, email: true, phone_number: true, company_name: true,
  job_title: true, work_email: true, work_phone: true, city: true, country: true, postal_code: true,
  region: true, street_address: true,
};

// ---------------------------------------------------------------- LinkedIn lead sync

/** Simple JSON from a LinkedIn Lead Gen sync: `{firstName, lastName, email, phone, company, ..., answers?}`. */
export function normaliseLinkedInSync(raw: unknown): NormalisedLead {
  const value = obj(raw);
  const bag: Bag = new Map();
  for (const [key, v] of Object.entries(value)) {
    if (key === "answers" || key === "customQuestions") continue;
    if (key === "emailAddress") put(bag, "email", v);
    else if (key === "phoneNumber") put(bag, "phone", v);
    else if (key === "companyName" || key === "organization") put(bag, "company", v);
    else put(bag, key, v);
  }
  for (const answer of Array.isArray(value.answers) ? value.answers : Array.isArray(value.customQuestions) ? value.customQuestions : []) {
    const a = obj(answer);
    const question = str(a.question) ?? str(a.name);
    if (question) put(bag, question, a.answer ?? a.value ?? a.values);
  }
  const lead = fromBag(bag, { platformIds: ids({ linkedin_lead_id: value.leadId ?? value.id, form_id: value.formId }) });
  if (!lead.picEmail && !lead.picPhoneE164) throw new DomainError("LEAD_NO_CONTACT", "LinkedIn lead has neither an email nor a phone number");
  return lead;
}

// ---------------------------------------------------------------- web form / manual entry

export function normaliseWebForm(raw: unknown): NormalisedLead {
  const value = obj(raw);
  const bag: Bag = new Map();
  for (const [key, v] of Object.entries(value)) put(bag, key, v);
  const lead = fromBag(bag);
  if (!lead.picEmail && !lead.picPhoneE164) throw new DomainError("LEAD_NO_CONTACT", "The form has neither a valid email nor a phone number");
  return lead;
}

// ---------------------------------------------------------------- WhatsApp Cloud API inbound

/** One inbound message, as split from a webhook: `{metadata, contact, message}`. */
export function normaliseWhatsAppInbound(raw: unknown): NormalisedLead {
  const value = obj(raw);
  const message = obj(value.message);
  const contact = obj(value.contact);
  const from = str(message.from) ?? str(contact.wa_id);
  if (!from) throw new DomainError("LEAD_PAYLOAD_INVALID", "WhatsApp message has no sender");
  const phone = normaliseMalaysianPhone(`+${from.replace(/^\+/, "")}`) ?? "";
  const body = whatsAppText(message);
  const referral = obj(message.referral);
  const adLine = str(referral.headline) ? `Ad: ${str(referral.headline)}` : null;
  const text = [body, adLine, str(referral.body)].filter(Boolean).join("\n");
  const email = findEmails(text)[0] ?? "";
  const companyDomain = email ? corporateDomainOf(email) : null;
  const ctwa = str(referral.ctwa_clid);
  const metadata = obj(value.metadata);
  return {
    ...emptyLead(),
    companyName: clip(extractCompanyName(text) ?? (companyDomain ? companyNameFromDomain(companyDomain) : UNKNOWN_COMPANY), 255) ?? UNKNOWN_COMPANY,
    companyDomain,
    ssm: extractSsm(text),
    picName: clip(str(obj(contact.profile).name), 150) ?? "",
    picEmail: email,
    picPhoneE164: phone,
    topic: clip(extractTopic(text), 255),
    message: clip(text, 20_000),
    estimatedPax: extractPax(text),
    deliveryPreference: extractDeliveryPreference(text),
    adClickIds: ctwa ? { ctwa_clid: ctwa } : {},
    adId: str(referral.source_type) === "ad" ? clip(str(referral.source_id), 100) : null,
    whatsappOptIn: true,
    platformIds: ids({ wamid: message.id, wa_id: contact.wa_id ?? from, phone_number_id: metadata.phone_number_id }),
  };
}

export function whatsAppText(message: Record<string, unknown>): string {
  const interactive = obj(message.interactive);
  return (
    str(obj(message.text).body) ??
    str(obj(message.button).text) ??
    str(obj(interactive.button_reply).title) ??
    str(obj(interactive.list_reply).title) ??
    `[${str(message.type) ?? "unknown"} message]`
  );
}

/**
 * Split a Cloud API webhook into one item per inbound message, each carrying
 * its sender's contact and the receiving number's metadata. Status callbacks
 * (sent/delivered/read) are not messages and are dropped here.
 */
export function splitWhatsAppWebhook(body: unknown): Array<{ metadata: Record<string, unknown>; contact: Record<string, unknown>; message: Record<string, unknown> }> {
  const items: Array<{ metadata: Record<string, unknown>; contact: Record<string, unknown>; message: Record<string, unknown> }> = [];
  for (const entry of Array.isArray(obj(body).entry) ? (obj(body).entry as unknown[]) : []) {
    for (const change of Array.isArray(obj(entry).changes) ? (obj(entry).changes as unknown[]) : []) {
      const value = obj(obj(change).value);
      const contacts = Array.isArray(value.contacts) ? value.contacts.map(obj) : [];
      for (const message of Array.isArray(value.messages) ? value.messages.map(obj) : []) {
        const contact = contacts.find((c) => str(c.wa_id) === str(message.from)) ?? contacts[0] ?? {};
        items.push({ metadata: obj(value.metadata), contact, message });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------- dispatch

/** R14: an unknown channel is an error, never a default normaliser. */
export function normalise(channel: LeadChannel, raw: unknown): NormalisedLead {
  switch (channel) {
    case "META_LEADGEN":
      return normaliseMetaLeadgen(raw);
    case "GOOGLE_WEBHOOK":
      return normaliseGoogleLeadForm(raw);
    case "LINKEDIN_SYNC":
      return normaliseLinkedInSync(raw);
    case "WHATSAPP_INBOUND":
      return normaliseWhatsAppInbound(raw);
    case "INBOUND_MAIL":
      return normaliseInboundMail(raw, "INBOUND_MAIL");
    case "SMART_BCC":
      return normaliseInboundMail(raw, "SMART_BCC");
    case "WEB_FORM":
    case "MANUAL":
      return normaliseWebForm(raw);
    default: {
      const unreachable: never = channel;
      throw new Error(`Unknown lead channel: ${String(unreachable)}`);
    }
  }
}

/**
 * Split one webhook body into per-lead items. Each item is stored and hashed
 * on its own, so a platform retry of the same body replays item by item.
 */
export function splitWebhook(channel: LeadChannel, body: unknown): unknown[] {
  switch (channel) {
    case "META_LEADGEN": {
      const o = obj(body);
      if (!Array.isArray(o.entry)) return o.leadgen_id || o.field_data ? [o] : [];
      const items: unknown[] = [];
      for (const entry of o.entry.map(obj)) {
        for (const change of Array.isArray(entry.changes) ? entry.changes.map(obj) : []) {
          if (change.field !== "leadgen") continue;
          const value = obj(change.value);
          items.push({ ...value, page_id: value.page_id ?? entry.id });
        }
      }
      return items;
    }
    case "LINKEDIN_SYNC":
      if (Array.isArray(body)) return body;
      return Array.isArray(obj(body).leads) ? (obj(body).leads as unknown[]) : [body];
    case "WHATSAPP_INBOUND":
      return splitWhatsAppWebhook(body);
    case "GOOGLE_WEBHOOK":
    case "INBOUND_MAIL":
    case "SMART_BCC":
    case "WEB_FORM":
    case "MANUAL":
      return [body];
    default: {
      const unreachable: never = channel;
      throw new Error(`Unknown lead channel: ${String(unreachable)}`);
    }
  }
}
