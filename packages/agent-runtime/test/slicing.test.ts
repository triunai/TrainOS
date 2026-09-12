/**
 * The constraint from architecture doc 05 D13, as tests.
 *
 * An Edge Function worker is killed at the wall clock and background tasks
 * share it, so a long run must yield and resume. The assertion that matters is
 * not "a checkpoint was written" — it is that a run split across workers is
 * **the same run**: one id, one root, contiguous node numbering, no work done
 * twice, and the same terminal state it would have reached in one go.
 */

import { describe, expect, it } from 'vitest';

import { APPROVAL_AURORA, type TraceNode } from '@trainos/contract';

import { createDemoMockProvider } from '../src/agents/demo-script';
import { leadToProposalAgent, LEAD_TO_PROPOSAL_INPUT } from '../src/agents/lead-to-proposal';
import { createLocalFixtureClient } from '../src/fixtures/local-client';
import { ProviderRegistry } from '../src/providers/resolve';
import type { LLMProvider } from '../src/providers/types';
import { DEFAULT_ROUTING_CONFIG, withRouting } from '../src/routing/config';
import { Router } from '../src/routing/router';
import {
  DEFAULT_SLICE_WALL_CLOCK_MS,
  InMemoryCheckpointStore,
  SliceMeter,
  deserialiseCheckpoint,
  serialiseCheckpoint,
} from '../src/orchestrator/checkpoint';
import { runAgent, runAgentToCompletion, type RunAgentOptions } from '../src/orchestrator/run';
import { createFixtureToolAdapter } from '../src/tools/fixture-adapter';

const ALL_PROVIDERS = ['anthropic', 'deepseek', 'openrouter', 'openai-compatible', 'mock'] as const;

function registryOf(provider: LLMProvider): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const id of ALL_PROVIDERS) registry.registerAs(id, provider);
  return registry;
}

/**
 * A clock the test drives.
 *
 * Reading it costs a millisecond, so bookkeeping is nearly free; time passes
 * because a *model call* took time, which {@link slowProvider} arranges. An
 * earlier version advanced the clock on every read, which made trace
 * bookkeeping look like minutes of work and produced slices that yielded
 * before doing anything at all.
 */
function fakeClock(start = Date.parse('2026-09-11T09:14:02+08:00')) {
  let nowMs = start;
  return {
    now: (): Date => new Date(nowMs++),
    advance: (ms: number): void => {
      nowMs += ms;
    },
  };
}

/** Wraps a provider so every call takes a known amount of wall clock. */
function slowProvider(
  inner: LLMProvider,
  clock: { advance: (ms: number) => void },
  msPerCall: number,
): LLMProvider {
  return {
    id: inner.id,
    label: inner.label,
    chat: async (req) => {
      clock.advance(msPerCall);
      return inner.chat(req);
    },
  };
}

/** A router whose every tier is served by one slow mock. */
function slowRouter(clock: { advance: (ms: number) => void }, msPerCall: number): Router {
  return new Router({
    config: DEFAULT_ROUTING_CONFIG,
    registry: registryOf(slowProvider(createDemoMockProvider(), clock, msPerCall)),
  });
}

function baseOptions(overrides: Partial<RunAgentOptions> = {}): RunAgentOptions {
  return {
    agent: leadToProposalAgent,
    router: new Router({
      config: DEFAULT_ROUTING_CONFIG,
      registry: registryOf(createDemoMockProvider()),
    }),
    tools: createFixtureToolAdapter({
      agentId: leadToProposalAgent.id,
      context: createLocalFixtureClient(),
    }),
    input: LEAD_TO_PROPOSAL_INPUT,
    runId: 'run_4821',
    runRef: '#4821',
    ...overrides,
  };
}

/** Node ids in order, so a resumed run can be checked for contiguity. */
function nodeIds(nodes: readonly TraceNode[]): string[] {
  return nodes.map((n) => n.id);
}

/** Collapse repeats of the same stage caused by a slice boundary. */
function dedupeAdjacent(values: readonly string[]): string[] {
  return values.filter((value, index) => value !== values[index - 1]);
}

describe('slice budget', () => {
  it('defaults to the 300s yield point from doc 05 D13', () => {
    expect(DEFAULT_SLICE_WALL_CLOCK_MS).toBe(300_000);
    // Comfortably under the 400s worker lifetime, with room for the yield
    // itself to write a checkpoint and return.
    expect(DEFAULT_SLICE_WALL_CLOCK_MS).toBeLessThan(400_000);
  });

  it('reports the wall clock spent in this slice and across the run separately', () => {
    let nowMs = 1_000;
    const meter = new SliceMeter({
      budget: { wallClockMs: 500 },
      carriedElapsedMs: 9_000,
      now: () => nowMs,
    });

    meter.noteTokens(10); // one model call, so the one-call floor is satisfied

    nowMs = 1_200;
    expect(meter.sliceElapsedMs(nowMs)).toBe(200);
    expect(meter.totalElapsedMs(nowMs)).toBe(9_200);
    expect(meter.exhausted(nowMs)).toBeUndefined();

    nowMs = 1_500;
    expect(meter.exhausted(nowMs)).toBe('WALL_CLOCK');
  });

  it('always grants one model call, however small the budget', () => {
    // Otherwise a budget smaller than a single call yields before doing
    // anything and the run livelocks across workers.
    const meter = new SliceMeter({ budget: { wallClockMs: 0, tokens: 0 }, now: () => 0 });
    expect(meter.exhausted(10_000)).toBeUndefined();

    meter.noteTokens(1);
    expect(meter.exhausted(10_000)).toBe('TOKEN_BUDGET');
  });

  it('rations tokens per slice, not cumulatively', () => {
    // The cumulative reading livelocks: a resumed slice would start already
    // over its limit and yield forever without making progress.
    const meter = new SliceMeter({
      budget: { tokens: 100 },
      carriedTokens: 10_000,
      now: () => 0,
    });

    expect(meter.exhausted(0)).toBeUndefined();
    expect(meter.totalTokens).toBe(10_000);

    meter.noteTokens(100);
    expect(meter.exhausted(0)).toBe('TOKEN_BUDGET');
    expect(meter.totalTokens).toBe(10_100);
  });

  it('is unbounded on tokens unless a ration is set', () => {
    const meter = new SliceMeter({ now: () => 0 });
    meter.noteTokens(50_000_000);
    expect(meter.exhausted(0)).toBeUndefined();
  });
});

describe('a run forced to yield resumes and completes', () => {
  it('yields mid-run with a checkpoint and a RESUMABLE disposition', async () => {
    const clock = fakeClock();
    const store = new InMemoryCheckpointStore();

    const first = await runAgent(
      baseOptions({
        now: clock.now,
        router: slowRouter(clock, 25_000), // 25s per model call
        slice: { wallClockMs: 60_000 },
        checkpoints: store,
      }),
    );

    expect(first.disposition).toBe('RESUMABLE');
    expect(first.resumeFrom).toBeTruthy();
    // `RUNNING` is the truthful contract status — still running, not here.
    expect(first.run.status).toBe('RUNNING');
    expect(first.run.outcome).toBe('RESUMABLE');
    expect(first.approval).toBeUndefined();

    const stored = await store.load(first.resumeFrom!);
    expect(stored).toBeDefined();
    expect(stored?.runId).toBe('run_4821');
    expect(['WALL_CLOCK', 'TOKEN_BUDGET']).toContain(stored?.reason);

    // The trace says why it stopped, so a reviewer is not left guessing.
    const handoffs = (first.run.events ?? []).filter((e) => e.type === 'HANDOFF');
    expect(handoffs.length).toBeGreaterThan(0);
    expect(handoffs.at(-1)?.detail['checkpointId']).toBe(first.resumeFrom);
  });

  it('yields at two nodes, then resumes to the same completed run', async () => {
    const store = new InMemoryCheckpointStore();
    // Tight enough that the run cannot finish in one slice.
    const clock = fakeClock();

    const first = await runAgent(
      baseOptions({
        now: clock.now,
        router: slowRouter(clock, 25_000),
        slice: { wallClockMs: 60_000 },
        checkpoints: store,
      }),
    );
    expect(first.disposition).toBe('RESUMABLE');

    const firstNodes = first.run.nodes ?? [];
    const firstSubAgents = firstNodes.filter((n) => n.kind === 'SUB_AGENT').map((n) => n.name);
    expect(firstSubAgents.length).toBeGreaterThanOrEqual(1);
    expect(first.run.status).toBe('RUNNING');

    // A fresh worker: new router, new tools, new everything except the
    // checkpoint id and the store it was written to.
    const second = await runAgent(
      baseOptions({
        resumeFrom: first.resumeFrom!,
        checkpoints: store,
        slice: { wallClockMs: 600_000 },
      }),
    );

    expect(second.disposition).toBe('COMPLETE');
    expect(second.run.status).toBe('HALTED');
    expect(second.run.outcome).toBe('QUEUED_FOR_APPROVAL');
    expect(second.approval?.ref).toBe(APPROVAL_AURORA);

    // Same run, not a second one.
    expect(second.run.id).toBe(first.run.id);
    expect(second.run.ref).toBe(first.run.ref);
    expect(second.run.agentId).toBe(first.run.agentId);
    expect(second.run.startedAt).toBe(first.run.startedAt);

    // One root across the whole run: the resumed slice did not plan again.
    expect((second.run.nodes ?? []).filter((n) => n.parentId === null)).toHaveLength(1);

    // Contiguous node numbering: n0, n1, n2, … with no restart and no gap.
    const ids = nodeIds(second.run.nodes ?? []);
    expect(ids).toEqual(ids.map((_, i) => `n${i}`));

    // The first slice's nodes are still there, unchanged, at the front.
    expect(ids.slice(0, firstNodes.length)).toEqual(nodeIds(firstNodes));

    // Every plan step ran, and the last one halted at the gate.
    const plan = second.run.stateCard?.plan ?? [];
    expect(plan.filter((s) => s.status === 'DONE')).toHaveLength(leadToProposalAgent.stages.length);
    expect(plan.at(-1)?.status).toBe('HALTED');

    // Steps stay sequential from 1 across the slice boundary.
    const seqs = (second.run.steps ?? []).map((s) => s.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    // Duration spans both slices rather than resetting with the new worker.
    expect(second.run.durationMs).toBeGreaterThan(first.run.durationMs);
  });

  it('reaches the same terminal state as an unsliced run', async () => {
    const whole = await runAgent(baseOptions({ slice: { wallClockMs: 600_000 } }));

    const store = new InMemoryCheckpointStore();
    const clock = fakeClock();
    const { result: sliced, slices } = await runAgentToCompletion(
      baseOptions({
        now: clock.now,
        router: slowRouter(clock, 25_000),
        slice: { wallClockMs: 60_000 },
        checkpoints: store,
      }),
    );

    expect(slices).toBeGreaterThan(1);
    expect(sliced.disposition).toBe('COMPLETE');

    // The parts a slice boundary must not change.
    expect(sliced.run.status).toBe(whole.run.status);
    expect(sliced.run.outcome).toBe(whole.run.outcome);
    expect(sliced.approval?.ref).toBe(whole.approval?.ref);
    expect(sliced.haltedBy?.policyId).toBe(whole.haltedBy?.policyId);

    const subAgents = (n: typeof sliced.run.nodes) =>
      (n ?? [])
        .filter((x) => x.kind === 'SUB_AGENT' && !x.name.startsWith('Juror'))
        .map((x) => x.name);

    // Every stage ran, in order. A stage that spanned a slice boundary shows
    // up more than once, which is the honest rendering: each slice's share of
    // the work is its own node, and the trace should not hide the seam.
    const slicedStages = subAgents(sliced.run.nodes);
    expect(dedupeAdjacent(slicedStages)).toEqual(subAgents(whole.run.nodes));

    // Of the nodes for one stage, the partial ones are RETRIED and the one
    // that finished it is OK.
    const matcherNodes = (sliced.run.nodes ?? []).filter((n) => n.name === 'Matcher');
    expect(matcherNodes.at(-1)?.status).toBe('OK');
    for (const partial of matcherNodes.slice(0, -1)) expect(partial.status).toBe('RETRIED');

    // The conversation carried across the boundary, so the sliced run did not
    // pay for the same tool calls twice.
    expect(sliced.blackboard.toolCalls.length).toBe(whole.blackboard.toolCalls.length);
  });

  it('does not redo a stage that had already completed', async () => {
    const store = new InMemoryCheckpointStore();
    const clock = fakeClock();
    const first = await runAgent(
      baseOptions({
        now: clock.now,
        router: slowRouter(clock, 25_000),
        slice: { wallClockMs: 60_000 },
        checkpoints: store,
      }),
    );
    expect(first.disposition).toBe('RESUMABLE');

    const completed = (first.run.stateCard?.plan ?? [])
      .filter((s) => s.status === 'DONE')
      .map((s) => s.label);

    const second = await runAgent(
      baseOptions({
        resumeFrom: first.resumeFrom!,
        checkpoints: store,
        slice: { wallClockMs: 600_000 },
      }),
    );

    const names = (second.run.nodes ?? [])
      .filter((n) => n.kind === 'SUB_AGENT' && !n.name.startsWith('Juror'))
      .map((n) => n.name);

    // Each stage that had already *finished* before the yield appears exactly
    // once: the resumed slice inherited its node and did not run it again.
    for (const label of completed) {
      const stage = leadToProposalAgent.stages.find((s) => s.planLabel === label);
      if (!stage) continue;
      expect(names.filter((n) => n === stage.name)).toHaveLength(1);
    }
  });
});

describe('checkpoints cross a process boundary', () => {
  it('survives a JSON round trip unchanged', async () => {
    const store = new InMemoryCheckpointStore();
    await runAgent(baseOptions({ checkpoints: store, slice: { wallClockMs: 600_000 } }));

    const all = await store.list('run_4821');
    expect(all.length).toBeGreaterThan(0);

    for (const checkpoint of all) {
      const round = deserialiseCheckpoint(serialiseCheckpoint(checkpoint));
      expect(round).toEqual(checkpoint);
    }
  });

  it('resumes from an id alone, the way a re-enqueued job would', async () => {
    const store = new InMemoryCheckpointStore();
    const clock = fakeClock();
    const first = await runAgent(
      baseOptions({
        now: clock.now,
        router: slowRouter(clock, 25_000),
        slice: { wallClockMs: 60_000 },
        checkpoints: store,
      }),
    );
    expect(first.disposition).toBe('RESUMABLE');

    // Everything the next worker has is a string. It reads the row itself.
    const id: string = first.resumeFrom!;
    const second = await runAgent(
      baseOptions({ resumeFrom: id, checkpoints: store, slice: { wallClockMs: 600_000 } }),
    );

    expect(second.run.id).toBe('run_4821');
    expect(second.disposition).toBe('COMPLETE');
  });

  it('refuses an id with no store rather than silently starting over', async () => {
    await expect(
      runAgent(baseOptions({ resumeFrom: 'ckpt_run_4821_2_stage_complete' })),
    ).rejects.toThrow(/no checkpoint store/i);
  });

  it('reports an unknown checkpoint id', async () => {
    await expect(
      runAgent(baseOptions({ resumeFrom: 'ckpt_nope', checkpoints: new InMemoryCheckpointStore() })),
    ).rejects.toThrow(/No checkpoint ckpt_nope/);
  });

  it('writes a checkpoint after every completed sub-agent', async () => {
    const store = new InMemoryCheckpointStore();
    await runAgent(baseOptions({ checkpoints: store, slice: { wallClockMs: 600_000 } }));

    const stageCheckpoints = (await store.list('run_4821')).filter(
      (c) => c.reason === 'STAGE_COMPLETE',
    );
    expect(stageCheckpoints).toHaveLength(leadToProposalAgent.stages.length);
    expect(stageCheckpoints.map((c) => c.stageIndex)).toEqual([1, 2, 3, 4]);
  });
});

describe('the context handoff writes the same record', () => {
  it('stores a CONTEXT_HANDOFF checkpoint in the same format', async () => {
    const config = withRouting(DEFAULT_ROUTING_CONFIG, {
      tiers: { CHEAP: { contextWindow: 2_000 }, MID: { contextWindow: 2_000 } },
    });
    const store = new InMemoryCheckpointStore();

    const result = await runAgent(
      baseOptions({
        router: new Router({ config, registry: registryOf(createDemoMockProvider()) }),
        checkpoints: store,
        slice: { wallClockMs: 600_000 },
      }),
    );

    const handoffs = (await store.list('run_4821')).filter((c) => c.reason === 'CONTEXT_HANDOFF');
    expect(handoffs.length).toBeGreaterThan(0);

    const checkpoint = handoffs[0]!;
    // Same shape as a yield's checkpoint: a whole run, resumable on its own.
    expect(checkpoint.runId).toBe('run_4821');
    expect(checkpoint.trace.nodes.length).toBeGreaterThan(0);
    expect(checkpoint.stateCard.goal).toBeTruthy();
    expect(checkpoint.pendingNodeId).toBeTruthy();
    expect(checkpoint.orchestratorNodeId).toBe('n0');
    expect(deserialiseCheckpoint(serialiseCheckpoint(checkpoint))).toEqual(checkpoint);

    // And the run itself still completed — a handoff is not a yield.
    expect(result.disposition).toBe('COMPLETE');
    expect(result.run.status).toBe('HALTED');
  });

  it('can be resumed from, like any other checkpoint', async () => {
    const config = withRouting(DEFAULT_ROUTING_CONFIG, {
      tiers: { CHEAP: { contextWindow: 2_000 }, MID: { contextWindow: 2_000 } },
    });
    const store = new InMemoryCheckpointStore();
    await runAgent(
      baseOptions({
        router: new Router({ config, registry: registryOf(createDemoMockProvider()) }),
        checkpoints: store,
        slice: { wallClockMs: 600_000 },
      }),
    );

    const handoff = (await store.list('run_4821')).find((c) => c.reason === 'CONTEXT_HANDOFF')!;
    const resumed = await runAgent(
      baseOptions({
        resumeFrom: handoff.id,
        checkpoints: store,
        slice: { wallClockMs: 600_000 },
      }),
    );

    expect(resumed.run.id).toBe('run_4821');
    expect(resumed.disposition).toBe('COMPLETE');
    expect((resumed.run.nodes ?? []).filter((n) => n.parentId === null)).toHaveLength(1);
  });
});

describe('runAgentToCompletion', () => {
  it('drives a run across as many slices as it needs', async () => {
    const store = new InMemoryCheckpointStore();
    const clock = fakeClock();
    const { result, slices } = await runAgentToCompletion(
      baseOptions({
        now: clock.now,
        router: slowRouter(clock, 25_000),
        slice: { wallClockMs: 60_000 },
        checkpoints: store,
      }),
    );

    expect(slices).toBeGreaterThan(1);
    expect(result.run.id).toBe('run_4821');
    expect(result.run.status).toBe('HALTED');
    expect(result.approval?.ref).toBe(APPROVAL_AURORA);
  });

  it('stops at maxSlices rather than looping forever', async () => {
    const store = new InMemoryCheckpointStore();
    const clock = fakeClock();
    const { result, slices } = await runAgentToCompletion(
      baseOptions({
        now: clock.now,
        router: slowRouter(clock, 60_000),
        // Smaller than one call. The meter's one-call floor keeps the run
        // moving anyway, one model call per slice.
        slice: { wallClockMs: 1 },
        checkpoints: store,
      }),
      { maxSlices: 3 },
    );

    expect(slices).toBe(3);
    expect(result.disposition).toBe('RESUMABLE');
  });

  it('works in-process without a store at all', async () => {
    const clock = fakeClock();
    const { result, slices } = await runAgentToCompletion(
      baseOptions({
        now: clock.now,
        router: slowRouter(clock, 25_000),
        slice: { wallClockMs: 60_000 },
      }),
    );

    expect(slices).toBeGreaterThan(1);
    expect(result.disposition).toBe('COMPLETE');
    expect(result.run.id).toBe('run_4821');
  });
});
