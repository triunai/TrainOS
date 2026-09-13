import { createContext, useContext } from "react";
import type { AuthOutcome, AuthUser } from "@/shared/api";

/*
 * The session context, apart from its provider so the provider file exports
 * only a component (fast refresh). See `AuthProvider.tsx` for what a session is
 * and is not.
 */

export type SessionState =
  { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; user: AuthUser };

export interface AuthContextValue {
  session: SessionState;
  /** Start the Google round trip. `returnTo` is where to land afterwards. */
  signInWithGoogle: (returnTo: string | null) => Promise<AuthOutcome>;
  /** Waits for supabase-js to finish the callback exchange; see `AuthPort.ready`. */
  completeSignIn: () => Promise<AuthOutcome & { user: AuthUser | null }>;
  /** Re-mint the access token so new membership claims take effect. */
  refresh: () => Promise<AuthOutcome>;
  signOut: () => Promise<AuthOutcome>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** `null` in fixtures mode. Never throws: most consumers render either way. */
export function useAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
