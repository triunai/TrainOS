/**
 * Does the run actually satisfy the contract?
 *
 * Two halves, and both are needed. The compile-time half proves the object's
 * *type* is `AutomationRun`; it says nothing about whether a required field
 * happens to hold `undefined` at runtime, which is exactly what a screen
 * reading `node.status` crashes on. The runtime walk covers that gap.
 */

import { describe, expect, it } from 'vitest';

import {
  ACTION_TYPES,
  RUN_EVENT_TYPES,
  RUN_STATUSES,
  RUN_STEP_STATUSES,
  TIER_KEYS,
  TRACE_NODE_KINDS,
  PROVENANCE_ORIGINS,
  AI_PROVIDERS,
  type AutomationRun,
  type Provenance,
  type RunEvent,
  type RunStateCard,
  type TraceNode,
} from '@trainos/contract';

import { createDemoMockProvider } from '../src/agents/demo-script';
import { leadToProposalAgent, LEAD_TO_PROPOSAL_INPUT } from '../src/agents/lead-to-proposal';
import { createLocalFixtureClient } from '../src/fixtures/local-client';
import { ProviderRegistry } from '../src/providers/resolve';
import { DEFAULT_ROUTING_CONFIG } from '../src/routing/config';
import { Router } from '../src/routing/router';
import { runAgent } from '../src/orchestrator/run';
import { createFixtureToolAdapter } from '../src/tools/fixture-adapter';
import { TOOL_OPERATIONS, WIRE_NAMES, operationForWireName } from '../src/tools/adapter';
import { toolDefsFor, validateArgs } from '../src/tools/definitions';

async function demoRun(): Promise<AutomationRun> {
  const provider = createDemoMockProvider();
  const registry = new ProviderRegistry();
  for (const id of ['anthropic', 'deepseek', 'openrouter', 'mock'] as const) {
    registry.registerAs(id, provider);
  }
  const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry });
  const result = await runAgent({
    agent: leadToProposalAgent,
    router,
    tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id, context: createLocalFixtureClient() }),
    input: LEAD_TO_PROPOSAL_INPUT,
    runId: 'run_4821',
    runRef: '#4821',
  });
  return result.run;
}

/** Required fields per the contract's interfaces. `parentId` may be null. */
const REQUIRED_RUN = ['id', 'ref', 'agentId', 'trigger', 'startedAt', 'durationMs', 'cost', 'tokens', 'status', 'guardrails'] as const;
const REQUIRED_NODE = ['id', 'parentId', 'kind', 'name', 'status'] as const;
const REQUIRED_CARD = ['goal', 'plan', 'decisions', 'constraints', 'recordPointers', 'openQuestions', 'budgets'] as const;

function assertDefined(host: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of keys) {
    expect(key in host, `${where}.${key} is missing`).toBe(true);
    expect(host[key], `${where}.${key} is undefined`).not.toBeUndefined();
  }
}

describe('the run satisfies the contract at compile time', () => {
  it('types as AutomationRun and its parts type as their own interfaces', async () => {
    const run = await demoRun();

    // If any of these annotations were wrong, `tsc` would fail — which is the
    // assertion. The runtime expectations below are the second half.
    const typed: AutomationRun = run;
    const nodes: TraceNode[] = typed.nodes ?? [];
    const events: RunEvent[] = typed.events ?? [];
    const card: RunStateCard | undefined = typed.stateCard;

    expect(typed satisfies AutomationRun).toBeTruthy();
    expect(nodes.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(card).toBeDefined();
  });
});

describe('no required field is undefined at runtime', () => {
  it('walks the run', async () => {
    const run = await demoRun();
    assertDefined(run as unknown as Record<string, unknown>, REQUIRED_RUN, 'run');

    expect(run.trigger.type).toBeTypeOf('string');
    expect(run.cost.currency).toBe('MYR');
    expect(Number.isFinite(run.cost.amount)).toBe(true);
    expect(Number.isFinite(run.tokens.in)).toBe(true);
    expect(Number.isFinite(run.tokens.out)).toBe(true);
    expect(Number.isFinite(run.durationMs)).toBe(true);
    expect(Array.isArray(run.guardrails)).toBe(true);
  });

  it('walks every node, and every optional field it did populate', async () => {
    const run = await demoRun();
    for (const node of run.nodes ?? []) {
      assertDefined(node as unknown as Record<string, unknown>, REQUIRED_NODE, `node ${node.id}`);
      expect(TRACE_NODE_KINDS).toContain(node.kind);
      expect(RUN_STEP_STATUSES).toContain(node.status);
      if (node.tier !== undefined) expect(TIER_KEYS).toContain(node.tier);
      if (node.provider !== undefined) expect(AI_PROVIDERS).toContain(node.provider);
      if (node.cost !== undefined) expect(node.cost.currency).toBe('MYR');
      if (node.cacheHitRate !== undefined) {
        expect(node.cacheHitRate).toBeGreaterThanOrEqual(0);
        expect(node.cacheHitRate).toBeLessThanOrEqual(1);
      }
      if (node.haltedBy !== undefined) {
        assertDefined(
          node.haltedBy as unknown as Record<string, unknown>,
          ['policyId', 'approvalRequestRef', 'reason'],
          `node ${node.id}.haltedBy`,
        );
      }
    }
  });

  it('walks every event and every step', async () => {
    const run = await demoRun();

    for (const event of run.events ?? []) {
      expect(RUN_EVENT_TYPES).toContain(event.type);
      expect(event.detail).toBeDefined();
      expect(typeof event.detail).toBe('object');
      // `at` is optional in the type but the runtime always sets it, and the
      // M18-S04 event rows are ordered by it.
      expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    }

    for (const step of run.steps ?? []) {
      assertDefined(
        step as unknown as Record<string, unknown>,
        ['seq', 'tool', 'status', 'durationMs'],
        `step ${step.seq}`,
      );
      expect(RUN_STEP_STATUSES).toContain(step.status);
    }

    // Steps are sequential from 1, because §10 renders them as a numbered list.
    const seqs = (run.steps ?? []).map((s) => s.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('walks the state card', async () => {
    const run = await demoRun();
    const card = run.stateCard!;
    assertDefined(card as unknown as Record<string, unknown>, REQUIRED_CARD, 'stateCard');

    for (const step of card.plan) {
      assertDefined(step as unknown as Record<string, unknown>, ['n', 'label', 'status'], `plan ${step.n}`);
    }
    assertDefined(
      card.budgets as unknown as Record<string, unknown>,
      ['tokens', 'cost'],
      'stateCard.budgets',
    );
    expect(card.budgets.tokens.limit).toBeGreaterThan(0);
    expect(card.budgets.cost.limit.currency).toBe('MYR');
  });

  it('reports statuses and tiers the contract actually catalogues', async () => {
    const run = await demoRun();
    expect(RUN_STATUSES).toContain(run.status);
    for (const tier of run.tiersUsed ?? []) expect(TIER_KEYS).toContain(tier);
  });
});

describe('provenance satisfies the envelope', () => {
  it('carries only enum values the contract knows', async () => {
    const provider = createDemoMockProvider();
    const registry = new ProviderRegistry();
    for (const id of ['anthropic', 'deepseek', 'openrouter', 'mock'] as const) {
      registry.registerAs(id, provider);
    }
    const result = await runAgent({
      agent: leadToProposalAgent,
      router: new Router({ config: DEFAULT_ROUTING_CONFIG, registry }),
      tools: createFixtureToolAdapter({ agentId: leadToProposalAgent.id, context: createLocalFixtureClient() }),
      input: LEAD_TO_PROPOSAL_INPUT,
    });

    const provenance: Provenance = result.provenance;
    expect(PROVENANCE_ORIGINS).toContain(provenance.origin);
    if (provenance.provider) expect(AI_PROVIDERS).toContain(provenance.provider);
    if (provenance.tier) expect(TIER_KEYS).toContain(provenance.tier);
    for (const source of provenance.sources ?? []) {
      expect(source.type).toBeTypeOf('string');
      expect(source.ref).toBeTypeOf('string');
    }
  });
});

describe('tool definitions', () => {
  it('uses wire names OpenAI will accept', () => {
    for (const op of TOOL_OPERATIONS) {
      const wire = WIRE_NAMES[op];
      // ^[a-zA-Z0-9_-]{1,64}$ — dots are rejected, which is why the dotted
      // operation names are flattened for the wire.
      expect(wire).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(operationForWireName(wire)).toBe(op);
    }
  });

  it('ships a JSON Schema for every operation', () => {
    const defs = toolDefsFor(TOOL_OPERATIONS);
    expect(defs).toHaveLength(TOOL_OPERATIONS.length);
    for (const def of defs) {
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.parameters['type']).toBe('object');
      expect(def.parameters['properties']).toBeDefined();
    }
  });

  it('returns a readable failure rather than throwing on bad arguments', () => {
    const bad = validateArgs('enquiries.get', {});
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('ref');

    expect(validateArgs('enquiries.get', { ref: 'ENQ-2026-0912' }).ok).toBe(true);
  });

  it('only proposes action types the contract catalogues', () => {
    const plan = leadToProposalAgent.submit({ facts: {}, toolCalls: [], notes: {} });
    expect([...ACTION_TYPES, 'PROPOSAL_DRAFT']).toContain(plan.type);
  });
});
