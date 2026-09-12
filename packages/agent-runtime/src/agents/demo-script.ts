/**
 * A mock model that actually plays the demo.
 *
 * `MockProvider`'s default reply ends every turn immediately, which proves the
 * loop terminates and nothing else. This responder instead reads the request
 * the way a model would — which tools am I holding, which have I already
 * called — and drives the whole lead-to-proposal chain through real tool
 * executions against the fixture data.
 *
 * So `--provider mock` is not a stub: it produces a genuine `AutomationRun`
 * with real tool results, a real quotation, a real jury and a real policy
 * halt. Only the language is fake.
 */

import {
  ENQUIRY_AURORA,
  ORG_AURORA,
  PROGRAMME_CONFLICT,
  PROGRAMME_LEADING_CHANGE,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  TRAINER_FARAH_REF,
} from '@trainos/contract';
import { MockProvider, type MockTurn } from '../providers/mock';
import type { ChatRequest } from '../providers/types';
import { WIRE_NAMES } from '../tools/adapter';

/** Tool names already answered in this conversation. */
function answeredTools(req: ChatRequest): Set<string> {
  const answered = new Set<string>();
  for (const message of req.messages) {
    if (message.role === 'tool') answered.add(message.name);
  }
  return answered;
}

/** Arguments the mock uses for each tool. Fixed, like the fixture data. */
const CALL_ARGS: Record<string, Record<string, unknown>> = {
  [WIRE_NAMES['enquiries.get']]: { ref: ENQUIRY_AURORA },
  [WIRE_NAMES['organisations.search']]: { query: 'auroramfg.com.my' },
  [WIRE_NAMES['programmes.search']]: {
    query: 'leading teams through change, supervisors avoiding difficult conversations',
    tags: ['leadership', 'change'],
  },
  [WIRE_NAMES['trainers.availability']]: {
    programmeRef: PROGRAMME_LEADING_CHANGE,
    from: '2026-11-01',
    to: '2026-11-30',
  },
  [WIRE_NAMES['quotations.compute']]: { programmeRef: PROGRAMME_LEADING_CHANGE, pax: 30, days: 2 },
  [WIRE_NAMES['proposals.draft']]: {
    organisationRef: ORG_AURORA,
    programmeRef: PROGRAMME_LEADING_CHANGE,
    quotationRef: QUOTATION_AURORA,
    sections: [
      {
        key: 'objectives',
        heading: 'What this programme is for',
        body:
          'Thirty plant managers and supervisors are leading their teams through a ' +
          'restructure. Two days, on site, focused on the conversations they are ' +
          'currently avoiding.',
      },
      {
        key: 'approach',
        heading: 'How we run it',
        body:
          'Day one builds the change narrative each supervisor has to carry. Day two ' +
          'is practice: the difficult conversation, rehearsed against their own cases.',
      },
      {
        key: 'trainer',
        heading: 'Who delivers it',
        body: 'Farah Aziz, TTT certified to 30 June 2027, available 12–13 November.',
      },
      {
        key: 'investment',
        heading: 'Investment',
        body: 'A package price for up to 30 participants, with materials itemised separately.',
      },
      {
        key: 'hrdc',
        heading: 'HRD Corp claim',
        body:
          'The programme is claimable. Grant application must be approved at least 14 ' +
          'calendar days before the start date under the in-house lead-time rule.',
      },
    ],
  },
};

/** The JSON each stage ends on, keyed by the tool it is recognisable from. */
const STAGE_OUTPUT: Record<string, string> = {
  [WIRE_NAMES['enquiries.get']]: JSON.stringify({
    topic: 'Leading teams through a restructure; supervisors avoiding difficult conversations',
    pax: 30,
    days: 2,
    monthWanted: '2026-11',
    hrdcClaim: true,
    organisationHint: 'Aurora Manufacturing Sdn Bhd',
    senderEmail: 'nurul.hassan@auroramfg.com.my',
    confidence: 0.88,
    openQuestions: [],
  }),
  [WIRE_NAMES['organisations.search']]: JSON.stringify({
    organisationRef: ORG_AURORA,
    programmeRef: PROGRAMME_LEADING_CHANGE,
    programmeTitle: 'Leading Through Change',
    runnerUpRef: PROGRAMME_CONFLICT,
    whyNotRunnerUp:
      'Conflict to Collaboration fits the friction but not the restructure; it caps at 25 pax against a stated 30.',
    trainerRef: TRAINER_FARAH_REF,
    dates: ['2026-11-12', '2026-11-13'],
    confidence: 0.91,
    decisions: [
      'PRG-0031 over PRG-0018 (0.91 vs 0.78)',
      'Farah Aziz — the only accredited match inside the November window',
    ],
    recordPointers: [ORG_AURORA, PROGRAMME_LEADING_CHANGE, TRAINER_FARAH_REF],
  }),
  [WIRE_NAMES['proposals.draft']]: JSON.stringify({
    quotationRef: QUOTATION_AURORA,
    proposalRef: PROPOSAL_AURORA,
    totalSen: 1_850_000,
    marginRate: 0.41,
    confidence: 0.84,
    decisions: ['List price held — no discount applied'],
    openQuestions: ['Section 5 HRDC wording unverified against the 2026 circular'],
  }),
};

const VERIFIER_OUTPUT = JSON.stringify({
  marginOk: true,
  totalsReconcile: true,
  trainerAccredited: true,
  consentOk: true,
  verdict: 'Send. Margin clears the floor, totals reconcile to the lines, trainer accredited.',
  confidence: 0.86,
  openQuestions: ['HRDC section wording not verified against the 2026 circular'],
});

/**
 * Decide this turn's reply from the request alone.
 *
 * Stateless on purpose: the orchestrator may hand a node off and restart it
 * mid-stage, and a responder holding a turn counter would answer the restarted
 * node as though it were further along than it is.
 */
export function demoResponder(req: ChatRequest): MockTurn {
  const system = req.system ?? '';

  if (system.startsWith('You are one juror')) {
    return {
      text: [
        'VERDICT: AGREE',
        'REASON: The programme match, the accredited trainer and the margin are all supported by the cited records.',
      ].join('\n'),
      usage: { in: 900, out: 40 },
    };
  }

  if (system.startsWith('You are the orchestrator')) {
    return {
      text: [
        'Plan confirmed: read the enquiry, match organisation and programme, price and',
        'draft, verify against the floor and consent, then submit for approval.',
        'OPEN QUESTION: whether the November window survives the 14-day HRD Corp lead time.',
      ].join('\n'),
      usage: { in: 620, out: 110, cacheRead: 280 },
    };
  }

  const offered = (req.tools ?? []).map((t) => t.name);
  const answered = answeredTools(req);
  const pending = offered.find((name) => !answered.has(name));

  if (pending) {
    return {
      text: '',
      toolCalls: [
        {
          id: `toolu_${pending}_${answered.size}`,
          name: pending,
          input: CALL_ARGS[pending] ?? {},
        },
      ],
      usage: { in: 1_400 + answered.size * 900, out: 120, cacheRead: 400 },
    };
  }

  // Most specific tool wins. The Drafter and the Verifier both hold
  // `quotations_compute`, so keying on the first offered tool would give the
  // Drafter the Verifier's answer.
  const signature = [
    WIRE_NAMES['proposals.draft'],
    WIRE_NAMES['organisations.search'],
    WIRE_NAMES['enquiries.get'],
  ].find((name) => offered.includes(name));

  const text =
    (signature ? STAGE_OUTPUT[signature] : undefined) ??
    (offered.includes(WIRE_NAMES['quotations.compute']) ? VERIFIER_OUTPUT : 'Done.');

  return { text, usage: { in: 3_200, out: 220, cacheRead: 1_100 } };
}

/** A `MockProvider` wired to {@link demoResponder}. */
export function createDemoMockProvider(): MockProvider {
  return new MockProvider({ fallback: demoResponder, model: 'mock-model' });
}
