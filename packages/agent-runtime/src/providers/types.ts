/**
 * The provider-neutral LLM surface.
 *
 * Everything above this file — routing, the orchestrator, the demo agent —
 * speaks only these types. An adapter's job is to translate them to and from
 * one vendor's wire format, so adding a provider is one file and no change
 * anywhere else. That is the BYOK promise, expressed as a type.
 */

import type { AiProvider } from '@trainos/contract';

/* ------------------------------------------------------------------ *
 * Provider identity
 * ------------------------------------------------------------------ */

/**
 * The runtime's own provider ids.
 *
 * Wider than the contract's {@link AiProvider}, which has no `OPENROUTER`
 * member — see {@link toContractProvider}. `openai-compatible` is the escape
 * hatch for any endpoint that speaks `/chat/completions`: vLLM, Together,
 * Groq, a self-hosted gateway. No code change, only configuration.
 */
export type ProviderId =
  | 'anthropic'
  | 'openrouter'
  | 'deepseek'
  | 'openai-compatible'
  | 'mock';

/**
 * Narrow a runtime provider id to the contract's enum.
 *
 * OpenRouter is a gateway in front of many vendors and the contract does not
 * catalogue it, so it reports as `OPENAI` — the API family it implements.
 * A generic OpenAI-compatible endpoint reports the same way. `mock` reports
 * as `OPENAI` too, because a trace must still type-check.
 */
export function toContractProvider(id: ProviderId): AiProvider {
  switch (id) {
    case 'anthropic':
      return 'ANTHROPIC';
    case 'deepseek':
      return 'DEEPSEEK';
    case 'openrouter':
    case 'openai-compatible':
    case 'mock':
      return 'OPENAI';
  }
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

/** One tool call the model asked for. `input` is already parsed. */
export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** The neutral conversation turn. Adapters translate it per vendor. */
export type LLMMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LLMToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

/** A tool offered to the model. `parameters` is a JSON Schema object. */
export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Request and result
 * ------------------------------------------------------------------ */

export interface ChatRequest {
  model: string;
  system?: string;
  messages: LLMMessage[];
  tools?: LLMToolDef[];
  maxTokens: number;
  /**
   * Dropped silently for models that reject sampling parameters — Claude
   * Sonnet 5, Opus 5 and the Fable family return `400` when `temperature` is
   * present. See `MODELS_WITHOUT_SAMPLING` in `anthropic.ts`.
   */
  temperature?: number;
  /** Ask the adapter to mark the system prompt as a cache breakpoint. */
  cacheSystem?: boolean;
  /** Abort signal, threaded to `fetch`. */
  signal?: AbortSignal;
}

/** Token accounting, normalised across vendors. */
export interface LLMUsage {
  in: number;
  out: number;
  /** Tokens served from a prompt cache, when the provider reports them. */
  cacheRead?: number;
  /** Tokens written into a prompt cache, when the provider reports them. */
  cacheWrite?: number;
}

/** Why the model stopped. Normalised; `other` covers vendor-specific values. */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface ChatResult {
  text: string;
  toolCalls: LLMToolCall[];
  usage: LLMUsage;
  /** USD. From the provider when it reports one, else from the price table. */
  costUsd: number;
  /** True when `costUsd` came from the local price table rather than the API. */
  costEstimated: boolean;
  model: string;
  provider: ProviderId;
  latencyMs: number;
  stopReason: StopReason;
  /**
   * Fraction of input tokens served from cache, 0–1. Feeds
   * `TraceNode.cacheHitRate` and `Provenance.cacheHitRate`.
   */
  cacheHitRate: number;
}

/* ------------------------------------------------------------------ *
 * The provider itself
 * ------------------------------------------------------------------ */

export interface LLMProvider {
  /** Stable instance id, e.g. `anthropic` or `openrouter`. */
  readonly id: ProviderId;
  /** Human label for logs and the provider matrix in the README. */
  readonly label: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  /**
   * Optional token stream. No adapter implements it yet; the orchestrator
   * never calls it, and the trace is built from the final result either way.
   */
  stream?(req: ChatRequest): AsyncIterable<string>;
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * A call that failed at the provider.
 *
 * `retryable` is what the router reads to decide whether to fall down the
 * tier chain: a `429` or a `5xx` is somebody else's bad day, a `400` is our
 * bug and falling back would only repeat it against a different vendor.
 */
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(
    provider: ProviderId,
    message: string,
    opts: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = opts.status;
    this.retryable = opts.retryable ?? isRetryableStatus(opts.status);
  }
}

export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true; // network / DNS / timeout
  if (status === 408 || status === 409 || status === 429) return true;
  return status >= 500;
}
