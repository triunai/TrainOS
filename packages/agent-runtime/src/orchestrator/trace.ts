/**
 * The trace builder.
 *
 * One job: produce an `AutomationRun` that M18-S04 can render without the
 * screen knowing anything about this package. Every field the §17 example
 * shows is populated, `nodes[]` is a real tree with `parentId` links, and
 * `haltedBy` sits on the node that was stopped — which is what makes the
 * trace *proof* that nothing was sent, rather than an inference from the logs.
 *
 * `steps[]` is filled too. §10's own example still returns it and §17 only
 * says the node tree "replaces" it, so dropping it would break any consumer
 * written against §10 for nothing gained.
 */

import type {
  AiProvider,
  AutomationRun,
  HaltedBy,
  Money,
  Ref,
  RunEvent,
  RunEventDetail,
  RunEventType,
  RunStateCard,
  RunStatus,
  RunStep,
  RunStepStatus,
  StateCardPlanStep,
  TierKey,
  TraceNode,
  TraceNodeKind,
} from '@trainos/contract';
import { sumMoney } from '../providers/pricing';
import { toMyt } from '../fixtures/local-client';

/** What opening a node needs to know. */
export interface OpenNodeInput {
  parentId: string | null;
  kind: TraceNodeKind;
  name: string;
  tier?: TierKey;
  model?: string;
  provider?: AiProvider;
}

/** What closing a node records. */
export interface CloseNodeInput {
  status: RunStepStatus;
  tokens?: { in: number; out: number };
  cost?: Money;
  cacheHitRate?: number;
  retries?: number;
  haltedBy?: HaltedBy;
}

export interface TraceBuilderOptions {
  runId: string;
  runRef: string;
  agentId: string;
  orchestrator: string;
  trigger: { type: string; ref?: Ref };
  goal: string;
  constraints: string[];
  guardrails: string[];
  tokenLimit: number;
  costLimit: Money;
  /** Injected so traces are reproducible under test. */
  now?: () => Date;
}

/**
 * Accumulates a run and hands back a contract-shaped `AutomationRun`.
 *
 * Deliberately not a class the orchestrator inherits from: the orchestrator
 * *has* a trace, it is not one, and keeping the accounting here means the run
 * loop never has to remember to sum a token count.
 */
export class TraceBuilder {
  readonly runId: string;
  readonly runRef: string;

  private readonly opts: TraceBuilderOptions;
  private readonly now: () => Date;
  private readonly startedAt: Date;

  private readonly nodes: TraceNode[] = [];
  private readonly events: RunEvent[] = [];
  private readonly steps: RunStep[] = [];
  private readonly openedAt = new Map<string, number>();
  private readonly tiers = new Set<TierKey>();

  private nodeSeq = 0;
  private stepSeq = 0;

  private plan: StateCardPlanStep[] = [];
  private decisions: string[] = [];
  private openQuestions: string[] = [];
  private recordPointers: Ref[] = [];

  constructor(opts: TraceBuilderOptions) {
    this.opts = opts;
    this.runId = opts.runId;
    this.runRef = opts.runRef;
    this.now = opts.now ?? (() => new Date());
    this.startedAt = this.now();
  }

  /* ---------------------------------------------------------------- *
   * Nodes
   * ---------------------------------------------------------------- */

  openNode(input: OpenNodeInput): string {
    const id = `n${this.nodeSeq++}`;
    this.nodes.push({
      id,
      parentId: input.parentId,
      kind: input.kind,
      name: input.name,
      tier: input.tier,
      model: input.model,
      provider: input.provider,
      status: 'OK',
    });
    this.openedAt.set(id, this.now().getTime());
    if (input.tier) this.tiers.add(input.tier);
    return id;
  }

  closeNode(id: string, input: CloseNodeInput): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    const opened = this.openedAt.get(id);
    node.status = input.status;
    node.durationMs = opened === undefined ? 0 : Math.max(0, this.now().getTime() - opened);
    if (input.tokens) node.tokens = input.tokens;
    if (input.cost) node.cost = input.cost;
    if (input.cacheHitRate !== undefined) node.cacheHitRate = round2(input.cacheHitRate);
    if (input.retries) node.retries = input.retries;
    if (input.haltedBy) node.haltedBy = input.haltedBy;
  }

  /** Retag a node when the router served it from a different tier. */
  retagNode(id: string, patch: { tier?: TierKey; model?: string; provider?: AiProvider }): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    if (patch.tier) {
      node.tier = patch.tier;
      this.tiers.add(patch.tier);
    }
    if (patch.model) node.model = patch.model;
    if (patch.provider) node.provider = patch.provider;
  }

  nodeById(id: string): TraceNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  /* ---------------------------------------------------------------- *
   * Events and steps
   * ---------------------------------------------------------------- */

  event(type: RunEventType, detail: RunEventDetail): void {
    this.events.push({ type, at: toMyt(this.now()), detail });
  }

  eventsOfType(type: RunEventType): RunEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  step(input: Omit<RunStep, 'seq'>): void {
    this.steps.push({ seq: ++this.stepSeq, ...input });
  }

  /* ---------------------------------------------------------------- *
   * The state card
   * ---------------------------------------------------------------- */

  setPlan(labels: string[]): void {
    this.plan = labels.map((label, index) => ({ n: index + 1, label, status: 'PENDING' }));
  }

  markPlanStep(n: number, status: 'DONE' | 'RUNNING' | 'HALTED' | 'SKIPPED' | 'FAILED'): void {
    const step = this.plan.find((s) => s.n === n);
    if (step) step.status = status;
  }

  decide(decision: string): void {
    if (decision.trim() !== '' && !this.decisions.includes(decision)) {
      this.decisions.push(decision);
    }
  }

  openQuestion(question: string): void {
    if (question.trim() !== '' && !this.openQuestions.includes(question)) {
      this.openQuestions.push(question);
    }
  }

  pointAt(ref: Ref | undefined): void {
    if (ref && !this.recordPointers.includes(ref)) this.recordPointers.push(ref);
  }

  /* ---------------------------------------------------------------- *
   * Totals
   * ---------------------------------------------------------------- */

  get tokens(): { in: number; out: number } {
    return this.nodes.reduce(
      (acc, node) => ({
        in: acc.in + (node.tokens?.in ?? 0),
        out: acc.out + (node.tokens?.out ?? 0),
      }),
      { in: 0, out: 0 },
    );
  }

  get cost(): Money {
    return sumMoney(this.nodes.map((n) => n.cost ?? { amount: 0, currency: 'MYR' as const }));
  }

  /**
   * Run-level cache hit rate, weighted by input tokens.
   *
   * An unweighted mean of per-node rates would let a 200-token node move the
   * headline figure as much as a 40,000-token one, which is how a cache
   * dashboard ends up lying about savings.
   */
  get cacheHitRate(): number {
    let weighted = 0;
    let total = 0;
    for (const node of this.nodes) {
      const inTokens = node.tokens?.in ?? 0;
      if (inTokens === 0) continue;
      weighted += inTokens * (node.cacheHitRate ?? 0);
      total += inTokens;
    }
    return total === 0 ? 0 : round2(weighted / total);
  }

  stateCard(): RunStateCard {
    return {
      goal: this.opts.goal,
      plan: this.plan,
      decisions: this.decisions,
      constraints: this.opts.constraints,
      recordPointers: this.recordPointers,
      openQuestions: this.openQuestions,
      budgets: {
        tokens: { used: this.tokens.in + this.tokens.out, limit: this.opts.tokenLimit },
        cost: { used: this.cost, limit: this.opts.costLimit },
      },
    };
  }

  /* ---------------------------------------------------------------- *
   * The run
   * ---------------------------------------------------------------- */

  build(input: { status: RunStatus; outcome?: string; failure?: AutomationRun['failure'] }): AutomationRun {
    const modelsUsed = [...new Set(this.nodes.map((n) => n.model).filter(isString))];

    return {
      id: this.runId,
      ref: this.runRef,
      agentId: this.opts.agentId,
      trigger: this.opts.trigger,
      model: modelsUsed[0],
      startedAt: toMyt(this.startedAt),
      durationMs: Math.max(0, this.now().getTime() - this.startedAt.getTime()),
      cost: this.cost,
      tokens: this.tokens,
      status: input.status,
      outcome: input.outcome,
      guardrails: this.opts.guardrails,
      steps: this.steps,
      failure: input.failure,
      orchestrator: this.opts.orchestrator,
      cacheHitRate: this.cacheHitRate,
      tiersUsed: [...this.tiers],
      nodes: this.nodes,
      events: this.events,
      stateCard: this.stateCard(),
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}
