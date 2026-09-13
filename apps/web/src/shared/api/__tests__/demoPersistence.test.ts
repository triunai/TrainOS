/**
 * The hosted demo's browser memory, as `main.tsx` switches it on.
 *
 * The module holds one attachment per page, so every test imports a fresh copy
 * and a fresh fixture client: a "reload" is a second import over the same
 * storage.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_AURORA } from "@trainos/contract";
import { createFixtureClient, DEMO_STORAGE_KEY, type StorageLike } from "@trainos/fixtures";

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

let storage: MemoryStorage;

/** One page load. */
async function boot() {
  vi.resetModules();
  const demo = await import("../demoPersistence");
  const client = createFixtureClient({ latencyMs: 0 });
  demo.enableDemoPersistence(client, storage);
  return { demo, client };
}

async function approveAurora(client: ReturnType<typeof createFixtureClient>) {
  const detail = await client.getApproval(APPROVAL_AURORA);
  await client.decideApproval(APPROVAL_AURORA, {
    decision: "APPROVE",
    note: null,
    diffHash: detail.diffHash,
  });
}

beforeEach(() => {
  storage = new MemoryStorage();
});

describe("demo persistence", () => {
  it("is off until main.tsx switches it on", async () => {
    vi.resetModules();
    const demo = await import("../demoPersistence");
    expect(demo.isDemoPersistenceEnabled()).toBe(false);
    expect(demo.readDemoRole()).toBeNull();
    expect(() => demo.writeDemoRole("FINANCE")).not.toThrow();
  });

  it("keeps a decided approval across a reload, flushed on pagehide", async () => {
    const first = await boot();
    expect(first.demo.isDemoPersistenceEnabled()).toBe(true);
    await approveAurora(first.client);
    window.dispatchEvent(new Event("pagehide"));
    expect(storage.getItem(DEMO_STORAGE_KEY)).not.toBeNull();

    const second = await boot();
    expect((await second.client.getApproval(APPROVAL_AURORA)).status).toBe("APPROVED");
  });

  it("remembers the dev role toggle, and ignores a value it does not recognise", async () => {
    const first = await boot();
    first.demo.writeDemoRole("FINANCE");
    expect((await boot()).demo.readDemoRole()).toBe("FINANCE");

    storage.setItem("trainos.demo.v1.role", "SUPERUSER");
    expect((await boot()).demo.readDemoRole()).toBeNull();
  });

  it("reset forgets the data and the role, then reloads onto the seed", async () => {
    const first = await boot();
    await approveAurora(first.client);
    first.demo.writeDemoRole("OPS");
    window.dispatchEvent(new Event("pagehide"));

    const reload = vi.fn();
    first.demo.resetDemoData(reload);
    expect(reload).toHaveBeenCalledOnce();
    expect(storage.items.size).toBe(0);

    const second = await boot();
    expect((await second.client.getApproval(APPROVAL_AURORA)).status).toBe("PENDING");
    expect(second.demo.readDemoRole()).toBeNull();
  });

  it("runs on the seed when the storage getter itself throws", async () => {
    vi.resetModules();
    const demo = await import("../demoPersistence");
    const getter = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    try {
      expect(demo.browserStorage()).toBeNull();
      const client = createFixtureClient({ latencyMs: 0 });
      expect(() => demo.enableDemoPersistence(client)).not.toThrow();
      await approveAurora(client);
      expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();
      expect(() => demo.resetDemoData(() => undefined)).not.toThrow();
      expect(demo.readDemoRole()).toBeNull();
    } finally {
      getter.mockRestore();
    }
  });
});
