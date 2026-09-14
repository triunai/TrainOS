/**
 * §10 · Agents, runs, dashboards — with the §17 orchestrator trace.
 *
 * Screens M18-S01 (agent registry), M18-S04 (run trace), M01-S01 (executive
 * dashboard).
 */

import type {
  Money,
  MetricValue,
  Provenance,
  Rate,
  Ref,
  Timestamp,
} from '../envelope';
import type {
  AgentStatus,
  AiProvider,
  AutonomyLevel,
  DeltaDirection,
  HoursSavedBasis,
  PlanStepStatus,
  RunEventType,
  RunStatus,
  RunStepStatus,
  TierKey,
  TraceNodeKind,
} from '../enums';
import type { GovernedActionType } from '../actions';
import type { ApprovalSummary } from './approvals';
import type { JuryPolicy } from './ai-ops';

/* ------------------------------------------------------------------ *
 * §10 · GET /v1/agents — M18-S01
 * ------------------------------------------------------------------ */

/**
 * §10 one autonomy grant.
 *
 * `ceiling` is the highest level this action type may ever reach, and
 * `ceilingReason` is why — DECISIONS §1: anything that moves money, makes a
 * commitment to a client, or touches HRDC state never starts above
 * act-with-approval.
 */
export interface AutonomyGrant {
  actionType: GovernedActionType;
  level: AutonomyLevel;
  paused: boolean;
  ceiling?: AutonomyLevel;
  /** e.g. `MONEY_MOVING`. */
  ceilingReason?: string;
  approverRole?: string;
  thresholdValue?: Money;
}

/** §10 the condition under which a paused agent may resume. */
export interface AgentResumeCondition {
  metric: string;
  op: string;
  value: number;
}

/**
 * §10 an agent in the registry, with the §17 columns added
 * (`defaultTier`, `jury`, `cacheHitRate30d`, `costPerRun30d`).
 *
 * The escalation ladder was dropped from this table during the fit pass; it
 * lives on M20-S20, which owns it.
 */
export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  scopes: string[];
  autonomy: AutonomyGrant[];
  costMonth: Money;
  evalScore: Rate;
  lastRunAt: Timestamp | null;
  killSwitch: boolean;
  pausedAt?: Timestamp;
  /** e.g. `EVAL_REGRESSION`. */
  pausedReason?: string;
  resumeCondition?: AgentResumeCondition;
  /* §17 additions. */
  defaultTier?: TierKey;
  escalationLadder?: TierKey[];
  jury?: JuryPolicy;
  cacheHitRate30d?: Rate;
  costPerRun30d?: Money;
}

/** §10 the registry summary strip. */
export interface AgentRegistrySummary {
  actionsMonth: number;
  cost: Money;
  budget: Money;
  approvalsRaised: number;
  autoApproved: number;
  medianEval: Rate;
  incidents30d: number;
}

/** §10 `GET /v1/agents`. */
export interface AgentRegistryResponse {
  data: Agent[];
  summary: AgentRegistrySummary;
}

/**
 * §10 `PUT /v1/agents/{id}/autonomy` — MD-gated.
 *
 * Returns `422 VALIDATION_FAILED` with `details.reason:
 * "MONEY_MOVING_CEILING"` when a money-moving action is set to AUTONOMOUS.
 */
export interface AgentAutonomyWrite {
  actionType: GovernedActionType;
  level: AutonomyLevel;
}

/** §10 `POST /v1/agents/{id}/pause`. `null` pauses the whole agent. Immediate, audited, idempotent. */
export interface AgentPauseRequest {
  actionType: GovernedActionType | null;
}

/* ------------------------------------------------------------------ *
 * §10 · Runs — M18-S04
 * ------------------------------------------------------------------ */

/** §10 what started the run. */
export interface RunTrigger {
  type: string;
  ref?: Ref;
}

/** §10 token usage. */
export interface TokenUsage {
  in: number;
  out: number;
}

/**
 * §10 the policy that stopped a step or node.
 *
 * `haltedBy` is first-class — it is how the trace proves the agent never sent
 * anything, rather than an inference from the logs.
 */
export interface HaltedBy {
  policyId: string;
  approvalRequestRef: Ref;
  reason: string;
}

/** §10 one flat tool step. */
export interface RunStep {
  seq: number;
  tool: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: RunStepStatus;
  retries?: number;
  durationMs: number;
  cost?: Money;
  error?: { attempt: number; code: string; message?: string };
  haltedBy?: HaltedBy;
}

/** §10 why a run failed, and whether it can be retried. */
export interface RunFailure {
  code: string;
  message: string;
  attempts: number;
  retryable: boolean;
  deadLettered: boolean;
}

/* §17 · Orchestrator trace ------------------------------------------ */

/** §17 one node of the execution tree. */
export interface TraceNode {
  id: string;
  parentId: string | null;
  kind: TraceNodeKind;
  name: string;
  tier?: TierKey;
  model?: string;
  provider?: AiProvider;
  tokens?: TokenUsage;
  cacheHitRate?: Rate;
  cost?: Money;
  durationMs?: number;
  retries?: number;
  status: RunStepStatus;
  haltedBy?: HaltedBy;
}

/** §17 one juror's vote inside a `JURY` run event. */
export interface JuryVote {
  tier: TierKey;
  model: string;
  agrees: boolean;
  dissent?: string;
}

/**
 * §17 one row of the run's event log.
 *
 * `detail` shape varies by `type`: an `ESCALATION` carries from/to tiers and
 * the confidence that triggered it, a `JURY` carries `votes[]`, a
 * `POLICY_HALT` carries the policy and approval refs.
 */
export interface RunEvent {
  type: RunEventType;
  at?: Timestamp;
  detail: RunEventDetail;
}

/** §17 the union of observed `detail` bags, all fields optional. */
export interface RunEventDetail {
  /** ESCALATION */
  from?: TierKey;
  to?: TierKey;
  confidence?: number;
  threshold?: number;
  node?: string;
  /** JURY */
  quorum?: number;
  of?: number;
  votes?: JuryVote[];
  /** TRUNCATION */
  tool?: string;
  storedTokens?: number;
  fetchMoreAvailable?: boolean;
  /** HANDOFF */
  atContextPct?: number;
  restartedNodes?: string[];
  /** CHECKPOINT */
  step?: number;
  replayable?: boolean;
  /** POLICY_HALT */
  policyId?: string;
  approvalRequestRef?: Ref;
  [key: string]: unknown;
}

/** §17 one line of the run's plan. */
export interface StateCardPlanStep {
  n: number;
  label: string;
  /**
   * Ruling R10: an enum. A plan step that has not started and one that failed
   * were the same untyped string before.
   */
  status: PlanStepStatus;
}

/** §17 the token and cost envelope the run is working inside. */
export interface StateCardBudgets {
  tokens: { used: number; limit: number };
  cost: { used: Money; limit: Money };
}

/**
 * §17 the state card — what the orchestrator is holding in mind.
 *
 * `POST /v1/runs/{id}/retry?from=checkpoint` resumes from the last checkpoint
 * using this stored state.
 */
export interface RunStateCard {
  goal: string;
  plan: StateCardPlanStep[];
  decisions: string[];
  constraints: string[];
  recordPointers: Ref[];
  openQuestions: string[];
  budgets: StateCardBudgets;
}

/**
 * §10 + §17 an automation run.
 *
 * §17 replaces the flat step list with `nodes[]`, `events[]` and `stateCard`;
 * `steps[]` is kept because §10's own example still returns it.
 */
export interface AutomationRun {
  id: string;
  ref: string;
  agentId: string;
  trigger: RunTrigger;
  model?: string;
  startedAt: Timestamp;
  durationMs: number;
  cost: Money;
  tokens: TokenUsage;
  status: RunStatus;
  outcome?: string;
  guardrails: string[];
  steps?: RunStep[];
  failure?: RunFailure;
  /* §17 additions. */
  orchestrator?: string;
  cacheHitRate?: Rate;
  tiersUsed?: TierKey[];
  nodes?: TraceNode[];
  events?: RunEvent[];
  stateCard?: RunStateCard;
}

/** §10 `POST /v1/runs/{id}/dead-letter`. */
export interface RunDeadLetterRequest {
  reason: string;
}

/**
 * §10 `POST /v1/runs/{id}/replay?mode=SANDBOX` — no side effects, returns a
 * new sandbox run id.
 * TODO(contract §16 Q8): does sandbox replay read live data or a snapshot
 * pinned to the original run? Live reads make replays non-deterministic.
 */
export interface RunReplayResponse {
  runId: string;
  mode: 'SANDBOX';
}

/** §17 `POST /v1/runs/{id}/retry?from=checkpoint`. */
export type RunRetryFrom = 'checkpoint';

/* ------------------------------------------------------------------ *
 * §10 · Dashboards — M01-S01
 * ------------------------------------------------------------------ */

/**
 * §10 one self-describing dashboard cell.
 *
 * `value` is nullable, on top of `MetricValue`'s own type: every other cell on
 * this strip is derived from data that exists (pipeline, AR, proposals,
 * claims), but `ADMIN_HOURS_SAVED` has no source until something measures a
 * baseline. `null` is the server's honest answer for that case, and it means
 * the screen must render "not available" rather than fold a missing figure
 * into a `0` that reads as "measured, and it was zero."
 */
export interface DashboardMetric extends Omit<MetricValue<Money | number>, 'value'> {
  key: string;
  label: string;
  value: Money | number | null;
  /** §10 `ADMIN_HOURS_SAVED` ships the formula it was computed from. */
  formula?: string;
}

/** §10 a day of agent activity on the dashboard. */
export interface AgentDaily {
  agentId: string;
  agentName: string;
  actionsToday: number;
  autonomy: AutonomyLevel;
  costMonth: Money;
  evalScore: Rate;
}

/** §10 the autonomy mix donut. */
export interface AutonomyMixSlice {
  level: AutonomyLevel;
  rate: Rate;
}

/** §10 spend against budget. */
export interface AgentSpend {
  spent: Money;
  budget: Money;
}

/** §10 `GET /v1/dashboards/executive?period=`. */
export interface ExecutiveDashboard {
  metrics: DashboardMetric[];
  approvalsPending: ApprovalSummary[];
  agentActivity: AgentDaily[];
  autonomyMix: AutonomyMixSlice[];
  agentSpend: AgentSpend;
}

/** §10 `GET /v1/metrics/{key}?scope=&id=` — one MetricStrip cell for a record header. */
export interface MetricResponse {
  value: Money | number;
  secondary?: string;
  delta?: { rate: Rate; direction: DeltaDirection; severity?: string; comparedTo?: string };
  drillTo?: string;
}

/** §10 `GET /v1/reports/proposals-vs-won?months=`. */
export interface ProposalsVsWonReport {
  series: { period: string; sent: number; won: number }[];
}

/**
 * §18 `GET /v1/reports/hours-saved`.
 *
 * The tile **must** render `basis` — it may not display a bare number.
 * DECISIONS §4: the first quarter applies a 0.7 haircut labelled
 * "measured baseline × 0.7 (conservative)"; `baselineMinutes` is measured in
 * discovery, never assumed.
 */
export interface HoursSavedReport {
  hours: number;
  basis: HoursSavedBasis;
  haircut: number;
  baselineTableVersion: string;
  actionTypes: HoursSavedActionType[];
}

/** §18 one action type's contribution to hours saved. */
export interface HoursSavedActionType {
  key: GovernedActionType;
  baselineMinutes: number;
  humanMinutes: number;
  credited: number;
}

/** §10 `GET /v1/evals?agentId=` — the eval dashboard row. */
export interface AgentEval {
  agentId: string;
  window: string;
  score: Rate;
  sampleSize: number;
  provenance?: Provenance;
}
