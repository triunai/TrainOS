import { estimateCostUsd } from "../pricing";
import { postJson } from "./http";
import { authHeaders, baseUrlFor, type OpenAiFamily } from "./openai-compatible";
import { ProviderError, type CallOptions, type ProviderCredential } from "./types";

/**
 * OpenAI-shaped `/embeddings`:
 *
 *   POST {base}/embeddings  { model, input: string[], dimensions }
 *   -> { data: [{ index, embedding: number[] }], usage: { prompt_tokens, cost? } }
 *
 * The knowledge-base columns are vector(1536), so a reply of any other width
 * is refused here rather than failing later on insert. That refusal is not
 * retryable: another vendor serving the same model returns the same width.
 */

/** Width of every knowledge-base vector column (`vector(1536)` in 0002_domain.sql). */
export const EMBEDDING_DIMENSIONS = 1536;

interface EmbeddingsResponse {
  model?: string;
  data?: Array<{ index?: number; embedding?: number[] }>;
  usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number };
}

export interface EmbeddingsResult {
  vectors: number[][];
  usage: { in: number };
  costUsd: number;
  costEstimated: boolean;
  model: string;
  latencyMs: number;
}

export async function openAiEmbeddings(
  provider: OpenAiFamily,
  credential: ProviderCredential,
  model: string,
  texts: string[],
  opts: CallOptions & { dimensions: number },
): Promise<EmbeddingsResult> {
  const { body: json, latencyMs } = await postJson<EmbeddingsResponse>(provider, `${baseUrlFor(provider, credential)}/embeddings`, {
    headers: authHeaders(provider, credential),
    body: { model, input: texts, dimensions: opts.dimensions },
    timeoutMs: opts.timeoutMs,
  });

  const data = [...(json?.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (data.length !== texts.length) {
    throw new ProviderError(provider, `Embeddings reply has ${data.length} vectors for ${texts.length} inputs`, { retryable: false });
  }
  const vectors = data.map((d) => d.embedding ?? []);
  for (const v of vectors) {
    if (v.length !== opts.dimensions || !v.every(Number.isFinite)) {
      throw new ProviderError(provider, `Embedding width ${v.length} does not match vector(${opts.dimensions})`, { retryable: false });
    }
  }
  const tokens = json?.usage?.prompt_tokens ?? json?.usage?.total_tokens ?? 0;
  const reported = typeof json?.usage?.cost === "number" && Number.isFinite(json.usage.cost) ? json.usage.cost : undefined;
  return {
    vectors,
    usage: { in: tokens },
    costUsd: reported ?? estimateCostUsd(model, { in: tokens, out: 0 }),
    costEstimated: reported === undefined,
    model: json?.model ?? model,
    latencyMs,
  };
}
