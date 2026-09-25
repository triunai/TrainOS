/**
 * The two state vocabularies. Order here is display order; the pipeline
 * renders from these arrays rather than hardcoding stage names in screens.
 */
export const OPS_STAGES = [
  "DRAFT",
  "QUOTED",
  "GRANT_PENDING",
  "GRANT_APPROVED",
  "OPERATIONS_LOCKED",
  "READY_FOR_EVENT",
  "DELIVERY_IN_PROGRESS",
  "DELIVERY_COMPLETED",
  "POSTPONED",
  "CANCELLED",
] as const;
export type OpsStage = (typeof OPS_STAGES)[number];

/** The forward spine (for steppers); POSTPONED and CANCELLED are exits. */
export const OPS_SPINE: readonly OpsStage[] = OPS_STAGES.slice(0, 8);

export const FIN_STAGES = [
  "ESTIMATE",
  "GRANT_RESERVED",
  "UPFRONT_CLAIM_SUBMITTED",
  "CLAIM_NOT_READY",
  "CLAIM_READY",
  "CLAIM_SUBMITTED",
  "QUERIED",
  "APPROVED",
  "REMITTED",
  "SETTLED_CLOSED",
  "VOIDED",
] as const;
export type FinStage = (typeof FIN_STAGES)[number];

export const FIN_SPINE: readonly FinStage[] = [
  "ESTIMATE",
  "GRANT_RESERVED",
  "CLAIM_NOT_READY",
  "CLAIM_READY",
  "CLAIM_SUBMITTED",
  "APPROVED",
  "REMITTED",
  "SETTLED_CLOSED",
];

export type Machine = "OPERATIONAL" | "FINANCIAL";
export type ActorType = "USER" | "SYSTEM" | "AGENT";

export const OPS_LABEL: Record<OpsStage, string> = {
  DRAFT: "Draft",
  QUOTED: "Quoted",
  GRANT_PENDING: "Grant pending",
  GRANT_APPROVED: "Grant approved",
  OPERATIONS_LOCKED: "Operations locked",
  READY_FOR_EVENT: "Ready for event",
  DELIVERY_IN_PROGRESS: "In delivery",
  DELIVERY_COMPLETED: "Delivered",
  POSTPONED: "Postponed",
  CANCELLED: "Cancelled",
};

export const FIN_LABEL: Record<FinStage, string> = {
  ESTIMATE: "Estimate",
  GRANT_RESERVED: "Grant reserved",
  UPFRONT_CLAIM_SUBMITTED: "Upfront 30% filed",
  CLAIM_NOT_READY: "Claim not ready",
  CLAIM_READY: "Claim ready",
  CLAIM_SUBMITTED: "Claim submitted",
  QUERIED: "Queried",
  APPROVED: "Claim approved",
  REMITTED: "Remitted",
  SETTLED_CLOSED: "Settled",
  VOIDED: "Voided",
};

export const DELIVERY_MODES = ["IN_HOUSE", "PUBLIC_PHYSICAL", "ROT_VIRTUAL"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];
export const DELIVERY_MODE_LABEL: Record<DeliveryMode, string> = {
  IN_HOUSE: "In-house",
  PUBLIC_PHYSICAL: "Public (physical)",
  ROT_VIRTUAL: "Remote online (ROT)",
};

export function isOpsStage(value: string): value is OpsStage {
  return (OPS_STAGES as readonly string[]).includes(value);
}
export function isFinStage(value: string): value is FinStage {
  return (FIN_STAGES as readonly string[]).includes(value);
}

/** R14: the receiving side rejects an unknown value instead of defaulting. */
export function assertOpsStage(value: string): OpsStage {
  if (!isOpsStage(value)) throw new Error(`Unknown operational stage: ${value}`);
  return value;
}
export function assertFinStage(value: string): FinStage {
  if (!isFinStage(value)) throw new Error(`Unknown financial stage: ${value}`);
  return value;
}
