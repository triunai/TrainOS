import { describe, expect, it } from 'vitest';

import {
  AnthropicProvider,
  acceptsSampling,
  toAnthropicMessages,
} from '../src/providers/anthropic';
import {
  OpenAICompatibleProvider,
  parseArguments,
  toOpenAIMessages,
} from '../src/providers/openai-compatible';
import { estimateCostUsd, priceFor, usdToMoney } from '../src/providers/pricing';
import { ProviderRegistry, resolveProvider, resolveProviderId } from '../src/providers/resolve';
import {
  detectProviderFromKey,
  EnvKeyStore,
  maskKey,
  StaticKeyStore,
  type KeyRef,
} from '../src/keys/keystore';
import { ProviderError } from '../src/providers/types';

describe('provider detection from key prefix', () => {
  it('recognises the prefixes that are self-identifying', () => {
    expect(detectProviderFromKey('sk-ant-api03-abcdef123456')).toBe('anthropic');
    expect(detectProviderFromKey('sk-or-v1-abcdef123456')).toBe('openrouter');
  });

  it('refuses to guess on a bare sk- key', () => {
    // DeepSeek and OpenAI both issue `sk-` + hex. Guessing would route a
    // customer's traffic to the wrong vendor, so the reference carries it.
    expect(detectProviderFromKey('sk-1234567890abcdef1234567890abcdef')).toBeUndefined();
  });

  it('takes the recorded provider over the prefix for a generic endpoint', () => {
    const ref: KeyRef = { id: 'X', provider: 'openai-compatible', baseUrl: 'https://x/v1' };
    expect(resolveProviderId(ref, 'sk-or-v1-abcdef123456')).toBe('openrouter');
  });

  it('errors rather than silently rerouting a mismatched key', () => {
    const ref: KeyRef = { id: 'DEEPSEEK_API_KEY', provider: 'deepseek' };
    expect(() => resolveProviderId(ref, 'sk-ant-api03-abcdef123456')).toThrow(/prefix says anthropic/);
  });

  it('builds the right adapter for each provider', () => {
    const store = new StaticKeyStore([
      { ref: { id: 'A', provider: 'anthropic' }, key: 'sk-ant-api03-aaaaaaaaaaaa' },
      { ref: { id: 'O', provider: 'openrouter' }, key: 'sk-or-v1-bbbbbbbbbbbb' },
      { ref: { id: 'D', provider: 'deepseek' }, key: 'sk-cccccccccccccccc' },
    ]);
    expect(resolveProvider({ id: 'A', provider: 'anthropic' }, { keyStore: store })).toBeInstanceOf(
      AnthropicProvider,
    );
    expect(resolveProvider({ id: 'O', provider: 'openrouter' }, { keyStore: store })).toBeInstanceOf(
      OpenAICompatibleProvider,
    );
    expect(resolveProvider({ id: 'D', provider: 'deepseek' }, { keyStore: store }).id).toBe('deepseek');
  });

  it('requires a base URL for a generic OpenAI-compatible endpoint', () => {
    const store = new StaticKeyStore([
      { ref: { id: 'C', provider: 'openai-compatible' }, key: 'xyz-no-prefix-key-here' },
    ]);
    expect(() => resolveProvider({ id: 'C', provider: 'openai-compatible' }, { keyStore: store })).toThrow(
      /needs a base URL/,
    );
  });
});

describe('key handling', () => {
  it('masks to the §17 ProviderKey shape', () => {
    expect(maskKey('sk-ant-api03-xxxxxxxxxxxxxxxx9a41')).toBe('sk-ant-••••••••••••9a41');
    expect(maskKey(undefined)).toBe('NOT_SET');
    expect(maskKey('short')).toBe('••••••••••••');
  });

  it('offers only the variables that are actually set', () => {
    const store = new EnvKeyStore({ ANTHROPIC_API_KEY: 'sk-ant-aaaa', OPENROUTER_API_KEY: '   ' });
    expect(store.list().map((r) => r.id)).toEqual(['ANTHROPIC_API_KEY']);
  });
});

describe('message translation', () => {
  it('merges consecutive tool results into one Anthropic user turn', () => {
    // Splitting them across turns silently trains the model out of parallel
    // tool calls, so the merge is behavioural, not cosmetic.
    const wire = toAnthropicMessages([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 't1', name: 'a', input: {} },
        { id: 't2', name: 'b', input: {} },
      ] },
      { role: 'tool', toolCallId: 't1', name: 'a', content: '1' },
      { role: 'tool', toolCallId: 't2', name: 'b', content: '2' },
    ]);
    expect(wire).toHaveLength(3);
    expect(wire[2]?.role).toBe('user');
    expect(wire[2]?.content).toHaveLength(2);
  });

  it('puts the system prompt in the messages array for OpenAI-compatible', () => {
    const wire = toOpenAIMessages([{ role: 'user', content: 'go' }], 'be brief');
    expect(wire[0]).toEqual({ role: 'system', content: 'be brief' });
  });

  it('parses tool arguments whatever shape they arrive in', () => {
    expect(parseArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseArguments('')).toEqual({});
    expect(parseArguments({ a: 1 })).toEqual({ a: 1 });
    expect(parseArguments('not json')).toEqual({});
  });

  it('drops temperature for models that reject sampling parameters', () => {
    expect(acceptsSampling('claude-sonnet-5')).toBe(false);
    expect(acceptsSampling('claude-opus-5')).toBe(false);
    expect(acceptsSampling('claude-haiku-4-5')).toBe(true);
    expect(acceptsSampling('deepseek-chat')).toBe(true);
  });
});

describe('anthropic adapter', () => {
  const store = new StaticKeyStore([
    { ref: { id: 'A', provider: 'anthropic' }, key: 'sk-ant-api03-aaaaaaaaaaaa' },
  ]);

  it('sends the documented request and reads the documented response', async () => {
    let captured: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | undefined;

    const provider = new AnthropicProvider({
      keyStore: store,
      keyRef: { id: 'A', provider: 'anthropic' },
      fetchImpl: (async (url: string, init: RequestInit) => {
        captured = {
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
          headers: init.headers as Record<string, string>,
        };
        return new Response(
          JSON.stringify({
            model: 'claude-sonnet-5',
            stop_reason: 'tool_use',
            content: [
              { type: 'text', text: 'Looking that up.' },
              { type: 'tool_use', id: 'toolu_1', name: 'enquiries_get', input: { ref: 'ENQ-2026-0912' } },
            ],
            usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 100 },
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });

    const result = await provider.chat({
      model: 'claude-sonnet-5',
      system: 'be brief',
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'enquiries_get', description: 'read', parameters: { type: 'object' } }],
      maxTokens: 512,
      temperature: 0.5,
      cacheSystem: true,
    });

    expect(captured?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(captured?.headers['anthropic-version']).toBe('2023-06-01');
    expect(captured?.headers['x-api-key']).toBe('sk-ant-api03-aaaaaaaaaaaa');
    // Anthropic tools are bare `input_schema`, not OpenAI's function envelope.
    expect(captured?.body['tools']).toEqual([
      { name: 'enquiries_get', description: 'read', input_schema: { type: 'object' } },
    ]);
    // Sonnet 5 rejects `temperature` with a 400, so it must not be sent.
    expect(captured?.body).not.toHaveProperty('temperature');
    expect(captured?.body['system']).toEqual([
      { type: 'text', text: 'be brief', cache_control: { type: 'ephemeral' } },
    ]);

    expect(result.text).toBe('Looking that up.');
    expect(result.toolCalls).toEqual([
      { id: 'toolu_1', name: 'enquiries_get', input: { ref: 'ENQ-2026-0912' } },
    ]);
    // Cached reads sit alongside input_tokens, so the real input is 1000.
    expect(result.usage.in).toBe(1000);
    expect(result.cacheHitRate).toBeCloseTo(0.1);
    expect(result.stopReason).toBe('tool_use');
  });

  it('marks a 429 retryable and a 400 not', async () => {
    const make = (status: number) =>
      new AnthropicProvider({
        keyStore: store,
        keyRef: { id: 'A', provider: 'anthropic' },
        fetchImpl: (async () =>
          new Response(JSON.stringify({ error: { message: 'nope' } }), { status })) as unknown as typeof fetch,
      });

    await expect(
      make(429).chat({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }], maxTokens: 8 }),
    ).rejects.toMatchObject({ retryable: true, status: 429 });

    await expect(
      make(400).chat({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }], maxTokens: 8 }),
    ).rejects.toMatchObject({ retryable: false, status: 400 });
  });
});

describe('openai-compatible adapter', () => {
  it('reads tool_calls with JSON-string arguments and DeepSeek cache fields', async () => {
    const store = new StaticKeyStore([{ ref: { id: 'D', provider: 'deepseek' }, key: 'sk-dddd' }]);
    let body: Record<string, unknown> | undefined;

    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      keyStore: store,
      keyRef: { id: 'D', provider: 'deepseek' },
      fetchImpl: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'c1', type: 'function', function: { name: 'programmes_search', arguments: '{"query":"x"}' } },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_cache_hit_tokens: 250 },
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });

    const result = await provider.chat({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'programmes_search', description: 'search', parameters: { type: 'object' } }],
      maxTokens: 512,
    });

    expect(body?.['tools']).toEqual([
      { type: 'function', function: { name: 'programmes_search', description: 'search', parameters: { type: 'object' } } },
    ]);
    expect(result.toolCalls[0]?.input).toEqual({ query: 'x' });
    expect(result.cacheHitRate).toBeCloseTo(0.25);
    expect(result.stopReason).toBe('tool_use');
  });

  it("prefers OpenRouter's reported cost over the price table", async () => {
    const store = new StaticKeyStore([{ ref: { id: 'O', provider: 'openrouter' }, key: 'sk-or-v1-oooo' }]);
    const provider = new OpenAICompatibleProvider({
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyStore: store,
      keyRef: { id: 'O', provider: 'openrouter' },
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            model: 'anthropic/claude-sonnet-5',
            choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
            usage: { prompt_tokens: 1000, completion_tokens: 100, cost: 0.0123 },
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });

    const result = await provider.chat({
      model: 'anthropic/claude-sonnet-5',
      messages: [{ role: 'user', content: 'go' }],
      maxTokens: 64,
    });
    expect(result.costUsd).toBe(0.0123);
    expect(result.costEstimated).toBe(false);
  });
});

describe('pricing', () => {
  it('finds a model routed through a gateway by suffix', () => {
    expect(priceFor('anthropic/claude-sonnet-5')).toEqual(priceFor('claude-sonnet-5'));
  });

  it('bills cached reads at the cache rate, not the input rate', () => {
    const plain = estimateCostUsd('claude-sonnet-5', { in: 1_000_000, out: 0 });
    const cached = estimateCostUsd('claude-sonnet-5', { in: 1_000_000, out: 0, cacheRead: 1_000_000 });
    expect(plain).toBeCloseTo(2);
    expect(cached).toBeCloseTo(0.2);
  });

  it('converts USD to MYR sen', () => {
    expect(usdToMoney(1, { prices: {}, usdToMyr: 4.45 })).toEqual({ amount: 445, currency: 'MYR' });
  });
});

describe('provider registry', () => {
  it('survives one unusable key without losing the others', () => {
    const store = new StaticKeyStore([
      { ref: { id: 'A', provider: 'anthropic' }, key: 'sk-ant-api03-aaaa' },
      // A generic endpoint with no base URL cannot be built.
      { ref: { id: 'C', provider: 'openai-compatible' }, key: 'plain-key-value-here' },
    ]);
    const registry = ProviderRegistry.fromKeyStore({ keyStore: store });
    expect(registry.ids()).toEqual(['anthropic']);
  });

  it('classifies a network failure as retryable', () => {
    expect(new ProviderError('anthropic', 'boom').retryable).toBe(true);
  });
});
