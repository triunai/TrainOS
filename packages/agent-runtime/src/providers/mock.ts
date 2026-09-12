/**
 * A scripted provider. No network, no key, deterministic.
 *
 * Two jobs. In tests it makes the orchestrator's behaviour — escalation,
 * handoff, the policy halt — assertable without pretending a real model is
 * predictable. In the CLI it lets somebody who has not configured a key still
 * watch a complete run produce a real `AutomationRun`, which is the whole
 * point of shipping a trace viewer before the keys arrive.
 *
 * A script entry is either a fixed {@link MockTurn} or a function of the
 * request, so a test can assert on what the orchestrator actually sent.
 */

import { estimateCostUsd, DEFAULT_PRICE_BOOK, type PriceBook } from './pricing';
import {
  ProviderError,
  type ChatRequest,
  type ChatResult,
  type LLMProvider,
  type LLMToolCall,
} from './types';

/** One scripted reply. Token counts default to something plausible. */
export interface MockTurn {
  text?: string;
  toolCalls?: LLMToolCall[];
  usage?: { in: number; out: number; cacheRead?: number };
  /** Throw instead of answering — used to exercise the routing fallback. */
  error?: ProviderError;
  latencyMs?: number;
}

export type MockScriptEntry = MockTurn | ((req: ChatRequest, callIndex: number) => MockTurn);

export interface MockProviderOptions {
  /** Consumed in order. When it runs out, {@link fallback} answers. */
  script?: MockScriptEntry[];
  /**
   * What to answer once the script is exhausted. The default ends the turn
   * with a short acknowledgement, which terminates any bounded tool loop.
   */
  fallback?: MockScriptEntry;
  model?: string;
  priceBook?: PriceBook;
  /** Every request the provider received, in order. Handy in assertions. */
  recordRequests?: boolean;
}

export class MockProvider implements LLMProvider {
  readonly id = 'mock' as const;
  readonly label = 'MockProvider (scripted, no network)';

  readonly requests: ChatRequest[] = [];

  private readonly opts: MockProviderOptions;
  private callIndex = 0;

  constructor(opts: MockProviderOptions = {}) {
    this.opts = opts;
  }

  /** How many calls have been served. */
  get callCount(): number {
    return this.callIndex;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const index = this.callIndex++;
    if (this.opts.recordRequests !== false) this.requests.push(req);

    const entry = this.opts.script?.[index] ?? this.opts.fallback ?? defaultFallback;
    const turn = typeof entry === 'function' ? entry(req, index) : entry;

    if (turn.error) throw turn.error;

    const usage = {
      in: turn.usage?.in ?? estimateInputTokens(req),
      out: turn.usage?.out ?? Math.max(16, Math.ceil((turn.text?.length ?? 0) / 4)),
      cacheRead: turn.usage?.cacheRead ?? 0,
      cacheWrite: 0,
    };
    const model = this.opts.model ?? req.model;
    const toolCalls = turn.toolCalls ?? [];

    return {
      text: turn.text ?? '',
      toolCalls,
      usage,
      costUsd: estimateCostUsd(model, usage, this.opts.priceBook ?? DEFAULT_PRICE_BOOK),
      costEstimated: true,
      model,
      provider: 'mock',
      latencyMs: turn.latencyMs ?? 1,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      cacheHitRate: usage.in > 0 ? usage.cacheRead / usage.in : 0,
    };
  }
}

const defaultFallback: MockTurn = { text: 'Done.' };

/**
 * A rough token count — four characters to the token.
 *
 * Good enough for the context meter to behave realistically in a mock run,
 * and never used for billing. A real count would need the vendor's tokenizer,
 * which is exactly the dependency this package is avoiding.
 */
export function estimateInputTokens(req: ChatRequest): number {
  let characters = req.system?.length ?? 0;
  for (const message of req.messages) {
    characters += message.content.length;
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        characters += JSON.stringify(call.input).length + call.name.length;
      }
    }
  }
  for (const tool of req.tools ?? []) {
    characters += tool.description.length + JSON.stringify(tool.parameters).length;
  }
  return Math.max(1, Math.ceil(characters / 4));
}

/** Convenience for tests: one tool call with a generated id. */
export function mockToolCall(name: string, input: Record<string, unknown>, id?: string): LLMToolCall {
  return { id: id ?? `toolu_mock_${name}`, name, input };
}
