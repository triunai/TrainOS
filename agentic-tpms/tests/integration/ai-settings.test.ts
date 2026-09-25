import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIERS,
  addProviderKey,
  disableProviderKey,
  getTierConfig,
  listProviderKeys,
  listTierConfig,
  seedTierConfig,
  testProviderKey,
  updateTierConfig,
} from "@/server/ai";
import { resolveCredentials } from "@/server/ai/keys";
import { tierEntityId } from "@/server/ai/tiers";
import { db, rows } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import { decryptSecret } from "@/server/lib/crypto";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator } from "../helpers/factory";
import { clearAiTables, restoreAiEnv, useAiEnv, usageRows } from "../unit/ai/ai-env";
import { anthropicReply, jsonResponse, openAiReply, resetFetch, stubFetch } from "../unit/ai/fetch-stub";

const PLAINTEXT = "sk-ant-api03-Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lz-abcd";

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

async function auditFor(entityId: string) {
  return rows<{ reason_code: string; actor_id: string; reason_details: string; metadata_diff: Record<string, unknown> }>(
    db(),
    sql`select reason_code, actor_id, reason_details, metadata_diff from tpms.audit_ledger where entity_id = ${entityId}::uuid order by seq`,
  );
}

describe("provider keys", () => {
  it("(f) encrypts at rest, masks for display, decrypts for use, and never lets the secret reach the audit ledger", async () => {
    const view = await addProviderKey({ provider: "anthropic", label: "Ops key", key: PLAINTEXT, tiers: ["L4"], monthlyCapMyr: 200 }, ALEX);
    expect(view.maskedKey).toBe("sk-ant-••••••••••••abcd");
    expect(view).toMatchObject({ provider: "anthropic", label: "Ops key", tiers: ["L4"], monthlyCapMyr: "200.00", status: "UNTESTED", source: "db", readOnly: false });
    expect(JSON.stringify(view)).not.toContain(PLAINTEXT);

    const [stored] = await rows<{ key_ciphertext: string; masked_key: string; created_by: string }>(
      db(),
      sql`select key_ciphertext, masked_key, created_by from tpms.provider_keys where id = ${view.id}::uuid`,
    );
    expect(stored.key_ciphertext).not.toBe(PLAINTEXT);
    expect(stored.key_ciphertext).not.toContain(PLAINTEXT.slice(8, 30));
    expect(stored.key_ciphertext).toMatch(/^v1:/);
    expect(stored.masked_key).toBe("sk-ant-••••••••••••abcd");
    expect(stored.created_by).toBe(ALEX.id);
    expect(decryptSecret(stored.key_ciphertext)).toBe(PLAINTEXT);

    const audit = await auditFor(view.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason_code: "PROVIDER_KEY_ADDED", actor_id: ALEX.id });
    expect(audit[0].metadata_diff).toMatchObject({ provider: "anthropic", masked_key: "sk-ant-••••••••••••abcd", tiers: ["L4"] });
    const serialised = JSON.stringify(audit);
    expect(serialised).not.toContain(PLAINTEXT);
    expect(serialised).not.toContain(stored.key_ciphertext);
    expect(serialised).not.toContain(stored.key_ciphertext.split(":")[3]);
  });

  it("refuses malformed input as a DomainError", async () => {
    const bad = [
      { provider: "anthropic", label: "x", key: "short" },
      { provider: "mistral", label: "x", key: "sk-000000000000" },
      { provider: "anthropic", label: "", key: "sk-000000000000" },
      { provider: "anthropic", label: "x", key: "sk-0000 00000000" },
      { provider: "anthropic", label: "x", key: "sk-000000000000", tiers: ["L2"] },
      { provider: "openai-compatible", label: "x", key: "sk-000000000000", baseUrl: "ftp://nope" },
      { provider: "anthropic", label: "x", key: "sk-000000000000", monthlyCapMyr: -5 },
    ];
    for (const input of bad) {
      const error = await addProviderKey(input as never, ALEX).catch((e) => e);
      expect(error, JSON.stringify(input)).toBeInstanceOf(DomainError);
      expect(error.code).toBe("PROVIDER_KEY_INVALID");
    }
    expect(await listProviderKeys()).toEqual([]);
  });

  it("resolves stored keys before the environment, honours tier scoping, and skips INVALID and DISABLED keys", async () => {
    useAiEnv({ OPENROUTER_API_KEY: "sk-or-v1-env-000000000000000001" });
    const general = await addProviderKey({ provider: "openrouter", label: "General", key: "sk-or-v1-general-00000000001" }, ALEX);
    const l4Only = await addProviderKey({ provider: "openrouter", label: "L4 only", key: "sk-or-v1-l4only-00000000001", tiers: ["L4"] }, ALEX);
    const invalid = await addProviderKey({ provider: "openrouter", label: "Broken", key: "sk-or-v1-broken-00000000001" }, ALEX);
    await db().execute(sql`update tpms.provider_keys set status = 'INVALID' where id = ${invalid.id}::uuid`);

    const onL4 = await resolveCredentials("openrouter", "L4");
    expect(onL4.map((c) => c.label)).toEqual(["L4 only", "General", "OPENROUTER_API_KEY (environment)"]);
    expect(onL4[0]).toMatchObject({ apiKey: "sk-or-v1-l4only-00000000001", keyId: l4Only.id, source: "db" });
    expect(onL4[2]).toMatchObject({ apiKey: "sk-or-v1-env-000000000000000001", keyId: null, source: "env" });

    const onL1 = await resolveCredentials("openrouter", "L1");
    expect(onL1.map((c) => c.keyId)).toEqual([general.id, null]);

    await disableProviderKey(general.id, ALEX);
    expect((await resolveCredentials("openrouter", "L1")).map((c) => c.source)).toEqual(["env"]);
  });

  it("lists masked keys with month-to-date spend, plus environment keys as read-only entries", async () => {
    useAiEnv({ DEEPSEEK_API_KEY: "sk-deepseek-envkey-0000000009876" });
    const key = await addProviderKey({ provider: "anthropic", label: "Ops", key: PLAINTEXT, monthlyCapMyr: "10" }, ALEX);
    await db().execute(sql`insert into tpms.llm_usage (agent, tier, provider, model, key_id, cost_myr, status) values
      ('a', 'L4', 'anthropic', 'claude-sonnet-5', ${key.id}::uuid, 5.2500, 'OK'),
      ('a', 'L4', 'anthropic', 'claude-sonnet-5', ${key.id}::uuid, 3.0000, 'OK'),
      ('a', 'L3', 'deepseek', 'deepseek-chat', null, 0.1234, 'OK'),
      ('a', 'L3', 'template', 'deterministic-template', null, 0, 'FALLBACK_TEMPLATE')`);
    await db().execute(sql`insert into tpms.llm_usage (agent, tier, provider, model, key_id, cost_myr, status, created_at)
      values ('a', 'L4', 'anthropic', 'claude-sonnet-5', ${key.id}::uuid, 99, 'OK', now() - interval '45 days')`);

    const list = await listProviderKeys();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: key.id, source: "db", maskedKey: "sk-ant-••••••••••••abcd", monthToDateMyr: "8.2500", capState: "NEAR", readOnly: false });
    expect(list[1]).toMatchObject({
      id: "env:deepseek",
      source: "env",
      provider: "deepseek",
      maskedKey: "sk-deepseek-••••••••••••9876",
      monthToDateMyr: "0.1234",
      readOnly: true,
      capState: null,
    });
    const serialised = JSON.stringify(list);
    expect(serialised).not.toContain(PLAINTEXT);
    expect(serialised).not.toContain("sk-deepseek-envkey-0000000009876");
    expect(serialised).not.toContain("v1:");
  });

  it("testProviderKey: a 200 marks the key VALID, a 401 INVALID, and a 503 leaves the status alone", async () => {
    const key = await addProviderKey({ provider: "anthropic", label: "Ops", key: PLAINTEXT, tiers: ["L4"] }, ALEX);

    const calls = stubFetch(() => jsonResponse(200, anthropicReply("OK", { input_tokens: 12, output_tokens: 1 })));
    const ok = await testProviderKey(key.id, ALEX);
    expect(ok).toMatchObject({ ok: true, status: "VALID", httpStatus: 200, model: "claude-sonnet-5" });
    expect(calls[0].headers["x-api-key"]).toBe(PLAINTEXT);
    expect(calls[0].body.max_tokens).toBe(16);

    stubFetch(() => jsonResponse(503, { error: { message: "Overloaded" } }));
    const flaky = await testProviderKey(key.id, ALEX);
    expect(flaky).toMatchObject({ ok: false, status: "VALID", httpStatus: 503 });

    stubFetch(() => jsonResponse(401, { error: { type: "authentication_error", message: "invalid x-api-key" } }));
    const denied = await testProviderKey(key.id, ALEX);
    expect(denied).toMatchObject({ ok: false, status: "INVALID", httpStatus: 401 });

    const [row] = await rows<{ status: string; last_test_result: string; last_tested_at: Date | null }>(
      db(),
      sql`select status, last_test_result, last_tested_at from tpms.provider_keys where id = ${key.id}::uuid`,
    );
    expect(row.status).toBe("INVALID");
    expect(row.last_test_result).toContain("401");
    expect(row.last_tested_at).not.toBeNull();

    const audit = await auditFor(key.id);
    expect(audit.map((a) => a.reason_code)).toEqual(["PROVIDER_KEY_ADDED", "PROVIDER_KEY_TESTED", "PROVIDER_KEY_TESTED", "PROVIDER_KEY_TESTED"]);
    expect(JSON.stringify(audit)).not.toContain(PLAINTEXT);

    // Probes are real spend on a real key, metered under their own tier.
    const usage = await usageRows();
    expect(usage.map((u) => [u.tier, u.status, u.key_id])).toEqual([
      ["TEST", "OK", key.id],
      ["TEST", "ERROR", key.id],
      ["TEST", "ERROR", key.id],
    ]);
  });

  it("an openai-compatible key is probed with an embeddings call; an environment key can be tested but not persisted", async () => {
    useAiEnv({ OPENAI_COMPATIBLE_API_KEY: "sk-proj-envkey-00000000000000001", OPENAI_COMPATIBLE_BASE_URL: "https://llm.example.my/v1" });
    const calls = stubFetch(() =>
      jsonResponse(200, { data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }], usage: { prompt_tokens: 1 } }),
    );
    const result = await testProviderKey("env:openai-compatible", ALEX);
    expect(result).toMatchObject({ ok: true, status: "UNTESTED", model: "text-embedding-3-small" });
    expect(calls[0].url).toBe("https://llm.example.my/v1/embeddings");
    expect(calls[0].body.dimensions).toBe(1536);
  });

  it("disables a stored key with an audit row, and refuses to touch an environment key", async () => {
    const key = await addProviderKey({ provider: "gemini", label: "Old", key: "AIzaSyOldKey00000000000000001" }, ALEX);
    const view = await disableProviderKey(key.id, ALEX);
    expect(view.status).toBe("DISABLED");
    expect((await auditFor(key.id)).map((a) => a.reason_code)).toEqual(["PROVIDER_KEY_ADDED", "PROVIDER_KEY_DISABLED"]);

    // A later successful probe does not quietly re-enable it.
    stubFetch(() => jsonResponse(200, openAiReply("OK")));
    expect((await testProviderKey(key.id, ALEX)).status).toBe("DISABLED");

    await expect(disableProviderKey("env:gemini", ALEX)).rejects.toMatchObject({ code: "PROVIDER_KEY_READ_ONLY" });
    await expect(disableProviderKey("not-a-uuid", ALEX)).rejects.toMatchObject({ code: "PROVIDER_KEY_NOT_FOUND" });
    await expect(disableProviderKey("00000000-0000-4000-8000-000000000000", ALEX)).rejects.toMatchObject({ code: "PROVIDER_KEY_NOT_FOUND" });
  });
});

describe("tier config", () => {
  it("reads defaults before anything is seeded, and seeding is idempotent and never overwrites an edit", async () => {
    expect((await getTierConfig("L1")).updatedAt).toBeNull();
    expect(await listTierConfig()).toHaveLength(4);

    await seedTierConfig();
    await seedTierConfig();
    const seeded = await listTierConfig();
    expect(seeded.map((t) => [t.tier, t.provider, t.model, t.monthlyCapMyr, t.maxTokens])).toEqual([
      ["L1", "gemini", "gemini-2.5-flash-lite", "60.00", 256],
      ["L3", "deepseek", "deepseek-chat", "250.00", 4096],
      ["L4", "anthropic", "claude-sonnet-5", "400.00", 2048],
      ["EMBED", "openai-compatible", "text-embedding-3-small", "30.00", 2048],
    ]);
    expect(seeded[0].fallback).toEqual(DEFAULT_TIERS.L1.fallback);

    await updateTierConfig("L1", { monthlyCapMyr: 80 }, ALEX);
    await seedTierConfig();
    expect((await getTierConfig("L1")).monthlyCapMyr).toBe("80.00");
  });

  it("updates a tier with an audit row naming what changed", async () => {
    const after = await updateTierConfig(
      "L3",
      { model: "deepseek-reasoner", fallback: [{ provider: "openrouter", model: "deepseek/deepseek-reasoner" }], maxTokens: 8000 },
      ALEX,
    );
    expect(after).toMatchObject({ tier: "L3", provider: "deepseek", model: "deepseek-reasoner", maxTokens: 8000, monthlyCapMyr: "250.00" });
    expect(await getTierConfig("L3")).toMatchObject({ model: "deepseek-reasoner", maxTokens: 8000 });

    const audit = await auditFor(tierEntityId("L3"));
    expect(audit).toHaveLength(1);
    expect(audit[0].reason_code).toBe("TIER_CONFIG_UPDATED");
    expect(audit[0].actor_id).toBe(ALEX.id);
    expect(audit[0].metadata_diff).toMatchObject({
      tier: "L3",
      changes: { model: { from: "deepseek-chat", to: "deepseek-reasoner" }, maxTokens: { from: 4096, to: 8000 } },
    });
  });

  it("refuses unknown providers, unknown fields, an Anthropic embeddings route, and a negative cap", async () => {
    for (const [tier, patch] of [
      ["L1", { provider: "mistral" }],
      ["L1", { temperature: 0.2 }],
      ["L1", { monthlyCapMyr: -1 }],
      ["L1", { fallback: [{ provider: "openrouter", model: "" }] }],
      ["EMBED", { provider: "anthropic" }],
    ] as const) {
      await expect(updateTierConfig(tier, patch as never, ALEX)).rejects.toMatchObject({ code: "TIER_CONFIG_INVALID" });
    }
    await expect(updateTierConfig("L2" as never, {}, ALEX)).rejects.toMatchObject({ code: "UNKNOWN_TIER" });
  });

  it("R14: a hand-edited row naming an unknown provider is refused on read, not routed", async () => {
    await seedTierConfig();
    await db().execute(sql`update tpms.tier_config set provider = 'mistral' where tier = 'L1'`);
    await expect(getTierConfig("L1")).rejects.toMatchObject({ code: "TIER_CONFIG_INVALID" });
  });
});
