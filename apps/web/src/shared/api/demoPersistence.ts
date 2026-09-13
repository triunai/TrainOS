import { ROLES, type Role } from "@trainos/contract";
import {
  DEMO_STORAGE_KEY,
  fixtureClient,
  persistFixtureClient,
  type FixtureClient,
  type FixturePersistence,
  type StorageLike,
} from "@trainos/fixtures";

/**
 * The hosted demo's memory: what a visitor changes survives a reload, in THEIR
 * browser and nowhere else.
 *
 * Switched on once, from `main.tsx`, and only when the build mounts the fixture
 * client. Nothing else calls `enableDemoPersistence`, which is what keeps it
 * out of every test and out of Supabase mode entirely — in either, every
 * function below is a no-op and the role starts where it always did.
 *
 * The store itself is `@trainos/fixtures`' `persistFixtureClient`. This file
 * adds the three things only a browser page has: `window.localStorage` (whose
 * GETTER throws in some blocked-storage modes, so even reaching it is
 * wrapped), a `pagehide` flush so a reload inside the save debounce keeps the
 * last change, and the dev role toggle, which lives in React state rather
 * than in the client.
 */

export const DEMO_ROLE_KEY = `${DEMO_STORAGE_KEY}.role`;

let persistence: FixturePersistence | null = null;
let storage: StorageLike | null = null;

/** `window.localStorage`, or `null` where touching it throws. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Hydrates the fixture client from this browser and saves every change back. Idempotent. */
export function enableDemoPersistence(
  client: FixtureClient = fixtureClient,
  store: StorageLike | null = browserStorage(),
): void {
  if (persistence) return;
  storage = store;
  const attached = persistFixtureClient(client, { storage: store });
  persistence = attached;
  if (typeof window !== "undefined") window.addEventListener("pagehide", () => attached.flush());
}

/** Whether this page keeps demo changes — the reset control renders only when it does. */
export function isDemoPersistenceEnabled(): boolean {
  return persistence !== null;
}

/** Forgets every demo change in this browser and reloads onto the seed data. */
export function resetDemoData(reload: () => void = () => window.location.reload()): void {
  persistence?.clear();
  try {
    storage?.removeItem(DEMO_ROLE_KEY);
  } catch {
    /* Storage refused; the reload still serves the seed store. */
  }
  reload();
}

/** The role the dev toggle last chose in this browser, or `null`. */
export function readDemoRole(): Role | null {
  if (!persistence || !storage) return null;
  try {
    const raw = storage.getItem(DEMO_ROLE_KEY);
    return ROLES.find((role) => role === raw) ?? null;
  } catch {
    return null;
  }
}

export function writeDemoRole(role: Role): void {
  if (!persistence || !storage) return;
  try {
    storage.setItem(DEMO_ROLE_KEY, role);
  } catch {
    /* Storage refused. The toggle still works for this session. */
  }
}
