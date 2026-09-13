import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `AuthPort` over supabase-js, with supabase-js itself mocked.
 *
 * Everything above this port is tested against an in-memory double; this is
 * the one file that proves the double describes calls the real library
 * receives — Google as the provider, this origin's callback as `redirectTo`,
 * PKCE on the client, and a sign-out scoped to this browser.
 */

const { auth, createClient } = vi.hoisted(() => {
  const auth = {
    initialize: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithOAuth: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(),
  };
  return { auth, createClient: vi.fn(() => ({ auth, schema: vi.fn() })) };
});

vi.mock("@supabase/supabase-js", () => ({ createClient }));

async function loadPort() {
  vi.resetModules();
  const module = await import("@/shared/api/auth");
  return module.getAuth();
}

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
  Object.values(auth).forEach((fn) => fn.mockReset());
  createClient.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("getAuth() over supabase-js", () => {
  it("creates the client for PKCE and starts Google OAuth with the given redirect", async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    const port = await loadPort();

    const outcome = await port.signInWithGoogle("http://localhost:5180/auth/callback");

    expect(outcome).toEqual({ error: null });
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "sb_publishable_x",
      expect.objectContaining({
        auth: expect.objectContaining({ flowType: "pkce", detectSessionInUrl: true }),
      }),
    );
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:5180/auth/callback" },
    });
  });

  it("reports the callback exchange's error from initialize(), without exchanging again", async () => {
    auth.initialize.mockResolvedValue({ error: { message: "invalid flow state" } });
    const port = await loadPort();

    expect(await port.ready()).toEqual({ error: "invalid flow state" });
    expect(auth.initialize).toHaveBeenCalledTimes(1);
  });

  it("maps the session user, and reports changes until unsubscribed", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "alex@example.my" } } },
      error: null,
    });
    const unsubscribe = vi.fn();
    let emit: (event: string, session: unknown) => void = () => undefined;
    auth.onAuthStateChange.mockImplementation((callback: typeof emit) => {
      emit = callback;
      return { data: { subscription: { unsubscribe } } };
    });
    const port = await loadPort();

    expect(await port.currentUser()).toEqual({ id: "u1", email: "alex@example.my" });

    const listener = vi.fn();
    const stop = port.onChange(listener);
    emit("SIGNED_OUT", null);
    emit("TOKEN_REFRESHED", { user: { id: "u1" } });
    stop();

    expect(listener.mock.calls).toEqual([[null], [{ id: "u1", email: null }]]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("signs out this browser only, and refreshes on request", async () => {
    auth.signOut.mockResolvedValue({ error: null });
    auth.refreshSession.mockResolvedValue({ data: {}, error: null });
    const port = await loadPort();

    expect(await port.signOut()).toEqual({ error: null });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(await port.refresh()).toEqual({ error: null });
  });

  it("turns a missing configuration into a readable error instead of a rejection", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const port = await loadPort();

    const outcome = await port.signInWithGoogle("http://localhost:5180/auth/callback");

    expect(outcome.error).toMatch(/Supabase is not configured/);
    expect(await port.currentUser()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});
