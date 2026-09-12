/**
 * Context accounting and handoff.
 *
 * The M18-S04 assumption, stated on the screen's own row in the design pack:
 * "per-run token/cost budgets trigger a HANDOFF and restart at 60% context
 * rather than truncation; checkpoints written after each sub-agent completes."
 *
 * That is a real design decision and not a detail. Truncating a conversation
 * silently drops the middle of the reasoning; handing off writes what was
 * learned into the state card and restarts the node with a clean window. The
 * run gets slower and stays correct, and the trace records which nodes were
 * restarted so a reviewer can see it happened.
 */

import type { RunStateCard } from '@trainos/contract';

/** Handoff fires at this fraction of the model's input window. */
export const HANDOFF_THRESHOLD = 0.6;

export interface ContextMeterOptions {
  /** The model's input window, from the tier binding. */
  contextWindow: number;
  threshold?: number;
}

/**
 * Tracks how full one node's context window is.
 *
 * Counts input tokens only. Output tokens leave the window as soon as they are
 * summarised into the state card, and counting them would fire handoffs early
 * on a node that happened to write a long draft.
 */
export class ContextMeter {
  readonly contextWindow: number;
  readonly threshold: number;

  private used = 0;

  constructor(opts: ContextMeterOptions) {
    this.contextWindow = Math.max(1, opts.contextWindow);
    this.threshold = opts.threshold ?? HANDOFF_THRESHOLD;
  }

  add(inputTokens: number): void {
    this.used += Math.max(0, inputTokens);
  }

  reset(): void {
    this.used = 0;
  }

  get usedTokens(): number {
    return this.used;
  }

  /** 0–1. Reported on the `HANDOFF` event as `atContextPct`. */
  get fraction(): number {
    return this.used / this.contextWindow;
  }

  get shouldHandoff(): boolean {
    return this.fraction >= this.threshold;
  }
}

/**
 * What a restarted node is told about what already happened.
 *
 * The state card is the handoff protocol: a node that restarts reads this
 * instead of the conversation it lost. Keeping the rendering here means the
 * handoff text and the M18-S04 state-card panel cannot drift apart, because
 * they are the same object.
 */
export function renderStateCard(card: RunStateCard): string {
  const lines: string[] = [];
  lines.push(`GOAL: ${card.goal}`);

  if (card.plan.length > 0) {
    lines.push('', 'PLAN:');
    for (const step of card.plan) lines.push(`  ${step.n}. [${step.status}] ${step.label}`);
  }
  if (card.decisions.length > 0) {
    lines.push('', 'DECISIONS ALREADY MADE (do not revisit):');
    for (const decision of card.decisions) lines.push(`  - ${decision}`);
  }
  if (card.constraints.length > 0) {
    lines.push('', 'CONSTRAINTS:');
    for (const constraint of card.constraints) lines.push(`  - ${constraint}`);
  }
  if (card.recordPointers.length > 0) {
    lines.push('', `RECORDS IN PLAY: ${card.recordPointers.join(', ')}`);
  }
  if (card.openQuestions.length > 0) {
    lines.push('', 'OPEN QUESTIONS:');
    for (const question of card.openQuestions) lines.push(`  - ${question}`);
  }
  lines.push(
    '',
    `BUDGET: ${card.budgets.tokens.used} of ${card.budgets.tokens.limit} tokens, ` +
      `${card.budgets.cost.used.amount} of ${card.budgets.cost.limit.amount} sen.`,
  );
  return lines.join('\n');
}
