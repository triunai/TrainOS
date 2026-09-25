import type { ProvenanceLike } from "@/components/kit/AIChip";
import type { StatusTone } from "@/components/kit/StatusChip";
import type { Intent, L1Verdict, LeadChannel, LeadStatus } from "@/server/ingestion";

/**
 * Demand-screen vocabulary: display labels and chip tones, as exhaustive maps
 * over the domain's constants so a new channel or status is a compile error
 * here rather than a blank cell (R14). Server-safe: no "use client".
 */
export const CHANNEL_LABEL: Record<LeadChannel, string> = {
  META_LEADGEN: "Meta lead ads",
  GOOGLE_WEBHOOK: "Google Ads form",
  LINKEDIN_SYNC: "LinkedIn lead gen",
  WHATSAPP_INBOUND: "WhatsApp",
  INBOUND_MAIL: "Email",
  SMART_BCC: "Email (smart BCC)",
  WEB_FORM: "Web form",
  MANUAL: "Manual entry",
};

export const LEAD_STATUS: Record<LeadStatus, { label: string; tab: string; tone: StatusTone }> = {
  LEAD_INGESTED: { label: "New · awaiting L1", tab: "New", tone: "neutral" },
  LEAD_QUALIFIED_TNA: { label: "Qualified · SBL-Khas", tab: "Qualified", tone: "success" },
  TRIAGE_REVIEW: { label: "Needs triage", tab: "Needs triage", tone: "warning" },
  PRIVATE_CASH: { label: "Private / cash", tab: "Private cash", tone: "info" },
  ARCHIVED: { label: "Archived", tab: "Archived", tone: "neutral" },
  DUPLICATE: { label: "Duplicate", tab: "Duplicate", tone: "neutral" },
  CONVERTED: { label: "Converted", tab: "Converted", tone: "success" },
};

export function leadStatusMeta(status: string): { label: string; tab: string; tone: StatusTone } {
  const meta = LEAD_STATUS[status as LeadStatus];
  if (!meta) throw new Error(`Unknown lead status: ${status}`);
  return meta;
}

export const INTENT_LABEL: Record<Intent, string> = {
  TRAINING_ENQUIRY: "Training enquiry",
  VENDOR_PITCH: "Vendor pitch",
  JOB_SEEKER: "Job seeker",
  SPAM: "Spam",
  OTHER: "Other",
};

export function intentLabel(intent: string | null | undefined): string {
  if (!intent) return "—";
  return INTENT_LABEL[intent as Intent] ?? intent;
}

/** The AIChip's provenance for an L1 verdict: tier, model or template, fallback reason, confidence. */
export function l1Provenance(v: L1Verdict): ProvenanceLike {
  return {
    tier: v.tier,
    agent: "ingestion.l1_classifier",
    mode: v.mode ?? undefined,
    provider: v.provider ?? undefined,
    model: v.model ?? undefined,
    fallbackReason: v.fallbackReason ?? undefined,
    confidence: v.intentConfidence ?? undefined,
    latencyMs: v.latencyMs ?? undefined,
  };
}

/** "Template" when no model ran, else the model that did — said in words next to the chip. */
export function classifierName(v: L1Verdict): string {
  if (v.mode === "LLM") return [v.provider, v.model].filter(Boolean).join(" / ");
  if (v.mode === "TEMPLATE") return `deterministic template${v.fallbackReason ? ` (${v.fallbackReason.toLowerCase().replace(/_/g, " ")})` : ""}`;
  return v.mode?.toLowerCase() ?? "unknown";
}

/** Mirrors the CHECK on tpms.outbound_campaign_outbox.status. */
export const OUTBOX_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  WAITING_APPROVAL: { label: "Awaiting approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "info" },
  DISPATCHED: { label: "Sent", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  BOUNCED: { label: "Bounced", tone: "danger" },
  REPLIED: { label: "Replied", tone: "success" },
};

export function outboxStatusMeta(status: string): { label: string; tone: StatusTone } {
  const meta = OUTBOX_STATUS[status];
  if (!meta) throw new Error(`Unknown outbox status: ${status}`);
  return meta;
}

export const MESSAGE_STATUS_TONE: Record<string, StatusTone> = { SENT: "success", LOGGED: "neutral", FAILED: "danger" };

/** "12 min", "5 h", "3 d" — how long ago, for an operator scanning an inbox. */
export function ageLabel(iso: string | Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}
