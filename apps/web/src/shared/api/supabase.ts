import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one supabase-js client, created lazily.
 *
 * LAZY IS THE LOAD-BEARING PART. `VITE_API_MODE` defaults to `fixtures`, and
 * the fixture build has no Supabase project — `createClient` with an empty URL
 * throws at MODULE LOAD, which would take the whole app down at import time
 * rather than at the first call that actually needs a database. Creating it on
 * first use means the fixture app boots with these variables absent, and the
 * one place that cares is the one place that fails.
 *
 * A SECOND CLIENT ON THE SAME STORAGE KEY IS UNDEFINED BEHAVIOUR. Two
 * GoTrueClient instances over one localStorage entry race each other on token
 * refresh and can sign a session out mid-flight, so nothing outside this module
 * may call `createClient`. That is also why `storageKey` is left defaulted:
 * overriding it renames the stored session and signs out every operator on the
 * deploy that changes it.
 */

/** `fixtures` is the in-memory oracle; `supabase` is the real database. */
export type ApiMode = "fixtures" | "supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * Which client the seam mounts. Unset means fixtures.
 *
 * The default is deliberately the safe one: a build that forgets the variable
 * serves the demo dataset rather than pointing a half-configured app at a real
 * tenant's data.
 */
export function apiMode(): ApiMode {
  return import.meta.env.VITE_API_MODE === "supabase" ? "supabase" : "fixtures";
}

/** Both variables present, so `getSupabase()` can succeed. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;
}

let cached: SupabaseClient | null = null;

/**
 * The module singleton. Throws only if asked for without configuration.
 *
 * Three auth options, each for a stated reason:
 *
 * - `flowType: "pkce"` — auth-js still defaults to `implicit`, which returns the
 *   access token in the URL fragment where it lands in history and in any
 *   referrer. PKCE returns a code that is exchanged server-side.
 * - `detectSessionInUrl: true` — the only thing that exchanges `?code=` for a
 *   session on the callback route. Without it PKCE never completes.
 * - `persistSession: true` — PKCE writes the `code_verifier` to storage BEFORE
 *   the redirect; with persistence off the verifier is gone when the user comes
 *   back and every sign-in fails at the exchange.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and " +
        "VITE_SUPABASE_PUBLISHABLE_KEY, or leave VITE_API_MODE unset to run on fixtures.",
    );
  }
  cached = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return cached;
}

/**
 * Replace the singleton. Tests only.
 *
 * The conformance suite drives the RPC client against a mocked transport, and
 * a mock has to be installed before the first call rather than injected at
 * every call site — otherwise the production path and the tested path are two
 * different code paths and the suite proves nothing about the first.
 */
export function __setSupabaseForTests(client: SupabaseClient | null): void {
  cached = client;
}
