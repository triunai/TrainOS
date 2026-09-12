/**
 * One adapter for every endpoint that speaks OpenAI's `/chat/completions`.
 *
 * Verified against the OpenRouter and DeepSeek references:
 *
 *   POST {baseUrl}/chat/completions
 *   Authorization: Bearer <key>
 *   Content-Type: application/json
 *
 *   { model, messages[], tools[]?, tool_choice?, max_tokens?, temperature? }
 *
 * — a message is `{role: 'system'|'user'|'assistant'|'tool', content}`; a tool
 *   result is a `tool` turn carrying `tool_call_id`.
 * — a tool is `{type:'function', function:{name, description, parameters}}`
 *   where `parameters` is a JSON Schema object.
 * — the reply is `choices[0].message` with `content` and `tool_calls[]`, each
 *   `{id, type:'function', function:{name, arguments}}` where **`arguments`
 *   is a JSON string**, not an object. That is the single most common way to
 *   get this wrong, so `parseArguments` is defensive about it.
 * — usage is `{prompt_tokens, completion_tokens, total_tokens}`. DeepSeek adds
 *   `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`; OpenRouter adds
 *   `prompt_tokens_details.cached_tokens` and an authoritative `cost`.
 *
 * OpenRouter is this adapter with `baseUrl: https://openrouter.ai/api/v1`,
 * DeepSeek is the same adapter with `https://api.deepseek.com`. Any other
 * OpenAI-compatible gateway is the same adapter with its own base URL and no
 * code change at all.
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
  type ProviderId,
  type StopReason,
} from './types';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/* ------------------------------------------------------------------ *
 * Wire shapes
 * ------------------------------------------------------------------ */

interface OpenAIWireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIWireToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: OpenAIWireToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
  error?: { message?: string; code?: string | number };
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

export function toOpenAIMessages(
  messages: readonly LLMMessage[],
  system?: string,
): OpenAIWireMessage[] {
  const out: OpenAIWireMessage[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const wire: OpenAIWireMessage = {
        role: 'assistant',
        content: message.content === '' ? null : message.content,
      };
      if (message.toolCalls?.length) {
        wire.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        }));
      }
      out.push(wire);
      continue;
    }
    out.push({
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    });
  }

  return out;
}

/**
 * `function.arguments` arrives as a JSON string. Some gateways send `""` for a
 * no-argument call and a few send an object despite the spec, so accept all
 * three rather than throwing away a valid call over a formatting difference.
 */
export function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normaliseFinishReason(raw: string | undefined): StopReason {
  switch (raw) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

export interface OpenAICompatibleOptions {
  /** Reported on the trace. `openrouter`, `deepseek` or `openai-compatible`. */
  id: ProviderId;
  label: string;
  baseUrl: string;
  keyStore: KeyStore;
  keyRef: KeyRef;
  priceBook?: PriceBook;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Extra headers. OpenRouter uses `HTTP-Referer` and `X-Title` for attribution. */
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: ProviderId;
  readonly label: string;

  private readonly opts: OpenAICompatibleOptions;

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.label = opts.label;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const key = this.opts.keyStore.get(this.opts.keyRef);
    if (!key) {
      throw new ProviderError(this.id, `No key configured for ${this.label}`, { retryable: false });
    }

    const priceBook = this.opts.priceBook ?? DEFAULT_PRICE_BOOK;
    const doFetch = this.opts.fetchImpl ?? fetch;

    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.messages, req.system),
      max_tokens: req.maxTokens,
    };

    if (req.tools?.length) {
      body['tools'] = req.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body['tool_choice'] = 'auto';
    }

    if (req.temperature !== undefined) body['temperature'] = req.temperature;

    const started = Date.now();
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 120_000);

    let response: Response;
    try {
      response = await doFetch(`${trimSlash(this.opts.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          ...(this.opts.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: req.signal ?? timeout,
      });
    } catch (cause) {
      throw new ProviderError(this.id, `Request failed: ${describe(cause)}`, {});
    }

    const latencyMs = Date.now() - started;
    const json = (await safeJson(response)) as OpenAIResponse;

    if (!response.ok) {
      const detail = json?.error?.message ?? response.statusText;
      throw new ProviderError(this.id, `HTTP ${response.status}: ${detail}`, {
        status: response.status,
      });
    }

    const choice = json.choices?.[0];
    const text = choice?.message?.content ?? '';
    const toolCalls: LLMToolCall[] = (choice?.message?.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? 'unknown',
      input: parseArguments(call.function?.arguments),
    }));

    const promptTokens = json.usage?.prompt_tokens ?? 0;
    const cacheRead =
      json.usage?.prompt_cache_hit_tokens ??
      json.usage?.prompt_tokens_details?.cached_tokens ??
      0;
    const usage = {
      in: promptTokens,
      out: json.usage?.completion_tokens ?? 0,
      cacheRead,
      cacheWrite: json.usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
    };

    // OpenRouter returns the real charge. Prefer it over the price table.
    const reportedCost = typeof json.usage?.cost === 'number' ? json.usage.cost : undefined;

    return {
      text,
      toolCalls,
      usage,
      costUsd: reportedCost ?? estimateCostUsd(req.model, usage, priceBook),
      costEstimated: reportedCost === undefined,
      model: json.model ?? req.model,
      provider: this.id,
      latencyMs,
      stopReason: normaliseFinishReason(choice?.finish_reason),
      cacheHitRate: promptTokens > 0 ? cacheRead / promptTokens : 0,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Named constructors
 * ------------------------------------------------------------------ */

export function createOpenRouterProvider(
  opts: Omit<OpenAICompatibleOptions, 'id' | 'label' | 'baseUrl'> & { baseUrl?: string },
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    ...opts,
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: opts.baseUrl ?? opts.keyRef.baseUrl ?? OPENROUTER_BASE_URL,
    extraHeaders: {
      'HTTP-Referer': 'https://trainos.local',
      'X-Title': 'TrainOS agent runtime',
      ...(opts.extraHeaders ?? {}),
    },
  });
}

export function createDeepSeekProvider(
  opts: Omit<OpenAICompatibleOptions, 'id' | 'label' | 'baseUrl'> & { baseUrl?: string },
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    ...opts,
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: opts.baseUrl ?? opts.keyRef.baseUrl ?? DEEPSEEK_BASE_URL,
  });
}

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
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
