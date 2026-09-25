import { createHash } from "node:crypto";
import { type ResolvedCredential, resolveCredentials, scrubSecret } from "./keys";
import { usdToMyr } from "./pricing";
import { EMBEDDING_DIMENSIONS, ProviderError, isRequestDefect, openAiEmbeddings, type OpenAiFamily } from "./providers";
import { budgetState, monthToDateSpend, recordUsage } from "./spend";
import { getTierConfig, type TierRoute } from "./tiers";

/**
 * Embeddings for the pgvector knowledge base (course catalog, JPK/NOSS,
 * HRD Corp focus areas). Columns are vector(1536).
 *
 * Contract (stable): embed(texts) -> { vectors, model }. Every vector is
 * 1536-d and L2-normalised. When the EMBED tier has a key, its
 * OpenAI-compatible `/embeddings` endpoint is used (and metered in
 * `llm_usage` under tier EMBED); otherwise — or when that endpoint fails or
 * the tier's budget is spent — the local model below is used and `model` says
 * so. Vectors from different models are not comparable, which is why every
 * stored row records its `embedding_model` and why queries go through
 * `embedQuery`.
 *
 * The local model is feature hashing over word unigrams and bigrams with
 * sublinear TF weighting and a stopword list. It is not semantic in the
 * transformer sense, but it is deterministic, free, offline, and ranks
 * catalog text sensibly by shared vocabulary.
 */
export { EMBEDDING_DIMENSIONS };
export const LOCAL_EMBEDDING_MODEL = "local-hash-1536-v1";

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were will with we our you your they them how what when which who can may should would".split(" "),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 5 && t.endsWith("ing") ? t.slice(0, -3) : t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

function bucket(feature: string): { index: number; sign: number } {
  const digest = createHash("sha256").update(feature).digest();
  return { index: digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS, sign: digest[4] & 1 ? 1 : -1 };
}

export function localEmbed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = tokens(text);
  const counts = new Map<string, number>();
  for (let i = 0; i < words.length; i += 1) {
    counts.set(words[i], (counts.get(words[i]) ?? 0) + 1);
    if (i + 1 < words.length) {
      const bigram = `${words[i]}_${words[i + 1]}`;
      counts.set(bigram, (counts.get(bigram) ?? 0) + 0.5);
    }
  }
  for (const [feature, count] of counts) {
    const { index, sign } = bucket(feature);
    vector[index] += sign * (1 + Math.log(count));
  }
  return normalise(vector);
}

function normalise(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

/** `openai/text-embedding-3-small` and `text-embedding-3-small` are one model behind two doors. */
export function sameModelFamily(a: string, b: string): boolean {
  const bare = (id: string) => id.slice(id.lastIndexOf("/") + 1).toLowerCase();
  return bare(a) === bare(b);
}

export interface EmbedOptions {
  /** Drives the cost breakdown. Defaults to `knowledge.embedder`. */
  agent?: string;
  packageId?: string | null;
  runId?: string | null;
}

const DEFAULT_AGENT = "knowledge.embedder";
const EMBED_TIMEOUT_MS = 30_000;
/** Inputs per request: well under every vendor's limit, small enough that one failure costs little. */
const BATCH_SIZE = 128;

export async function embed(texts: string[], opts: EmbedOptions = {}): Promise<{ vectors: number[][]; model: string }> {
  if (texts.length === 0) return { vectors: [], model: LOCAL_EMBEDDING_MODEL };
  const remote = await embedRemote(texts, null, opts);
  return remote ?? { vectors: texts.map(localEmbed), model: LOCAL_EMBEDDING_MODEL };
}

/**
 * Embed a search query in the same model family as the rows it will be
 * compared with. Rows written by the local model are searched with the local
 * model even when a key now exists; rows written by a remote model are
 * searched with that model even if the tier has since been re-pointed.
 *
 * `comparable` is false only when the stored rows' model could not be reached
 * (no key, budget spent, outage): the returned local vector would rank those
 * rows by noise, and the caller should fall back to lexical search.
 */
export async function embedQuery(
  text: string,
  storedModel: string | null | undefined,
  opts: EmbedOptions = {},
): Promise<{ vector: number[]; model: string; comparable: boolean }> {
  if (!storedModel) {
    const { vectors, model } = await embed([text], opts);
    return { vector: vectors[0], model, comparable: true };
  }
  if (storedModel === LOCAL_EMBEDDING_MODEL) return { vector: localEmbed(text), model: LOCAL_EMBEDDING_MODEL, comparable: true };
  const remote = await embedRemote([text], storedModel, opts);
  if (remote) return { vector: remote.vectors[0], model: remote.model, comparable: true };
  return { vector: localEmbed(text), model: LOCAL_EMBEDDING_MODEL, comparable: false };
}

interface EmbedCandidate {
  provider: OpenAiFamily;
  model: string;
  credential: ResolvedCredential & { provider: OpenAiFamily };
}

/**
 * The EMBED tier's routes, narrowed to `requiredModel`'s family when one is
 * given. When the tier has since been re-pointed to another model, the
 * stored model is asked of the primary vendor, spelled the way that vendor
 * spells ids (`openai/…` on a gateway, bare on a direct endpoint). A route
 * to Anthropic is skipped by the caller: it has no embeddings endpoint.
 */
function routesFor(primary: TierRoute, fallback: TierRoute[], requiredModel: string | null): TierRoute[] {
  const all = [primary, ...fallback];
  if (!requiredModel) return all;
  const matching = all.filter((r) => sameModelFamily(r.model, requiredModel));
  if (matching.length > 0) return matching;
  const vendorPrefix = primary.model.slice(0, primary.model.lastIndexOf("/") + 1);
  return [{ provider: primary.provider, model: vendorPrefix + requiredModel.slice(requiredModel.lastIndexOf("/") + 1) }];
}

/**
 * What `embed()` would try right now, best first: the EMBED tier's routes
 * (narrowed to `requiredModel`'s family) paired with every usable credential,
 * less keys already over their own cap. `blocked` says why nothing may be
 * spent when the tier itself is over its cap.
 */
async function plan(requiredModel: string | null): Promise<{ candidates: EmbedCandidate[]; blocked: string | null }> {
  const config = await getTierConfig("EMBED");
  if (!config.enabled) return { candidates: [], blocked: null };

  const candidates: EmbedCandidate[] = [];
  for (const route of routesFor({ provider: config.provider, model: config.model }, config.fallback, requiredModel)) {
    if (route.provider === "anthropic") continue;
    const provider = route.provider;
    for (const credential of await resolveCredentials(provider, "EMBED")) {
      if (credential.keyId && credential.monthlyCapMyr !== null) {
        if (budgetState(await monthToDateSpend({ keyId: credential.keyId }), credential.monthlyCapMyr) === "PAUSED") continue;
      }
      candidates.push({ provider, model: route.model, credential: { ...credential, provider } });
    }
  }
  if (candidates.length === 0) return { candidates, blocked: null };

  const tierSpend = await monthToDateSpend({ tier: "EMBED" });
  if (budgetState(tierSpend, config.monthlyCapMyr) === "PAUSED") {
    return { candidates: [], blocked: `EMBED has spent RM ${tierSpend} of its RM ${config.monthlyCapMyr} monthly cap` };
  }
  return { candidates, blocked: null };
}

/**
 * The model `embed()` would use right now, without spending anything. Lets a
 * re-embedding job decide which stored rows are stale before paying for a
 * single vector.
 */
export async function currentEmbeddingModel(): Promise<string> {
  const { candidates } = await plan(null);
  return candidates[0]?.model ?? LOCAL_EMBEDDING_MODEL;
}

/** Null means "use the local model": no key, tier disabled or over budget, or every candidate failed. */
async function embedRemote(
  texts: string[],
  requiredModel: string | null,
  opts: EmbedOptions,
): Promise<{ vectors: number[][]; model: string } | null> {
  const { candidates, blocked } = await plan(requiredModel);
  const base = { runId: opts.runId ?? null, agent: opts.agent ?? DEFAULT_AGENT, tier: "EMBED", packageId: opts.packageId ?? null };
  if (blocked) {
    await recordUsage({
      ...base,
      provider: "local",
      model: LOCAL_EMBEDDING_MODEL,
      costEstimated: false,
      status: "BUDGET_BLOCKED",
      error: `BUDGET_EXHAUSTED: ${blocked}`,
    });
    return null;
  }

  for (const candidate of candidates) {
    const { credential } = candidate;
    const vectors: number[][] = [];
    let failed: ProviderError | null = null;
    for (let i = 0; i < texts.length && !failed; i += BATCH_SIZE) {
      const started = Date.now();
      try {
        const result = await openAiEmbeddings(candidate.provider, credential, candidate.model, texts.slice(i, i + BATCH_SIZE), {
          dimensions: EMBEDDING_DIMENSIONS,
          timeoutMs: EMBED_TIMEOUT_MS,
        });
        const costMyr = usdToMyr(result.costUsd);
        await recordUsage({
          ...base,
          provider: candidate.provider,
          model: candidate.model,
          keyId: credential.keyId,
          inputTokens: result.usage.in,
          costUsd: result.costUsd,
          costMyr,
          costEstimated: result.costEstimated,
          latencyMs: result.latencyMs,
          status: "OK",
        });
        vectors.push(...result.vectors.map(normalise));
      } catch (thrown) {
        if (!(thrown instanceof ProviderError)) throw thrown;
        failed = thrown;
        await recordUsage({
          ...base,
          provider: candidate.provider,
          model: candidate.model,
          keyId: credential.keyId,
          latencyMs: Date.now() - started,
          status: "ERROR",
          error: scrubSecret(thrown.message, credential.apiKey),
        });
      }
    }
    if (!failed) return { vectors, model: candidate.model };
    if (isRequestDefect(failed)) break;
  }
  return null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
