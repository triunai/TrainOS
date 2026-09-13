import { describe, expect, it } from "vitest";
import { assertQualifiedFunction, DEFAULT_BYOK_RPC, TenantKeyResolver } from "../src/keys";
import { FakeTransport, TENANT } from "./fake-transport";

const ROWS = [
  { provider: "anthropic", api_key: "sk-ant-live-1", base_url: null, label: "Anthropic direct" },
  {
    provider: "openrouter",
    api_key: "sk-or-live-2",
    base_url: "https://openrouter.ai/api/v1",
    label: null,
  },
];

describe("TenantKeyResolver", () => {
  it("reads keys through the RPC, scoped to the tenant, never from the environment", async () => {
    const transport = new FakeTransport().on(DEFAULT_BYOK_RPC, ROWS);
    const keys = new TenantKeyResolver({ transport });
    expect(await keys.forTenant(TENANT).get("anthropic")).toBe("sk-ant-live-1");
    expect(transport.paramsFor(DEFAULT_BYOK_RPC)).toEqual([TENANT, null]);
  });

  it("returns undefined for a provider the tenant has not configured", async () => {
    const transport = new FakeTransport().on(DEFAULT_BYOK_RPC, ROWS);
    expect(
      await new TenantKeyResolver({ transport }).forTenant(TENANT).get("deepseek"),
    ).toBeUndefined();
  });

  it("drops a row whose key is blank rather than offering an unusable provider", async () => {
    const transport = new FakeTransport().on(DEFAULT_BYOK_RPC, [
      { provider: "anthropic", api_key: "   ", base_url: null },
      ...ROWS.slice(1),
    ]);
    expect(await new TenantKeyResolver({ transport }).forTenant(TENANT).list()).toEqual([
      "openrouter",
    ]);
  });

  it("caches for the TTL and asks again once it lapses", async () => {
    let clock = 0;
    const transport = new FakeTransport().on(DEFAULT_BYOK_RPC, ROWS);
    const keys = new TenantKeyResolver({ transport, ttlMs: 1_000, now: () => clock });

    await keys.rows(TENANT);
    await keys.rows(TENANT);
    expect(transport.callsTo(DEFAULT_BYOK_RPC)).toHaveLength(1);

    clock = 1_500;
    await keys.rows(TENANT);
    expect(transport.callsTo(DEFAULT_BYOK_RPC)).toHaveLength(2);
  });

  it("invalidate() forces the next read to go back to the RPC", async () => {
    const transport = new FakeTransport().on(DEFAULT_BYOK_RPC, ROWS);
    const keys = new TenantKeyResolver({ transport, ttlMs: 600_000 });
    await keys.rows(TENANT);
    keys.invalidate(TENANT);
    await keys.rows(TENANT);
    expect(transport.callsTo(DEFAULT_BYOK_RPC)).toHaveLength(2);
  });

  it("keeps two tenants' keys apart", async () => {
    const other = "99999999-9999-4999-8999-999999999999";
    const transport = new FakeTransport().on(DEFAULT_BYOK_RPC, (params) =>
      params[0] === TENANT
        ? ROWS
        : [{ provider: "anthropic", api_key: "sk-ant-other", base_url: null }],
    );
    const keys = new TenantKeyResolver({ transport });
    expect(await keys.forTenant(TENANT).get("anthropic")).toBe("sk-ant-live-1");
    expect(await keys.forTenant(other).get("anthropic")).toBe("sk-ant-other");
  });

  it("builds a runtime KeyStore whose refs carry the base URL and never the secret", async () => {
    const transport = new FakeTransport().on(DEFAULT_BYOK_RPC, ROWS);
    const store = await new TenantKeyResolver({ transport }).keyStoreFor(TENANT);
    const refs = store.list();
    expect(refs.map((ref) => ref.provider).sort()).toEqual(["anthropic", "openrouter"]);
    expect(JSON.stringify(refs)).not.toContain("sk-ant-live-1");
    expect(store.get(refs.find((ref) => ref.provider === "openrouter")!)).toBe("sk-or-live-2");
    expect(refs.find((ref) => ref.provider === "openrouter")?.baseUrl).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("reports no keys when the RPC does not exist yet, so a run refuses instead of guessing", async () => {
    const transport = new FakeTransport();
    expect(await new TenantKeyResolver({ transport }).forTenant(TENANT).list()).toEqual([]);
  });
});

describe("assertQualifiedFunction", () => {
  it("accepts a schema-qualified name", () => {
    expect(() => assertQualifiedFunction("app.provider_key_for_tenant")).not.toThrow();
  });

  it("refuses anything that is not one, because the name is interpolated into SQL", () => {
    for (const bad of ["provider_key", "app.fn; drop table app.outbox", 'app."fn"', "app.fn()"]) {
      expect(() => assertQualifiedFunction(bad)).toThrow(/schema-qualified/);
    }
  });

  it("is checked at construction, not at first use", () => {
    expect(() => new TenantKeyResolver({ transport: new FakeTransport(), rpc: "oops" })).toThrow();
  });
});
