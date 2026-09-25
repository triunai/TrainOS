/**
 * The provider-neutral chat surface.
 *
 * The router speaks only these types; an adapter translates them to and from
 * one vendor's wire format. Adding a vendor is one adapter file and one entry
 * in `PROVIDER_IDS` — nothing above this layer changes. That is the BYOK
 * promise expressed as a type.
 */

/** Mirrors the `provider_keys.provider` check constraint in 0003_finance_ai.sql. */
export const PROVIDER_IDS = ["anthropic", "openrouter", "deepseek", "gemini", "openai-compatible"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Dropped by the Anthropic adapter for models that reject sampling parameters. */
  temperature?: number;
  /** Ask for a JSON object. OpenAI-family endpoints get `response_format`; Anthropic relies on the prompt. */
  json?: boolean;
  signal?: AbortSignal;
}

/** Token accounting, normalised: `cacheRead` is a SUBSET of `in`, never an addition to it. */
export interface ChatUsage {
  in: number;
  out: number;
  cacheRead?: number;
}

export type StopReason = "end_turn" | "max_tokens" | "refusal" | "other";

export interface ChatResult {
  text: string;
  usage: ChatUsage;
  /** USD. The provider's own figure when it reports one (OpenRouter), else the price table's. */
  costUsd: number;
  /** True when `costUsd` came from the local price table rather than the vendor. */
  costEstimated: boolean;
  model: string;
  provider: ProviderId;
  latencyMs: number;
  stopReason: StopReason;
}

/** What an adapter needs to authenticate. Resolution (DB, then env) lives in ../keys.ts. */
export interface ProviderCredential {
  apiKey: string;
  baseUrl?: string | null;
}

export interface CallOptions {
  /** Wall-clock ceiling for the whole call, body included. */
  timeoutMs?: number;
}

/**
 * A call that failed at the provider.
 *
 * `retryable` is what the router reads to decide whether to walk on down the
 * chain: a 429 or a 5xx is somebody else's bad day; a 400 is our bug, and
 * repeating it against a different vendor would only bury it.
 */
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(provider: ProviderId, message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = opts.status;
    this.retryable = opts.retryable ?? isRetryableStatus(opts.status);
  }
}

/** No status means the request never got an answer (network, DNS, timeout): worth another vendor. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  if (status === 408 || status === 409 || status === 429) return true;
  return status >= 500;
}

/**
 * A defect in the request itself, which every vendor would refuse the same
 * way, so walking the chain would only repeat it: a 400/422, or a reply we
 * refused as unusable whatever door it came through (a wrong-width
 * embedding). Some vendors report an empty balance as a 400; that is an
 * account problem another vendor does not share, so it is not a defect.
 */
export function isRequestDefect(error: ProviderError): boolean {
  if (error.status === undefined) return !error.retryable;
  if (error.status !== 400 && error.status !== 422) return false;
  return !/credit|balance|billing|quota|insufficient/i.test(error.message);
}
