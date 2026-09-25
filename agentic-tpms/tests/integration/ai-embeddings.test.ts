import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_MODEL,
  addProviderKey,
  cosineSimilarity,
  currentEmbeddingModel,
  embed,
  embedQuery,
  localEmbed,
  sameModelFamily,
  updateTierConfig,
} from "@/server/ai";
import { db } from "@/server/db/client";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator } from "../helpers/factory";
import { clearAiTables, restoreAiEnv, useAiEnv, usageRows } from "../unit/ai/ai-env";
import { forbidFetch, jsonResponse, resetFetch, stubFetch, type RecordedCall } from "../unit/ai/fetch-stub";

beforeAll(async () => {
  await useTestDatabase();
  await makeOperator();
});
afterAll(async () => {
  resetFetch();
  restoreAiEnv();
  await releaseTestDatabase();
});
beforeEach(async () => {
  useAiEnv();
  resetFetch();
  await clearAiTables();
});
afterEach(() => {
  resetFetch();
  restoreAiEnv();
});

const norm = (v: number[]) => Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));

/** A remote model stand-in: one un-normalised 1536-d vector per input, seeded by the input's position. */
function embeddingsServer(): RecordedCall[] {
  return stubFetch((call) => {
    const input = call.body.input as string[];
    return jsonResponse(200, {
      model: call.body.model,
      data: input.map((_, index) => ({ index, embedding: Array.from({ length: 1536 }, (_, i) => ((i + index) % 7) - 3) })),
      usage: { prompt_tokens: input.length * 2_500 },
    });
  });
}

describe("(g) local embeddings", () => {
  it("are deterministic, 1536-d and unit-norm", () => {
    const text = "Leadership and change management for supervisors";
    const a = localEmbed(text);
    const b = localEmbed(text);
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(norm(a)).toBeCloseTo(1, 10);
    expect(a.every(Number.isFinite)).toBe(true);
  });

  it("score related texts above unrelated ones", () => {
    const query = localEmbed("leading teams through organisational change");
    const related = localEmbed("Change management: leading your team through organisational change and transition");
    const unrelated = localEmbed("Forklift safety inspection checklist for warehouse operators");
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated) + 0.2);
  });

  it("an empty text is the zero vector, not NaN", () => {
    const v = localEmbed("");
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it("with no key, embed() uses the local model and writes no usage row", async () => {
    const calls = forbidFetch();
    expect(await currentEmbeddingModel()).toBe(LOCAL_EMBEDDING_MODEL);
    const { vectors, model } = await embed(["alpha beta", "gamma delta"]);
    expect(model).toBe(LOCAL_EMBEDDING_MODEL);
    expect(vectors).toEqual([localEmbed("alpha beta"), localEmbed("gamma delta")]);
    expect(calls).toHaveLength(0);
    expect(await usageRows()).toEqual([]);
  });
});

describe("remote embeddings", () => {
  it("with an EMBED key, embed() calls {base}/embeddings, normalises, and meters under tier EMBED", async () => {
    useAiEnv({ OPENAI_COMPATIBLE_API_KEY: "sk-proj-embed-000000000000000001", OPENAI_COMPATIBLE_BASE_URL: "https://llm.example.my/v1" });
    const calls = embeddingsServer();
    expect(await currentEmbeddingModel()).toBe("text-embedding-3-small");
    expect(calls).toHaveLength(0);
    const { vectors, model } = await embed(["course one", "course two"], { agent: "catalog.indexer" });
    expect(model).toBe("text-embedding-3-small");
    expect(vectors).toHaveLength(2);
    for (const v of vectors) {
      expect(v).toHaveLength(1536);
      expect(norm(v)).toBeCloseTo(1, 10);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://llm.example.my/v1/embeddings");
    expect(calls[0].headers.authorization).toBe("Bearer sk-proj-embed-000000000000000001");
    expect(calls[0].body).toEqual({ model: "text-embedding-3-small", input: ["course one", "course two"], dimensions: 1536 });

    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    // 5,000 tokens × $0.02 per million = $0.0001 = RM 0.000445, kept whole at cost_myr's eight places (0010).
    expect(usage[0]).toMatchObject({
      tier: "EMBED",
      agent: "catalog.indexer",
      provider: "openai-compatible",
      status: "OK",
      input_tokens: 5_000,
      cost_usd: "0.0001000000",
      cost_myr: "0.00044500",
    });
  });

  it("a stored key scoped to EMBED is used, and a failing endpoint degrades to the local model with an ERROR row", async () => {
    await addProviderKey({ provider: "openai-compatible", label: "Embeddings", key: "sk-proj-db-0000000000000000001", tiers: ["EMBED"] }, ALEX);
    stubFetch(() => jsonResponse(500, { error: { message: "upstream down" } }));
    const { vectors, model } = await embed(["text"]);
    expect(model).toBe(LOCAL_EMBEDDING_MODEL);
    expect(vectors[0]).toEqual(localEmbed("text"));
    const usage = await usageRows();
    expect(usage.map((u) => [u.tier, u.status])).toEqual([["EMBED", "ERROR"]]);
  });

  it("an EMBED tier over its cap stays local and says so", async () => {
    useAiEnv({ OPENAI_COMPATIBLE_API_KEY: "sk-proj-embed-000000000000000001" });
    await db().execute(sql`insert into tpms.llm_usage (agent, tier, provider, model, cost_myr, status)
                           values ('seed', 'EMBED', 'openai-compatible', 'text-embedding-3-small', 30, 'OK')`);
    const calls = forbidFetch();
    expect(await currentEmbeddingModel()).toBe(LOCAL_EMBEDDING_MODEL);
    const { model } = await embed(["text"]);
    expect(model).toBe(LOCAL_EMBEDDING_MODEL);
    expect(calls).toHaveLength(0);
    expect((await usageRows()).at(-1)).toMatchObject({ tier: "EMBED", status: "BUDGET_BLOCKED" });
  });
});

describe("embedQuery respects the stored rows' model", () => {
  it("rows written by the local model are searched locally even when a key exists", async () => {
    useAiEnv({ OPENAI_COMPATIBLE_API_KEY: "sk-proj-embed-000000000000000001" });
    const calls = forbidFetch();
    const result = await embedQuery("leadership", LOCAL_EMBEDDING_MODEL);
    expect(result).toEqual({ vector: localEmbed("leadership"), model: LOCAL_EMBEDDING_MODEL, comparable: true });
    expect(calls).toHaveLength(0);
  });

  it("rows written by a remote model are searched with that model", async () => {
    useAiEnv({ OPENAI_COMPATIBLE_API_KEY: "sk-proj-embed-000000000000000001" });
    const calls = embeddingsServer();
    const result = await embedQuery("leadership", "text-embedding-3-small");
    expect(result.model).toBe("text-embedding-3-small");
    expect(result.comparable).toBe(true);
    expect(result.vector).toHaveLength(1536);
    expect(calls[0].body.model).toBe("text-embedding-3-small");
  });

  it("rows written before the tier was re-pointed are still searched with their own model", async () => {
    useAiEnv({ OPENAI_COMPATIBLE_API_KEY: "sk-proj-embed-000000000000000001" });
    await updateTierConfig("EMBED", { model: "text-embedding-3-large" }, ALEX);
    const calls = embeddingsServer();
    // Written through a gateway as `openai/…`; the direct endpoint now configured spells it bare.
    const result = await embedQuery("leadership", "openai/text-embedding-3-small");
    expect(calls[0].body.model).toBe("text-embedding-3-small");
    expect(result.comparable).toBe(true);
    expect(sameModelFamily(result.model, "openai/text-embedding-3-small")).toBe(true);
  });

  it("remote rows with no way to reach their model: a local vector flagged not comparable", async () => {
    const calls = forbidFetch();
    const result = await embedQuery("leadership", "text-embedding-3-small");
    expect(result.model).toBe(LOCAL_EMBEDDING_MODEL);
    expect(result.comparable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("with nothing stored yet, the query uses whatever embed() would", async () => {
    const result = await embedQuery("leadership", null);
    expect(result).toMatchObject({ model: LOCAL_EMBEDDING_MODEL, comparable: true });
  });

  it("model family ignores the vendor prefix", () => {
    expect(sameModelFamily("openai/text-embedding-3-small", "text-embedding-3-small")).toBe(true);
    expect(sameModelFamily("text-embedding-3-large", "text-embedding-3-small")).toBe(false);
  });
});
