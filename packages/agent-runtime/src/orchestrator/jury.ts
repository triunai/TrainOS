/**
 * The jury — gate, sample, escalate.
 *
 * DECISIONS §2 settles the economics and architecture doc 03 §5 settles the
 * mechanics, and the important part of both is what the jury is *not*: it is
 * not a step that runs on every action. Three modes:
 *
 *   GATE      promotion time, against the golden set. Never in a live run, so
 *             this module refuses to run it and says why.
 *   SAMPLE    5% of gated actions, after the human decides. Never blocks — it
 *             is scheduled, and the run does not wait for it.
 *   ESCALATE  blocks, but only when a trigger fires: confidence < 0.70, or
 *             value > RM 50,000, or first-of-kind.
 *
 * Disagreement is recorded, not resolved. A 2-of-3 quorum that fails does not
 * overturn the agent's proposal; it emits `JuryDisagreed` and lands on the
 * approval as advisory input, because a human's judgement does not wait on
 * three models.
 */

import type {
  JuryPolicy,
  JuryVote,
  Money,
  ProvenanceJury,
  TierKey,
} from '@trainos/contract';
import type { Router } from '../routing/router';

/** What the jury is being asked about. */
export interface JuryQuestion {
  /** One paragraph. The jurors see this and nothing else about the run. */
  proposition: string;
  /** Everything a juror needs to judge it. */
  evidence: string;
  /** The agent's own confidence, which is itself a trigger. */
  confidence: number;
  /** The action's monetary value, read from the record. */
  value?: Money;
  /** New client, new programme or new trainer. */
  firstOfKind?: boolean;
}

export interface JuryOutcome {
  ran: boolean;
  /** Why it did not run, when it did not. */
  skippedReason?: string;
  votes: JuryVote[];
  quorum: number;
  of: number;
  /** True when at least `quorum` jurors agreed. */
  reached: boolean;
  /** The trigger that made an ESCALATE jury run. */
  trigger?: 'LOW_CONFIDENCE' | 'HIGH_VALUE' | 'FIRST_OF_KIND';
  /** Shaped for `Provenance.jury`. Absent when the jury did not run. */
  provenance?: ProvenanceJury;
}

/**
 * Which trigger fires, if any.
 *
 * Order matters only for reporting — any one of the three is sufficient — and
 * confidence leads because it is the one the agent itself controls.
 */
export function escalationTrigger(
  policy: JuryPolicy,
  question: JuryQuestion,
): JuryOutcome['trigger'] | undefined {
  const triggers = policy.triggers;
  if (!triggers) return undefined;
  if (question.confidence < triggers.minConfidence) return 'LOW_CONFIDENCE';
  if (question.value && question.value.amount > triggers.maxValue.amount) return 'HIGH_VALUE';
  if (triggers.firstOfKind && question.firstOfKind) return 'FIRST_OF_KIND';
  return undefined;
}

const JUROR_SYSTEM = [
  'You are one juror of three reviewing another agent\'s proposed action before a',
  'human approver sees it. You are not the decision-maker and you are not being',
  'asked to be agreeable.',
  '',
  'Answer in exactly this form, nothing else:',
  '  VERDICT: AGREE or DISAGREE',
  '  REASON: one sentence',
  '',
  'Disagree when the proposition is unsupported by the evidence, breaches a stated',
  'constraint, or rests on a figure that does not reconcile. Agreeing because the',
  'reasoning sounds plausible is the failure mode this jury exists to catch.',
].join('\n');

export interface RunJuryOptions {
  policy: JuryPolicy;
  question: JuryQuestion;
  router: Router;
  /** Called per juror so the run can trace each call. */
  onJuror?: (tier: TierKey, vote: JuryVote, tokens: { in: number; out: number }) => void;
}

/**
 * Run a blocking jury.
 *
 * Jurors are polled in sequence rather than in parallel, because a juror that
 * falls back to a different tier changes what the next juror should be — two
 * jurors that both fell back to `STRONG_2` are one opinion counted twice, and
 * this loop skips a tier that has already voted under another name.
 */
export async function runJury(opts: RunJuryOptions): Promise<JuryOutcome> {
  const { policy, question, router } = opts;

  if (policy.mode === 'GATE') {
    return skipped(policy, 'GATE juries run at promotion time against the golden set, not in a run');
  }
  if (policy.mode === 'SAMPLE') {
    return skipped(policy, 'SAMPLE juries run after the human decides and never block');
  }

  const trigger = escalationTrigger(policy, question);
  if (!trigger) {
    return skipped(policy, 'No ESCALATE trigger fired');
  }

  const votes: JuryVote[] = [];
  const votedTiers = new Set<TierKey>();

  for (const tier of policy.tiers.slice(0, policy.of)) {
    if (!router.isReachable(tier)) continue;

    try {
      const call = await router.call(tier, {
        system: JUROR_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `PROPOSITION\n${question.proposition}\n\nEVIDENCE\n${question.evidence}`,
          },
        ],
        maxTokens: 256,
      });

      // Two jurors served by the same model are one opinion, not two.
      if (votedTiers.has(call.tier)) continue;
      votedTiers.add(call.tier);

      const vote = parseVote(call.tier, call.result.model, call.result.text);
      votes.push(vote);
      opts.onJuror?.(call.tier, vote, { in: call.result.usage.in, out: call.result.usage.out });
    } catch {
      // A juror that cannot be reached does not vote. It never counts as
      // agreement — a jury that fails open is worse than no jury.
    }
  }

  const agreed = votes.filter((v) => v.agrees);
  return {
    ran: votes.length > 0,
    votes,
    quorum: policy.quorum,
    of: policy.of,
    reached: agreed.length >= policy.quorum,
    trigger,
    provenance:
      votes.length > 0
        ? {
            quorum: policy.quorum,
            of: policy.of,
            agreed: agreed.map((v) => v.model),
            dissented: votes
              .filter((v) => !v.agrees)
              .map((v) => ({ model: v.model, note: v.dissent ?? 'No reason given' })),
          }
        : undefined,
  };
}

/**
 * Read a juror's answer.
 *
 * Defaults to **disagreement** when the verdict cannot be parsed. An
 * unreadable answer is not consent, and a jury whose parse failures count as
 * approval would quietly stop working the day a model changed its formatting.
 */
export function parseVote(tier: TierKey, model: string, text: string): JuryVote {
  const verdictMatch = /VERDICT:\s*(AGREE|DISAGREE)/i.exec(text);
  const reasonMatch = /REASON:\s*(.+)/i.exec(text);
  const agrees = verdictMatch?.[1]?.toUpperCase() === 'AGREE';
  const reason = reasonMatch?.[1]?.trim();

  return {
    tier,
    model,
    agrees,
    dissent: agrees ? undefined : (reason ?? 'Verdict could not be read; recorded as dissent'),
  };
}

/**
 * A `SAMPLE` jury, scheduled rather than awaited.
 *
 * Returns immediately with the promise. The caller attaches a handler for
 * drift monitoring and moves on; nothing in the run's control flow depends on
 * it, which is the whole distinction between SAMPLE and ESCALATE.
 */
export function scheduleSampleJury(
  opts: RunJuryOptions & { sampleRate?: number; random?: () => number },
): { sampled: boolean; result?: Promise<JuryOutcome> } {
  const rate = opts.sampleRate ?? opts.policy.sampleRate ?? 0;
  const roll = (opts.random ?? Math.random)();
  if (roll >= rate) return { sampled: false };

  // Run it as an ESCALATE-shaped poll, but off the run's critical path.
  const escalateShaped: JuryPolicy = {
    ...opts.policy,
    mode: 'ESCALATE',
    triggers: opts.policy.triggers ?? {
      minConfidence: 1,
      maxValue: { amount: 0, currency: 'MYR' },
      firstOfKind: true,
    },
  };
  return { sampled: true, result: runJury({ ...opts, policy: escalateShaped }) };
}

function skipped(policy: JuryPolicy, reason: string): JuryOutcome {
  return {
    ran: false,
    skippedReason: reason,
    votes: [],
    quorum: policy.quorum,
    of: policy.of,
    reached: false,
  };
}
