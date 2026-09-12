/**
 * Checkpoints — the thing that makes agent runs possible on this runtime.
 *
 * Architecture doc 05 §2.6: an Edge Function worker is killed at the wall
 * clock, 400s on paid plans, and `EdgeRuntime.waitUntil` does not buy a longer
 * budget — a background task shares the request's clock. So there is no
 * fifteen-minute job. A long handler runs to roughly 300s, writes a
 * checkpoint, re-enqueues itself and returns; the next tick resumes. D13 puts
 * it plainly: **a run that cannot checkpoint cannot exceed 400s, full stop.**
 *
 * That makes this file load-bearing rather than a retry convenience, and it
 * sets the bar for what a checkpoint has to hold. The doc's own test requires
 * the re-enqueued job to carry the **same `run_id`**, so a checkpoint cannot
 * be "where to start again" — it must be the whole run so far, serialisable,
 * so a different worker in a different process continues the same
 * `AutomationRun` rather than beginning a second one.
 *
 * The 60% context handoff writes the same record. Both are the same move:
 * throw away the conversation, keep the state card, continue.
 */

import type {
  AutomationRun,
  Ref,
  RunEvent,
  RunStateCard,
  RunStep,
  StateCardPlanStep,
  TierKey,
  TraceNode,
} from '@trainos/contract';
import type { LLMMessage } from '../providers/types';
import type { Blackboard } from './run';

/* ------------------------------------------------------------------ *
 * The serialised trace
 * ------------------------------------------------------------------ */

/**
 * Everything the trace builder needs to carry on numbering where it left off.
 *
 * `nodeSeq` and `stepSeq` are the point: without them a resumed run starts at
 * `n0` again and the trace viewer shows two roots and two `n1`s for one run.
 */
export interface TraceSnapshot {
  startedAt: string;
  /** Wall-clock milliseconds already spent, across every earlier slice. */
  elapsedMs: number;
  nodeSeq: number;
  stepSeq: number;
  nodes: TraceNode[];
  events: RunEvent[];
  steps: RunStep[];
  plan: StateCardPlanStep[];
  decisions: string[];
  openQuestions: string[];
  recordPointers: Ref[];
  tiers: TierKey[];
}

/* ------------------------------------------------------------------ *
 * A sub-agent caught mid-flight
 * ------------------------------------------------------------------ */

/**
 * The conversation a sub-agent was holding when its slice ran out.
 *
 * Without this a mid-stage yield can only restart the stage, and a stage that
 * needs more model calls than one slice allows then restarts forever: each
 * slice redoes the same first few turns and the run never advances. That is a
 * livelock dressed as a healthy queue, and it is the reason this state is
 * carried rather than discarded.
 *
 * Plain data throughout, because it rides inside a serialised checkpoint.
 */
export interface PendingStageState {
  /** Which stage was in flight. */
  stageIndex: number;
  /** The tier it had reached, which may be a rung above where it started. */
  tier: TierKey;
  /** Its messages, including every tool result it had already received. */
  messages: LLMMessage[];
  /** Turns already spent, so the stage's own turn budget is not refilled. */
  turnsUsed: number;
  /** Context handoffs so far within this stage. */
  retries: number;
  /** Passes over the stage, so a confidence escalation cannot repeat forever. */
  attemptsAtStage: number;
  escalated: boolean;
}

/* ------------------------------------------------------------------ *
 * The checkpoint
 * ------------------------------------------------------------------ */

/** Why the run stopped where it did. */
export type CheckpointReason =
  /** A sub-agent finished. §17 writes one of these after each. */
  | 'STAGE_COMPLETE'
  /** The slice's wall-clock budget ran out. Yield before the worker is killed. */
  | 'WALL_CLOCK'
  /** The slice's token ration ran out. */
  | 'TOKEN_BUDGET'
  /** A node crossed 60% of its context window. */
  | 'CONTEXT_HANDOFF';

/**
 * A resumable point in a run.
 *
 * Must survive `JSON.stringify` unchanged — it crosses a process boundary, and
 * anything that does not round-trip is a resume that silently loses state.
 * {@link serialiseCheckpoint} is the round trip, and a test asserts it.
 */
export interface RunCheckpoint {
  id: string;
  runId: string;
  runRef: string;
  agentId: string;
  /** Plan step this checkpoint follows, 1-based. */
  step: number;
  /** Index into the agent's stage list where a resume restarts. */
  stageIndex: number;
  reason: CheckpointReason;
  at: string;
  replayable: boolean;
  stateCard: RunStateCard;
  trace: TraceSnapshot;
  blackboard: Blackboard;
  /**
   * The orchestrator node's id, so a resumed slice hangs its sub-agents off
   * the original root instead of planning again and growing a second one.
   */
  orchestratorNodeId: string;
  /** The node the run was inside when it yielded, if it yielded mid-stage. */
  pendingNodeId?: string;
  /**
   * The in-flight sub-agent's conversation, when the yield caught one.
   * Absent for a checkpoint written between stages, which needs nothing but
   * the stage index.
   */
  pendingStage?: PendingStageState;
}

/**
 * `ckpt_run_4821_2_wall_clock_7`.
 *
 * Deterministic in the run's state, so a re-delivered job addresses the same
 * row. The node count discriminates two yields at the same stage — without it
 * a run that yields twice inside one stage overwrites its own earlier
 * checkpoint, and `list()` loses the history.
 */
export function checkpointId(
  runId: string,
  step: number,
  reason: CheckpointReason,
  nodeCount: number,
): string {
  return `ckpt_${runId}_${step}_${reason.toLowerCase()}_${nodeCount}`;
}

/**
 * Round-trip a checkpoint through JSON.
 *
 * Not decoration: the next slice may be a different worker, so a checkpoint
 * that only works in-process is a checkpoint that works in tests and fails in
 * production. Calling this on save makes the boundary real everywhere.
 */
export function serialiseCheckpoint(checkpoint: RunCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function deserialiseCheckpoint(raw: string): RunCheckpoint {
  return JSON.parse(raw) as RunCheckpoint;
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

/**
 * Where checkpoints live between slices.
 *
 * In production this is a row the worker writes before re-enqueueing. Here it
 * is a map. The interface is the same either way, and async because the real
 * one is.
 */
export interface CheckpointStore {
  save(checkpoint: RunCheckpoint): Promise<void>;
  load(id: string): Promise<RunCheckpoint | undefined>;
  /** Every checkpoint for one run, oldest first. */
  list(runId: string): Promise<RunCheckpoint[]>;
}

/** An in-memory store that serialises on the way in, so the boundary is real. */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly rows = new Map<string, string>();
  private readonly order: string[] = [];

  async save(checkpoint: RunCheckpoint): Promise<void> {
    if (!this.rows.has(checkpoint.id)) this.order.push(checkpoint.id);
    this.rows.set(checkpoint.id, serialiseCheckpoint(checkpoint));
  }

  async load(id: string): Promise<RunCheckpoint | undefined> {
    const raw = this.rows.get(id);
    return raw === undefined ? undefined : deserialiseCheckpoint(raw);
  }

  async list(runId: string): Promise<RunCheckpoint[]> {
    const out: RunCheckpoint[] = [];
    for (const id of this.order) {
      const raw = this.rows.get(id);
      if (!raw) continue;
      const checkpoint = deserialiseCheckpoint(raw);
      if (checkpoint.runId === runId) out.push(checkpoint);
    }
    return out;
  }

  get size(): number {
    return this.rows.size;
  }
}

/* ------------------------------------------------------------------ *
 * The slice budget
 * ------------------------------------------------------------------ */

/**
 * Default wall clock for one slice: 300s, per doc 05 D13.
 *
 * Deliberately under the 400s worker lifetime rather than near it. The margin
 * is for the work a yield still has to do — writing the checkpoint,
 * re-enqueueing, returning — none of which is free, and all of which happens
 * after the budget is found to be spent.
 */
export const DEFAULT_SLICE_WALL_CLOCK_MS = 300_000;

export interface SliceBudget {
  /**
   * Per slice, not per run. Each worker invocation gets its own clock, because
   * it is a fresh worker with a fresh 400s lifetime.
   */
  wallClockMs?: number;
  /**
   * Tokens one slice may spend before yielding. Per slice, like the wall
   * clock, and for the same reason.
   *
   * It was tempting to make this the run's cumulative budget instead. That
   * livelocks: a resumed slice starts already over the limit, yields
   * immediately, and the run makes no progress forever. The run's overall
   * envelope is `tokenLimit`, which the state card reports; this is a ceiling
   * on how much any single worker may burn. Unbounded unless you set it.
   */
  tokens?: number;
}

/** Why a slice stopped, or `undefined` while it may continue. */
export type SliceExhaustion = 'WALL_CLOCK' | 'TOKEN_BUDGET';

/**
 * Bounds one slice.
 *
 * Both budgets are per slice, and carried figures are kept only so the run can
 * report totals. A budget that carried across slices could never be satisfied
 * by starting a new worker, which is the one thing a yield is able to do.
 */
export class SliceMeter {
  readonly wallClockMs: number;
  readonly tokenLimit: number;

  private readonly sliceStartedMs: number;
  private readonly carriedElapsedMs: number;
  private readonly carriedTokens: number;
  private sliceTokens = 0;
  private sliceCalls = 0;

  constructor(opts: {
    budget?: SliceBudget;
    /** Tokens spent in earlier slices. Reported, never budgeted. */
    carriedTokens?: number;
    /** Wall clock spent in earlier slices. Reported, never budgeted. */
    carriedElapsedMs?: number;
    now?: () => number;
  }) {
    this.wallClockMs = opts.budget?.wallClockMs ?? DEFAULT_SLICE_WALL_CLOCK_MS;
    this.tokenLimit = opts.budget?.tokens ?? Number.POSITIVE_INFINITY;
    this.sliceStartedMs = (opts.now ?? Date.now)();
    this.carriedElapsedMs = opts.carriedElapsedMs ?? 0;
    this.carriedTokens = opts.carriedTokens ?? 0;
  }

  /** One completed model call, and what it cost in tokens. */
  noteTokens(count: number): void {
    this.sliceTokens += Math.max(0, count);
    this.sliceCalls += 1;
  }

  /** Model calls completed in this slice. */
  get calls(): number {
    return this.sliceCalls;
  }

  /** Tokens spent in this slice — what the budget is checked against. */
  get tokens(): number {
    return this.sliceTokens;
  }

  /** Tokens spent across every slice of the run. */
  get totalTokens(): number {
    return this.carriedTokens + this.sliceTokens;
  }

  sliceElapsedMs(now: number = Date.now()): number {
    return Math.max(0, now - this.sliceStartedMs);
  }

  /** Wall clock across every slice, for `AutomationRun.durationMs`. */
  totalElapsedMs(now: number = Date.now()): number {
    return this.carriedElapsedMs + this.sliceElapsedMs(now);
  }

  /**
   * Whether this slice must yield now.
   *
   * Checked *before* starting more work, never after finishing it. A budget
   * discovered to be spent after the call that spent it is a budget that
   * cannot prevent the worker being killed mid-call.
   */
  exhausted(now: number = Date.now()): SliceExhaustion | undefined {
    // A slice always gets one model call. Without this, a budget smaller than
    // a single call yields before doing anything, the next slice does the
    // same, and the run never advances — a livelock that looks like a healthy
    // queue, which is the worst kind. One call per slice is the slowest
    // progress that is still progress.
    if (this.sliceCalls === 0) return undefined;
    if (this.sliceTokens >= this.tokenLimit) return 'TOKEN_BUDGET';
    if (this.sliceElapsedMs(now) >= this.wallClockMs) return 'WALL_CLOCK';
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Result status
 * ------------------------------------------------------------------ */

/**
 * What the caller should do next.
 *
 * The contract's `RunStatus` has four members and `RESUMABLE` is not one of
 * them, so a yielded run reports `RUNNING` on the `AutomationRun` — which is
 * true, it is still running, just not in this worker — and the wrapper carries
 * the disposition. Same shape as `haltedBy`: the contract object stays
 * contract-valid and the runtime detail rides alongside.
 */
export type RunDisposition = 'COMPLETE' | 'RESUMABLE' | 'FAILED';

/** Does this run object represent work still owed? */
export function isResumable(run: Pick<AutomationRun, 'status'>): boolean {
  return run.status === 'RUNNING';
}
