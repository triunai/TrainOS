import { getSupabase } from "./supabase";

/**
 * The narrow auth port the session layer talks to.
 *
 * WHY A PORT AND NOT `supabase.auth`. The same reason `transport.ts` exists:
 * `supabase.ts` is the only module allowed to hold a supabase-js client, and
 * everything above `shared/api` reads identity through a shape a test can
 * satisfy without a cast. The session provider, the guard and the pages never
 * learn which auth server is behind this.
 *
 * Only what the app does is declared. There is no password, OTP or magic-link
 * method on purpose: Google is the one live sign-in method, and a method on the
 * port is an invitation to build a screen for it.
 *
 * Errors come back as a readable string or `null`, never thrown. Every caller
 * renders the failure on an account screen, so an exception would only be
 * caught and flattened to the same string one frame later.
 */

/** The signed-in person, as far as the AUTH server knows them. Not `Me`. */
export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthOutcome {
  error: string | null;
}

export interface AuthPort {
  /**
   * Resolves once supabase-js has finished starting: read the stored session,
   * and — on the callback URL — exchanged `?code=` for one. The `error` is the
   * exchange's, which is the only place a failed Google round trip surfaces.
   */
  ready(): Promise<AuthOutcome>;
  /** The stored session's user, or `null` when nobody is signed in. */
  currentUser(): Promise<AuthUser | null>;
  /** Every sign-in, sign-out and token refresh. Returns the unsubscribe. */
  onChange(listener: (user: AuthUser | null) => void): () => void;
  /** Leaves the page for Google. Resolves only if the redirect could not start. */
  signInWithGoogle(redirectTo: string): Promise<AuthOutcome>;
  /**
   * A new access token NOW, rather than at the next automatic refresh.
   *
   * The tenant and role are JWT claims written by the access-token hook at
   * issue time (002 `app.custom_access_token_hook`), so a membership created
   * after sign-in is invisible until the token is re-minted.
   */
  refresh(): Promise<AuthOutcome>;
  /** This browser only. Other devices keep their sessions. */
  signOut(): Promise<AuthOutcome>;
}

type SupabaseAuth = ReturnType<typeof getSupabase>["auth"];

function userOf(user: { id: string; email?: string | null } | null | undefined): AuthUser | null {
  return user ? { id: user.id, email: user.email ?? null } : null;
}

const outcome = (error: { message: string } | null): AuthOutcome => ({
  error: error === null ? null : error.message,
});

/**
 * PKCE, exchanged by supabase-js itself.
 *
 * `supabase.ts` creates the client with `flowType: "pkce"` and
 * `detectSessionInUrl: true`, so `initialize()` finds `?code=` on the callback
 * URL, exchanges it and strips it from the address bar. Calling
 * `exchangeCodeForSession` again here would spend the same single-use code a
 * second time and fail every sign-in; `ready()` awaits the exchange that
 * already happened and reports its result instead.
 */
function fromSupabase(auth: () => SupabaseAuth): AuthPort {
  /* `getSupabase()` throws when the build has no URL or key. Caught per call so
     an unconfigured supabase-mode build lands on the sign-in screen with that
     sentence under the button, rather than on an unhandled rejection and a
     screen that never leaves "loading". */
  const attempt = async (run: () => Promise<AuthOutcome>): Promise<AuthOutcome> => {
    try {
      return await run();
    } catch (thrown) {
      return { error: thrown instanceof Error ? thrown.message : "Sign-in is unavailable." };
    }
  };

  return {
    ready: () => attempt(async () => outcome((await auth().initialize()).error)),
    currentUser: async () => {
      try {
        const { data } = await auth().getSession();
        return userOf(data.session?.user);
      } catch {
        return null;
      }
    },
    onChange: (listener) => {
      try {
        const { data } = auth().onAuthStateChange((_event, session) => {
          listener(userOf(session?.user));
        });
        return () => data.subscription.unsubscribe();
      } catch {
        return () => undefined;
      }
    },
    signInWithGoogle: (redirectTo) =>
      attempt(async () => {
        const { error } = await auth().signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        return outcome(error);
      }),
    refresh: () => attempt(async () => outcome((await auth().refreshSession()).error)),
    signOut: () => attempt(async () => outcome((await auth().signOut({ scope: "local" })).error)),
  };
}

let override: AuthPort | null = null;

/** The port the session layer uses. Throws only if Supabase is unconfigured. */
export function getAuth(): AuthPort {
  return override ?? fromSupabase(() => getSupabase().auth);
}

/** Install a test double. Tests only — the same shape as `__setTransportForTests`. */
export function __setAuthForTests(port: AuthPort | null): void {
  override = port;
}
