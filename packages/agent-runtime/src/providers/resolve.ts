/**
 * Turning a key into a provider.
 *
 * This is the BYOK seam. A customer pastes a key on M20-S21; the runtime has
 * to work out which wire format that key speaks and construct the right
 * adapter, without anybody editing code or redeploying. Three signals, in
 * descending order of trust:
 *
 *   1. the provider recorded on the key reference (what the customer chose),
 *   2. the key's own prefix (`sk-ant-`, `sk-or-`) — self-evident, but absent
 *      on DeepSeek and plain OpenAI keys, which share a bare `sk-`,
 *   3. the base URL, for a generic OpenAI-compatible endpoint.
 */

import { detectProviderFromKey, type KeyRef, type KeyStore } from '../keys/keystore';
import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import {
  createDeepSeekProvider,
  createOpenRouterProvider,
  OpenAICompatibleProvider,
  DEEPSEEK_BASE_URL,
  OPENROUTER_BASE_URL,
} from './openai-compatible';
import type { PriceBook } from './pricing';
import { ProviderError, type LLMProvider, type ProviderId } from './types';

export interface ResolveOptions {
  keyStore: KeyStore;
  priceBook?: PriceBook;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The provider a key reference should be driven by.
 *
 * The recorded provider wins, because the customer told us. The prefix only
 * decides when the reference is silent, and a mismatch between the two is
 * reported rather than silently resolved — a key pasted into the wrong slot
 * should fail loudly on M20-S21, not route traffic somewhere unexpected.
 */
export function resolveProviderId(ref: KeyRef, key: string | undefined): ProviderId {
  const fromPrefix = key ? detectProviderFromKey(key) : undefined;
  if (fromPrefix && ref.provider !== fromPrefix && ref.provider !== 'openai-compatible') {
    throw new ProviderError(
      ref.provider,
      `Key ${ref.id} is recorded as ${ref.provider} but its prefix says ${fromPrefix}`,
      { retryable: false },
    );
  }
  return ref.provider === 'openai-compatible' && fromPrefix ? fromPrefix : ref.provider;
}

/** Build the adapter for one key reference. */
export function resolveProvider(ref: KeyRef, opts: ResolveOptions): LLMProvider {
  const key = opts.keyStore.get(ref);
  const id = resolveProviderId(ref, key);

  const shared = {
    keyStore: opts.keyStore,
    keyRef: ref,
    priceBook: opts.priceBook,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  };

  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(shared);
    case 'openrouter':
      return createOpenRouterProvider({ ...shared, baseUrl: ref.baseUrl ?? OPENROUTER_BASE_URL });
    case 'deepseek':
      return createDeepSeekProvider({ ...shared, baseUrl: ref.baseUrl ?? DEEPSEEK_BASE_URL });
    case 'mock':
      return new MockProvider();
    case 'openai-compatible': {
      if (!ref.baseUrl) {
        throw new ProviderError(
          'openai-compatible',
          `Key ${ref.id} needs a base URL: an OpenAI-compatible endpoint is defined by its URL`,
          { retryable: false },
        );
      }
      return new OpenAICompatibleProvider({
        ...shared,
        id: 'openai-compatible',
        label: `OpenAI-compatible (${ref.baseUrl})`,
        baseUrl: ref.baseUrl,
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * The registry the router calls
 * ------------------------------------------------------------------ */

/**
 * Every provider this process can reach, built once from the key store.
 *
 * A tier names a provider id; the registry answers whether that provider is
 * actually available. When it is not — no key for it — the router falls down
 * the tier chain exactly as it would for a `5xx`, because from the run's point
 * of view an unreachable provider and an unconfigured one are the same event.
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, LLMProvider>();

  constructor(providers: Iterable<LLMProvider> = []) {
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  /** Build a registry from every key the store can serve. */
  static fromKeyStore(opts: ResolveOptions): ProviderRegistry {
    const registry = new ProviderRegistry();
    for (const ref of opts.keyStore.list()) {
      try {
        const provider = resolveProvider(ref, opts);
        registry.register(provider);
      } catch {
        // A malformed or mis-filed key must not stop the other providers from
        // being usable. It shows up as an unavailable provider instead.
      }
    }
    return registry;
  }

  register(provider: LLMProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id: ProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  ids(): ProviderId[] {
    return [...this.providers.keys()];
  }

  get size(): number {
    return this.providers.size;
  }
}
