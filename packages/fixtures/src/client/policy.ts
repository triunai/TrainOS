/**
 * §3 · Policy evaluation, in the order the contract states.
 *
 * 1. `type` → the autonomy level granted to `requestedBy`. Human requesters
 *    skip to step 3.
 * 2. `payload` monetary value against the policy thresholds.
 * 3. Context flags computed server-side, never sent by the client.
 * 4. `confidence` against the agent's minimum for that action.
 * 5. Requester role against the policy's `approverRole` — a user cannot
 *    approve their own request.
 *
 * The contract does not publish the per-action confidence minimum from step 4,
 * so `MINIMUM_CONFIDENCE` below is a fixture table and is reported as a gap.
 */

import type {
  ActionRequest,
  AutonomyLevel,
  GovernedActionType,
  Money,
  Policy,
  PolicyContextFlags,
  Role,
} from "@trainos/contract";
import type { FixtureStore } from "./store";
import { byIdOrRef } from "./store";
import { matchesClause } from "./query";
import { evaluateFloors } from "./pricing";

/**
 * Step 4 — the confidence an agent must clear before its proposal is even
 * considered. Below it the action comes back as a draft for a human.
 * Anything money-moving, client-committing or HRDC-touching sits higher.
 */
export const MINIMUM_CONFIDENCE: Partial<Record<GovernedActionType, number>> = {
  ENQUIRY_ARCHIVE: 0.9,
  OPPORTUNITY_CONVERT: 0.75,
  PROPOSAL_DRAFT: 0.6,
  PROPOSAL_SEND: 0.8,
  QUOTATION_APPLY: 0.85,
  DISCOUNT_APPROVE: 0.9,
  TRAINER_BOOK: 0.85,
  FOLLOWUP_SEND: 0.75,
  REMINDER_SEND: 0.8,
  INVOICE_CREATE: 0.9,
  HRDC_PACKET_MARK_SUBMITTED: 0.95,
  RULE_CHANGE_APPROVE: 0.8,
};

export const DEFAULT_MINIMUM_CONFIDENCE = 0.7;

/** The monetary value an action carries, if any — step 2's input. */
export const payloadValue = (request: ActionRequest): Money | undefined => {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  for (const key of ["value", "sellPrice", "amount", "cap", "claimValue"]) {
    const candidate = payload[key];
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as Money).amount === "number"
    ) {
      return candidate as Money;
    }
  }
  return undefined;
};

/** Step 3 — the five flags the server computes and the client never sends. */
export const computeContextFlags = (store: FixtureStore, request: ActionRequest): PolicyContextFlags => {
  const proposal = byIdOrRef(store.proposals, request.targetRef);
  const opportunity = proposal ? byIdOrRef(store.opportunities, proposal.opportunityRef) : undefined;
  const organisationRef =
    opportunity?.organisationRef ??
    byIdOrRef(store.engagements, request.targetRef)?.organisationRef ??
    byIdOrRef(store.invoices, request.targetRef)?.organisationRef;

  const firstProposalToOrg = (() => {
    if (!organisationRef) return false;
    const sentStatuses = new Set(["SENT", "VIEWED", "ACCEPTED", "LOST"]);
    return !store.proposals.some((candidate) => {
      if (candidate.ref === proposal?.ref) return false;
      const candidateOpportunity = byIdOrRef(store.opportunities, candidate.opportunityRef);
      return candidateOpportunity?.organisationRef === organisationRef && sentStatuses.has(candidate.status);
    });
  })();

  const belowFloorPrice = (() => {
    const quotation =
      byIdOrRef(store.quotations, request.targetRef) ??
      (proposal ? store.quotations.find((row) => row.proposalRef === proposal.ref) : undefined);
    if (!quotation) return false;
    const proposed = payloadValue(request) ?? quotation.sellPrice;
    const programme = (() => {
      const linked = byIdOrRef(store.proposals, quotation.proposalRef);
      const linkedOpportunity = linked ? byIdOrRef(store.opportunities, linked.opportunityRef) : undefined;
      if (!linkedOpportunity) return undefined;
      const engagement = store.engagements.find(
        (row) => row.opportunityRef === linkedOpportunity.ref,
      );
      return engagement ? byIdOrRef(store.programmes, engagement.programmeRef) : undefined;
    })();
    return evaluateFloors(quotation, proposed, programme).breached;
  })();

  const overdueBalanceOnAccount = organisationRef
    ? store.receivables.some((row) => row.organisation.ref === organisationRef && row.daysOverdue > 0)
    : false;

  const attendanceLocked = (() => {
    const payload = (request.payload ?? {}) as { day?: number };
    const engagement = byIdOrRef(store.engagements, request.targetRef);
    if (!engagement) return false;
    const day = payload.day ?? 1;
    return store.attendanceSheets[`${engagement.ref}::${day}`]?.status === "LOCKED";
  })();

  const deadlineWithinDays = (() => {
    const engagement = byIdOrRef(store.engagements, request.targetRef);
    if (!engagement) return 9999;
    const packet = store.claimPackets.find((row) => row.engagementRef === engagement.ref);
    return packet?.daysRemaining ?? 9999;
  })();

  return {
    firstProposalToOrg,
    belowFloorPrice,
    overdueBalanceOnAccount,
    attendanceLocked,
    deadlineWithinDays,
  };
};

/**
 * Steps 2 and 3 — the first policy for this action type whose conditions hold.
 *
 * A policy with no conditions always matches: those are the types DECISIONS §1
 * caps at act-with-approval regardless of value.
 */
export const matchPolicy = (
  policies: readonly Policy[],
  request: ActionRequest,
  context: PolicyContextFlags,
): Policy | undefined => {
  const subject = { payload: request.payload ?? {}, context, type: request.type, targetRef: request.targetRef };
  return policies.find((policy) => {
    if (policy.actionType !== request.type) return false;
    if (policy.conditions.length === 0) return true;
    const results = policy.conditions.map((condition) =>
      matchesClause(subject, { field: condition.field, op: condition.op, value: condition.value }),
    );
    return policy.combinator === "ANY" ? results.some(Boolean) : results.every(Boolean);
  });
};

/** Step 1 — the autonomy granted to an agent for this action type. */
export const grantedAutonomy = (
  store: FixtureStore,
  agentId: string,
  type: GovernedActionType,
): { level: AutonomyLevel; paused: boolean; agentPaused: boolean } | undefined => {
  const agent = store.agents.find((row) => row.id === agentId);
  if (!agent) return undefined;
  const grant = agent.autonomy.find((row) => row.actionType === type);
  if (!grant) return { level: "OBSERVE", paused: false, agentPaused: agent.status === "PAUSED" };
  return { level: grant.level, paused: grant.paused, agentPaused: agent.status === "PAUSED" };
};

/**
 * Step 5 — who the approval goes to.
 *
 * A user cannot approve their own request, so a requester holding the
 * approver role is skipped and, when nobody else holds it, the policy's
 * escalation role takes over.
 */
export const assignApprover = (
  store: FixtureStore,
  policy: Policy,
  requesterId: string,
): { id: string; name: string; role: Role } | undefined => {
  const pool = store.users.filter((user) => user.role === policy.approverRole && user.id !== requesterId);
  const first = pool[0];
  if (first) return { id: first.id, name: first.name, role: first.role };
  if (!policy.escalateToRole) return undefined;
  const escalated = store.users.filter(
    (user) => user.role === policy.escalateToRole && user.id !== requesterId,
  )[0];
  return escalated ? { id: escalated.id, name: escalated.name, role: escalated.role } : undefined;
};
