/**
 * The demo chain: an enquiry arrives, a proposal is stopped at the gate.
 *
 * ENQ-2026-0912 → Reader extracts what Aurora asked for → Matcher finds
 * ORG-0114 and ranks PRG-0031 → Drafter prices QUO-2026-0184 and writes
 * PRO-2026-0184 → Verifier checks it against the floor, the margin and PDPA
 * consent → the orchestrator submits `PROPOSAL_SEND` → APV-01 queues it as
 * APV-2026-0771 and the run halts.
 *
 * The fixture data is fixed, so the *shape* of the run is reproducible: four
 * sub-agents, a policy halt, an approval. What the models say inside each node
 * varies, which is the point — this is a real agent making real calls, not a
 * recording.
 */

import {
  AGENT_PROPOSAL,
  ENQUIRY_AURORA,
  ORCHESTRATOR_PROPOSAL,
  ORG_AURORA,
  PROGRAMME_LEADING_CHANGE,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  TEMPLATE_EMAIL_PROPOSAL,
  TNA_AURORA,
  TRAINER_FARAH_REF,
  type Money,
} from '@trainos/contract';
import type { AgentDefinition, AgentStage, Blackboard, SubmitPlan } from '../orchestrator/run';

/* ------------------------------------------------------------------ *
 * Shared prompt furniture
 * ------------------------------------------------------------------ */

const HOUSE_RULES = [
  'You work for a Malaysian training provider. Money is MYR, in integer sen:',
  '1850000 is RM 18,500.00. Never invent a figure — every number you state must',
  'have come out of a tool.',
  '',
  'Report your confidence honestly. It gates what you are allowed to do without a',
  'human, so an inflated number is not optimism, it is a safety failure.',
].join('\n');

const JSON_TAIL = (fields: string) =>
  [
    '',
    'End your reply with a single JSON object and nothing after it:',
    fields,
  ].join('\n');

/* ------------------------------------------------------------------ *
 * Stages
 * ------------------------------------------------------------------ */

const reader: AgentStage = {
  name: 'Reader',
  planLabel: 'Read the enquiry and extract what the client asked for',
  actionType: 'ENQUIRY_ARCHIVE',
  maxTurns: 4,
  escalateBelow: 0.75,
  tools: ['enquiries.get'],
  system: [
    'You are the Reader. You read one enquiry and extract what it actually asks',
    'for. You do not recommend anything — that is somebody else\'s node.',
    '',
    HOUSE_RULES,
    '',
    'Extract only what is stated or clearly implied. A headcount the client did',
    'not give is not a headcount you may supply.',
  ].join('\n'),
  prompt: (ctx) =>
    [
      `Read enquiry ${String(ctx.input['enquiryRef'] ?? ENQUIRY_AURORA)} and extract the requirement.`,
      JSON_TAIL(
        '{ "topic": string, "pax": number, "days": number, "monthWanted": string, ' +
          '"hrdcClaim": boolean, "organisationHint": string, "senderEmail": string, ' +
          '"confidence": number, "openQuestions": string[] }',
      ),
    ].join('\n'),
};

const matcher: AgentStage = {
  name: 'Matcher',
  planLabel: 'Match the organisation, the programme and an accredited trainer',
  actionType: 'OPPORTUNITY_CONVERT',
  maxTurns: 6,
  escalateBelow: 0.7,
  tools: ['organisations.search', 'programmes.search', 'trainers.availability'],
  system: [
    'You are the Matcher. You identify the organisation, rank the catalogue against',
    'the requirement, and confirm an accredited trainer is free in the window.',
    '',
    HOUSE_RULES,
    '',
    'A trainer without a valid TTT certificate is not an option however convenient',
    'the dates are. Say which programme you rejected and why — the runner-up is',
    'what an approver checks first.',
  ].join('\n'),
  prompt: (ctx) => {
    const reading = ctx.blackboard.facts['Reader'] ?? {};
    return [
      'The Reader extracted this requirement:',
      JSON.stringify(reading, null, 2),
      '',
      'Find the organisation, rank programmes against the requirement, and check',
      'trainer availability across the month the client asked for.',
      JSON_TAIL(
        '{ "organisationRef": string, "programmeRef": string, "programmeTitle": string, ' +
          '"runnerUpRef": string, "whyNotRunnerUp": string, "trainerRef": string, ' +
          '"dates": string[], "confidence": number, "decisions": string[], ' +
          '"recordPointers": string[] }',
      ),
    ].join('\n');
  },
};

const drafter: AgentStage = {
  name: 'Drafter',
  planLabel: 'Price the engagement and draft the proposal',
  actionType: 'PROPOSAL_DRAFT',
  maxTurns: 6,
  escalateBelow: 0.7,
  tools: ['quotations.compute', 'proposals.draft'],
  system: [
    'You are the Drafter. You price the engagement and write the proposal.',
    '',
    HOUSE_RULES,
    '',
    'Lines are truth and totals are their sum. Never state a total you worked out',
    'yourself — quote the one the costing tool returned. A per-pax figure that does',
    'not multiply back to the total is informational and must not become a line.',
    '',
    'Write the sections for a plant HR manager, not for a procurement portal.',
  ].join('\n'),
  prompt: (ctx) => {
    const reading = ctx.blackboard.facts['Reader'] ?? {};
    const match = ctx.blackboard.facts['Matcher'] ?? {};
    return [
      'Requirement:',
      JSON.stringify(reading, null, 2),
      '',
      'Match:',
      JSON.stringify(match, null, 2),
      '',
      'Price it at list, then draft the proposal with sections for objectives,',
      'approach, the trainer, the investment and the HRD Corp claim.',
      JSON_TAIL(
        '{ "quotationRef": string, "proposalRef": string, "totalSen": number, ' +
          '"marginRate": number, "confidence": number, "decisions": string[], ' +
          '"openQuestions": string[] }',
      ),
    ].join('\n');
  },
};

const verifier: AgentStage = {
  name: 'Verifier',
  planLabel: 'Verify against the floor price, the margin and PDPA consent',
  actionType: 'PROPOSAL_SEND',
  maxTurns: 4,
  escalateBelow: 0.8,
  tools: ['quotations.compute'],
  system: [
    'You are the Verifier. You are the last node before a human sees this, and your',
    'job is to find what is wrong with it, not to bless it.',
    '',
    HOUSE_RULES,
    '',
    'Check four things and say so explicitly for each:',
    '  1. margin at or above the 0.35 floor,',
    '  2. the total reconciles to the sum of the lines,',
    '  3. the trainer holds a TTT certificate valid on the delivery dates,',
    '  4. the recipient has consented to be contacted (PDPA).',
    '',
    'If you cannot verify something from the tool results, it is an open question,',
    'not a pass. Lower your confidence accordingly.',
  ].join('\n'),
  prompt: (ctx) => {
    const draft = ctx.blackboard.facts['Drafter'] ?? {};
    const match = ctx.blackboard.facts['Matcher'] ?? {};
    return [
      'Draft:',
      JSON.stringify(draft, null, 2),
      '',
      'Match:',
      JSON.stringify(match, null, 2),
      '',
      'Recompute the costing yourself and verify the four checks.',
      JSON_TAIL(
        '{ "marginOk": boolean, "totalsReconcile": boolean, "trainerAccredited": boolean, ' +
          '"consentOk": boolean, "verdict": string, "confidence": number, ' +
          '"openQuestions": string[] }',
      ),
    ].join('\n');
  },
};

/* ------------------------------------------------------------------ *
 * Submission
 * ------------------------------------------------------------------ */

/**
 * Assemble the `PROPOSAL_SEND` from what the stages established.
 *
 * Deterministic on purpose. The sub-agents decide *what* to propose; the
 * orchestrator's submission is bookkeeping over their conclusions, so the run
 * reaches the gate — and therefore the halt — regardless of how a particular
 * model phrased its last reply. The value is read from the quotation the tool
 * returned, never from anything a model said, which is architecture doc 03's
 * decision 2 honoured in the one place it can be broken here.
 */
function submit(blackboard: Blackboard): SubmitPlan {
  const draft = blackboard.facts['Drafter'] ?? {};
  const match = blackboard.facts['Matcher'] ?? {};
  const verdict = blackboard.facts['Verifier'] ?? {};

  const quotationCall = [...blackboard.toolCalls]
    .reverse()
    .find((call) => call.op === 'quotations.compute' && call.result.ok);
  const quotation = quotationCall?.result.data as
    | { proposalValue?: Money; total?: Money; marginRate?: number; floorMarginRate?: number }
    | undefined;

  // `proposalValue`, never `total`: SST is a pass-through the client is not
  // being asked to approve, and reading the gross would push a proposal over
  // a threshold on tax alone.
  const value: Money = quotation?.proposalValue ?? { amount: 0, currency: 'MYR' };
  const programmeRef = str(match['programmeRef']) ?? PROGRAMME_LEADING_CHANGE;
  const trainerRef = str(match['trainerRef']) ?? TRAINER_FARAH_REF;
  const proposalRef = str(draft['proposalRef']) ?? PROPOSAL_AURORA;

  const confidence = clamp(
    num(verdict['confidence']) ?? num(draft['confidence']) ?? 0.8,
  );

  const reasoning = [
    `${programmeRef} fits the extracted requirement;`,
    `${trainerRef} is accredited and free in the window;`,
    quotation?.marginRate !== undefined
      ? `margin ${quotation.marginRate} against a ${quotation.floorMarginRate ?? 0.35} floor.`
      : 'costing computed from the rate card.',
  ].join(' ');

  return {
    type: 'PROPOSAL_SEND',
    targetRef: proposalRef,
    payload: {
      channel: 'EMAIL',
      templateId: TEMPLATE_EMAIL_PROPOSAL,
      to: ['nurul.hassan@auroramfg.com.my'],
      attachPdf: true,
    },
    confidence,
    reasoning,
    evidence: [
      { type: 'EMAIL', ref: ENQUIRY_AURORA, excerpt: '30 managers, November, leading through change' },
      { type: 'TNA', ref: TNA_AURORA },
      { type: 'PROGRAMME', ref: programmeRef },
      { type: 'TRAINER_AVAILABILITY', ref: trainerRef },
      {
        type: 'QUOTATION',
        ref: str(draft['quotationRef']) ?? QUOTATION_AURORA,
        excerpt:
          quotation?.marginRate !== undefined
            ? `margin ${quotation.marginRate}, floor ${quotation.floorMarginRate ?? 0.35}`
            : undefined,
      },
    ],
    value,
    // Aurora has prior engagements but no prior *proposal*, which is what
    // APV-01's `firstProposalToOrg` condition actually tests.
    firstOfKind: true,
  };
}

/* ------------------------------------------------------------------ *
 * The agent
 * ------------------------------------------------------------------ */

export const leadToProposalAgent: AgentDefinition = {
  id: AGENT_PROPOSAL,
  name: 'Proposal Agent',
  orchestrator: ORCHESTRATOR_PROPOSAL,
  orchestratorTier: 'MID',
  goal:
    "Turn enquiry ENQ-2026-0912 into a priced, verified proposal for Aurora Manufacturing, " +
    "and submit it for approval within the client's November window.",
  constraints: [
    'November delivery',
    'max 2 days off-floor',
    'margin ≥ 0.35',
    'HRDC claimable',
    'trainer must hold a valid TTT certificate on the delivery dates',
  ],
  guardrails: [
    'APV-01 value threshold',
    'No PII in prompt',
    'Rate card ≤ 24h old',
    'Approved template version',
    'Max 8 tool calls',
  ],
  trigger: { type: 'ENQUIRY_RECEIVED', ref: ENQUIRY_AURORA },
  stages: [reader, matcher, drafter, verifier],
  submit,
};

/** The input the demo run starts from. */
export const LEAD_TO_PROPOSAL_INPUT: Record<string, unknown> = {
  enquiryRef: ENQUIRY_AURORA,
  organisationRef: ORG_AURORA,
};

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
