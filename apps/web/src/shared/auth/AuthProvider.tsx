import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiMode, getAuth, type AuthPort, type AuthUser } from "@/shared/api";
import { AuthContext, type AuthContextValue, type SessionState } from "./authContext";
import { callbackUrl, rememberReturnPath } from "./returnPath";

/**
 * The session: who the AUTH server says is signed in, in supabase mode only.
 *
 * This is not identity. `useMe()` still owns name, role and tenant, and those
 * come from `core.me()` once a session exists — a signed-in Google account with
 * no membership is a real, valid session that `me` then refuses. Keeping the
 * two apart is what lets the app say "you are signed in, and not linked to a
 * workspace" instead of collapsing both into "sign-in failed".
 *
 * FIXTURES MODE HAS NO SESSION, and the context is `null` there rather than a
 * pretend signed-in user. Every consumer checks for `null` and does exactly
 * what it did before this file existed, which is what keeps the fixture app and
 * its 1,100 tests unchanged.
 */

export interface AuthProviderProps {
  children: ReactNode;
  /** Injectable for tests. Defaults to the Supabase-backed port. */
  port?: AuthPort;
}

export function AuthProvider({ children, port }: AuthProviderProps) {
  if (apiMode() !== "supabase") return <>{children}</>;
  return <SessionProvider port={port}>{children}</SessionProvider>;
}

function SessionProvider({ children, port: injected }: { children: ReactNode; port?: AuthPort }) {
  /* Resolved once. A fresh port per render would re-subscribe the effect
     below on every render, and the subscription's own first report renders. */
  const port = useMemo(() => injected ?? getAuth(), [injected]);
  const queryClient = useQueryClient();
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const holder = useRef<string | null>(null);

  const apply = useCallback(
    (user: AuthUser | null) => {
      /* The query cache is keyed by query, not by principal. When the person
         changes — signed out, or a different account signed in — every cached
         answer belongs to somebody else and has to go before anything renders
         from it. A token refresh for the SAME person keeps the cache. */
      const next = user?.id ?? null;
      if (holder.current !== null && holder.current !== next) queryClient.clear();
      holder.current = next;
      setSession(user === null ? { status: "signedOut" } : { status: "signedIn", user });
    },
    [queryClient],
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = port.onChange((user) => {
      if (active) apply(user);
    });
    /* `onChange` also reports the restored session, but not on every version
       of supabase-js and not before the first paint; asking once as well means
       a reload never waits on an event that might not come. */
    void port.currentUser().then((user) => {
      if (active) apply(user);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [port, apply]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      signInWithGoogle: (returnTo) => {
        rememberReturnPath(returnTo);
        return port.signInWithGoogle(callbackUrl());
      },
      completeSignIn: async () => {
        const { error } = await port.ready();
        if (error !== null) return { error, user: null };
        return { error: null, user: await port.currentUser() };
      },
      refresh: () => port.refresh(),
      signOut: async () => {
        const result = await port.signOut();
        /* Settle locally as well as through `onChange`, so the guard sends the
           reader to sign-in even if the event is late or the server call
           failed after the local session was already cleared. */
        if (result.error === null) apply(null);
        return result;
      },
    }),
    [session, port, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
