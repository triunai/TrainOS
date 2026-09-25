import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { addProviderKey, runTier, startAgentRun, updateTierConfig } from "@/server/ai";
import { db, withTx } from "@/server/db/client";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator, makePackage } from "../helpers/factory";
import { clearAiTables, restoreAiEnv, useAiEnv, usageRows } from "../unit/ai/ai-env";
import { anthropicReply, forbidFetch, jsonResponse, openAiReply, resetFetch, stubFetch } from "../unit/ai/fetch-stub";

const outlineSchema = z.object({ title: z.string(), modules: z.array(z.string()).min(1) });
const TEMPLATE = { title: "Template outline", modules: ["Module 1"] };

function outlineInput(packageId?: string) {
  return {
    tier: "L3" as const,
    agent: "commercial.outline_writer",
    packageId: packageId ?? null,
    system: "You design HRD Corp claimable course outlines.",
    prompt: "Outline a two-day course on leading through change.",
    json: { schema: outlineSchema },
    template: () => TEMPLATE,
  };
}

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

describe("runTier with no keys", () => {
  it("(a) falls back to the template, calls nothing, and records exactly one FALLBACK_TEMPLATE row", async () => {
    const calls = forbidFetch();
    const { output, provenance } = await runTier(outlineInput());
    expect(output).toEqual(TEMPLATE);
    expect(provenance).toMatchObject({
      tier: "L3",
      agent: "commercial.outline_writer",
      mode: "TEMPLATE",
      provider: "template",
      model: "deterministic-template",
      costMyr: 0,
      fallbackReason: "NO_PROVIDER_CONFIGURED",
    });
    expect(calls).toHaveLength(0);
    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ tier: "L3", status: "FALLBACK_TEMPLATE", provider: "template", model: "deterministic-template", cost_myr: "0.00000000" });
    expect(usage[0].error).toMatch(/^NO_PROVIDER_CONFIGURED/);
  });

  it("a disabled tier falls back even when a key exists", async () => {
    useAiEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test-000000000001" });
    await updateTierConfig("L3", { enabled: false }, ALEX);
    const calls = forbidFetch();
    const { provenance } = await runTier(outlineInput());
    expect(provenance.fallbackReason).toBe("NO_PROVIDER_CONFIGURED");
    expect(calls).toHaveLength(0);
  });
});

describe("runTier with an environment key", () => {
  it("(b) returns LLM provenance and records an OK row with tokens and cost", async () => {
    useAiEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test-000000000001", USD_TO_MYR: "4.45" });
    const pkg = await makePackage();
    const calls = stubFetch(() =>
      jsonResponse(
        200,
        openAiReply(
          '```json\n{"title":"Leading Through Change","modules":["Why change fails","Leading the transition"]}\n```',
          { prompt_tokens: 1_000, completion_tokens: 500, prompt_cache_hit_tokens: 200 },
          "deepseek-chat",
        ),
      ),
    );
    const { output, provenance } = await runTier(outlineInput(pkg.id));
    expect(output).toEqual({ title: "Leading Through Change", modules: ["Why change fails", "Leading the transition"] });
    // 800 fresh × 0.28 + 200 cached × 0.028 + 500 out × 0.42 = 439.6 USD per million
    expect(provenance).toMatchObject({ mode: "LLM", provider: "deepseek", model: "deepseek-chat", tier: "L3", costMyr: 0.00195622 });
    expect(provenance.fallbackReason).toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0].headers.authorization).toBe("Bearer sk-deepseek-test-000000000001");
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
    expect(calls[0].body.max_tokens).toBe(4096);
    const messages = calls[0].body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("single JSON object");

    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      tier: "L3",
      agent: "commercial.outline_writer",
      provider: "deepseek",
      model: "deepseek-chat",
      status: "OK",
      key_id: null,
      package_id: pkg.id,
      input_tokens: 1_000,
      output_tokens: 500,
      cache_read_tokens: 200,
      // Kept whole at the 0010 precision; at the old (12,6)/(12,4) this read 0.000440 / 0.0020.
      cost_usd: "0.0004396000",
      cost_myr: "0.00195622", // 0.0004396 × 4.45
      cost_estimated: true,
      error: null,
    });
  });

  it("returns trimmed text when no schema is given", async () => {
    useAiEnv({ ANTHROPIC_API_KEY: "sk-ant-test-00000000000000000001" });
    const calls = stubFetch(() => jsonResponse(200, anthropicReply("  Dear Puan Nurul, thank you.  ")));
    const { output, provenance } = await runTier({
      tier: "L4",
      agent: "retention.copywriter",
      system: "Warm, concise.",
      prompt: "Thank the client.",
      template: () => "template copy",
    });
    expect(output).toBe("Dear Puan Nurul, thank you.");
    expect(provenance).toMatchObject({ mode: "LLM", provider: "anthropic", model: "claude-sonnet-5" });
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].body.temperature).toBeUndefined();
    expect(calls[0].body.system).toBe("Warm, concise.");
    expect(calls[0].body.max_tokens).toBe(2048);
  });

  it("repairs once: an invalid first answer is shown its validation error and a valid second answer wins", async () => {
    useAiEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test-000000000001" });
    const calls = stubFetch((_call, index) =>
      jsonResponse(200, openAiReply(index === 0 ? '{"title":"No modules"}' : '{"title":"Fixed","modules":["One"]}')),
    );
    const { output, provenance } = await runTier(outlineInput());
    expect(output).toEqual({ title: "Fixed", modules: ["One"] });
    expect(provenance.mode).toBe("LLM");
    expect(calls).toHaveLength(2);
    const repair = calls[1].body.messages as Array<{ role: string; content: string }>;
    expect(repair.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(repair[2].content).toBe('{"title":"No modules"}');
    expect(repair[3].content).toContain("modules");
    const usage = await usageRows();
    expect(usage.map((u) => u.status)).toEqual(["OK", "OK"]);
    expect(usage[0].error).toMatch(/^OUTPUT_INVALID/);
    expect(usage[1].error).toBeNull();
  });

  it("(c) invalid JSON twice falls back with SCHEMA_INVALID and records both paid calls", async () => {
    useAiEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test-000000000001", OPENROUTER_API_KEY: "sk-or-v1-test-0000000000000001" });
    const calls = stubFetch((call) => {
      if (!call.url.startsWith("https://api.deepseek.com")) throw new Error(`fell through to ${call.url}`);
      return jsonResponse(200, openAiReply("Certainly! Here is the outline: Module 1, Module 2.", { prompt_tokens: 100, completion_tokens: 50 }));
    });
    const { output, provenance } = await runTier(outlineInput());
    expect(output).toEqual(TEMPLATE);
    expect(provenance).toMatchObject({ mode: "TEMPLATE", fallbackReason: "SCHEMA_INVALID" });
    expect(provenance.costMyr).toBeGreaterThan(0);
    // One call and one repair, and no walk to the OpenRouter fallback for the same model.
    expect(calls).toHaveLength(2);
    const usage = await usageRows();
    expect(usage.map((u) => u.status)).toEqual(["OK", "OK", "FALLBACK_TEMPLATE"]);
    expect(usage[2].error).toMatch(/^SCHEMA_INVALID/);
  });
});

describe("budgets", () => {
  async function spend(tier: string, myr: string, keyId: string | null = null) {
    await db().execute(sql`insert into tpms.llm_usage (agent, tier, provider, model, key_id, cost_myr, status)
                           values ('seed.spend', ${tier}, 'gemini', 'gemini-2.5-flash-lite', ${keyId}::uuid, ${myr}::numeric, 'OK')`);
  }

  it("(d) a tier at its monthly cap is BUDGET_BLOCKED without a single provider call", async () => {
    useAiEnv({ GEMINI_API_KEY: "AIzaSyTestKey000000000000001" });
    await spend("L1", "35.00");
    await spend("L1", "25.00");
    const calls = forbidFetch();
    const { output, provenance } = await runTier({
      tier: "L1",
      agent: "inbox.classifier",
      system: "Classify.",
      prompt: "Is this an enquiry?",
      json: { schema: z.object({ label: z.string() }) },
      template: () => ({ label: "UNCLASSIFIED" }),
    });
    expect(output).toEqual({ label: "UNCLASSIFIED" });
    expect(provenance).toMatchObject({ mode: "TEMPLATE", fallbackReason: "BUDGET_EXHAUSTED", costMyr: 0 });
    expect(calls).toHaveLength(0);
    const usage = await usageRows();
    const blocked = usage.filter((u) => u.status === "BUDGET_BLOCKED");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ tier: "L1", provider: "template", cost_myr: "0.00000000" });
  });

  it("spend on another tier, or last month, does not count against this tier's cap", async () => {
    useAiEnv({ GEMINI_API_KEY: "AIzaSyTestKey000000000000001" });
    await spend("L3", "500.00");
    await db().execute(sql`insert into tpms.llm_usage (agent, tier, provider, model, cost_myr, status, created_at)
                           values ('seed.spend', 'L1', 'gemini', 'gemini-2.5-flash-lite', 100, 'OK', now() - interval '40 days')`);
    const calls = stubFetch(() => jsonResponse(200, openAiReply('{"label":"ENQUIRY"}')));
    const { provenance } = await runTier({
      tier: "L1",
      agent: "inbox.classifier",
      system: "Classify.",
      prompt: "Is this an enquiry?",
      json: { schema: z.object({ label: z.string() }) },
      template: () => ({ label: "UNCLASSIFIED" }),
    });
    expect(provenance.mode).toBe("LLM");
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(calls[0].body.max_tokens).toBe(256);
  });

  it("a stored key over its own cap is skipped and the next credential serves the call", async () => {
    useAiEnv({ GEMINI_API_KEY: "AIzaSyEnvKey0000000000000009" });
    const key = await addProviderKey({ provider: "gemini", label: "Capped", key: "AIzaSyDbKey00000000000000001", tiers: ["L1"], monthlyCapMyr: 1 }, ALEX);
    await spend("TEST", "1.00", key.id);
    const calls = stubFetch(() => jsonResponse(200, openAiReply("ENQUIRY")));
    const { provenance } = await runTier({ tier: "L1", agent: "inbox.classifier", system: "", prompt: "?", template: () => "UNCLASSIFIED" });
    expect(provenance.mode).toBe("LLM");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.authorization).toBe("Bearer AIzaSyEnvKey0000000000000009");
    const ok = (await usageRows()).filter((u) => u.status === "OK" && u.agent === "inbox.classifier");
    expect(ok[0].key_id).toBeNull();
  });

  it("every key capped and no other credential: BUDGET_EXHAUSTED", async () => {
    const key = await addProviderKey({ provider: "gemini", label: "Capped", key: "AIzaSyDbKey00000000000000001", monthlyCapMyr: "0.50" }, ALEX);
    await spend("TEST", "0.50", key.id);
    const calls = forbidFetch();
    const { provenance } = await runTier({ tier: "L1", agent: "inbox.classifier", system: "", prompt: "?", template: () => "UNCLASSIFIED" });
    expect(provenance.fallbackReason).toBe("BUDGET_EXHAUSTED");
    expect(calls).toHaveLength(0);
    expect((await usageRows()).at(-1)?.status).toBe("BUDGET_BLOCKED");
  });
});

describe("fallback chain", () => {
  const copyInput = {
    tier: "L4" as const,
    agent: "retention.copywriter",
    system: "Warm, concise.",
    prompt: "Thank the client.",
    template: () => "template copy",
  };

  it("(e) a 503 from the primary vendor walks to the fallback vendor", async () => {
    useAiEnv({ ANTHROPIC_API_KEY: "sk-ant-test-00000000000000000001", OPENROUTER_API_KEY: "sk-or-v1-test-0000000000000001" });
    const calls = stubFetch((call) =>
      call.url.startsWith("https://api.anthropic.com")
        ? jsonResponse(503, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } })
        : jsonResponse(200, openAiReply("Thank you, from OpenRouter.", { prompt_tokens: 300, completion_tokens: 40, cost: 0.0012 }, "anthropic/claude-sonnet-5")),
    );
    const { output, provenance } = await runTier(copyInput);
    expect(output).toBe("Thank you, from OpenRouter.");
    expect(provenance).toMatchObject({ mode: "LLM", provider: "openrouter", model: "anthropic/claude-sonnet-5" });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.anthropic.com", "openrouter.ai"]);
    expect(calls[1].body.model).toBe("anthropic/claude-sonnet-5");

    const usage = await usageRows();
    expect(usage.map((u) => [u.provider, u.status])).toEqual([
      ["anthropic", "ERROR"],
      ["openrouter", "OK"],
    ]);
    expect(usage[0].error).toContain("503");
    expect(usage[1]).toMatchObject({ cost_usd: "0.0012000000", cost_estimated: false });
  });

  it("a 401 (bad key) also walks on, and the key is not silently marked", async () => {
    const key = await addProviderKey({ provider: "anthropic", label: "Stale", key: "sk-ant-api03-stale-000000000000wxyz" }, ALEX);
    useAiEnv({ OPENROUTER_API_KEY: "sk-or-v1-test-0000000000000001" });
    stubFetch((call) =>
      call.url.startsWith("https://api.anthropic.com")
        ? jsonResponse(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })
        : jsonResponse(200, openAiReply("ok")),
    );
    const { provenance } = await runTier(copyInput);
    expect(provenance.provider).toBe("openrouter");
    const usage = await usageRows();
    expect(usage[0]).toMatchObject({ provider: "anthropic", status: "ERROR", key_id: key.id });
    const [{ status }] = (await db().execute(sql`select status from tpms.provider_keys where id = ${key.id}::uuid`)).rows as Array<{ status: string }>;
    expect(status).toBe("UNTESTED");
  });

  it("a 400 is our bug: the chain stops and the template answers with PROVIDER_ERROR", async () => {
    useAiEnv({ ANTHROPIC_API_KEY: "sk-ant-test-00000000000000000001", OPENROUTER_API_KEY: "sk-or-v1-test-0000000000000001" });
    const calls = stubFetch(() => jsonResponse(400, { type: "error", error: { type: "invalid_request_error", message: "max_tokens: too large" } }));
    const { output, provenance } = await runTier(copyInput);
    expect(output).toBe("template copy");
    expect(provenance.fallbackReason).toBe("PROVIDER_ERROR");
    expect(calls).toHaveLength(1);
    expect((await usageRows()).map((u) => u.status)).toEqual(["ERROR", "FALLBACK_TEMPLATE"]);
  });

  it("every vendor down: PROVIDER_ERROR after trying each, never an exception", async () => {
    useAiEnv({ ANTHROPIC_API_KEY: "sk-ant-test-00000000000000000001", OPENROUTER_API_KEY: "sk-or-v1-test-0000000000000001" });
    const calls = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const { output, provenance } = await runTier(copyInput);
    expect(output).toBe("template copy");
    expect(provenance.fallbackReason).toBe("PROVIDER_ERROR");
    expect(calls).toHaveLength(2);
  });

  it("a stored key is preferred over the environment key and its id lands on the usage row", async () => {
    useAiEnv({ ANTHROPIC_API_KEY: "sk-ant-env-000000000000000000001" });
    const key = await addProviderKey({ provider: "anthropic", label: "Ops", key: "sk-ant-api03-db-00000000000000abcd", tiers: ["L4"] }, ALEX);
    const calls = stubFetch(() => jsonResponse(200, anthropicReply("hi")));
    await runTier(copyInput);
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant-api03-db-00000000000000abcd");
    expect((await usageRows())[0].key_id).toBe(key.id);
  });

  it("a provider error message never carries the key into the ledger", async () => {
    const secret = "sk-ant-api03-leaky-0000000000000zzzz";
    useAiEnv({ ANTHROPIC_API_KEY: secret });
    stubFetch(() => jsonResponse(401, { error: { message: `Incorrect API key provided: ${secret}` } }));
    await runTier(copyInput);
    const usage = await usageRows();
    expect(JSON.stringify(usage)).not.toContain(secret);
    expect(usage[0].error).toContain("sk-ant-••••••••••••zzzz");
  });
});

describe("the ledger is written outside the caller's transaction", () => {
  /** Fails the test instead of hanging it: the failure mode under test is a wait nobody can see. */
  function within<T>(work: Promise<T>, ms: number): Promise<T> {
    return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms}ms: self-deadlock`)), ms))]);
  }

  it("does not wait on a package row the caller holds FOR UPDATE", async () => {
    const pkg = await makePackage();
    const result = await withTx(ALEX, { reasonCode: "TEST_LOCK_HELD" }, async (tx) => {
      await tx.execute(sql`select id from tpms.training_packages where id = ${pkg.id}::uuid for update`);
      return within(runTier(outlineInput(pkg.id)), 5_000);
    });
    expect(result.provenance.fallbackReason).toBe("NO_PROVIDER_CONFIGURED");
    expect((await usageRows())[0].package_id).toBe(pkg.id);
  });

  it("does not wait on an agent run the caller opened in its own uncommitted transaction", async () => {
    useAiEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test-000000000001" });
    stubFetch(() => jsonResponse(200, openAiReply('{"title":"T","modules":["M"]}')));
    const pkg = await makePackage();
    const runId = await withTx(ALEX, { reasonCode: "TEST_RUN_OPEN" }, async (tx) => {
      const id = await startAgentRun(tx, { agent: "commercial.outline_writer", tier: "L3", packageId: pkg.id });
      const { provenance } = await within(runTier(outlineInput(pkg.id), { runId: id }), 5_000);
      expect(provenance).toMatchObject({ mode: "LLM", runId: id });
      return id;
    });
    const [row] = (await db().execute(sql`select run_id::text as run_id from tpms.llm_usage`)).rows as Array<{ run_id: string }>;
    expect(row.run_id).toBe(runId);
  });

  it("keeps the spend when the caller's transaction rolls back", async () => {
    useAiEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test-000000000001" });
    stubFetch(() => jsonResponse(200, openAiReply('{"title":"T","modules":["M"]}', { prompt_tokens: 10_000, completion_tokens: 1_000 })));
    const pkg = await makePackage();
    await withTx(ALEX, { reasonCode: "TEST_ROLLBACK" }, async () => {
      await runTier(outlineInput(pkg.id));
      throw new Error("business write failed after the model answered");
    }).catch(() => undefined);
    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(Number(usage[0].cost_myr)).toBeGreaterThan(0);
  });
});
