import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import { DASHBOARD_PATH } from "@/features/dashboard";

/**
 * The dashboard feature's route registration — M01-S01.
 *
 * The scaffold's `routes.tsx` builds every nav path from `ALL_NAV_ROUTES` and
 * points it at `PlaceholderPage`. A real screen therefore has to be mounted
 * BEFORE that generated list, or the placeholder wins on the same path.
 *
 * `/dashboard` is also `DEFAULT_ROUTE_PATH`, where `/` redirects, so this is
 * the first real screen anyone sees.
 *
 * M22-S04, the demo index, is NOT here. It is a development surface and
 * registers itself through `routes/dev.routes.tsx`, which is aliased away
 * entirely in a production build.
 *
 * Lazy, so the dashboard and its reports stay out of the initial chunk.
 */

export interface FeatureRoute {
  /** Path exactly as the navigation rule derives it. */
  path: string;
  element: ReactElement;
  /** For a dev index and for error copy. A few words. */
  label: string;
}

const ExecutiveDashboard = lazy(() =>
  import("@/features/dashboard").then((module) => ({ default: module.ExecutiveDashboard })),
);

export const dashboardRoutes: FeatureRoute[] = [
  {
    path: DASHBOARD_PATH,
    label: "Executive dashboard",
    element: (
      <Suspense fallback={<LoadingState label="Loading the dashboard" />}>
        <ExecutiveDashboard />
      </Suspense>
    ),
  },
];
