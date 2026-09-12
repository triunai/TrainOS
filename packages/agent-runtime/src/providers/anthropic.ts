/**
 * Anthropic Messages API adapter.
 *
 * Wire format verified against the `claude-api` skill's raw-HTTP reference:
 *
 *   POST https://api.anthropic.com/v1/messages
 *   x-api-key: <key>
 *   anthropic-version: 2023-06-01
 *   content-type: application/json
 *
 *   { model, max_tokens, system?, messages[], tools[]? }
 *
 * — `system` is a string or an array of text blocks; a `cache_control:
 *   {type:"ephemeral"}` marker on the last stable block opens a prompt cache.
 * — a tool is `{ name, description, input_schema }` (JSON Schema), *not*
 *   OpenAI's `{type:"function", function:{…}}` envelope.
 * — the reply is `content[]` carrying `{type:"text",text}` and
 *   `{type:"tool_use",id,name,input}` blocks, with `stop_reason` and
 *   `usage.{input_tokens,output_tokens,cache_read_input_tokens,
 *   cache_creation_input_tokens}`.
 * — a tool result goes back as a **user** message holding
 *   `{type:"tool_result", tool_use_id, content}`.
 */

import type { KeyRef, KeyStore } from '../keys/keystore';
import { estimateCostUsd, type PriceBook, DEFAULT_PRICE_BOOK } from './pricing';
import {
  ProviderError,
  type ChatRequest,
  type ChatResult,
  type LLMMessage,
  type LLMProvider,
  type LLMToolCall,
  type StopReason,
} from './types';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * Models that reject `temperature` / `top_p` / `top_k` with a 400.
 *
 * Sampling parameters were removed across the 4.6+ family once thinking
 * became adaptive. Sending one is not a soft failure — the request is
 * rejected — so the adapter drops it rather than letting a caller's default
 * break every STRONG-tier call.
 */
const MODELS_WITHOUT_SAMPLING = [
  'claude-fable-5',
  'claude-fable-5-1',
  'claude-mythos-5',
  'claude-mythos-5-1',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
];

export function acceptsSampling(model: string): boolean {
  return !MODELS_WITHOUT_SAMPLING.some((m) => model.includes(m));
}

/* ------------------------------------------------------------------ *
 * Wire shapes — only the fields this adapter reads or writes
 * ------------------------------------------------------------------ */

interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicWireMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: { type?: string; message?: string };
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

/**
 * Neutral messages → Anthropic messages.
 *
 * The one structural difference from the OpenAI family: a tool *result* is a
 * user turn, not a `tool` turn, and consecutive results must be merged into a
 * single user message. Splitting them trains the model out of parallel tool
 * calls, so the merge is behavioural, not cosmetic.
 */
export function toAnthropicMessages(messages: readonly LLMMessage[]): AnthropicWireMessage[] {
  const out: AnthropicWireMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
      continue;
    }

    if (message.role === 'assistant') {
      const content: AnthropicContentBlock[] = [];
      if (message.content.trim() !== '') {
        content.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      // An assistant turn with no blocks at all is rejected by the API.
      if (content.length === 0) content.push({ type: 'text', text: '(no content)' });
      out.push({ role: 'assistant', content });
      continue;
    }

    const block: AnthropicToolResultBlock = {
      type: 'tool_result',
      tool_use_id: message.toolCallId,
      content: message.content,
      ...(message.isError ? { is_error: true } : {}),
    };
    const last = out[out.length - 1];
    if (last && last.role === 'user' && last.content.every((b) => b.type === 'tool_result')) {
      last.content.push(block);
    } else {
      out.push({ role: 'user', content: [block] });
    }
  }

  return out;
}

function normaliseStopReason(raw: string | undefined): StopReason {
  switch (raw) {
    case 'tool_use':
      return 'tool_use';
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

export interface AnthropicProviderOptions {
  keyStore: KeyStore;
  keyRef: KeyRef;
  baseUrl?: string;
  priceBook?: PriceBook;
  fetchImpl?: typeof fetch;
  /** Wall-clock ceiling for one call. Default 120s. */
  timeoutMs?: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  readonly label = 'Anthropic Messages API';

  private readonly opts: AnthropicProviderOptions;

  constructor(opts: AnthropicProviderOptions) {
    this.opts = opts;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const key = this.opts.keyStore.get(this.opts.keyRef);
    if (!key) {
      throw new ProviderError('anthropic', 'No Anthropic key configured', { retryable: false });
    }

    const base = this.opts.baseUrl ?? this.opts.keyRef.baseUrl ?? DEFAULT_BASE_URL;
    const priceBook = this.opts.priceBook ?? DEFAULT_PRICE_BOOK;
    const doFetch = this.opts.fetchImpl ?? fetch;

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: toAnthropicMessages(req.messages),
    };

    if (req.system) {
      body['system'] = req.cacheSystem
        ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }]
        : req.system;
    }

    if (req.tools?.length) {
      body['tools'] = req.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    if (req.temperature !== undefined && acceptsSampling(req.model)) {
      body['temperature'] = req.temperature;
    }

    const started = Date.now();
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 120_000);

    let response: Response;
    try {
      response = await doFetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: req.signal ?? timeout,
      });
    } catch (cause) {
      throw new ProviderError('anthropic', `Request failed: ${describe(cause)}`, {});
    }

    const latencyMs = Date.now() - started;
    const json = (await safeJson(response)) as AnthropicResponse;

    if (!response.ok) {
      const detail = json?.error?.message ?? response.statusText;
      throw new ProviderError('anthropic', `HTTP ${response.status}: ${detail}`, {
        status: response.status,
      });
    }

    const blocks = json.content ?? [];
    const text = blocks
      .filter((b): b is AnthropicTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const toolCalls: LLMToolCall[] = blocks
      .filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));

    const usage = {
      in: json.usage?.input_tokens ?? 0,
      out: json.usage?.output_tokens ?? 0,
      cacheRead: json.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: json.usage?.cache_creation_input_tokens ?? 0,
    };
    // Anthropic reports cached reads *alongside* input_tokens, not inside it.
    const totalIn = usage.in + usage.cacheRead + usage.cacheWrite;

    return {
      text,
      toolCalls,
      usage: { ...usage, in: totalIn },
      costUsd: estimateCostUsd(req.model, { ...usage, in: totalIn }, priceBook),
      costEstimated: true,
      model: json.model ?? req.model,
      provider: 'anthropic',
      latencyMs,
      stopReason: normaliseStopReason(json.stop_reason),
      cacheHitRate: totalIn > 0 ? usage.cacheRead / totalIn : 0,
    };
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
