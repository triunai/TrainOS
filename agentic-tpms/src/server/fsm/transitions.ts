import type { Machine } from "../domain/stages";

/**
 * The state machines, as data. This table is duplicated VERBATIM in
 * db/migrations/0002_domain.sql (`fsm_transitions`), and
 * tests/integration/fsm-parity.test.ts asserts the two are equal row for row.
 * The database enforces it on every UPDATE; this copy lets the application
 * explain a refusal before it reaches the database, and lets the UI offer
 * only the moves that exist.
 */
export interface TransitionRule {
  machine: Machine;
  from: string;
  to: string;
  reason: string;
  actors: ReadonlyArray<"USER" | "SYSTEM">;
  description: string;
}

const O = "OPERATIONAL" as const;
const F = "FINANCIAL" as const;
const USER = ["USER"] as const;
const ANY = ["USER", "SYSTEM"] as const;

export const TRANSITIONS: readonly TransitionRule[] = [
  { machine: O, from: "DRAFT", to: "QUOTED", reason: "COMMERCIAL_TERMS_APPROVED", actors: USER, description: "Gate 1: operator approves the priced quotation and dispatches it" },
  { machine: O, from: "QUOTED", to: "DRAFT", reason: "QUOTATION_REVISION_REQUESTED", actors: USER, description: "Client asked for a revised quotation" },
  { machine: O, from: "QUOTED", to: "GRANT_PENDING", reason: "CLIENT_ACCEPTED_QUOTATION", actors: USER, description: "Client accepted; HR files the e-TRiS grant application" },
  { machine: O, from: "GRANT_PENDING", to: "GRANT_APPROVED", reason: "GRANT_CONFIRMED_LOCKED", actors: USER, description: "Operator verified the extracted e-TRiS approval letter" },
  { machine: O, from: "GRANT_APPROVED", to: "OPERATIONS_LOCKED", reason: "OPERATIONS_READINESS_LOCKED", actors: ANY, description: "Trainer confirmed with TTT, venue BEO signed (or not required)" },
  { machine: O, from: "GRANT_APPROVED", to: "POSTPONED", reason: "VIABILITY_POSTPONED", actors: USER, description: "Gate 2: postpone inside the free venue window" },
  { machine: O, from: "GRANT_APPROVED", to: "CANCELLED", reason: "VIABILITY_CANCELLED", actors: USER, description: "Gate 2: cancel and release tentative holds" },
  { machine: O, from: "OPERATIONS_LOCKED", to: "READY_FOR_EVENT", reason: "T14_VIABILITY_PASSED", actors: ["SYSTEM", "USER"], description: "T-14 cohort check passed" },
  { machine: O, from: "OPERATIONS_LOCKED", to: "READY_FOR_EVENT", reason: "VIABILITY_PIVOT_ROT", actors: USER, description: "Gate 2: pivot to Remote Online Training, venue released" },
  { machine: O, from: "OPERATIONS_LOCKED", to: "READY_FOR_EVENT", reason: "VIABILITY_OVERRIDE_PROCEED", actors: USER, description: "Gate 2: operator proceeds below minimum cohort" },
  { machine: O, from: "OPERATIONS_LOCKED", to: "POSTPONED", reason: "VIABILITY_POSTPONED", actors: USER, description: "Gate 2: postpone inside the free venue window" },
  { machine: O, from: "OPERATIONS_LOCKED", to: "CANCELLED", reason: "VIABILITY_CANCELLED", actors: USER, description: "Gate 2: cancel and release tentative holds" },
  { machine: O, from: "POSTPONED", to: "GRANT_APPROVED", reason: "RESCHEDULE_CONFIRMED", actors: USER, description: "New dates confirmed; vendors must re-lock" },
  { machine: O, from: "READY_FOR_EVENT", to: "DELIVERY_IN_PROGRESS", reason: "DELIVERY_STARTED", actors: ["SYSTEM", "USER"], description: "Day 1 of delivery" },
  { machine: O, from: "DELIVERY_IN_PROGRESS", to: "DELIVERY_COMPLETED", reason: "DELIVERY_VERIFIED_SUCCESS", actors: ["SYSTEM", "USER"], description: "Attendance verified, evidence captured" },
  { machine: O, from: "DRAFT", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actors: USER, description: "Cancelled before quotation" },
  { machine: O, from: "QUOTED", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actors: USER, description: "Client declined" },
  { machine: O, from: "GRANT_PENDING", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actors: USER, description: "Grant refused or withdrawn" },
  { machine: O, from: "GRANT_APPROVED", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actors: USER, description: "Cancelled after grant approval" },
  { machine: O, from: "OPERATIONS_LOCKED", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actors: USER, description: "Cancelled after lock" },
  { machine: O, from: "READY_FOR_EVENT", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actors: USER, description: "Cancelled before delivery" },
  { machine: O, from: "POSTPONED", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actors: USER, description: "Postponed package cancelled" },
  { machine: F, from: "ESTIMATE", to: "GRANT_RESERVED", reason: "CLIENT_ACCEPTED_QUOTATION", actors: ANY, description: "Quotation accepted; grant value reserved" },
  { machine: F, from: "GRANT_RESERVED", to: "UPFRONT_CLAIM_SUBMITTED", reason: "UPFRONT_CLAIM_FILED", actors: USER, description: "Optional 30% upfront grant claim filed" },
  { machine: F, from: "GRANT_RESERVED", to: "CLAIM_NOT_READY", reason: "TRAINING_COMPLETED", actors: ["SYSTEM", "USER"], description: "Delivery completed; evidence collation begins" },
  { machine: F, from: "UPFRONT_CLAIM_SUBMITTED", to: "CLAIM_NOT_READY", reason: "TRAINING_COMPLETED", actors: ["SYSTEM", "USER"], description: "Delivery completed; balance claim collation begins" },
  { machine: F, from: "CLAIM_NOT_READY", to: "CLAIM_READY", reason: "CLAIM_EVIDENCE_VERIFIED", actors: ["SYSTEM", "USER"], description: "T3, JD/14, photos verified and invoice drafted" },
  { machine: F, from: "CLAIM_READY", to: "CLAIM_NOT_READY", reason: "CLAIM_EVIDENCE_REOPENED", actors: ["SYSTEM", "USER"], description: "A claim document was flagged after verification" },
  { machine: F, from: "CLAIM_READY", to: "CLAIM_SUBMITTED", reason: "CLAIM_PACK_APPROVED", actors: USER, description: "Gate 3: operator approved the claim pack for e-TRiS submission" },
  { machine: F, from: "CLAIM_SUBMITTED", to: "QUERIED", reason: "CLAIM_QUERIED_BY_HRDC", actors: USER, description: "HRD Corp raised a query" },
  { machine: F, from: "QUERIED", to: "CLAIM_SUBMITTED", reason: "QUERY_RESPONSE_RESUBMITTED", actors: USER, description: "Query answered and resubmitted" },
  { machine: F, from: "CLAIM_SUBMITTED", to: "APPROVED", reason: "CLAIM_APPROVED_BY_HRDC", actors: USER, description: "HRD Corp approved the claim" },
  { machine: F, from: "APPROVED", to: "REMITTED", reason: "REMITTANCE_RECEIVED", actors: USER, description: "Remittance advice received and banked" },
  { machine: F, from: "REMITTED", to: "SETTLED_CLOSED", reason: "AP_DISBURSEMENT_CONFIRMED", actors: USER, description: "Gate 3: every payment voucher paid with bank reference and receipt" },
  { machine: F, from: "ESTIMATE", to: "VOIDED", reason: "PACKAGE_CANCELLED", actors: ANY, description: "Package cancelled before acceptance" },
  { machine: F, from: "GRANT_RESERVED", to: "VOIDED", reason: "PACKAGE_CANCELLED", actors: ANY, description: "Package cancelled; reservation released" },
  { machine: F, from: "UPFRONT_CLAIM_SUBMITTED", to: "VOIDED", reason: "PACKAGE_CANCELLED", actors: ANY, description: "Package cancelled; upfront claim must be refunded" },
];

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | { ok: false; code: "ILLEGAL_TRANSITION" | "TRANSITION_REASON_REJECTED" | "TRANSITION_ACTOR_REJECTED"; message: string };

/** Pure check, same semantics as the SQL `fsm_check`. AGENT is never allowed. */
export function checkTransition(
  machine: Machine,
  from: string,
  to: string,
  reason: string,
  actor: "USER" | "SYSTEM" | "AGENT",
): TransitionCheck {
  const edge = TRANSITIONS.filter((t) => t.machine === machine && t.from === from && t.to === to);
  if (edge.length === 0) {
    return { ok: false, code: "ILLEGAL_TRANSITION", message: `${machine} ${from} -> ${to} is not a transition` };
  }
  const rule = edge.find((t) => t.reason === reason);
  if (!rule) {
    return {
      ok: false,
      code: "TRANSITION_REASON_REJECTED",
      message: `${machine} ${from} -> ${to} accepts ${edge.map((e) => e.reason).join(", ")}, not ${reason}`,
    };
  }
  if (!(rule.actors as readonly string[]).includes(actor)) {
    return {
      ok: false,
      code: "TRANSITION_ACTOR_REJECTED",
      message: `${reason} requires ${rule.actors.join("/")}; actor is ${actor}`,
    };
  }
  return { ok: true, rule };
}

export function outgoing(machine: Machine, from: string): TransitionRule[] {
  return TRANSITIONS.filter((t) => t.machine === machine && t.from === from);
}
