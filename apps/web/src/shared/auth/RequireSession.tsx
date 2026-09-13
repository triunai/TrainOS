import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { useAuth } from "./authContext";
import { signInHref } from "./returnPath";

/**
 * The route guard: no session, no app.
 *
 * It wraps the ELEMENT of the layout route every screen sits under, as
 * `routes.tsx` always said a guard would, so there is no list of protected
 * paths to keep in step with the navigation tree.
 *
 * It decides "is anyone signed in", never "may they see this". Role and tenant
 * are the database's to enforce; this only stops an anonymous browser from
 * calling RPCs that can only refuse it.
 *
 * Fixtures mode has no session (`useAuth()` is `null`) and passes straight
 * through.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth === null) return <>{children}</>;

  if (auth.session.status === "loading") {
    return (
      <div className="min-h-dvh bg-canvas">
        <LoadingState label="Checking your session" />
      </div>
    );
  }

  if (auth.session.status === "signedOut") {
    return (
      <Navigate to={signInHref(`${location.pathname}${location.search}${location.hash}`)} replace />
    );
  }

  return <>{children}</>;
}
