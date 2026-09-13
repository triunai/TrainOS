import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Me, Role } from "@trainos/contract";
import {
  apiMode,
  defaultClient,
  isDomainError,
  isRetryable,
  queryKeys,
  readableMessage,
  toApiError,
  type ApiError,
} from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { AuthShell, GhostButton, LoadingState, PrimaryButton } from "@/shared/components/kit";
import { FIXTURE_ME, MeContext, type MeContextValue } from "./useMe";

/**
 * The principal, from wherever this build's identity actually lives.
 *
 * FIXTURES: the fixture principal and the development role switch, exactly as
 * before. Deliberately NOT a query — a fixture pretending to be a fetch would
 * hide that there is no session behind it.
 *
 * SUPABASE: `core.me()` for the signed-in session (018), fetched once the
 * session exists and keyed by the auth user, so a different account never reads
 * the previous one's `Me`. Nothing below this provider renders until `me` has
 * answered, because every consumer reads `me.role` synchronously and a
 * placeholder principal would paint the wrong rail for a frame.
 */
export interface MeProviderProps {
  children: ReactNode;
  /**
   * Supabase mode: what a signed-in account with no workspace sees. Passed in
   * rather than drawn here because it is a page, and `shared` does not import
   * pages. Falls back to a plain account-shell message when absent.
   */
  unlinked?: ReactNode;
  /** Injectable for tests. Defaults to the mounted client's `getMe()`. */
  loadMe?: () => Promise<Me>;
}

export function MeProvider({ children, unlinked, loadMe }: MeProviderProps) {
  if (apiMode() !== "supabase") return <FixtureMeProvider>{children}</FixtureMeProvider>;
  return (
    <SessionMeProvider unlinked={unlinked} loadMe={loadMe}>
      {children}
    </SessionMeProvider>
  );
}

function FixtureMeProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>(FIXTURE_ME.role);

  const value = useMemo<MeContextValue>(() => ({ me: { ...FIXTURE_ME, role }, setRole }), [role]);

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

/**
 * "Signed in, but not in a workspace", from `core.me()`'s own refusals.
 *
 * Matched on CODE, never on message text, and each branch names the SQL that
 * produces it:
 *
 * - `UNAUTHENTICATED` — SQLSTATE 42501. `core.me()` starts with
 *   `app.require_tenant_id()` (002), which raises `insufficient_privilege` when
 *   the JWT carries no `tenant_id`. The access-token hook writes a null tenant
 *   for an account with no ACTIVE membership in an ACTIVE tenant
 *   (`app.principal_claims`, 002), so this is the no-membership case. It is
 *   also what an expired token looks like (PGRST301), which "Check again" —
 *   a token refresh — resolves either way.
 * - `FORBIDDEN` with `reason` `NO_MEMBERSHIP` or `NO_APP_ROLE` — the token
 *   still names a tenant the membership row no longer backs (018 `core.me`).
 *
 * Any other refusal is NOT this state. A `FORBIDDEN` for some other reason is
 * the database saying something new, and it is shown as an error with its own
 * message rather than guessed into "not linked" (R14).
 */
function isUnlinked(error: ApiError): boolean {
  if (isDomainError(error)) {
    const reason = error.details?.reason;
    return error.code === "FORBIDDEN" && (reason === "NO_MEMBERSHIP" || reason === "NO_APP_ROLE");
  }
  return error.code === "UNAUTHENTICATED";
}

function SessionMeProvider({
  children,
  unlinked,
  loadMe,
}: {
  children: ReactNode;
  unlinked?: ReactNode;
  loadMe?: () => Promise<Me>;
}) {
  const auth = useAuth();
  const userId = auth?.session.status === "signedIn" ? auth.session.user.id : null;

  const query = useQuery<Me, ApiError>({
    queryKey: [...queryKeys.me, "session", userId] as const,
    queryFn: () =>
      (loadMe ?? (() => defaultClient.getMe()))().catch((thrown) =>
        Promise.reject(toApiError(thrown)),
      ),
    enabled: userId !== null,
    /* Identity does not go stale on a timer. It changes when the token does,
       and every path that changes the token invalidates this key. */
    staleTime: Infinity,
  });

  /* No setRole: the role is the session's. See `MeContextValue.setRole`. */
  const value = useMemo<MeContextValue | null>(
    () => (query.data === undefined ? null : { me: query.data }),
    [query.data],
  );

  if (value !== null) return <MeContext.Provider value={value}>{children}</MeContext.Provider>;

  if (query.error) {
    if (isUnlinked(query.error)) {
      return (
        <>
          {unlinked ?? (
            <AuthShell
              title="Your account isn't linked to a workspace yet"
              description="Ask your TrainOS administrator to add you."
            />
          )}
        </>
      );
    }

    const error = query.error;
    return (
      <AuthShell title="We couldn't load your account" description={readableMessage(error)}>
        <div className="flex flex-col gap-2">
          {isRetryable(error) ? (
            <PrimaryButton className="w-full" onClick={() => void query.refetch()}>
              Try again
            </PrimaryButton>
          ) : null}
          {auth ? (
            <GhostButton className="w-full" onClick={() => void auth.signOut()}>
              Sign out
            </GhostButton>
          ) : null}
        </div>
      </AuthShell>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <LoadingState label="Loading your workspace" />
    </div>
  );
}
