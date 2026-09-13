/**
 * Browser persistence for the fixture client — the hosted demo's memory.
 *
 * Opt-in and additive: nothing here runs unless a caller hands a client to
 * `persistFixtureClient`, so the tests and the shared singleton behave exactly
 * as before. The web app attaches it at boot in fixtures mode only.
 *
 * ── WHY A WRAPPER AND NOT A HOOK INSIDE THE CLIENT ────────────────────────
 *
 * The store mutates from a hundred-odd methods, many of them outside `#write`
 * (`deleteView`, `putAiRouting`, every `Object.assign` on a looked-up row).
 * Threading a "changed" call through each one is the refactor this avoids.
 * Instead every public method on the instance is wrapped, and a debounced save
 * runs once the call settles — resolved OR rejected, because a refusal can
 * land after a partial write (`accountingWebhook` records its key first). The
 * save serialises the store and skips the write when the string is unchanged,
 * which makes reads free apart from one ~1ms stringify per quiet period.
 *
 * The wrappers are OWN properties on the instance, so `keyof FixtureClient`
 * and the web's `ApiClient` mapped type are untouched.
 *
 * ── WHAT A SAVED SNAPSHOT MUST SURVIVE ───────────────────────────────────
 *
 * - A new deploy with different seed data or a different store shape: the
 *   snapshot carries a fingerprint of the fresh seed store, and a mismatch
 *   discards it. `FORMAT` is the manual lever for a change in how the client
 *   interprets stored rows that leaves the seed identical.
 * - Corrupt JSON, a missing key, storage that throws on access (Safari private
 *   mode), a full quota: every one falls back to the seed and carries on. The
 *   demo must never fail to render because of storage.
 * - The two `Map`s: JSON has no Map, so they are written as entry arrays and
 *   rebuilt. Every other store value is JSON by construction (`store.ts`).
 */

import type { ActionDraft } from "@trainos/contract";
import type { FixtureClient } from "./FixtureClient";
import { createStore, type FixtureStore, type IdempotencyRecord } from "./store";

/** The subset of `Storage` this needs, so a test can hand in a plain object. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEMO_STORAGE_KEY = "trainos.demo.v1";

/** Bump when the client reads stored rows differently but the seed is unchanged. */
const FORMAT = 1;

interface Snapshot {
  format: number;
  seed: string;
  store: Record<string, unknown>;
}

export interface PersistFixtureClientOptions {
  /** `null` when the environment has no usable storage — the handle is then inert. */
  storage: StorageLike | null;
  key?: string;
  /** Quiet period before a save. Default 250ms. */
  debounceMs?: number;
}

export interface FixturePersistence {
  /** Whether a saved snapshot was applied at attach time. */
  readonly hydrated: boolean;
  /** Save now, cancelling any pending save. Call on `pagehide`. */
  flush(): void;
  /** Cancel any pending save, delete the snapshot, and stop saving. */
  clear(): void;
}

const serialiseStore = (store: FixtureStore): string =>
  JSON.stringify({
    ...store,
    drafts: [...store.drafts.entries()],
    idempotency: [...store.idempotency.entries()],
  });

/** FNV-1a, 32-bit. A change detector for the seed, not a security boundary. */
const fingerprint = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}.${(hash >>> 0).toString(36)}`;
};

let seedFingerprint: string | undefined;
/** Computed once per page: a fresh store costs ~2ms to build and ~1ms to stringify. */
export const currentSeedFingerprint = (): string =>
  (seedFingerprint ??= fingerprint(serialiseStore(createStore())));

/**
 * Rebuilds a store from a snapshot, or `undefined` if the snapshot is not one
 * this build wrote. Every top-level key of a fresh store must be present —
 * the fingerprint already covers the shape, this is the belt to its braces.
 */
const restoreStore = (raw: string): FixtureStore | undefined => {
  const parsed = JSON.parse(raw) as Partial<Snapshot> | null;
  if (!parsed || parsed.format !== FORMAT || parsed.seed !== currentSeedFingerprint()) return undefined;
  const saved = parsed.store;
  if (!saved || typeof saved !== "object") return undefined;
  const fresh = createStore();
  if (!Object.keys(fresh).every((key) => key in saved)) return undefined;
  if (!Array.isArray(saved.drafts) || !Array.isArray(saved.idempotency)) return undefined;
  return {
    ...(saved as unknown as FixtureStore),
    drafts: new Map(saved.drafts as [string, ActionDraft][]),
    idempotency: new Map(saved.idempotency as [string, IdempotencyRecord][]),
  };
};

const INERT: FixturePersistence = { hydrated: false, flush: () => undefined, clear: () => undefined };

/**
 * Hydrates `client` from `storage` and saves it back after every call.
 *
 * Attach before the first read. Never throws.
 */
export function persistFixtureClient(
  client: FixtureClient,
  { storage, key = DEMO_STORAGE_KEY, debounceMs = 250 }: PersistFixtureClientOptions,
): FixturePersistence {
  if (!storage) return INERT;

  let hydrated = false;
  try {
    const raw = storage.getItem(key);
    if (raw !== null) {
      const restored = restoreStore(raw);
      if (restored) {
        Object.assign(client.store, restored);
        hydrated = true;
      } else {
        storage.removeItem(key);
      }
    }
  } catch {
    /* Corrupt JSON or storage refused. Seed data it is; try to drop the bad
       snapshot so the next load does not pay for the same parse. */
    try {
      storage.removeItem(key);
    } catch {
      /* Storage is unusable altogether; saves below will fail quietly too. */
    }
  }

  let lastSaved: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const save = (): void => {
    timer = undefined;
    if (stopped) return;
    try {
      const store = serialiseStore(client.store);
      if (store === lastSaved) return;
      const snapshot = `{"format":${FORMAT},"seed":${JSON.stringify(currentSeedFingerprint())},"store":${store}}`;
      storage.setItem(key, snapshot);
      lastSaved = store;
    } catch {
      /* Quota or storage refused. The previous snapshot, if any, is still a
         whole one; the session carries on in memory. */
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(save, debounceMs);
  };

  /* Whatever the store holds at attach time is either the snapshot just read
     or the seed, and neither needs writing: a visitor who only reads never
     costs a 300KB write, and a hydrated boot does not rewrite what it loaded. */
  try {
    lastSaved = serialiseStore(client.store);
  } catch {
    lastSaved = undefined;
  }

  const prototype = Object.getPrototypeOf(client) as object;
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor || typeof descriptor.value !== "function") continue;
    const method = descriptor.value as (...args: unknown[]) => unknown;
    Object.defineProperty(client, name, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]): unknown => {
        let result: unknown;
        try {
          result = method.apply(client, args);
        } catch (error) {
          schedule();
          throw error;
        }
        if (result instanceof Promise) {
          /* Observe without re-throwing: the caller still gets the original
             promise, and this branch cannot become an unhandled rejection. */
          result.then(schedule, schedule);
        } else {
          schedule();
        }
        return result;
      },
    });
  }

  return {
    hydrated,
    flush: () => {
      if (timer !== undefined) clearTimeout(timer);
      save();
    },
    clear: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      try {
        storage.removeItem(key);
      } catch {
        /* Nothing saved can be read back either, so seed is what loads. */
      }
    },
  };
}
