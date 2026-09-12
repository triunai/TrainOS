import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import { PORTAL_PROPOSAL_PATTERN } from "@/features/portal";

/**
 * PUBLIC routes. Everything here mounts as a SIBLING of the `AppShell` route,
 * never inside it.
 *
 * M07-S07 is the pack's one external screen: `ExternalMinimalShell` draws its
 * own 56px bar, and nesting it in the app shell would put a sidebar, a search
 * field and a notification bell in front of a client who has no account.
 *
 * No role guard, by design — the signed, expiring token IS the authorization
 * and the server decides whether it is still valid. A revoked token surfaces as
 * a domain refusal on the page rather than a redirect to a login the client
 * does not have.
 *
 * The array shape matches `<feature>.routes.tsx` so `routes.tsx` spreads it the
 * same way; the only difference is WHERE it is spread. Another public screen
 * adds an entry here rather than a second mount point.
 */

export interface PublicRoute {
  path: string;
  element: ReactElement;
  /** A few words, for a dev index and for error copy. */
  label: string;
}

const ClientProposalPage = lazy(() =>
  import("@/features/portal").then((module) => ({ default: module.ClientProposalPage })),
);

export const portalRoutes: PublicRoute[] = [
  {
    path: PORTAL_PROPOSAL_PATTERN,
    label: "Client proposal",
    element: (
      <Suspense fallback={<LoadingState label="Loading your proposal" />}>
        <ClientProposalPage />
      </Suspense>
    ),
  },
];
