import type { StatusTone } from "@/components/kit/StatusChip";
import { FIN_LABEL, OPS_LABEL, type FinStage, type OpsStage } from "@/server/domain/stages";

/**
 * Stage → chip tone, total over both vocabularies (TrainOS statusTone.ts rule:
 * one file decides which states are worth a colour; spend nothing on states a
 * reader cannot act on). Amber = pending/tentative, rose = queried/at risk,
 * emerald = verified/settled.
 */
export const OPS_TONE: Record<OpsStage, StatusTone> = {
  DRAFT: "neutral",
  QUOTED: "neutral",
  GRANT_PENDING: "warning",
  GRANT_APPROVED: "neutral",
  OPERATIONS_LOCKED: "neutral",
  READY_FOR_EVENT: "info",
  DELIVERY_IN_PROGRESS: "info",
  DELIVERY_COMPLETED: "success",
  POSTPONED: "warning",
  CANCELLED: "danger",
};

export const FIN_TONE: Record<FinStage, StatusTone> = {
  ESTIMATE: "neutral",
  GRANT_RESERVED: "neutral",
  UPFRONT_CLAIM_SUBMITTED: "info",
  CLAIM_NOT_READY: "warning",
  CLAIM_READY: "info",
  CLAIM_SUBMITTED: "neutral",
  QUERIED: "danger",
  APPROVED: "info",
  REMITTED: "warning",
  SETTLED_CLOSED: "success",
  VOIDED: "neutral",
};

export function opsLabel(stage: string): string {
  return OPS_LABEL[stage as OpsStage] ?? stage;
}
export function finLabel(stage: string): string {
  return FIN_LABEL[stage as FinStage] ?? stage;
}
export function opsTone(stage: string): StatusTone {
  return OPS_TONE[stage as OpsStage] ?? "neutral";
}
export function finTone(stage: string): StatusTone {
  return FIN_TONE[stage as FinStage] ?? "neutral";
}
