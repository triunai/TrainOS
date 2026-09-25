import type { StatusTone } from "@/components/kit";

/**
 * Finance status vocabularies → chip tone and label, in one server-safe file
 * (a "use client" module may export only components). R14: a value missing
 * here renders neutral with its raw code, and every map is total over the
 * vocabulary the domain module declares.
 */
export const PV_TONE: Record<string, StatusTone> = { DRAFT: "warning", APPROVED: "info", PAID: "success", CANCELLED: "neutral" };

export const PAYEE_LABEL: Record<string, string> = {
  TRAINER: "trainer",
  VENUE: "venue",
  CATERING: "catering",
  PRINTING: "printing",
  COMMISSION: "commission",
};

export const RETENTION_TONE: Record<string, StatusTone> = {
  PENDING: "neutral",
  DRAFTED: "warning",
  APPROVED: "warning",
  DISPATCHED: "success",
  SKIPPED: "neutral",
};

export const RETENTION_STATUS_LABEL: Record<string, string> = {
  PENDING: "scheduled",
  DRAFTED: "draft ready",
  APPROVED: "approved, not sent",
  DISPATCHED: "sent",
  SKIPPED: "skipped",
};
