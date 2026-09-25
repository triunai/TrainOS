import { estimateCostUsd } from "../pricing";
import { postJson, trimSlash } from "./http";
import type { CallOptions, ChatRequest, ChatResult, ProviderCredential, StopReason } from "./types";

/**
 * Anthropic Messages API, raw HTTP.
 *
 *   POST {base}/v1/messages
 *   x-api-key, anthropic-version: 2023-06-01
 *   { model, max_tokens, system?, messages[], temperature? }
 *
 * The reply is `content[]` (text blocks, plus thinking blocks on the models
 * that think by default — ignored here), `stop_reason`, and
 * `usage.{input_tokens, output_tokens, cache_read_input_tokens,
 * cache_creation_input_tokens}`. Cached tokens are reported ALONGSIDE
 * `input_tokens`, not inside it, so they are added back to make `usage.in` the
 * whole prompt, the same shape every other adapter reports.
 *
 * There is no JSON mode flag and no assistant prefill on current models; JSON
 * is asked for in the prompt and validated by the router.
 */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Models that answer `temperature` with a 400. Sampling parameters were
 * removed from Sonnet 5, the Opus 5 line, Opus 4.7/4.8 and the Fable/Mythos
 * families; sending one is not a soft failure, so the adapter drops it.
 */
const NO_SAMPLING = [/^claude-sonnet-5/, /^claude-opus-5/, /^claude-opus-4-[78]/, /^claude-fable-/, /^claude-mythos-/];

export function acceptsTemperature(model: string): boolean {
  const bare = model.slice(model.lastIndexOf("/") + 1);
  return !NO_SAMPLING.some((pattern) => pattern.test(bare));
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function buildAnthropicBody(req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (req.system) body.system = req.system;
  if (req.temperature !== undefined && acceptsTemperature(req.model)) body.temperature = req.temperature;
  return body;
}

function stopReason(raw: string | undefined): StopReason {
  switch (raw) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

export async function anthropicChat(
  credential: ProviderCredential,
  req: ChatRequest,
  opts: CallOptions = {},
): Promise<ChatResult> {
  const base = trimSlash(credential.baseUrl || ANTHROPIC_BASE_URL);
  const { body: json, latencyMs } = await postJson<AnthropicResponse>("anthropic", `${base}/v1/messages`, {
    headers: { "x-api-key": credential.apiKey, "anthropic-version": ANTHROPIC_VERSION },
    body: buildAnthropicBody(req),
    timeoutMs: opts.timeoutMs,
    signal: req.signal,
  });

  const text = (json?.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
  const cacheRead = json?.usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = json?.usage?.cache_creation_input_tokens ?? 0;
  const usage = {
    in: (json?.usage?.input_tokens ?? 0) + cacheRead + cacheWrite,
    out: json?.usage?.output_tokens ?? 0,
    cacheRead,
  };

  return {
    text,
    usage,
    // Priced by the id we asked for: the price table is keyed by it, and the
    // reply's `model` may carry a snapshot suffix the table does not list.
    costUsd: estimateCostUsd(req.model, usage),
    costEstimated: true,
    model: json?.model ?? req.model,
    provider: "anthropic",
    latencyMs,
    stopReason: stopReason(json?.stop_reason),
  };
}
