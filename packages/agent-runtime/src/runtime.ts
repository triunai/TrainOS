/**
 * Assembly.
 *
 * One call that turns "whatever keys this machine has" into a runnable agent
 * runtime. Everything it does is available piecemeal — this file just spares
 * every caller from writing the same six lines and getting the mock fallback
 * subtly wrong.
 */

import { createDemoMockProvider } from './agents/demo-script';
import { EnvKeyStore, type KeyStore } from './keys/keystore';
import type { MockProvider } from './providers/mock';
import { ProviderRegistry } from './providers/resolve';
import type { PriceBook } from './providers/pricing';
import type { LLMProvider, ProviderId } from './providers/types';
import { BudgetLedger } from './routing/budget';
import { DEFAULT_ROUTING_CONFIG, type RoutingConfig } from './routing/config';
import { Router } from './routing/router';
import { createFixtureToolAdapter, type FixtureToolAdapter } from './tools/fixture-adapter';
import type { ToolContext } from './tools/adapter';

/** Which provider to prefer. `auto` takes the first configured key. */
export type ProviderChoice = ProviderId | 'auto';

export interface RuntimeOptions {
  agentId: string;
  keyStore?: KeyStore;
  routing?: RoutingConfig;
  priceBook?: PriceBook;
  fetchImpl?: typeof fetch;
  /** Fixture data the tools read. Defaults to the local client. */
  context?: ToolContext;
  /**
   * Force a provider. `auto` uses live keys when any exist and falls back to
   * the mock when none do.
   */
  provider?: ProviderChoice;
  /** Supply your own mock, e.g. a script that exercises one failure path. */
  mockProvider?: LLMProvider;
}

export interface Runtime {
  router: Router;
  registry: ProviderRegistry;
  tools: FixtureToolAdapter;
  keyStore: KeyStore;
  /** True when no live key was found and the mock is standing in. */
  usingMock: boolean;
  /** Providers with a usable key, for the CLI's provider matrix. */
  liveProviders: ProviderId[];
}

/**
 * Build a runtime.
 *
 * When no live provider can serve a tier, the mock is registered under *every*
 * provider id rather than the routing config being rewritten. The tiers, the
 * fallback chains and the escalation ladders stay exactly as they are in
 * production, so a no-key run exercises the same routing decisions a live one
 * would — which is the only way a mock run tells you anything about the real
 * one.
 */
export function createRuntime(opts: RuntimeOptions): Runtime {
  const keyStore = opts.keyStore ?? new EnvKeyStore();
  const routing = opts.routing ?? DEFAULT_ROUTING_CONFIG;
  const choice = opts.provider ?? 'auto';

  const registry =
    choice === 'mock'
      ? new ProviderRegistry()
      : ProviderRegistry.fromKeyStore({
          keyStore,
          priceBook: opts.priceBook,
          fetchImpl: opts.fetchImpl,
        });

  const liveProviders = registry.ids();

  // Narrow to one provider when the caller named one and it is configured.
  if (choice !== 'auto' && choice !== 'mock' && registry.has(choice)) {
    const chosen = registry.get(choice)!;
    const narrowed = new ProviderRegistry([chosen]);
    return finish(narrowed, false);
  }

  if (choice === 'mock' || registry.size === 0) {
    const mock: LLMProvider = opts.mockProvider ?? (createDemoMockProvider() as MockProvider);
    for (const id of ['anthropic', 'openrouter', 'deepseek', 'openai-compatible', 'mock'] as const) {
      registry.registerAs(id, mock);
    }
    return finish(registry, true);
  }

  return finish(registry, false);

  function finish(active: ProviderRegistry, usingMock: boolean): Runtime {
    const router = new Router({
      config: routing,
      registry: active,
      ledger: new BudgetLedger(routing.budgets),
      priceBook: opts.priceBook,
      agentId: opts.agentId,
    });
    const tools = createFixtureToolAdapter({ agentId: opts.agentId, context: opts.context });
    return { router, registry: active, tools, keyStore, usingMock, liveProviders };
  }
}
