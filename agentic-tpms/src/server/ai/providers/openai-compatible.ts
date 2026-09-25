import { estimateCostUsd } from "../pricing";
import { postJson, trimSlash } from "./http";
import type { CallOptions, ChatRequest, ChatResult, ProviderCredential, ProviderId, StopReason } from "./types";

/**
 * One adapter for every endpoint that speaks OpenAI's `/chat/completions`:
 * OpenRouter, DeepSeek, Gemini's OpenAI-compatible surface, and any custom
 * gateway. The vendors differ only in base URL, a couple of headers, and
 * where they report cached tokens and cost.
 *
 *   POST {base}/chat/completions   Authorization: Bearer <key>
 *   { model, messages[], max_tokens, temperature?, response_format? }
 *
 * Usage is `{prompt_tokens, completion_tokens}`; `prompt_tokens` INCLUDES any
 * cached tokens. DeepSeek reports the cached share as
 * `prompt_cache_hit_tokens`, OpenRouter as `prompt_tokens_details.cached_tokens`
 * together with an authoritative `cost` in USD.
 */
export type OpenAiFamily = Exclude<ProviderId, "anthropic">;

export const OPENAI_FAMILY_PRESETS: Readonly<Record<OpenAiFamily, { baseUrl: string; headers?: Record<string, string> }>> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    headers: { "HTTP-Referer": "https://agentic-tpms.local", "X-Title": "agentic-tpms" },
  },
  deepseek: { baseUrl: "https://api.deepseek.com" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  // A custom gateway names its own base URL. Without one, the only sensible
  // reading of "an OpenAI-compatible key and no URL" is OpenAI itself.
  "openai-compatible": { baseUrl: "https://api.openai.com/v1" },
};

export function baseUrlFor(provider: OpenAiFamily, credential: ProviderCredential): string {
  return trimSlash(credential.baseUrl || OPENAI_FAMILY_PRESETS[provider].baseUrl);
}

export function authHeaders(provider: OpenAiFamily, credential: ProviderCredential): Record<string, string> {
  return { authorization: `Bearer ${credential.apiKey}`, ...(OPENAI_FAMILY_PRESETS[provider].headers ?? {}) };
}

interface OpenAiResponse {
  model?: string;
  choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export function buildOpenAiBody(provider: OpenAiFamily, req: ChatRequest): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });
  const body: Record<string, unknown> = { model: req.model, messages, max_tokens: req.maxTokens };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.json) body.response_format = { type: "json_object" };
  // OpenRouter returns `usage.cost` only when usage accounting is requested.
  if (provider === "openrouter") body.usage = { include: true };
  return body;
}

/** The spec says a string; a few gateways send an array of `{type:"text", text}` parts instead. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
      .join("");
  }
  return "";
}

function stopReason(raw: string | undefined): StopReason {
  switch (raw) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "other";
  }
}

export async function openAiCompatibleChat(
  provider: OpenAiFamily,
  credential: ProviderCredential,
  req: ChatRequest,
  opts: CallOptions = {},
): Promise<ChatResult> {
  const { body: json, latencyMs } = await postJson<OpenAiResponse>(
    provider,
    `${baseUrlFor(provider, credential)}/chat/completions`,
    {
      headers: authHeaders(provider, credential),
      body: buildOpenAiBody(provider, req),
      timeoutMs: opts.timeoutMs,
      signal: req.signal,
    },
  );

  const choice = json?.choices?.[0];
  const promptTokens = json?.usage?.prompt_tokens ?? 0;
  const cacheRead = json?.usage?.prompt_cache_hit_tokens ?? json?.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const usage = { in: promptTokens, out: json?.usage?.completion_tokens ?? 0, cacheRead };
  const reportedCost = typeof json?.usage?.cost === "number" && Number.isFinite(json.usage.cost) ? json.usage.cost : undefined;

  return {
    text: contentText(choice?.message?.content),
    usage,
    costUsd: reportedCost ?? estimateCostUsd(req.model, usage),
    costEstimated: reportedCost === undefined,
    model: json?.model ?? req.model,
    provider,
    latencyMs,
    stopReason: stopReason(choice?.finish_reason),
  };
}
