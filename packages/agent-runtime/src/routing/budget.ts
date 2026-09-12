/**
 * Budget accounting.
 *
 * §17: "A tripped cap sets the affected routing entry to `PAUSED_BY_CAP`; runs
 * requesting it get `409 AGENT_PAUSED` with `details.reason: 'BUDGET_CAP'`."
 * That is what this file enforces, in-process. The ledger is per-run here; the
 * production one is the `/v1/ai/usage` accounting, and the interface is the
 * same either way — ask before spending, record after.
 */

import type { Money } from '@trainos/contract';
import type { BudgetLimit } from './config';

export type BudgetState = 'WITHIN' | 'NEAR' | 'PAUSED';

/** Spend against one cap. Mirrors the §17 `Budget` shape. */
export interface BudgetStatus {
  scope: BudgetLimit['scope'];
  key: string;
  cap: Money;
  spend: Money;
  state: BudgetState;
}

/** A cap that has tripped. The orchestrator turns this into `BUDGET_EXCEEDED`. */
export class BudgetExceededError extends Error {
  readonly status: BudgetStatus;

  constructor(status: BudgetStatus) {
    super(
      `Budget cap tripped for ${status.scope} ${status.key}: ` +
        `${status.spend.amount} sen against a ${status.cap.amount} sen cap`,
    );
    this.name = 'BudgetExceededError';
    this.status = status;
  }
}

/** At or above this fraction of the cap, a budget reports `NEAR`. */
export const NEAR_THRESHOLD = 0.9;

export class BudgetLedger {
  private readonly caps = new Map<string, BudgetLimit>();
  private readonly spend = new Map<string, number>();

  constructor(limits: readonly BudgetLimit[] = []) {
    for (const limit of limits) this.caps.set(keyOf(limit.scope, limit.key), limit);
  }

  /** Record spend against every scope this call belongs to. */
  record(cost: Money, scopes: { tier?: string; agent?: string; actionType?: string }): void {
    if (scopes.tier) this.add('TIER', scopes.tier, cost.amount);
    if (scopes.agent) this.add('AGENT', scopes.agent, cost.amount);
    if (scopes.actionType) this.add('ACTION_TYPE', scopes.actionType, cost.amount);
  }

  private add(scope: BudgetLimit['scope'], key: string, amount: number): void {
    const id = keyOf(scope, key);
    this.spend.set(id, (this.spend.get(id) ?? 0) + amount);
  }

  /** Current status for one cap, or `undefined` when nothing caps it. */
  status(scope: BudgetLimit['scope'], key: string): BudgetStatus | undefined {
    const limit = this.caps.get(keyOf(scope, key));
    if (!limit) return undefined;
    const spent = this.spend.get(keyOf(scope, key)) ?? 0;
    const ratio = limit.cap.amount === 0 ? Infinity : spent / limit.cap.amount;
    return {
      scope,
      key,
      cap: limit.cap,
      spend: { amount: spent, currency: 'MYR' },
      state: ratio >= 1 ? 'PAUSED' : ratio >= NEAR_THRESHOLD ? 'NEAR' : 'WITHIN',
    };
  }

  /** Every cap the ledger knows about, with live spend. */
  all(): BudgetStatus[] {
    const out: BudgetStatus[] = [];
    for (const limit of this.caps.values()) {
      const status = this.status(limit.scope, limit.key);
      if (status) out.push(status);
    }
    return out;
  }

  /**
   * Throw when any of these scopes has already tripped.
   *
   * Called *before* a spend, never after: a run that has blown its cap must
   * not make one more call to discover it.
   */
  assertWithin(scopes: { tier?: string; agent?: string; actionType?: string }): void {
    const checks: Array<[BudgetLimit['scope'], string | undefined]> = [
      ['TIER', scopes.tier],
      ['AGENT', scopes.agent],
      ['ACTION_TYPE', scopes.actionType],
    ];
    for (const [scope, key] of checks) {
      if (!key) continue;
      const status = this.status(scope, key);
      if (status?.state === 'PAUSED') throw new BudgetExceededError(status);
    }
  }

  /** Total spend across every recorded scope of one kind. */
  totalFor(scope: BudgetLimit['scope']): Money {
    let amount = 0;
    for (const [id, spent] of this.spend) {
      if (id.startsWith(`${scope}:`)) amount += spent;
    }
    return { amount, currency: 'MYR' };
  }
}

function keyOf(scope: string, key: string): string {
  return `${scope}:${key}`;
}
