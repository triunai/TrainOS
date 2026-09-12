/**
 * The run loop.
 *
 * An orchestrator node plans, delegates to bounded sub-agents, and submits the
 * result to the policy gate. The §17 execution tree, made to actually run:
 *
 *     n0  ORCHESTRATOR   plans, holds the state card, submits
 *     n1  SUB_AGENT      Reader    ─┐
 *     n2  SUB_AGENT      Matcher    │ each with its own tool set, its own
 *     n3  SUB_AGENT      Drafter    │ context meter and its own tier
 *     n4  SUB_AGENT      Verifier  ─┘
 *     n5  TOOL           actions.perform → QUEUED_FOR_APPROVAL → HALTED
 *
 * **The loop is sliced.** Architecture doc 05 D13: an Edge Function worker is
 * killed at the wall clock and background tasks share it, so a long run cannot
 * hold — it runs to roughly 300s, writes a checkpoint, and returns
 * `RESUMABLE`. The next worker calls `runAgent({ resumeFrom: <checkpoint> })`
 * and continues the *same* `AutomationRun`: same id, node numbering carrying
 * on from where it stopped. A run that cannot checkpoint cannot exceed 400s,
 * which is why this is load-bearing rather than a retry convenience.
 *
 * Four properties this file exists to guarantee, whatever the model does:
 *
 *   — every write goes through `actions.perform`, so a policy can stop it;
 *   — a node that fills 60% of its context hands off and restarts rather than
 *     truncating, writing the same checkpoint record a yield does;
 *   — a slice yields before its budget is spent, never after;
 *   — being stopped is a successful outcome. `HALTED` with a `haltedBy` is the
 *     demo working, not the demo failing.
 */

import type {
  ActionQueuedResponse,
  ActionResponse,
  ApprovalRequestRef,
  AutomationRun,
  EvidenceType,
  GovernedActionType,
  HaltedBy,
  Money,
  Provenance,
  ProvenanceSource,
  Ref,
  RunStatus,
  TierKey,
  TraceNode,
} from '@trainos/contract';
import { toMyt } from '../fixtures/local-client';
import { usdToMoney, type PriceBook, DEFAULT_PRICE_BOOK } from '../providers/pricing';
import { toContractProvider, type LLMMessage, type LLMToolCall } from '../providers/types';
import { BudgetExceededError } from '../routing/budget';
import { entryFor } from '../routing/config';
import { NoProviderError, type Router } from '../routing/router';
import {
  operationForWireName,
  type ToolAdapter,
  type ToolOperation,
  type ToolResult,
} from '../tools/adapter';
import { toolDefsFor } from '../tools/definitions';
import {
  checkpointId,
  SliceMeter,
  type CheckpointReason,
  type CheckpointStore,
  type RunCheckpoint,
  type PendingStageState,
  type RunDisposition,
  type SliceBudget,
  type SliceExhaustion,
  type TraceSnapshot,
} from './checkpoint';
import { ContextMeter, renderStateCard } from './context';
import { runJury, type JuryOutcome, type JuryQuestion } from './jury';
import { TraceBuilder } from './trace';

/* ------------------------------------------------------------------ *
 * Agent definition
 * ------------------------------------------------------------------ */

/** The shared blackboard. Stages read what earlier stages established. */
export interface Blackboard {
  /** Structured output per stage, keyed by stage name. */
  facts: Record<string, Record<string, unknown>>;
  /** Every tool call made in the run, in order. */
  toolCalls: Array<{ op: ToolOperation; args: Record<string, unknown>; result: ToolResult }>;
  /** Free-text output per stage. */
  notes: Record<string, string>;
}

export interface StageContext {
  blackboard: Blackboard;
  /** Everything the state card holds right now, rendered. */
  stateCard: string;
  input: Record<string, unknown>;
}

export interface AgentStage {
  /** Node name on the trace, e.g. `Reader`. */
  name: string;
  /** The plan line this stage satisfies. */
  planLabel: string;
  system: string;
  prompt(ctx: StageContext): string;
  tools: ToolOperation[];
  /** How many model turns this stage may take before it is cut off. */
  maxTurns: number;
  /** Overrides the tier the routing matrix would pick. */
  tier?: TierKey;
  /** Attributes spend and picks the routing entry. */
  actionType?: GovernedActionType;
  /**
   * Escalate one rung up the ladder when the stage reports confidence below
   * this. Omit to never escalate on confidence.
   */
  escalateBelow?: number;
  /** Pull structured facts out of the stage's final text. */
  harvest?(text: string, blackboard: Blackboard): Record<string, unknown>;
}

/** What the orchestrator submits to the gate once the stages are done. */
export interface SubmitPlan {
  type: GovernedActionType;
  targetRef: Ref;
  payload?: Record<string, unknown>;
  confidence: number;
  reasoning: string;
  evidence: Array<{ type: EvidenceType; ref: Ref; excerpt?: string }>;
  /** Read from the record, never from the model. Feeds the jury's value trigger. */
  value?: Money;
  firstOfKind?: boolean;
}

export interface AgentDefinition {
  id: string;
  name: string;
  orchestrator: string;
  goal: string;
  constraints: string[];
  guardrails: string[];
  trigger: { type: string; ref?: Ref };
  stages: AgentStage[];
  /** Tier for the planning node. Cheap by design — planning is not the hard part. */
  orchestratorTier: TierKey;
  /** Assembles the action from what the stages established. */
  submit(blackboard: Blackboard): SubmitPlan;
}

/* ------------------------------------------------------------------ *
 * Run options and result
 * ------------------------------------------------------------------ */

export interface RunAgentOptions {
  agent: AgentDefinition;
  router: Router;
  tools: ToolAdapter;
  input?: Record<string, unknown>;
  runId?: string;
  runRef?: string;
  tokenLimit?: number;
  costLimit?: Money;
  priceBook?: PriceBook;
  now?: () => Date;
  /**
   * What one slice may spend before yielding. Wall clock defaults to 300s,
   * which is doc 05 D13's yield point; the token ration is unbounded unless
   * set. Both are per slice — see the note on `SliceBudget.tokens`.
   */
  slice?: SliceBudget;
  /** Where checkpoints are written. Without one they are returned but not stored. */
  checkpoints?: CheckpointStore;
  /**
   * Continue an existing run. A checkpoint id requires {@link checkpoints};
   * the object itself works without a store, which is what an in-process
   * resume uses.
   */
  resumeFrom?: RunCheckpoint | string;
  /** Called as nodes open and close. The CLI uses it to stream the tree. */
  onTrace?: (event: { kind: 'node-open' | 'node-close' | 'event'; detail: unknown }) => void;
}

export interface AgentRunResult {
  /** Exactly the shape `GET /v1/runs/{id}` returns. */
  run: AutomationRun;
  /**
   * What the caller should do next. `RESUMABLE` means the slice yielded with
   * work still owed; re-enqueue and call `runAgent` again with
   * {@link resumeFrom}.
   */
  disposition: RunDisposition;
  /** The checkpoint to resume from. Present exactly when `RESUMABLE`. */
  resumeFrom?: string;
  /**
   * First-class, as the brief requires. It is also on the halted node inside
   * `run.nodes`, which is where M18-S04 reads it — this is the convenience
   * copy for a caller that does not want to walk the tree.
   */
  haltedBy?: HaltedBy;
  approval?: ApprovalRequestRef;
  /** Provenance for whatever the run produced. Attaches to the drafted record. */
  provenance: Provenance;
  /** Checkpoints written during this slice, oldest first. */
  checkpoints: RunCheckpoint[];
  jury?: JuryOutcome;
  blackboard: Blackboard;
}

/* ------------------------------------------------------------------ *
 * Yield
 * ------------------------------------------------------------------ */

/**
 * Thrown when a slice must stop. Not an error condition — the run is fine,
 * this worker is simply out of clock.
 */
class SliceYield extends Error {
  readonly reason: SliceExhaustion;
  readonly nodeId: string | undefined;
  /** The stage's conversation, so the next slice continues it rather than redoing it. */
  readonly pending: PendingStageState | undefined;

  constructor(reason: SliceExhaustion, nodeId?: string, pending?: PendingStageState) {
    super(`Slice exhausted: ${reason}`);
    this.name = 'SliceYield';
    this.reason = reason;
    this.nodeId = nodeId;
    this.pending = pending;
  }
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const { agent, router, tools } = opts;
  const now = opts.now ?? (() => new Date());
  const priceBook = opts.priceBook ?? DEFAULT_PRICE_BOOK;
  const tokenLimit = opts.tokenLimit ?? 60_000;
  const costLimit = opts.costLimit ?? { amount: 12_000, currency: 'MYR' as const };

  const resumed = await resolveCheckpoint(opts);

  const traceOptions = {
    // A resumed slice keeps the original run's identity. This is doc 05 §8.5's
    // assertion: the re-enqueued job carries the same `run_id`.
    runId: resumed?.runId ?? opts.runId ?? `run_${Math.floor(1000 + Math.random() * 9000)}`,
    runRef: resumed?.runRef ?? opts.runRef ?? `#${Math.floor(1000 + Math.random() * 9000)}`,
    agentId: agent.id,
    orchestrator: agent.orchestrator,
    trigger: agent.trigger,
    goal: agent.goal,
    constraints: agent.constraints,
    guardrails: agent.guardrails,
    tokenLimit,
    costLimit,
    now,
  };

  const trace = resumed
    ? TraceBuilder.restore(traceOptions, resumed.trace)
    : new TraceBuilder(traceOptions);

  const meter = new SliceMeter({
    // No fallback to `tokenLimit`: that is the run's envelope, not one
    // worker's ration, and using it here would yield at the end of the run
    // instead of completing it.
    budget: { wallClockMs: opts.slice?.wallClockMs, tokens: opts.slice?.tokens },
    carriedTokens: resumed ? tokensOfSnapshot(resumed.trace) : 0,
    carriedElapsedMs: resumed?.trace.elapsedMs ?? 0,
    now: () => now().getTime(),
  });

  const blackboard: Blackboard = resumed
    ? resumed.blackboard
    : { facts: {}, toolCalls: [], notes: {} };
  const checkpoints: RunCheckpoint[] = [];

  /* --- n0 · the orchestrator node ---------------------------------- */

  let orchestratorNode: string;

  if (resumed) {
    // Do not plan again. The plan is in the state card, the node is in the
    // snapshot, and a second planning call would cost money to produce a
    // second ORCHESTRATOR node in a tree that may have only one root.
    orchestratorNode = resumed.orchestratorNodeId;
    trace.event('CHECKPOINT', {
      step: resumed.step,
      replayable: true,
      resumedFrom: resumed.id,
      reason: resumed.reason,
    });
  } else {
    trace.setPlan([...agent.stages.map((s) => s.planLabel), 'Submit to the policy gate']);
    trace.pointAt(agent.trigger.ref);

    orchestratorNode = trace.openNode({
      parentId: null,
      kind: 'ORCHESTRATOR',
      name: 'Orchestrator',
      tier: agent.orchestratorTier,
      model: router.binding(agent.orchestratorTier)?.model,
      provider: toContractProvider(router.binding(agent.orchestratorTier)?.provider ?? 'mock'),
    });
    opts.onTrace?.({ kind: 'node-open', detail: { id: orchestratorNode, name: 'Orchestrator' } });

    try {
      const call = await router.call(agent.orchestratorTier, {
        system: ORCHESTRATOR_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              `GOAL\n${agent.goal}`,
              `CONSTRAINTS\n${agent.constraints.map((c) => `- ${c}`).join('\n')}`,
              `AVAILABLE SUB-AGENTS\n${agent.stages.map((s) => `- ${s.name}: ${s.planLabel}`).join('\n')}`,
              'Confirm the plan and note anything you are uncertain about.',
            ].join('\n\n'),
          },
        ],
        maxTokens: 800,
      });

      // Always retag with what actually answered, not what the tier binding
      // says would have. A trace that names `claude-sonnet-5` on a run served
      // by a mock is a trace that lies, and this is the one file that can
      // prevent it.
      trace.retagNode(orchestratorNode, {
        tier: call.tier,
        model: call.result.model,
        provider: toContractProvider(call.result.provider),
      });

      if (call.degraded) {
        trace.event('ESCALATION', {
          from: call.requestedTier,
          to: call.tier,
          node: orchestratorNode,
          reason: call.attempts[0]?.reason,
        });
      }
      for (const question of extractOpenQuestions(call.result.text)) trace.openQuestion(question);
      blackboard.notes['Orchestrator'] = call.result.text;

      meter.noteTokens(call.result.usage.in + call.result.usage.out);

      // Closed here rather than at the end of the run: the orchestrator's own
      // work is done, and §17's example node tree closes n0 `OK` while the
      // tool node carries the halt. It also means a yielded slice snapshots a
      // complete n0 instead of a half-open one.
      trace.closeNode(orchestratorNode, {
        status: 'OK',
        tokens: { in: call.result.usage.in, out: call.result.usage.out },
        cost: usdToMoney(call.result.costUsd, priceBook),
        cacheHitRate: call.result.cacheHitRate,
      });
    } catch (cause) {
      trace.closeNode(orchestratorNode, { status: 'FAILED' });
      return failRun(trace, blackboard, checkpoints, cause);
    }
  }

  /* --- the yield helper -------------------------------------------- */

  const yieldSlice = async (
    reason: CheckpointReason,
    stageIndex: number,
    pendingNodeId?: string,
    pendingStage?: PendingStageState,
  ): Promise<AgentRunResult> => {
    const checkpoint = await writeCheckpoint({
      trace,
      blackboard,
      agent,
      orchestratorNode,
      reason,
      stageIndex,
      pendingNodeId,
      pendingStage,
      store: opts.checkpoints,
      now,
      emitEvent: true,
    });
    checkpoints.push(checkpoint);

    return {
      // `RUNNING` is the truthful contract status: the run is still running,
      // just not in this worker. `RESUMABLE` rides on the wrapper because the
      // contract's `RunStatus` has no such member.
      run: trace.build({ status: 'RUNNING', outcome: 'RESUMABLE' }),
      disposition: 'RESUMABLE',
      resumeFrom: checkpoint.id,
      provenance: buildProvenance(trace, agent, blackboard, 0, undefined),
      checkpoints,
      blackboard,
    };
  };

  /* --- n1..nN · the sub-agents ------------------------------------- */

  const startIndex = resumed?.stageIndex ?? 0;
  // Consumed by the stage it belongs to and then dropped: a later stage must
  // not inherit an earlier one's half-finished conversation.
  let pendingStage =
    resumed?.pendingStage && resumed.pendingStage.stageIndex === startIndex
      ? resumed.pendingStage
      : undefined;

  for (let index = startIndex; index < agent.stages.length; index += 1) {
    const stage = agent.stages[index];
    if (!stage) continue;

    // Checked before the stage starts, never after it finishes. A budget found
    // to be spent afterwards cannot stop the worker being killed mid-call.
    const exhausted = meter.exhausted(now().getTime());
    if (exhausted) return yieldSlice(exhausted, index);

    trace.markPlanStep(index + 1, 'RUNNING');
    try {
      const resumeState = pendingStage;
      pendingStage = undefined;

      await runStage({
        stage,
        stageIndex: index,
        resume: resumeState,
        parentId: orchestratorNode,
        trace,
        blackboard,
        router,
        tools,
        priceBook,
        meter,
        now,
        input: opts.input ?? {},
        onTrace: opts.onTrace,
        onHandoff: async (nodeId, pending) => {
          const checkpoint = await writeCheckpoint({
            trace,
            blackboard,
            agent,
            orchestratorNode,
            reason: 'CONTEXT_HANDOFF',
            stageIndex: index,
            pendingNodeId: nodeId,
            pendingStage: pending,
            store: opts.checkpoints,
            now,
            emitEvent: false,
          });
          checkpoints.push(checkpoint);
        },
      });
      trace.markPlanStep(index + 1, 'DONE');
    } catch (cause) {
      if (cause instanceof SliceYield) {
        // Mid-stage. The next slice picks the conversation up where this one
        // dropped it, so no model call is paid for twice.
        trace.markPlanStep(index + 1, 'PENDING');
        return yieldSlice(cause.reason, index, cause.nodeId, cause.pending);
      }
      if (cause instanceof BudgetExceededError) {
        trace.event('BUDGET_EXCEEDED', {
          scope: cause.status.scope,
          key: cause.status.key,
          cap: cause.status.cap,
          spend: cause.status.spend,
          pausedActionTypes: stage.actionType ? [stage.actionType] : [],
        });
        trace.markPlanStep(index + 1, 'HALTED');
        return {
          run: trace.build({ status: 'HALTED', outcome: 'BUDGET_CAP' }),
          disposition: 'COMPLETE',
          provenance: buildProvenance(trace, agent, blackboard, 0, undefined),
          checkpoints,
          blackboard,
        };
      }
      trace.markPlanStep(index + 1, 'FAILED');
      return failRun(trace, blackboard, checkpoints, cause);
    }

    // §17: a checkpoint after each sub-agent completes.
    const checkpoint = await writeCheckpoint({
      trace,
      blackboard,
      agent,
      orchestratorNode,
      reason: 'STAGE_COMPLETE',
      stageIndex: index + 1,
      store: opts.checkpoints,
      now,
      emitEvent: true,
    });
    checkpoints.push(checkpoint);
  }

  /* --- the jury, only when a trigger fires ------------------------- */

  const plan = agent.submit(blackboard);
  trace.pointAt(plan.targetRef);

  const routingEntry = entryFor(router.config, plan.type);
  let jury: JuryOutcome | undefined;

  if (routingEntry?.jury) {
    const question: JuryQuestion = {
      proposition: `${plan.type} on ${plan.targetRef}. ${plan.reasoning}`,
      evidence: plan.evidence
        .map((e) => `- ${e.type} ${e.ref}${e.excerpt ? `: ${e.excerpt}` : ''}`)
        .join('\n'),
      confidence: plan.confidence,
      value: plan.value,
      firstOfKind: plan.firstOfKind,
    };

    jury = await runJury({
      policy: routingEntry.jury,
      question,
      router,
      onJuror: (tier, vote, tokens) => {
        const jurorNode = trace.openNode({
          parentId: orchestratorNode,
          kind: 'SUB_AGENT',
          name: `Juror (${tier})`,
          tier,
          model: vote.model,
        });
        trace.closeNode(jurorNode, { status: 'OK', tokens });
        meter.noteTokens(tokens.in + tokens.out);
      },
    });

    if (jury.ran) {
      trace.event('JURY', {
        quorum: jury.quorum,
        of: jury.of,
        votes: jury.votes,
        trigger: jury.trigger,
      });
      if (!jury.reached) {
        // §17 `JuryDisagreed`. Advisory: it never overturns the proposal, it
        // lands on the approval for the human to weigh.
        trace.event('JURY', {
          quorum: jury.quorum,
          of: jury.of,
          disagreed: true,
          dissenters: jury.votes.filter((v) => !v.agrees).map((v) => v.model),
        });
        trace.openQuestion(
          `Jury did not reach ${jury.quorum} of ${jury.of}: ` +
            jury.votes
              .filter((v) => !v.agrees)
              .map((v) => `${v.model} — ${v.dissent}`)
              .join('; '),
        );
      }
    }
  }

  /* --- the gate ---------------------------------------------------- */

  const submitNode = trace.openNode({
    parentId: orchestratorNode,
    kind: 'TOOL',
    name: 'actions.perform',
  });
  trace.markPlanStep(agent.stages.length + 1, 'RUNNING');

  const submitArgs: Record<string, unknown> = {
    type: plan.type,
    targetRef: plan.targetRef,
    payload: plan.payload,
    confidence: plan.confidence,
    reasoning: plan.reasoning,
    evidence: plan.evidence,
  };
  const submitResult = await tools.execute('actions.perform', submitArgs);
  blackboard.toolCalls.push({ op: 'actions.perform', args: submitArgs, result: submitResult });

  const response = submitResult.data as ActionResponse | undefined;
  let status: RunStatus = 'SUCCEEDED';
  let outcome = 'EXECUTED';
  let haltedBy: HaltedBy | undefined;
  let approval: ApprovalRequestRef | undefined;

  if (!submitResult.ok || !response) {
    status = 'FAILED';
    outcome = 'ACTION_FAILED';
    trace.closeNode(submitNode, { status: 'FAILED' });
    trace.markPlanStep(agent.stages.length + 1, 'FAILED');
    trace.step({
      tool: 'actions.perform',
      args: submitArgs,
      status: 'FAILED',
      durationMs: 0,
      error: {
        attempt: 1,
        code: submitResult.error?.code ?? 'UNKNOWN',
        message: submitResult.error?.message,
      },
    });
  } else if (response.status === 'QUEUED_FOR_APPROVAL') {
    const queued = response as ActionQueuedResponse;
    approval = queued.approvalRequest;
    haltedBy = {
      policyId: queued.approvalRequest.policyId,
      approvalRequestRef: queued.approvalRequest.ref,
      reason: haltReason(plan, queued.approvalRequest.policyId),
    };
    status = 'HALTED';
    outcome = 'QUEUED_FOR_APPROVAL';

    trace.closeNode(submitNode, { status: 'HALTED', haltedBy });
    trace.markPlanStep(agent.stages.length + 1, 'HALTED');
    trace.event('POLICY_HALT', {
      policyId: queued.approvalRequest.policyId,
      approvalRequestRef: queued.approvalRequest.ref,
      reason: haltedBy.reason,
    });
    trace.step({ tool: 'actions.perform', args: submitArgs, status: 'HALTED', durationMs: 0, haltedBy });
    trace.decide(
      `Stopped at ${queued.approvalRequest.policyId}; ${queued.approvalRequest.ref} raised for a human`,
    );
  } else {
    trace.closeNode(submitNode, { status: 'OK' });
    trace.markPlanStep(agent.stages.length + 1, 'DONE');
    trace.step({
      tool: 'actions.perform',
      args: submitArgs,
      result: response as unknown as Record<string, unknown>,
      status: 'OK',
      durationMs: 0,
    });
    outcome = response.status;
  }

  return {
    run: trace.build({ status, outcome }),
    disposition: status === 'FAILED' ? 'FAILED' : 'COMPLETE',
    haltedBy,
    approval,
    provenance: buildProvenance(trace, agent, blackboard, plan.confidence, jury),
    checkpoints,
    jury,
    blackboard,
  };
}

/* ------------------------------------------------------------------ *
 * One sub-agent
 * ------------------------------------------------------------------ */

interface RunStageOptions {
  stage: AgentStage;
  stageIndex: number;
  /** A conversation from an earlier slice to continue rather than restart. */
  resume?: PendingStageState;
  parentId: string;
  trace: TraceBuilder;
  blackboard: Blackboard;
  router: Router;
  tools: ToolAdapter;
  priceBook: PriceBook;
  meter: SliceMeter;
  now: () => Date;
  input: Record<string, unknown>;
  onTrace: RunAgentOptions['onTrace'];
  onHandoff: (nodeId: string, pending: PendingStageState) => Promise<void>;
}

async function runStage(opts: RunStageOptions): Promise<void> {
  const { stage, trace, blackboard, router, tools, priceBook, meter } = opts;

  const requestedTier = stage.tier ?? router.tierFor(stage.actionType);
  const ladder = entryFor(router.config, stage.actionType as GovernedActionType)
    ?.escalationLadder ?? [requestedTier];

  // A resumed stage keeps the tier it had climbed to and the passes it had
  // already spent, so neither the escalation nor the turn budget refills.
  let tier = opts.resume?.tier ?? requestedTier;
  let attemptsAtStage = opts.resume?.attemptsAtStage ?? 0;
  let escalated = opts.resume?.escalated ?? false;
  let carriedMessages = opts.resume?.messages;
  let carriedTurns = opts.resume?.turnsUsed ?? 0;
  let carriedRetries = opts.resume?.retries ?? 0;

  // Up to two passes: the first at the routed tier, a second one rung up the
  // ladder if the stage came back unsure of itself.
  for (;;) {
    attemptsAtStage += 1;
    const binding = router.binding(tier);
    const nodeId = trace.openNode({
      parentId: opts.parentId,
      kind: 'SUB_AGENT',
      name: stage.name,
      tier,
      model: binding?.model,
      provider: toContractProvider(binding?.provider ?? 'mock'),
    });
    opts.onTrace?.({ kind: 'node-open', detail: { id: nodeId, name: stage.name, tier } });

    const contextMeter = new ContextMeter({ contextWindow: binding?.contextWindow ?? 128_000 });
    const toolDefs = toolDefsFor(stage.tools);

    let messages: LLMMessage[] = carriedMessages ?? [
      {
        role: 'user',
        content: stage.prompt({
          blackboard,
          stateCard: renderStateCard(trace.stateCard()),
          input: opts.input,
        }),
      },
    ];
    const turnsAlreadySpent = carriedTurns;
    // Consumed once. A second pass up the escalation ladder starts fresh.
    carriedMessages = undefined;
    carriedTurns = 0;

    let tokensIn = 0;
    let tokensOut = 0;
    let cost: Money = { amount: 0, currency: 'MYR' };
    let cacheWeighted = 0;
    let retries = carriedRetries;
    carriedRetries = 0;
    let finalText = '';
    let degradedTo: TierKey | undefined;

    /** Close the node with whatever it managed before stopping. */
    const closeWith = (status: 'OK' | 'RETRIED'): void => {
      trace.closeNode(nodeId, {
        status,
        tokens: { in: tokensIn, out: tokensOut },
        cost,
        cacheHitRate: tokensIn > 0 ? cacheWeighted / tokensIn : 0,
        retries: retries || undefined,
      });
    };

    for (let turn = turnsAlreadySpent; turn < stage.maxTurns; turn += 1) {
      // Before the call, not after it. The point of a yield is to stop before
      // the worker is killed, and a check after a 40-second model call is a
      // check that has already lost.
      const exhausted = meter.exhausted(opts.now().getTime());
      if (exhausted) {
        // Record the partial work honestly: this node did real turns, and the
        // next slice opens a fresh node continuing the same conversation.
        closeWith('RETRIED');
        throw new SliceYield(exhausted, nodeId, {
          stageIndex: opts.stageIndex,
          tier,
          messages,
          turnsUsed: turn,
          retries,
          attemptsAtStage,
          escalated,
        });
      }

      const call = await router.call(
        tier,
        { system: stage.system, messages, tools: toolDefs },
        { actionType: stage.actionType },
      );

      trace.retagNode(nodeId, {
        tier: call.tier,
        model: call.result.model,
        provider: toContractProvider(call.result.provider),
      });

      if (call.degraded) {
        degradedTo = call.tier;
        trace.event('ESCALATION', {
          from: call.requestedTier,
          to: call.tier,
          node: nodeId,
          reason: call.attempts[0]?.reason,
        });
      }

      tokensIn += call.result.usage.in;
      tokensOut += call.result.usage.out;
      cost = {
        amount: cost.amount + usdToMoney(call.result.costUsd, priceBook).amount,
        currency: 'MYR',
      };
      cacheWeighted += call.result.usage.in * call.result.cacheHitRate;
      contextMeter.add(call.result.usage.in);
      meter.noteTokens(call.result.usage.in + call.result.usage.out);

      if (call.result.text.trim() !== '') finalText = call.result.text;

      if (call.result.toolCalls.length === 0) break;

      messages = [
        ...messages,
        { role: 'assistant', content: call.result.text, toolCalls: call.result.toolCalls },
      ];

      for (const toolCall of call.result.toolCalls) {
        const message = await executeToolCall({ toolCall, nodeId, trace, blackboard, tools });
        messages.push(message);
      }

      // §17 handoff: restart the node with the state card rather than
      // truncating the middle of its reasoning away.
      if (contextMeter.shouldHandoff) {
        trace.event('HANDOFF', {
          atContextPct: Math.round(contextMeter.fraction * 100) / 100,
          restartedNodes: [nodeId],
          node: nodeId,
          reason: 'CONTEXT_HANDOFF',
        });
        // The same checkpoint record a yield writes. Both throw away the
        // conversation and keep the state card; only the trigger differs.
        // The state card *is* the continuation here, so that is what the
        // pending conversation becomes.
        const handedOff: LLMMessage[] = [
          {
            role: 'user',
            content: [
              'Your context was handed off. Everything below is what the run knows so far;',
              'the conversation that produced it is gone. Continue from here.',
              '',
              renderStateCard(trace.stateCard()),
              '',
              summariseToolCalls(blackboard),
              '',
              stage.prompt({
                blackboard,
                stateCard: renderStateCard(trace.stateCard()),
                input: opts.input,
              }),
            ].join('\n'),
          },
        ];
        contextMeter.reset();
        retries += 1;
        messages = handedOff;

        await opts.onHandoff(nodeId, {
          stageIndex: opts.stageIndex,
          tier,
          messages,
          turnsUsed: turn + 1,
          retries,
          attemptsAtStage,
          escalated,
        });
      }
    }

    const facts = stage.harvest?.(finalText, blackboard) ?? extractJson(finalText) ?? {};
    blackboard.facts[stage.name] = facts;
    blackboard.notes[stage.name] = finalText;

    for (const decision of asStringArray(facts['decisions'])) trace.decide(decision);
    for (const question of asStringArray(facts['openQuestions'])) trace.openQuestion(question);
    for (const ref of asStringArray(facts['recordPointers'])) trace.pointAt(ref);

    closeWith(retries > 0 ? 'RETRIED' : 'OK');
    opts.onTrace?.({ kind: 'node-close', detail: { id: nodeId, name: stage.name } });

    // Confidence escalation: one rung up the ladder, once.
    const confidence = asNumber(facts['confidence']);
    const gate = stage.escalateBelow;
    const nextTier = ladder[ladder.indexOf(degradedTo ?? tier) + 1];

    if (
      gate !== undefined &&
      confidence !== undefined &&
      confidence < gate &&
      !escalated &&
      nextTier &&
      attemptsAtStage < 2 &&
      router.isReachable(nextTier)
    ) {
      trace.event('ESCALATION', {
        from: tier,
        to: nextTier,
        confidence,
        threshold: gate,
        node: nodeId,
      });
      tier = nextTier;
      escalated = true;
      continue;
    }

    return;
  }
}

/* ------------------------------------------------------------------ *
 * One tool call
 * ------------------------------------------------------------------ */

interface ExecuteToolOptions {
  toolCall: LLMToolCall;
  nodeId: string;
  trace: TraceBuilder;
  blackboard: Blackboard;
  tools: ToolAdapter;
}

async function executeToolCall(opts: ExecuteToolOptions): Promise<LLMMessage> {
  const { toolCall, trace, blackboard, tools } = opts;
  const op = operationForWireName(toolCall.name);

  if (!op || !tools.supports(op)) {
    const message = `No such tool: ${toolCall.name}`;
    trace.step({
      tool: toolCall.name,
      args: toolCall.input,
      status: 'FAILED',
      durationMs: 0,
      error: { attempt: 1, code: 'NO_SUCH_TOOL', message },
    });
    return {
      role: 'tool',
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: message,
      isError: true,
    };
  }

  const toolNode = trace.openNode({ parentId: opts.nodeId, kind: 'TOOL', name: op });
  const started = Date.now();
  const result = await tools.execute(op, toolCall.input);
  const durationMs = Date.now() - started;

  blackboard.toolCalls.push({ op, args: toolCall.input, result });

  if (result.truncated) {
    trace.event('TRUNCATION', {
      tool: op,
      storedTokens: result.truncated.storedTokens,
      fetchMoreAvailable: result.truncated.fetchMoreAvailable,
    });
  }

  trace.closeNode(toolNode, { status: result.ok ? 'OK' : 'FAILED' });
  trace.step({
    tool: op,
    args: toolCall.input,
    result: result.ok ? asRecord(result.data) : undefined,
    status: result.ok ? 'OK' : 'FAILED',
    durationMs,
    error: result.ok
      ? undefined
      : { attempt: 1, code: result.error?.code ?? 'TOOL_ERROR', message: result.error?.message },
  });

  return {
    role: 'tool',
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: JSON.stringify(result.ok ? result.data : { error: result.error }),
    isError: !result.ok,
  };
}

/* ------------------------------------------------------------------ *
 * Checkpoints
 * ------------------------------------------------------------------ */

interface WriteCheckpointOptions {
  trace: TraceBuilder;
  blackboard: Blackboard;
  agent: AgentDefinition;
  orchestratorNode: string;
  reason: CheckpointReason;
  stageIndex: number;
  pendingNodeId?: string;
  pendingStage?: PendingStageState;
  store?: CheckpointStore;
  now: () => Date;
  /** Emit the `HANDOFF` event too. A context handoff emits its own. */
  emitEvent: boolean;
}

async function writeCheckpoint(opts: WriteCheckpointOptions): Promise<RunCheckpoint> {
  const { trace, reason, stageIndex } = opts;
  const id = checkpointId(trace.runId, stageIndex, reason, trace.nodeCount);

  // The event goes in before the snapshot, so the checkpoint contains the
  // record of its own creation and a resumed run's event log is continuous.
  if (opts.emitEvent) {
    if (reason === 'STAGE_COMPLETE') {
      trace.event('CHECKPOINT', { step: stageIndex, replayable: true, checkpointId: id });
    } else {
      trace.event('HANDOFF', {
        reason,
        checkpointId: id,
        node: opts.pendingNodeId,
        restartedNodes: opts.pendingNodeId ? [opts.pendingNodeId] : [],
        step: stageIndex,
      });
      trace.event('CHECKPOINT', { step: stageIndex, replayable: true, checkpointId: id });
    }
  }

  const checkpoint: RunCheckpoint = {
    id,
    runId: trace.runId,
    runRef: trace.runRef,
    agentId: opts.agent.id,
    step: stageIndex,
    stageIndex,
    reason,
    at: toMyt(opts.now()),
    replayable: true,
    stateCard: trace.stateCard(),
    trace: trace.snapshot(),
    blackboard: opts.blackboard,
    orchestratorNodeId: opts.orchestratorNode,
    pendingNodeId: opts.pendingNodeId,
    pendingStage: opts.pendingStage,
  };

  await opts.store?.save(checkpoint);
  return checkpoint;
}

/** Accept a checkpoint object or an id, and require a store for the latter. */
async function resolveCheckpoint(opts: RunAgentOptions): Promise<RunCheckpoint | undefined> {
  if (!opts.resumeFrom) return undefined;
  if (typeof opts.resumeFrom !== 'string') return opts.resumeFrom;

  if (!opts.checkpoints) {
    throw new Error(
      `runAgent was asked to resume from checkpoint ${opts.resumeFrom} but no checkpoint store was supplied`,
    );
  }
  const loaded = await opts.checkpoints.load(opts.resumeFrom);
  if (!loaded) throw new Error(`No checkpoint ${opts.resumeFrom}`);
  return loaded;
}

function tokensOfSnapshot(snapshot: TraceSnapshot): number {
  return snapshot.nodes.reduce(
    (acc: number, node: TraceNode) => acc + (node.tokens?.in ?? 0) + (node.tokens?.out ?? 0),
    0,
  );
}

/**
 * `POST /v1/runs/{id}/retry?from=checkpoint`.
 *
 * The same call a worker makes on the next tick; nothing about resuming is
 * special-cased for the retry endpoint.
 */
export async function retryFromCheckpoint(
  checkpoint: RunCheckpoint | string,
  opts: RunAgentOptions,
): Promise<AgentRunResult> {
  return runAgent({ ...opts, resumeFrom: checkpoint });
}

/**
 * Drive a run to completion across as many slices as it needs.
 *
 * What the queue does, in one function: run, and if the result says
 * `RESUMABLE`, run again from the checkpoint. In production each iteration is
 * a separate worker; here they are sequential calls, which is the same thing
 * with less waiting.
 */
export async function runAgentToCompletion(
  opts: RunAgentOptions,
  limits: { maxSlices?: number } = {},
): Promise<{ result: AgentRunResult; slices: number }> {
  const maxSlices = limits.maxSlices ?? 20;
  let result = await runAgent(opts);
  let slices = 1;

  while (result.disposition === 'RESUMABLE' && result.resumeFrom && slices < maxSlices) {
    const checkpoint =
      opts.checkpoints === undefined
        ? result.checkpoints.find((c) => c.id === result.resumeFrom)
        : result.resumeFrom;
    if (!checkpoint) break;
    result = await runAgent({ ...opts, resumeFrom: checkpoint });
    slices += 1;
  }

  return { result, slices };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const ORCHESTRATOR_SYSTEM = [
  'You are the orchestrator of a training-operations agent. You do not do the work',
  'yourself: you confirm the plan, name what you are uncertain about, and hand off',
  'to sub-agents that each hold one tool set.',
  '',
  'Be brief. Two or three sentences confirming the plan, then, if anything is',
  'genuinely unclear, a line starting "OPEN QUESTION:" for each. Do not invent',
  'questions to look thorough — an empty list is the normal case.',
].join('\n');

function extractOpenQuestions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /OPEN QUESTION:\s*(.+)/i.exec(line)?.[1]?.trim())
    .filter((q): q is string => Boolean(q));
}

/**
 * Pull a JSON object out of a model's reply.
 *
 * Models wrap JSON in prose and fences no matter how firmly they are asked not
 * to. Scanning for the outermost balanced braces is duller than a parser and
 * survives both.
 */
export function extractJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function summariseToolCalls(blackboard: Blackboard): string {
  if (blackboard.toolCalls.length === 0) return 'TOOL RESULTS SO FAR: none.';
  const lines = blackboard.toolCalls.slice(-8).map((call) => {
    const summary = JSON.stringify(call.result.data).slice(0, 400);
    return `  ${call.op}(${JSON.stringify(call.args)}) → ${summary}`;
  });
  return ['TOOL RESULTS SO FAR:', ...lines].join('\n');
}

function haltReason(plan: SubmitPlan, policyId: string): string {
  if (plan.value && plan.value.amount > 0) {
    const major = (plan.value.amount / 100).toLocaleString('en-MY', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return `Value RM ${major} requires approval under ${policyId}`;
  }
  return `${plan.type} is gated by ${policyId}`;
}

function buildProvenance(
  trace: TraceBuilder,
  agent: AgentDefinition,
  blackboard: Blackboard,
  confidence: number,
  jury: JuryOutcome | undefined,
): Provenance {
  const nodes = agent.stages
    .map((s) => trace.nodeById(nodeIdForName(trace, s.name)))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
  const authoring = nodes[nodes.length - 1] ?? trace.nodeById('n0');

  const sources: ProvenanceSource[] = blackboard.toolCalls
    .filter((call) => call.op !== 'actions.perform' && call.result.ok)
    .slice(0, 8)
    .map((call) => ({
      type: evidenceTypeFor(call.op),
      ref: String(call.args['ref'] ?? call.args['programmeRef'] ?? call.args['query'] ?? call.op),
    }));

  return {
    origin: 'AI_GENERATED',
    confidence,
    agentId: agent.id,
    runId: trace.runId,
    sources,
    generatedAt: toMyt(new Date()),
    tier: authoring?.tier,
    model: authoring?.model,
    provider: authoring?.provider,
    cacheHitRate: trace.cacheHitRate,
    jury: jury?.provenance,
  };
}

function nodeIdForName(trace: TraceBuilder, name: string): string {
  // Latest wins: a stage that was restarted after a handoff or a resume has
  // more than one node, and the last one is the one that finished the work.
  for (let i = trace.nodeCount - 1; i >= 0; i -= 1) {
    if (trace.nodeById(`n${i}`)?.name === name) return `n${i}`;
  }
  return 'n0';
}

function evidenceTypeFor(op: ToolOperation): EvidenceType {
  switch (op) {
    case 'enquiries.get':
      return 'EMAIL';
    case 'organisations.search':
      return 'ORGANISATION';
    case 'programmes.search':
      return 'PROGRAMME';
    case 'trainers.availability':
      return 'TRAINER_AVAILABILITY';
    case 'quotations.compute':
      return 'QUOTATION';
    case 'proposals.draft':
      return 'PROPOSAL';
    default:
      return 'ACTION';
  }
}

function failRun(
  trace: TraceBuilder,
  blackboard: Blackboard,
  checkpoints: RunCheckpoint[],
  cause: unknown,
): AgentRunResult {
  const code =
    cause instanceof NoProviderError
      ? 'NO_PROVIDER'
      : cause instanceof BudgetExceededError
        ? 'BUDGET_CAP'
        : 'RUN_FAILED';
  const message = cause instanceof Error ? cause.message : String(cause);

  return {
    run: trace.build({
      status: 'FAILED',
      outcome: code,
      failure: { code, message, attempts: 1, retryable: code !== 'BUDGET_CAP', deadLettered: false },
    }),
    disposition: 'FAILED',
    provenance: { origin: 'AI_GENERATED', runId: trace.runId },
    checkpoints,
    blackboard,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
