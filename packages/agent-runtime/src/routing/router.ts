/**
 * The router — tier in, model call out.
 *
 * Everything that decides *which* model answers lives here, so the
 * orchestrator can be read as pure control flow. Three responsibilities:
 *
 *   1. resolve an action type to a tier (§17 routing matrix),
 *   2. call that tier, falling down its chain when the provider errors or has
 *      no key, and report the fall so the run can log an `ESCALATION`,
 *   3. refuse to spend past a cap.
 *
 * Falling back is deliberately not silent. §17 models a tier that is carrying
 * somebody else's traffic as `DEGRADED` with an `activeFallback`, and a trace
 * that hides the substitution would make the M20-S20 degradation banner a lie.
 */

import type { GovernedActionType, TierKey } from '@trainos/contract';
import type { ProviderRegistry } from '../providers/resolve';
import { ProviderError, type ChatRequest, type ChatResult } from '../providers/types';
import { usdToMoney, type PriceBook, DEFAULT_PRICE_BOOK } from '../providers/pricing';
import { BudgetLedger } from './budget';
import { entryFor, type RoutingConfig, type TierBinding } from './config';

/** One attempt that did not produce an answer. */
export interface TierAttempt {
  tier: TierKey;
  model: string;
  reason: string;
}

export interface RoutedCall {
  result: ChatResult;
  /** The tier that actually answered. */
  tier: TierKey;
  binding: TierBinding;
  /** The tier originally asked for, when it differs from {@link tier}. */
  requestedTier: TierKey;
  /** Tiers tried and abandoned, in order. Empty on the happy path. */
  attempts: TierAttempt[];
  /** True when the call was served by a fallback rather than the asked-for tier. */
  degraded: boolean;
}

/** Everything the router needs but does not own. */
export interface RouterOptions {
  config: RoutingConfig;
  registry: ProviderRegistry;
  ledger?: BudgetLedger;
  priceBook?: PriceBook;
  /** Recorded against `AGENT` budget scope. */
  agentId?: string;
}

/** The tier chain has no reachable provider left. */
export class NoProviderError extends Error {
  readonly attempts: TierAttempt[];

  constructor(tier: TierKey, attempts: TierAttempt[]) {
    super(
      `No provider could serve tier ${tier}. Tried: ` +
        (attempts.map((a) => `${a.tier} (${a.reason})`).join(', ') || 'nothing'),
    );
    this.name = 'NoProviderError';
    this.attempts = attempts;
  }
}

export class Router {
  readonly config: RoutingConfig;
  readonly registry: ProviderRegistry;
  readonly ledger: BudgetLedger;

  private readonly priceBook: PriceBook;
  private readonly agentId: string | undefined;
  private readonly degradedTiers = new Map<TierKey, { reason: string; activeFallback: TierKey }>();

  constructor(opts: RouterOptions) {
    this.config = opts.config;
    this.registry = opts.registry;
    this.ledger = opts.ledger ?? new BudgetLedger(opts.config.budgets);
    this.priceBook = opts.priceBook ?? DEFAULT_PRICE_BOOK;
    this.agentId = opts.agentId;
  }

  /** §17 matrix lookup, falling back to the configured default tier. */
  tierFor(actionType: GovernedActionType | undefined): TierKey {
    if (!actionType) return this.config.defaultTier;
    return entryFor(this.config, actionType)?.tier ?? this.config.defaultTier;
  }

  binding(tier: TierKey): TierBinding {
    return this.config.tiers[tier];
  }

  /** Tiers this one may be served by, itself first, with cycles removed. */
  chainFor(tier: TierKey): TierKey[] {
    const seen = new Set<TierKey>();
    const chain: TierKey[] = [];
    const walk = (key: TierKey, depth: number): void => {
      if (seen.has(key) || depth > 4) return;
      seen.add(key);
      chain.push(key);
      for (const next of this.config.tiers[key]?.fallbackChain ?? []) walk(next, depth + 1);
    };
    walk(tier, 0);
    return chain;
  }

  /** Tiers currently carrying another tier's traffic. Feeds the §17 degradation view. */
  degradations(): Array<{ tier: TierKey; reason: string; activeFallback: TierKey }> {
    return [...this.degradedTiers.entries()].map(([tier, d]) => ({ tier, ...d }));
  }

  /**
   * Call a tier, walking its fallback chain on failure.
   *
   * A tier is skipped without an attempt being recorded only when it does not
   * exist. A tier whose provider has no key *is* recorded, because "we could
   * not reach Anthropic" and "nobody pasted an Anthropic key" look identical
   * from inside a run and the trace should say which it was.
   */
  async call(
    tier: TierKey,
    request: Omit<ChatRequest, 'model' | 'maxTokens'> & { maxTokens?: number },
    scopes: { actionType?: GovernedActionType } = {},
  ): Promise<RoutedCall> {
    const attempts: TierAttempt[] = [];
    const chain = this.chainFor(tier);

    for (const candidate of chain) {
      const binding = this.config.tiers[candidate];
      if (!binding) continue;

      this.ledger.assertWithin({
        tier: candidate,
        agent: this.agentId,
        actionType: scopes.actionType,
      });

      const provider = this.registry.get(binding.provider);
      if (!provider) {
        attempts.push({
          tier: candidate,
          model: binding.model,
          reason: `no key configured for ${binding.provider}`,
        });
        continue;
      }

      try {
        const result = await provider.chat({
          ...request,
          model: binding.model,
          maxTokens: request.maxTokens ?? binding.maxOutputTokens,
          cacheSystem: request.cacheSystem ?? binding.cacheStrategy !== 'NONE',
        });

        this.ledger.record(usdToMoney(result.costUsd, this.priceBook), {
          tier: candidate,
          agent: this.agentId,
          actionType: scopes.actionType,
        });

        if (candidate !== tier) {
          this.degradedTiers.set(tier, {
            reason: attempts[0]?.reason ?? 'PROVIDER_ERROR',
            activeFallback: candidate,
          });
        } else {
          this.degradedTiers.delete(tier);
        }

        return {
          result,
          tier: candidate,
          binding,
          requestedTier: tier,
          attempts,
          degraded: candidate !== tier,
        };
      } catch (cause) {
        if (cause instanceof ProviderError && !cause.retryable) {
          // A 400 is our bug. Repeating it against another vendor wastes money
          // and buries the real error under a fallback chain.
          throw cause;
        }
        attempts.push({
          tier: candidate,
          model: binding.model,
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    throw new NoProviderError(tier, attempts);
  }

  /** Whether a tier can be served at all right now, chain included. */
  isReachable(tier: TierKey): boolean {
    return this.chainFor(tier).some((key) => {
      const binding = this.config.tiers[key];
      return binding ? this.registry.has(binding.provider) : false;
    });
  }
}
