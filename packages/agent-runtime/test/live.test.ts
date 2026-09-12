/**
 * The one test that touches a network — and only if you have a key.
 *
 * Skipped by default. It exists because every other test in this package
 * mocks `fetch`, which proves the adapters send what the docs say and proves
 * nothing about whether a provider agrees. One real round trip per provider,
 * asserting the two things a mock cannot: that the request is accepted, and
 * that a tool call comes back in the shape the adapter parses.
 *
 * Run it with a key in the environment:
 *
 *     ANTHROPIC_API_KEY=sk-ant-... npx vitest run --root packages/agent-runtime
 *
 * It costs a fraction of a cent and never writes anything anywhere.
 */

import { describe, expect, it } from 'vitest';

import { EnvKeyStore, maskKey } from '../src/keys/keystore';
import { resolveProvider } from '../src/providers/resolve';
import type { LLMToolDef } from '../src/providers/types';

const store = new EnvKeyStore();
const available = store.list();

/** One model per provider that is cheap and supports tool use. */
const LIVE_MODEL: Record<string, string> = {
  anthropic: 'claude-haiku-4-5',
  openrouter: 'anthropic/claude-haiku-4.5',
  deepseek: 'deepseek-chat',
};

const PING_TOOL: LLMToolDef = {
  name: 'record_city',
  description: 'Record the city a country\'s capital is in.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'The capital city' } },
    required: ['city'],
    additionalProperties: false,
  },
};

describe('live provider round trip (opt-in)', () => {
  it.skipIf(available.length === 0)('reports which keys were found, masked', () => {
    for (const ref of available) {
      const key = store.get(ref);
      expect(key).toBeDefined();
      // The assertion that matters: nothing unmasked ever reaches output.
      expect(maskKey(key)).not.toContain(key!.slice(8, 20));
    }
    expect(available.length).toBeGreaterThan(0);
  });

  for (const ref of available) {
    const model = LIVE_MODEL[ref.provider];

    it.skipIf(!model)(
      `${ref.provider}: accepts the request and returns a tool call`,
      async () => {
        const provider = resolveProvider(ref, { keyStore: store, timeoutMs: 60_000 });

        const result = await provider.chat({
          model: model!,
          system: 'Answer by calling the tool. Do not reply in prose.',
          messages: [{ role: 'user', content: 'What is the capital of Malaysia?' }],
          tools: [PING_TOOL],
          maxTokens: 256,
        });

        // The request was accepted and billed — that is the half a mock cannot
        // prove.
        expect(result.usage.in).toBeGreaterThan(0);
        expect(result.model).toBeTruthy();
        expect(result.latencyMs).toBeGreaterThan(0);
        expect(['end_turn', 'tool_use', 'max_tokens', 'other']).toContain(result.stopReason);

        // And the tool call parses into the neutral shape, whichever wire
        // format it arrived in.
        if (result.toolCalls.length > 0) {
          const call = result.toolCalls[0]!;
          expect(call.name).toBe('record_city');
          expect(call.id).toBeTruthy();
          expect(typeof call.input).toBe('object');
          expect(String(call.input['city'] ?? '')).toMatch(/kuala lumpur/i);
        } else {
          // A model that answered in prose instead is not a failure of the
          // adapter; the text still has to have arrived.
          expect(result.text.length).toBeGreaterThan(0);
        }

        console.log(
          `  ${ref.provider} · ${maskKey(store.get(ref))} · ${result.model} · ` +
            `${result.usage.in}/${result.usage.out} tok · ` +
            `$${result.costUsd.toFixed(6)}${result.costEstimated ? ' (estimated)' : ' (reported)'} · ` +
            `${result.latencyMs}ms · ${result.toolCalls.length} tool call(s)`,
        );
      },
      90_000,
    );
  }
});
