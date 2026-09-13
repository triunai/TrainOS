/**
 * Browser persistence for the hosted demo.
 *
 * "A reload" is modelled as a second client attached to the same storage: the
 * page's only memory is what the first one wrote.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_FOLLOWUP,
  APPROVAL_AURORA,
  FOLLOW_UP_AURORA,
  TEMPLATE_FOLLOWUP_WHATSAPP,
} from "@trainos/contract";
import { createFixtureClient } from "../index";
import { createStore } from "../client/store";
import {
  DEMO_STORAGE_KEY,
  persistFixtureClient,
  type StorageLike,
} from "../client/persistence";

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

let storage: MemoryStorage;

/** One page load: a fresh client, persisted to the shared storage. */
const boot = () => {
  const api = createFixtureClient({ latencyMs: 0 });
  const persistence = persistFixtureClient(api, { storage, debounceMs: 50 });
  return { api, persistence };
};

const decideAurora = async (api: ReturnType<typeof createFixtureClient>) => {
  const detail = await api.getApproval(APPROVAL_AURORA);
  return api.decideApproval(APPROVAL_AURORA, { decision: "APPROVE", note: null, diffHash: detail.diffHash });
};

const auroraStatus = (api: ReturnType<typeof createFixtureClient>) =>
  api.store.approvals.find((row) => row.ref === APPROVAL_AURORA || row.id === APPROVAL_AURORA)?.status;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("persistFixtureClient", () => {
  it("serves the seed and writes nothing when nothing changed", async () => {
    const { api, persistence } = boot();
    expect(persistence.hydrated).toBe(false);
    await api.listApprovals({ page: { size: 10 } });
    await vi.runAllTimersAsync();
    expect(storage.writes).toBe(0);
    expect(api.store).toEqual(createStore());
  });

  it("saves after a mutation, once the quiet period passes", async () => {
    const { api } = boot();
    await decideAurora(api);
    expect(storage.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(storage.writes).toBe(1);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toContain('"format":1');
  });

  it("round-trips a decided approval across a reload", async () => {
    const first = boot();
    expect(auroraStatus(first.api)).toBe("PENDING");
    await decideAurora(first.api);
    await vi.runAllTimersAsync();

    const second = boot();
    expect(second.persistence.hydrated).toBe(true);
    expect(auroraStatus(second.api)).toBe("APPROVED");
    const inbox = await second.api.getApproval(APPROVAL_AURORA);
    expect(inbox.status).toBe("APPROVED");
  });

  it("rebuilds the Maps, and the rest of the store survives exactly", async () => {
    const first = boot();
    const response = await first.api.performAction(
      {
        type: "FOLLOWUP_SEND",
        targetRef: FOLLOW_UP_AURORA,
        payload: { channel: "WHATSAPP", templateId: TEMPLATE_FOLLOWUP_WHATSAPP },
        requestedBy: { kind: "AGENT", id: AGENT_FOLLOWUP, name: "Follow-up Agent" },
        confidence: 0.82,
        reasoning: "Proposal not opened since 13 September.",
      },
      { idempotencyKey: "persist-test-key" },
    );
    expect(response.status).toBe("SUGGESTED");
    await decideAurora(first.api);
    await vi.runAllTimersAsync();

    const second = boot();
    expect(second.api.store.drafts).toBeInstanceOf(Map);
    expect(second.api.store.idempotency).toBeInstanceOf(Map);
    expect(second.api.store.drafts.size).toBe(first.api.store.drafts.size);
    expect(second.api.store.idempotency.get("persist-test-key")).toEqual(
      first.api.store.idempotency.get("persist-test-key"),
    );
    expect(second.api.store).toEqual(first.api.store);
    expect(second.api.store.counters).toEqual(first.api.store.counters);
  });

  it("saves writes that bypass #write", async () => {
    const { api } = boot();
    const created = await api.createView({ label: "Mine", object: "ENQUIRY", filters: [], columns: [] });
    await vi.runAllTimersAsync();
    expect(boot().api.store.savedViews.some((view) => view.id === created.id)).toBe(true);

    await api.deleteView(created.id);
    await vi.runAllTimersAsync();
    expect(boot().api.store.savedViews.some((view) => view.id === created.id)).toBe(false);
  });

  it("flush saves immediately", async () => {
    const { api, persistence } = boot();
    await decideAurora(api);
    persistence.flush();
    expect(storage.writes).toBe(1);
  });

  it("discards a snapshot written against a different seed", async () => {
    const first = boot();
    await decideAurora(first.api);
    await vi.runAllTimersAsync();
    const raw = storage.getItem(DEMO_STORAGE_KEY) ?? "";
    storage.items.set(DEMO_STORAGE_KEY, raw.replace(/"seed":"[^"]*"/, '"seed":"stale"'));

    const second = boot();
    expect(second.persistence.hydrated).toBe(false);
    expect(auroraStatus(second.api)).toBe("PENDING");
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });

  it("discards a snapshot of a different format", () => {
    storage.items.set(DEMO_STORAGE_KEY, JSON.stringify({ format: 0, seed: "x", store: {} }));
    const { api, persistence } = boot();
    expect(persistence.hydrated).toBe(false);
    expect(api.store).toEqual(createStore());
  });

  it("falls back to the seed on corrupt JSON", () => {
    storage.items.set(DEMO_STORAGE_KEY, "{not json");
    const { api, persistence } = boot();
    expect(persistence.hydrated).toBe(false);
    expect(auroraStatus(api)).toBe("PENDING");
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });

  it("falls back to the seed when storage throws on every access", async () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const api = createFixtureClient({ latencyMs: 0 });
    const persistence = persistFixtureClient(api, { storage: hostile, debounceMs: 50 });
    expect(persistence.hydrated).toBe(false);
    const decision = await decideAurora(api);
    expect(decision.status).toBe("APPROVED");
    await vi.runAllTimersAsync();
    expect(() => persistence.flush()).not.toThrow();
    expect(() => persistence.clear()).not.toThrow();
  });

  it("is inert without storage", async () => {
    const api = createFixtureClient({ latencyMs: 0 });
    const persistence = persistFixtureClient(api, { storage: null });
    await decideAurora(api);
    expect(() => persistence.flush()).not.toThrow();
    expect(persistence.hydrated).toBe(false);
  });

  it("clear deletes the snapshot and stops a pending save", async () => {
    const first = boot();
    await decideAurora(first.api);
    await vi.runAllTimersAsync();
    expect(storage.getItem(DEMO_STORAGE_KEY)).not.toBeNull();

    await first.api.createView({ label: "Pending", object: "ENQUIRY", filters: [], columns: [] });
    first.persistence.clear();
    await vi.runAllTimersAsync();
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();

    const second = boot();
    expect(second.persistence.hydrated).toBe(false);
    expect(auroraStatus(second.api)).toBe("PENDING");
  });

  it("leaves the caller's promise and its rejection untouched", async () => {
    const { api } = boot();
    await expect(api.getApproval("APV-DOES-NOT-EXIST")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await vi.runAllTimersAsync();
    expect(storage.writes).toBe(0);
  });
});
