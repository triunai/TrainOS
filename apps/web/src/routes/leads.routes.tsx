import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { LEADS_QUEUE_PATH } from "@/features/leads";

/**
 * Sales › Leads. One route, claiming the nav leaf the generated placeholder
 * held — feature routes are spread BEFORE the generated ones in `routes.tsx`,
 * so mounting this is the whole change and no nav file moves.
 */

const LeadsQueuePage = lazy(() =>
  import("@/features/leads").then((module) => ({ default: module.LeadsQueuePage })),
);

export const routes: RouteObject[] = [
  {
    path: LEADS_QUEUE_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the lead queue" />}>
        <LeadsQueuePage />
      </Suspense>
    ),
  },
];

export const leadsRoutes = routes;
