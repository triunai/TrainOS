import type { NormalisedLead } from "./types";

/** Small readers shared by the channel normalisers (./normalise, ./mail). */
export const UNKNOWN_COMPANY = "Unknown company";

export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local || /^(info|admin|hr|sales|enquiry|enquiries|contact|hello|training|noreply|no-reply)$/i.test(local)) return "";
  return local
    .split(/[._-]+/)
    .filter((p) => /^[a-z]+$/i.test(p))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function str(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

export function ids(entries: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    const s = str(v);
    if (s) out[k] = s;
  }
  return out;
}

export function emptyLead(): NormalisedLead {
  return {
    companyName: UNKNOWN_COMPANY,
    companyDomain: null,
    ssm: null,
    picName: "",
    picEmail: "",
    picPhoneE164: "",
    topic: null,
    message: null,
    estimatedPax: null,
    deliveryPreference: null,
    adClickIds: {},
    campaignId: null,
    adId: null,
    whatsappOptIn: false,
    platformIds: {},
    owner: null,
    isTest: false,
    needsEnrichment: false,
  };
}
