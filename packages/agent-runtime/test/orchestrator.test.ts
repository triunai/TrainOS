import { describe, expect, it } from 'vitest';

import type { AutomationRun, RunEventType, TraceNode } from '@trainos/contract';
import { APPROVAL_AURORA, POLICY_PROPOSAL_SEND, PROPOSAL_AURORA } from '@trainos/contract';

import { createDemoMockProvider } from '../src/agents/demo-script';
import { leadToProposalAgent, LEAD_TO_PROPOSAL_INPUT } from '../src/agents/lead-to-proposal';
import { createLocalFixtureClient } from '../src/fixtures/local-client';
import { MockProvider } from '../src/providers/mock';
import { ProviderRegistry } from '../src/providers/resolve';
import { ProviderError, type LLMProvider } from '../src/providers/types';
import { DEFAULT_ROUTING_CONFIG, withRouting } from '../src/routing/config';
import { Router } from '../src/routing/router';
import { ContextMeter, HANDOFF_THRESHOLD } from '../src/orchestrator/context';
import { parseVote, escalationTrigger, runJury } from '../src/orchestrator/jury';
import { extractJson, retryFromCheckpoint, runAgent, type AgentRunResult } from '../src/orchestrator/run';
import { createFixtureToolAdapter } from '../src/tools/fixture-adapter';
import { createRuntime } from '../src/runtime';

const ALL_PROVIDERS = ['anthropic', 'deepseek', 'openrouter', 'openai-compatible', 'mock'] as const;

function registryOf(provider: LLMProvider): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const id of ALL_PROVIDERS) registry.registerAs(id, provider);
  return registry;
}

async function runDemo(overrides: Partial<Parameters<typeof runAgent>[0]> = {}): Promise<AgentRunResult> {
  const provider = createDemoMockProvider();
  const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry: registryOf(provider), agentId: leadToProposalAgent.id });
  return runAgent({
    agent: leadToProposalAgent,
    router,
    tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id, context: createLocalFixtureClient() }),
    input: LEAD_TO_PROPOSAL_INPUT,
    runId: 'run_4821',
    runRef: '#4821',
    ...overrides,
  });
}

describe('end-to-end run with MockProvider', () => {
  it('produces a contract-valid AutomationRun with a policy halt', async () => {
    const result = await runDemo();
    const run: AutomationRun = result.run;

    expect(run.id).toBe('run_4821');
    expect(run.agentId).toBe(leadToProposalAgent.id);
    expect(run.orchestrator).toBe(leadToProposalAgent.orchestrator);
    expect(run.status).toBe('HALTED');
    expect(run.outcome).toBe('QUEUED_FOR_APPROVAL');
  });

  it('builds an execution tree of at least four nodes rooted at the orchestrator', async () => {
    const { run } = await runDemo();
    const nodes = run.nodes ?? [];

    expect(nodes.length).toBeGreaterThanOrEqual(4);

    const roots = nodes.filter((n) => n.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.kind).toBe('ORCHESTRATOR');

    // Every non-root node points at a node that exists.
    const ids = new Set(nodes.map((n) => n.id));
    for (const node of nodes) {
      if (node.parentId !== null) expect(ids.has(node.parentId)).toBe(true);
    }

    const subAgents = nodes.filter((n) => n.kind === 'SUB_AGENT').map((n) => n.name);
    expect(subAgents).toEqual(expect.arrayContaining(['Reader', 'Matcher', 'Drafter', 'Verifier']));
    expect(nodes.some((n) => n.kind === 'TOOL')).toBe(true);
  });

  it('hangs haltedBy on the halted node, which is what proves nothing was sent', async () => {
    const result = await runDemo();
    const halted = (result.run.nodes ?? []).filter((n) => n.status === 'HALTED');

    expect(halted).toHaveLength(1);
    expect(halted[0]?.name).toBe('actions.perform');
    expect(halted[0]?.haltedBy).toMatchObject({
      policyId: POLICY_PROPOSAL_SEND,
      approvalRequestRef: APPROVAL_AURORA,
    });

    // The orchestrator's own work succeeded; the policy stopped the tool.
    expect(result.run.nodes?.find((n) => n.parentId === null)?.status).toBe('OK');

    expect(result.haltedBy).toEqual(halted[0]?.haltedBy);
    expect(result.approval?.ref).toBe(APPROVAL_AURORA);
    expect(result.approval?.approverRole).toBe('SALES_MANAGER');
  });

  it('emits a POLICY_HALT event and a checkpoint per sub-agent', async () => {
    const { run } = await runDemo();
    const types = (run.events ?? []).map((e) => e.type);

    expect(types).toContain('POLICY_HALT');
    expect(types.filter((t) => t === 'CHECKPOINT')).toHaveLength(leadToProposalAgent.stages.length);

    const halt = run.events?.find((e) => e.type === 'POLICY_HALT');
    expect(halt?.detail['policyId']).toBe(POLICY_PROPOSAL_SEND);
    expect(halt?.detail['approvalRequestRef']).toBe(APPROVAL_AURORA);
  });

  it('fills the state card with the plan, the decisions and the budgets', async () => {
    const { run } = await runDemo();
    const card = run.stateCard;

    expect(card).toBeDefined();
    expect(card?.goal).toContain('ENQ-2026-0912');
    expect(card?.plan).toHaveLength(leadToProposalAgent.stages.length + 1);
    expect(card?.plan.at(-1)?.status).toBe('HALTED');
    expect(card?.plan.slice(0, -1).every((s) => s.status === 'DONE')).toBe(true);
    expect(card?.decisions.length).toBeGreaterThan(0);
    expect(card?.constraints).toEqual(leadToProposalAgent.constraints);
    expect(card?.recordPointers).toContain(PROPOSAL_AURORA);
    expect(card?.budgets.tokens.used).toBeGreaterThan(0);
    expect(card?.budgets.cost.limit.currency).toBe('MYR');
  });

  it('sums tokens and cost from the nodes rather than counting them twice', async () => {
    const { run } = await runDemo();
    const nodes = run.nodes ?? [];
    const summed = nodes.reduce(
      (acc, n) => ({ in: acc.in + (n.tokens?.in ?? 0), out: acc.out + (n.tokens?.out ?? 0) }),
      { in: 0, out: 0 },
    );
    expect(run.tokens).toEqual(summed);
    expect(run.cost.amount).toBe(nodes.reduce((acc, n) => acc + (n.cost?.amount ?? 0), 0));
  });

  it('reads the value from the quotation, not from anything the model said', async () => {
    const result = await runDemo();
    // DECISIONS §7 / architecture doc 03 decision 2: PRG-0031 is a package
    // price of RM 18,500 ex-SST, which is what APV-01's threshold sees.
    expect(result.haltedBy?.reason).toContain('RM 18,500');

    const quotation = result.blackboard.toolCalls.find((c) => c.op === 'quotations.compute');
    const data = quotation?.result.data as { proposalValue: { amount: number }; marginRate: number; lines: unknown[] };
    expect(data.proposalValue.amount).toBe(1_850_000);
    expect(data.marginRate).toBe(0.41);
    expect(data.lines).toHaveLength(1);
  });

  it('populates provenance for the AI badge', async () => {
    const { provenance } = await runDemo();
    expect(provenance.origin).toBe('AI_GENERATED');
    expect(provenance.agentId).toBe(leadToProposalAgent.id);
    expect(provenance.runId).toBe('run_4821');
    expect(provenance.confidence).toBeGreaterThan(0);
    expect(provenance.model).toBeDefined();
    expect(provenance.provider).toBeDefined();
    expect(provenance.sources?.length).toBeGreaterThan(0);
  });

  it('names the model that actually answered, never the one the tier binds', async () => {
    const { run } = await runDemo();
    // A mock run must not claim to have called Claude.
    for (const node of run.nodes ?? []) {
      if (node.model) expect(node.model).toBe('mock-model');
    }
    expect(run.tiersUsed).toEqual(expect.arrayContaining(['CHEAP', 'MID', 'STRONG_1']));
  });
});

describe('handoff at 60% context', () => {
  it('fires the meter exactly at the threshold', () => {
    const meter = new ContextMeter({ contextWindow: 1000 });
    meter.add(599);
    expect(meter.shouldHandoff).toBe(false);
    meter.add(1);
    expect(meter.fraction).toBeCloseTo(HANDOFF_THRESHOLD);
    expect(meter.shouldHandoff).toBe(true);
    meter.reset();
    expect(meter.shouldHandoff).toBe(false);
  });

  it('emits HANDOFF and restarts the node instead of truncating', async () => {
    // A tiny context window makes a normal-sized call cross 60% at once.
    const config = withRouting(DEFAULT_ROUTING_CONFIG, {
      tiers: { CHEAP: { contextWindow: 2_000 }, MID: { contextWindow: 2_000 } },
    });
    const provider = createDemoMockProvider();
    const router = new Router({ config, registry: registryOf(provider) });

    const result = await runAgent({
      agent: leadToProposalAgent,
      router,
      tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id, context: createLocalFixtureClient() }),
      input: LEAD_TO_PROPOSAL_INPUT,
      runId: 'run_handoff',
      runRef: '#handoff',
    });

    const handoffs = (result.run.events ?? []).filter((e) => e.type === 'HANDOFF');
    expect(handoffs.length).toBeGreaterThan(0);

    const detail = handoffs[0]?.detail;
    expect(detail?.['atContextPct']).toBeGreaterThanOrEqual(HANDOFF_THRESHOLD);
    expect(Array.isArray(detail?.['restartedNodes'])).toBe(true);

    // A restarted node is recorded as RETRIED, not silently as OK.
    const restarted = (result.run.nodes ?? []).filter((n) => n.status === 'RETRIED');
    expect(restarted.length).toBeGreaterThan(0);
    expect(restarted[0]?.retries).toBeGreaterThan(0);

    // The run still reaches the gate. A handoff slows a run; it never loses it.
    expect(result.run.status).toBe('HALTED');
  });
});

describe('escalation', () => {
  it('records an ESCALATION when the router falls to another tier', async () => {
    const demo = createDemoMockProvider();
    const registry = new ProviderRegistry();
    // Nothing serves deepseek, so CHEAP and MID both fall to anthropic.
    registry.registerAs('anthropic', demo);
    registry.registerAs('openrouter', demo);

    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry });
    const result = await runAgent({
      agent: leadToProposalAgent,
      router,
      tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id, context: createLocalFixtureClient() }),
      input: LEAD_TO_PROPOSAL_INPUT,
      runId: 'run_escalate',
      runRef: '#escalate',
    });

    const escalations = (result.run.events ?? []).filter((e) => e.type === 'ESCALATION');
    expect(escalations.length).toBeGreaterThan(0);
    expect(escalations[0]?.detail['from']).toBe('MID');
    expect(escalations[0]?.detail['reason']).toContain('no key configured for deepseek');
  });
});

describe('budget pause stops a run', () => {
  it('halts with BUDGET_CAP and emits BUDGET_EXCEEDED', async () => {
    const provider = new MockProvider({
      fallback: { text: '{"confidence":0.9}', usage: { in: 3_000_000, out: 0 } },
    });
    const config = withRouting(DEFAULT_ROUTING_CONFIG, {
      budgets: [{ scope: 'AGENT', key: leadToProposalAgent.id, cap: { amount: 100, currency: 'MYR' } }],
    });
    const router = new Router({ config, registry: registryOf(provider), agentId: leadToProposalAgent.id });

    const result = await runAgent({
      agent: leadToProposalAgent,
      router,
      tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id, context: createLocalFixtureClient() }),
      input: LEAD_TO_PROPOSAL_INPUT,
      runId: 'run_budget',
      runRef: '#budget',
    });

    expect(result.run.status).toBe('HALTED');
    expect(result.run.outcome).toBe('BUDGET_CAP');

    const exceeded = (result.run.events ?? []).find((e) => e.type === 'BUDGET_EXCEEDED');
    expect(exceeded).toBeDefined();
    expect(exceeded?.detail['scope']).toBe('AGENT');
    expect(exceeded?.detail['key']).toBe(leadToProposalAgent.id);

    // No approval was raised: the run stopped before it could submit.
    expect(result.approval).toBeUndefined();
  });
});

describe('jury', () => {
  it('fires only when a trigger is met', () => {
    const policy = DEFAULT_ROUTING_CONFIG.entries.find((e) => e.actionType === 'PROPOSAL_SEND')!.jury;
    const base = { proposition: 'p', evidence: 'e', confidence: 0.95 };

    expect(escalationTrigger(policy, base)).toBeUndefined();
    expect(escalationTrigger(policy, { ...base, confidence: 0.5 })).toBe('LOW_CONFIDENCE');
    expect(
      escalationTrigger(policy, { ...base, value: { amount: 6_000_000, currency: 'MYR' } }),
    ).toBe('HIGH_VALUE');
    expect(escalationTrigger(policy, { ...base, firstOfKind: true })).toBe('FIRST_OF_KIND');
  });

  it('refuses to run a GATE jury inside a live run', async () => {
    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry: registryOf(new MockProvider()) });
    const outcome = await runJury({
      policy: { mode: 'GATE', quorum: 2, of: 3, tiers: ['STRONG_1'] },
      question: { proposition: 'p', evidence: 'e', confidence: 0.1 },
      router,
    });
    expect(outcome.ran).toBe(false);
    expect(outcome.skippedReason).toContain('promotion time');
  });

  it('never blocks on a SAMPLE jury', async () => {
    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry: registryOf(new MockProvider()) });
    const outcome = await runJury({
      policy: { mode: 'SAMPLE', quorum: 2, of: 3, tiers: ['STRONG_1'], sampleRate: 1 },
      question: { proposition: 'p', evidence: 'e', confidence: 0.1 },
      router,
    });
    expect(outcome.ran).toBe(false);
    expect(outcome.skippedReason).toContain('never block');
  });

  it('counts an unreadable verdict as dissent', () => {
    expect(parseVote('STRONG_1', 'm', 'VERDICT: AGREE\nREASON: fine').agrees).toBe(true);
    expect(parseVote('STRONG_1', 'm', 'I think it looks good to me!').agrees).toBe(false);
    expect(parseVote('STRONG_1', 'm', 'VERDICT: DISAGREE\nREASON: margin').dissent).toBe('margin');
  });

  it('records votes and the trigger on the run, and quorum in provenance', async () => {
    const result = await runDemo();
    expect(result.jury?.ran).toBe(true);
    expect(result.jury?.trigger).toBe('FIRST_OF_KIND');
    expect(result.jury?.votes).toHaveLength(3);
    expect(result.jury?.reached).toBe(true);

    const juryEvent = (result.run.events ?? []).find((e) => e.type === 'JURY');
    expect(juryEvent?.detail['quorum']).toBe(2);
    expect(juryEvent?.detail['of']).toBe(3);
    expect(result.provenance.jury?.agreed).toHaveLength(3);
  });

  it('records a disagreement without overturning the proposal', async () => {
    const dissenting = new MockProvider({
      fallback: (req) => {
        if ((req.system ?? '').startsWith('You are one juror')) {
          return { text: 'VERDICT: DISAGREE\nREASON: Prefers waiting for Daniel Wong in December' };
        }
        return { text: '{"confidence":0.9}' };
      },
    });
    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry: registryOf(dissenting) });
    const result = await runAgent({
      agent: leadToProposalAgent,
      router,
      tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id, context: createLocalFixtureClient() }),
      input: LEAD_TO_PROPOSAL_INPUT,
      runId: 'run_jury',
      runRef: '#jury',
    });

    expect(result.jury?.reached).toBe(false);
    expect(result.provenance.jury?.dissented.length).toBeGreaterThan(0);

    // The jury is advisory. The action still went to the gate, and the gate
    // still stopped it — a human weighs the dissent on M02-S02.
    expect(result.run.status).toBe('HALTED');
    expect(result.approval?.ref).toBe(APPROVAL_AURORA);

    const questions = result.run.stateCard?.openQuestions ?? [];
    expect(questions.some((q) => q.includes('Jury did not reach'))).toBe(true);
  });
});

describe('retry from checkpoint', () => {
  it('resumes at the stored stage and marks the earlier ones skipped', async () => {
    const first = await runDemo();
    const checkpoint = first.checkpoints[1];
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.stageIndex).toBe(2);

    const provider = createDemoMockProvider();
    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry: registryOf(provider) });
    const resumed = await retryFromCheckpoint(checkpoint!, {
      agent: leadToProposalAgent,
      router,
      tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id, context: createLocalFixtureClient() }),
      input: LEAD_TO_PROPOSAL_INPUT,
      runId: 'run_4821_retry',
      runRef: '#4821r',
    });

    const plan = resumed.run.stateCard?.plan ?? [];
    expect(plan[0]?.status).toBe('SKIPPED');
    expect(plan[1]?.status).toBe('SKIPPED');
    expect(plan[2]?.status).toBe('DONE');

    const names = (resumed.run.nodes ?? []).filter((n) => n.kind === 'SUB_AGENT').map((n) => n.name);
    expect(names).not.toContain('Reader');
    expect(names).toContain('Drafter');

    // A resumed run still reaches the gate and still halts.
    expect(resumed.run.status).toBe('HALTED');
  });
});

describe('run failure', () => {
  it('reports NO_PROVIDER rather than throwing when nothing is reachable', async () => {
    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry: new ProviderRegistry() });
    const result = await runAgent({
      agent: leadToProposalAgent,
      router,
      tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id }),
      runId: 'run_dead',
      runRef: '#dead',
    });

    expect(result.run.status).toBe('FAILED');
    expect(result.run.failure?.code).toBe('NO_PROVIDER');
    expect(result.run.failure?.retryable).toBe(true);
    expect(result.approval).toBeUndefined();
  });

  it('rethrows a non-retryable provider error as a failed run, not a fallback', async () => {
    const provider = new MockProvider({
      fallback: { error: new ProviderError('anthropic', 'HTTP 400: bad schema', { status: 400 }) },
    });
    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry: registryOf(provider) });
    const result = await runAgent({
      agent: leadToProposalAgent,
      router,
      tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id }),
      runId: 'run_400',
      runRef: '#400',
    });
    expect(result.run.status).toBe('FAILED');
    expect(result.run.failure?.message).toContain('bad schema');
  });
});

describe('createRuntime', () => {
  it('falls back to the mock when no key is configured, keeping the routing config', async () => {
    const runtime = createRuntime({
      agentId: leadToProposalAgent.id,
      keyStore: { list: () => [], get: () => undefined },
    });
    expect(runtime.usingMock).toBe(true);
    // Every tier still resolves, so a no-key run walks the same chains.
    for (const tier of ['CHEAP', 'MID', 'STRONG_1', 'STRONG_2', 'STRONG_3'] as const) {
      expect(runtime.router.isReachable(tier)).toBe(true);
    }
  });
});

describe('lenient JSON extraction', () => {
  it('finds an object inside prose and fences', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nHope that helps')).toEqual({ a: 1 });
    expect(extractJson('{"a":{"b":[1,2]}}')).toEqual({ a: { b: [1, 2] } });
    expect(extractJson('nothing here')).toBeUndefined();
  });

  it('is not fooled by braces inside strings', () => {
    expect(extractJson('{"a":"} not the end {"}')).toEqual({ a: '} not the end {' });
  });
});

/** Every event type the run is capable of emitting, for the record. */
export const EXPECTED_EVENT_TYPES: RunEventType[] = [
  'ESCALATION',
  'JURY',
  'TRUNCATION',
  'HANDOFF',
  'CHECKPOINT',
  'POLICY_HALT',
  'BUDGET_EXCEEDED',
];

export type { TraceNode };
