import type { DeliveryMode } from "@/server/domain/stages";

/**
 * The intake vocabulary. `LeadChannel` mirrors the CHECK on
 * tpms.raw_lead_payloads.source_channel verbatim; `LEAD_STATUSES` mirrors the
 * CHECK on tpms.lead_records.status. R14: anything outside them is refused.
 */
export const LEAD_CHANNELS = [
  "META_LEADGEN",
  "GOOGLE_WEBHOOK",
  "LINKEDIN_SYNC",
  "WHATSAPP_INBOUND",
  "INBOUND_MAIL",
  "SMART_BCC",
  "WEB_FORM",
  "MANUAL",
] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const LEAD_STATUSES = [
  "LEAD_INGESTED",
  "LEAD_QUALIFIED_TNA",
  "TRIAGE_REVIEW",
  "PRIVATE_CASH",
  "ARCHIVED",
  "DUPLICATE",
  "CONVERTED",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function assertLeadChannel(value: string): LeadChannel {
  if (!(LEAD_CHANNELS as readonly string[]).includes(value)) throw new Error(`Unknown lead channel: ${value}`);
  return value as LeadChannel;
}

export function assertLeadStatus(value: string): LeadStatus {
  if (!(LEAD_STATUSES as readonly string[]).includes(value)) throw new Error(`Unknown lead status: ${value}`);
  return value as LeadStatus;
}

export interface AdClickIds {
  gclid?: string;
  fbclid?: string;
  li_fat_id?: string;
  /** Click-to-WhatsApp ad click id. */
  ctwa_clid?: string;
}

/** Who at the provider owns a lead captured by the smart-BCC address. */
export interface LeadOwner {
  email: string;
  name: string | null;
}

/** One channel-agnostic lead, the output of every normaliser. */
export interface NormalisedLead {
  companyName: string;
  /** Registrable corporate domain; null for free-mail (never used to dedupe). */
  companyDomain: string | null;
  ssm: string | null;
  picName: string;
  picEmail: string;
  /** E.164, or '' when no usable number was given. */
  picPhoneE164: string;
  topic: string | null;
  message: string | null;
  estimatedPax: number | null;
  deliveryPreference: DeliveryMode | null;
  adClickIds: AdClickIds;
  campaignId: string | null;
  adId: string | null;
  whatsappOptIn: boolean;
  /** Platform identifiers that are not click ids (leadgen_id, form_id, wamid...). */
  platformIds: Record<string, string>;
  owner: LeadOwner | null;
  /** A platform test submission (Google `is_test`). */
  isTest: boolean;
  /** Meta leadgen notification without field_data: enrich from the Graph API before triage. */
  needsEnrichment: boolean;
}

/** Intake facts kept on the lead (tna_profile.intake) for triage and the inbox. */
export interface IntakeMeta {
  verified: boolean;
  channel: LeadChannel;
  platformIds: Record<string, string>;
  owner: LeadOwner | null;
  isTest: boolean;
  needsEnrichment: boolean;
}
