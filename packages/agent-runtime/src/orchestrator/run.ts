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
 * Three properties this file exists to guarantee, whatever the model does:
 *
 *   — every write goes through `actions.perform`, so a policy can stop it;
 *   — a node that fills 60% of its context hands off and restarts rather than
 *     truncating, and the trace says which nodes were restarted;
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
import { ContextMeter, renderStateCard, type Checkpoint } from './context';
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
  /** Resume from a checkpoint instead of starting at stage zero. */
  resumeFrom?: Checkpoint;
  /** Called as nodes open and close. The CLI uses it to stream the tree. */
  onTrace?: (event: { kind: 'node-open' | 'node-close' | 'event'; detail: unknown }) => void;
}

export interface AgentRunResult {
  /** Exactly the shape `GET /v1/runs/{id}` returns. */
  run: AutomationRun;
  /**
   * First-class, as the brief requires. It is also on the halted node inside
   * `run.nodes`, which is where M18-S04 reads it — this is the convenience
   * copy for a caller that does not want to walk the tree.
   */
  haltedBy?: HaltedBy;
  approval?: ApprovalRequestRef;
  /** Provenance for whatever the run produced. Attaches to the drafted record. */
  provenance: Provenance;
  checkpoints: Checkpoint[];
  jury?: JuryOutcome;
  blackboard: Blackboard;
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

  const trace = new TraceBuilder({
    runId: opts.runId ?? `run_${Math.floor(1000 + Math.random() * 9000)}`,
    runRef: opts.runRef ?? `#${Math.floor(1000 + Math.random() * 9000)}`,
    agentId: agent.id,
    orchestrator: agent.orchestrator,
    trigger: agent.trigger,
    goal: agent.goal,
    constraints: agent.constraints,
    guardrails: agent.guardrails,
    tokenLimit,
    costLimit,
    now,
  });

  const blackboard: Blackboard = { facts: {}, toolCalls: [], notes: {} };
  const checkpoints: Checkpoint[] = [];
  trace.setPlan([...agent.stages.map((s) => s.planLabel), 'Submit to the policy gate']);
  trace.pointAt(agent.trigger.ref);

  /* --- n0 · the orchestrator node ---------------------------------- */

  const orchestratorNode = trace.openNode({
    parentId: null,
    kind: 'ORCHESTRATOR',
    name: 'Orchestrator',
    tier: agent.orchestratorTier,
    model: router.binding(agent.orchestratorTier)?.model,
    provider: toContractProvider(router.binding(agent.orchestratorTier)?.provider ?? 'mock'),
  });
  opts.onTrace?.({ kind: 'node-open', detail: { id: orchestratorNode, name: 'Orchestrator' } });

  let orchestratorTokens = { in: 0, out: 0 };
  let orchestratorCost: Money = { amount: 0, currency: 'MYR' };
  let orchestratorCacheRate = 0;

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

    trace.retagNode(orchestratorNode, {
      tier: call.tier,
      model: call.result.model,
      provider: toContractProvider(call.result.provider),
    });
    orchestratorTokens = { in: call.result.usage.in, out: call.result.usage.out };
    orchestratorCost = usdToMoney(call.result.costUsd, priceBook);
    orchestratorCacheRate = call.result.cacheHitRate;

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
  } catch (cause) {
    return failRun(trace, blackboard, checkpoints, orchestratorNode, cause);
  }

  /* --- n1..nN · the sub-agents ------------------------------------- */

  const startIndex = opts.resumeFrom?.stageIndex ?? 0;
  if (opts.resumeFrom) {
    trace.event('CHECKPOINT', { step: opts.resumeFrom.step, replayable: true, resumed: true });
    for (let i = 0; i < startIndex; i += 1) trace.markPlanStep(i + 1, 'SKIPPED');
  }

  for (let index = startIndex; index < agent.stages.length; index += 1) {
    const stage = agent.stages[index];
    if (!stage) continue;

    trace.markPlanStep(index + 1, 'RUNNING');
    try {
      await runStage({
        stage,
        stageIndex: index,
        parentId: orchestratorNode,
        trace,
        blackboard,
        router,
        tools,
        priceBook,
        input: opts.input ?? {},
        onTrace: opts.onTrace,
      });
      trace.markPlanStep(index + 1, 'DONE');
    } catch (cause) {
      if (cause instanceof BudgetExceededError) {
        trace.event('BUDGET_EXCEEDED', {
          scope: cause.status.scope,
          key: cause.status.key,
          cap: cause.status.cap,
          spend: cause.status.spend,
          pausedActionTypes: stage.actionType ? [stage.actionType] : [],
        });
        trace.markPlanStep(index + 1, 'HALTED');
        trace.closeNode(orchestratorNode, {
          status: 'HALTED',
          tokens: orchestratorTokens,
          cost: orchestratorCost,
          cacheHitRate: orchestratorCacheRate,
        });
        return {
          run: trace.build({ status: 'HALTED', outcome: 'BUDGET_CAP' }),
          provenance: buildProvenance(trace, agent, blackboard, 0, undefined),
          checkpoints,
          blackboard,
        };
      }
      trace.markPlanStep(index + 1, 'FAILED');
      return failRun(trace, blackboard, checkpoints, orchestratorNode, cause);
    }

    // §17: a checkpoint after each sub-agent completes.
    const checkpoint: Checkpoint = {
      step: index + 1,
      nodeId: `after:${stage.name}`,
      stageIndex: index + 1,
      stateCard: trace.stateCard(),
      at: toMyt(now()),
      replayable: true,
    };
    checkpoints.push(checkpoint);
    trace.event('CHECKPOINT', { step: checkpoint.step, replayable: true });
  }

  /* --- the jury, only when a trigger fires ------------------------- */

  const plan = agent.submit(blackboard);
  trace.pointAt(plan.targetRef);

  const routingEntry = entryFor(router.config, plan.type);
  let jury: JuryOutcome | undefined;

  if (routingEntry?.jury) {
    const question: JuryQuestion = {
      proposition: `${plan.type} on ${plan.targetRef}. ${plan.reasoning}`,
      evidence: plan.evidence.map((e) => `- ${e.type} ${e.ref}${e.excerpt ? `: ${e.excerpt}` : ''}`).join('\n'),
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

  /* --- n5 · the gate ----------------------------------------------- */

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
      error: { attempt: 1, code: submitResult.error?.code ?? 'UNKNOWN', message: submitResult.error?.message },
    });
  } else if (response.status === 'QUEUED_FOR_APPROVAL') {
    const queued = response as ActionQueuedResponse;
    approval = queued.approvalRequest;
    haltedBy = {
      policyId: queued.approvalRequest.policyId,
      approvalRequestRef: queued.approvalRequest.ref,
      reason: haltReason(plan),
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
    trace.step({
      tool: 'actions.perform',
      args: submitArgs,
      status: 'HALTED',
      durationMs: 0,
      haltedBy,
    });
    trace.decide(`Stopped at ${queued.approvalRequest.policyId}; ${queued.approvalRequest.ref} raised for a human`);
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

  trace.closeNode(orchestratorNode, {
    status: status === 'HALTED' ? 'HALTED' : status === 'FAILED' ? 'FAILED' : 'OK',
    tokens: orchestratorTokens,
    cost: orchestratorCost,
    cacheHitRate: orchestratorCacheRate,
  });

  return {
    run: trace.build({ status, outcome }),
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
  parentId: string;
  trace: TraceBuilder;
  blackboard: Blackboard;
  router: Router;
  tools: ToolAdapter;
  priceBook: PriceBook;
  input: Record<string, unknown>;
  onTrace: RunAgentOptions['onTrace'];
}

async function runStage(opts: RunStageOptions): Promise<void> {
  const { stage, trace, blackboard, router, tools, priceBook } = opts;

  const requestedTier = stage.tier ?? router.tierFor(stage.actionType);
  const ladder = entryFor(router.config, stage.actionType as GovernedActionType)?.escalationLadder ?? [
    requestedTier,
  ];

  let tier = requestedTier;
  let attemptsAtStage = 0;
  let escalated = false;

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

    const meter = new ContextMeter({ contextWindow: binding?.contextWindow ?? 128_000 });
    const toolDefs = toolDefsFor(stage.tools);

    let messages: LLMMessage[] = [
      { role: 'user', content: stage.prompt({ blackboard, stateCard: renderStateCard(trace.stateCard()), input: opts.input }) },
    ];

    let tokensIn = 0;
    let tokensOut = 0;
    let cost: Money = { amount: 0, currency: 'MYR' };
    let cacheWeighted = 0;
    let retries = 0;
    let finalText = '';
    let degradedTo: TierKey | undefined;

    for (let turn = 0; turn < stage.maxTurns; turn += 1) {
      const call = await router.call(
        tier,
        { system: stage.system, messages, tools: toolDefs },
        { actionType: stage.actionType },
      );

      if (call.degraded) {
        degradedTo = call.tier;
        trace.retagNode(nodeId, {
          tier: call.tier,
          model: call.result.model,
          provider: toContractProvider(call.result.provider),
        });
        trace.event('ESCALATION', {
          from: call.requestedTier,
          to: call.tier,
          node: nodeId,
          reason: call.attempts[0]?.reason,
        });
      }

      tokensIn += call.result.usage.in;
      tokensOut += call.result.usage.out;
      cost = { amount: cost.amount + usdToMoney(call.result.costUsd, priceBook).amount, currency: 'MYR' };
      cacheWeighted += call.result.usage.in * call.result.cacheHitRate;
      meter.add(call.result.usage.in);

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
      if (meter.shouldHandoff) {
        trace.event('HANDOFF', {
          atContextPct: Math.round(meter.fraction * 100) / 100,
          restartedNodes: [nodeId],
          node: nodeId,
        });
        messages = [
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
              stage.prompt({ blackboard, stateCard: renderStateCard(trace.stateCard()), input: opts.input }),
            ].join('\n'),
          },
        ];
        meter.reset();
        retries += 1;
      }
    }

    const facts = stage.harvest?.(finalText, blackboard) ?? extractJson(finalText) ?? {};
    blackboard.facts[stage.name] = facts;
    blackboard.notes[stage.name] = finalText;

    for (const decision of asStringArray(facts['decisions'])) trace.decide(decision);
    for (const question of asStringArray(facts['openQuestions'])) trace.openQuestion(question);
    for (const ref of asStringArray(facts['recordPointers'])) trace.pointAt(ref);

    trace.closeNode(nodeId, {
      status: retries > 0 ? 'RETRIED' : 'OK',
      tokens: { in: tokensIn, out: tokensOut },
      cost,
      cacheHitRate: tokensIn > 0 ? cacheWeighted / tokensIn : 0,
      retries: retries || undefined,
    });
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
    trace.step({ tool: toolCall.name, args: toolCall.input, status: 'FAILED', durationMs: 0, error: { attempt: 1, code: 'NO_SUCH_TOOL', message } });
    return { role: 'tool', toolCallId: toolCall.id, name: toolCall.name, content: message, isError: true };
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
    error: result.ok ? undefined : { attempt: 1, code: result.error?.code ?? 'TOOL_ERROR', message: result.error?.message },
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
 * Resume
 * ------------------------------------------------------------------ */

/**
 * `POST /v1/runs/{id}/retry?from=checkpoint`.
 *
 * The stages before the checkpoint are marked `SKIPPED` rather than replayed,
 * and the resumed run carries the stored state card in, which is exactly what
 * §17 says the checkpoint is for.
 */
export async function retryFromCheckpoint(
  checkpoint: Checkpoint,
  opts: RunAgentOptions,
): Promise<AgentRunResult> {
  return runAgent({ ...opts, resumeFrom: checkpoint });
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
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
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

function haltReason(plan: SubmitPlan): string {
  if (plan.value) {
    return `Value RM ${(plan.value.amount / 100).toLocaleString('en-MY')} requires approval`;
  }
  return `${plan.type} is policy-gated`;
}

function buildProvenance(
  trace: TraceBuilder,
  agent: AgentDefinition,
  blackboard: Blackboard,
  confidence: number,
  jury: JuryOutcome | undefined,
): Provenance {
  const strongest = [...(trace.nodeById('n0') ? [trace.nodeById('n0')!] : [])];
  const nodes = agent.stages
    .map((s) => s.name)
    .map((name) => trace.nodeById(nodeIdForName(trace, name)))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
  const authoring = nodes[nodes.length - 1] ?? strongest[0];

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
  for (let i = 0; i < trace.nodeCount; i += 1) {
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
  checkpoints: Checkpoint[],
  orchestratorNode: string,
  cause: unknown,
): AgentRunResult {
  const code =
    cause instanceof NoProviderError
      ? 'NO_PROVIDER'
      : cause instanceof BudgetExceededError
        ? 'BUDGET_CAP'
        : 'RUN_FAILED';
  const message = cause instanceof Error ? cause.message : String(cause);

  trace.closeNode(orchestratorNode, { status: 'FAILED' });
  return {
    run: trace.build({
      status: 'FAILED',
      outcome: code,
      failure: { code, message, attempts: 1, retryable: code !== 'BUDGET_CAP', deadLettered: false },
    }),
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
