import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import { APPROVALS_PATH, APPROVAL_DETAIL_PATTERN } from "@/features/approvals";

/**
 * The approvals feature's route registrations — M02-S01, M02-S02.
 *
 * The scaffold's `routes.tsx` builds every nav path from `ALL_NAV_ROUTES` and
 * points it at `PlaceholderPage`. A real screen therefore has to be mounted
 * BEFORE that generated list, or the placeholder wins on the same path.
 *
 * Order matters inside this array: `/approvals` is declared before
 * `/approvals/:ref`, though in this case either order resolves — React Router
 * scores a static segment above a dynamic one. The order is kept anyway so the
 * file reads the same way as every other feature's.
 *
 * Both paths come from `@/features/approvals`, which derives them from the nav
 * tree's one path rule (CLAUDE.md R7). There is no path literal here.
 *
 * Lazy from the start, so an approval record pulls its own chunk.
 */

export interface FeatureRoute {
  /** Path exactly as the navigation rule derives it. */
  path: string;
  element: ReactElement;
  /** For a dev index and for error copy. A few words. */
  label: string;
}

const ApprovalInbox = lazy(() =>
  import("@/features/approvals").then((module) => ({ default: module.ApprovalInbox })),
);

const ApprovalDetail = lazy(() =>
  import("@/features/approvals").then((module) => ({ default: module.ApprovalDetail })),
);

export const approvalsRoutes: FeatureRoute[] = [
  {
    path: APPROVALS_PATH,
    label: "Approval inbox",
    element: (
      <Suspense fallback={<LoadingState label="Loading the approval inbox" />}>
        <ApprovalInbox />
      </Suspense>
    ),
  },
  {
    path: APPROVAL_DETAIL_PATTERN,
    label: "Approval detail",
    element: (
      <Suspense fallback={<LoadingState label="Loading the approval" />}>
        <ApprovalDetail />
      </Suspense>
    ),
  },
];
