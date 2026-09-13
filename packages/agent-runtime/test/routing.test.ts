import { GOVERNED_ACTION_TYPES, JURY_MODES, type GovernedActionType, type TierKey } from '@trainos/contract';
import { describe, expect, it } from 'vitest';

import { MockProvider } from '../src/providers/mock';
import { ProviderRegistry } from '../src/providers/resolve';
import { ProviderError, type LLMProvider } from '../src/providers/types';
import { BudgetExceededError, BudgetLedger } from '../src/routing/budget';
import {
  DEFAULT_ROUTING_CONFIG,
  DEFAULT_TIERS,
  ESCALATE_JURY,
  GATE_JURY,
  HostNotAllowedError,
  INBOUND_CONTENT_TIERS,
  SAMPLE_JURY,
  assertHostAllowed,
  entryFor,
  hasIndependentJury,
  isHostAllowed,
  vendorFor,
  withRouting,
} from '../src/routing/config';
import { NoProviderError, Router } from '../src/routing/router';

/** A provider that answers under a chosen id, so a tier can be aimed at it. */
function providerAs(id: LLMProvider['id'], provider: LLMProvider): LLMProvider {
  return { ...provider, id, chat: provider.chat.bind(provider) };
}

describe('tier resolution', () => {
  const registry = new ProviderRegistry();
  registry.registerAs('anthropic', new MockProvider());
  const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry });

  it('reads the action→tier matrix', () => {
    expect(router.tierFor('PROPOSAL_SEND')).toBe('STRONG_1');
    expect(router.tierFor('ENQUIRY_ARCHIVE')).toBe('CHEAP');
  });

  it('falls back to the default tier for an unmapped action', () => {
    // All 24 GOVERNED_ACTION_TYPES have an explicit row now (see below), so
    // there is no real action type left to prove the fallback with — a cast
    // stands in for "a future type nobody has routed yet".
    expect(router.tierFor('NOT_A_REAL_ACTION_TYPE' as GovernedActionType)).toBe('MID');
    expect(router.tierFor(undefined)).toBe('MID');
  });

  it('flattens a fallback chain without cycles', () => {
    const chain = router.chainFor('STRONG_1');
    expect(chain[0]).toBe('STRONG_1');
    expect(new Set(chain).size).toBe(chain.length);
  });
});

describe('routing fallback on provider error', () => {
  it('walks the chain and records every tier it abandoned', async () => {
    const failing = new MockProvider({
      fallback: { error: new ProviderError('deepseek', 'HTTP 503: upstream down', { status: 503 }) },
    });
    const working = new MockProvider({ fallback: { text: 'answered' } });

    const registry = new ProviderRegistry();
    // MID is bound to deepseek, STRONG_1 to anthropic.
    registry.registerAs('deepseek', failing);
    registry.registerAs('anthropic', working);

    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry });
    const call = await router.call('MID', { messages: [{ role: 'user', content: 'go' }] });

    expect(call.requestedTier).toBe('MID');
    expect(call.tier).toBe('STRONG_1');
    expect(call.degraded).toBe(true);
    expect(call.attempts).toHaveLength(1);
    expect(call.attempts[0]?.reason).toContain('503');
    expect(call.result.text).toBe('answered');

    // §17: the tier is now degraded with a named active fallback, which is
    // what the M20-S20 banner renders.
    expect(router.degradations()).toEqual([
      { tier: 'MID', reason: expect.stringContaining('503'), activeFallback: 'STRONG_1' },
    ]);
  });

  it('does not retry a non-retryable 400 against another vendor', async () => {
    const badRequest = new MockProvider({
      fallback: { error: new ProviderError('deepseek', 'HTTP 400: bad tool schema', { status: 400 }) },
    });
    const working = new MockProvider({ fallback: { text: 'should never be reached' } });

    const registry = new ProviderRegistry();
    registry.registerAs('deepseek', badRequest);
    registry.registerAs('anthropic', working);

    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry });
    await expect(router.call('MID', { messages: [{ role: 'user', content: 'go' }] })).rejects.toThrow(
      /bad tool schema/,
    );
    expect(working.callCount).toBe(0);
  });

  it('treats a missing key the same as an outage, and says which it was', async () => {
    const registry = new ProviderRegistry();
    registry.registerAs('anthropic', new MockProvider({ fallback: { text: 'ok' } }));

    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry });
    const call = await router.call('MID', { messages: [{ role: 'user', content: 'go' }] });

    expect(call.tier).toBe('STRONG_1');
    expect(call.attempts[0]?.reason).toContain('no key configured for deepseek');
  });

  it('throws when the whole chain is unreachable', async () => {
    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry: new ProviderRegistry() });
    await expect(router.call('CHEAP', { messages: [{ role: 'user', content: 'x' }] })).rejects.toBeInstanceOf(
      NoProviderError,
    );
    expect(router.isReachable('CHEAP')).toBe(false);
  });
});

describe('budget caps', () => {
  it('reports WITHIN, NEAR and PAUSED against a cap', () => {
    const ledger = new BudgetLedger([
      { scope: 'TIER', key: 'SPECIAL', cap: { amount: 1000, currency: 'MYR' } },
    ]);
    expect(ledger.status('TIER', 'SPECIAL')?.state).toBe('WITHIN');

    ledger.record({ amount: 900, currency: 'MYR' }, { tier: 'SPECIAL' });
    expect(ledger.status('TIER', 'SPECIAL')?.state).toBe('NEAR');

    ledger.record({ amount: 100, currency: 'MYR' }, { tier: 'SPECIAL' });
    expect(ledger.status('TIER', 'SPECIAL')?.state).toBe('PAUSED');
  });

  it('pauses an action type before the spend, not after', async () => {
    const provider = new MockProvider({ fallback: { text: 'ok', usage: { in: 2_000_000, out: 0 } } });
    const registry = new ProviderRegistry();
    registry.registerAs('anthropic', provider);

    const config = withRouting(DEFAULT_ROUTING_CONFIG, {
      budgets: [{ scope: 'ACTION_TYPE', key: 'PROPOSAL_SEND', cap: { amount: 100, currency: 'MYR' } }],
    });
    const router = new Router({ config, registry });

    // First call spends 2M input tokens of Sonnet 5 — far past a RM 1.00 cap.
    await router.call('STRONG_1', { messages: [{ role: 'user', content: 'go' }] }, { actionType: 'PROPOSAL_SEND' });
    expect(router.ledger.status('ACTION_TYPE', 'PROPOSAL_SEND')?.state).toBe('PAUSED');

    const before = provider.callCount;
    await expect(
      router.call('STRONG_1', { messages: [{ role: 'user', content: 'again' }] }, { actionType: 'PROPOSAL_SEND' }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    // No second call was made: the cap is checked before spending, never after.
    expect(provider.callCount).toBe(before);
  });

  it('leaves an uncapped scope alone', () => {
    const ledger = new BudgetLedger([]);
    ledger.record({ amount: 99_999, currency: 'MYR' }, { agent: 'agent_proposal' });
    expect(ledger.status('AGENT', 'agent_proposal')).toBeUndefined();
    expect(() => ledger.assertWithin({ agent: 'agent_proposal' })).not.toThrow();
  });
});

describe('provider registry aliasing', () => {
  it('lets one instance stand in for every vendor', async () => {
    const mock = new MockProvider({ fallback: { text: 'ok' } });
    const registry = new ProviderRegistry();
    for (const id of ['anthropic', 'deepseek', 'openrouter'] as const) registry.registerAs(id, mock);

    const router = new Router({ config: DEFAULT_ROUTING_CONFIG, registry });
    for (const tier of ['CHEAP', 'MID', 'STRONG_1', 'STRONG_3'] as const) {
      const call = await router.call(tier, { messages: [{ role: 'user', content: 'x' }] });
      // The tier asked for is the tier served: no fallback was needed, so a
      // mock run exercises the same routing decisions a live one would.
      expect(call.tier).toBe(tier);
      expect(call.degraded).toBe(false);
    }
  });

  it('keeps the aliased provider usable under its own id too', () => {
    const mock = providerAs('mock', new MockProvider());
    const registry = new ProviderRegistry([mock]);
    expect(registry.has('mock')).toBe(true);
  });
});

describe('STRONG jury vendor independence', () => {
  it('draws each of the three jury policies from three distinct, identified vendors', () => {
    expect(vendorFor(DEFAULT_TIERS.STRONG_1)).toBe('anthropic');
    expect(vendorFor(DEFAULT_TIERS.STRONG_2)).toBe('google');
    expect(vendorFor(DEFAULT_TIERS.STRONG_3)).toBe('openai');

    for (const policy of [ESCALATE_JURY, SAMPLE_JURY, GATE_JURY]) {
      expect(hasIndependentJury(policy)).toBe(true);
    }
  });

  it('would catch a jury that regressed to two tiers on one vendor', () => {
    const collapsed = { ...ESCALATE_JURY, tiers: ['STRONG_1', 'STRONG_1', 'STRONG_3'] as TierKey[] };
    expect(hasIndependentJury(collapsed)).toBe(false);
  });
});

describe('host constraint enforcement', () => {
  it('pins every DeepSeek/Qwen tier reading inbound content to the non-China allow-list', () => {
    for (const key of INBOUND_CONTENT_TIERS) {
      const binding = DEFAULT_TIERS[key];
      expect(binding.hostConstraint).toBeDefined();
      expect(binding.hostConstraint?.allowedHosts.length).toBeGreaterThan(0);

      // Every allow-listed host is actually allowed.
      for (const host of binding.hostConstraint?.allowedHosts ?? []) {
        expect(isHostAllowed(binding, host)).toBe(true);
        expect(() => assertHostAllowed(binding, host)).not.toThrow();
      }

      // OpenRouter's un-pinned default (and an explicit China host) are not.
      expect(isHostAllowed(binding, 'openrouter-default')).toBe(false);
      expect(isHostAllowed(binding, 'deepseek-cn')).toBe(false);
      expect(() => assertHostAllowed(binding, 'deepseek-cn')).toThrow(HostNotAllowedError);
    }
  });

  it('does not constrain a tier with no compliance-driven allow-list', () => {
    // STRONG_1 (Anthropic) and FAST_UI (Groq, already US-hosted) carry none.
    expect(DEFAULT_TIERS.STRONG_1.hostConstraint).toBeUndefined();
    expect(isHostAllowed(DEFAULT_TIERS.STRONG_1, 'anything')).toBe(true);
    expect(DEFAULT_TIERS.FAST_UI.hostConstraint).toBeUndefined();
  });
});

describe('every tier has a fallback', () => {
  it('gives every configured tier a non-empty fallback chain', () => {
    for (const binding of Object.values(DEFAULT_TIERS)) {
      expect(binding.fallbackChain.length).toBeGreaterThan(0);
      // A tier never lists itself as its own fallback.
      expect(binding.fallbackChain).not.toContain(binding.key);
    }
  });
});

describe('full action-type coverage', () => {
  it('gives all 24 GOVERNED_ACTION_TYPES an explicit routing entry with a jury mode', () => {
    expect(GOVERNED_ACTION_TYPES.length).toBe(24);
    for (const actionType of GOVERNED_ACTION_TYPES) {
      const entry = entryFor(DEFAULT_ROUTING_CONFIG, actionType);
      expect(entry, `missing routing entry for ${actionType}`).toBeDefined();
      expect(JURY_MODES).toContain(entry?.jury.mode);
      expect(DEFAULT_TIERS[entry!.tier]).toBeDefined();
    }
  });
});
