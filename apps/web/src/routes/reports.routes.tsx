import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { REPORTS_PATH } from "@/features/reports";

/**
 * The reports feature's routes — `/reports`.
 *
 * One entry, and the path is exactly `/reports`: `Reports` is the nav tree's
 * only childless parent, and `navPath` puts such a parent at its own slug. A
 * nested path here would mount a screen the rail never links to.
 *
 * Declared before the generated placeholder list in `routes.tsx`, which is the
 * whole wiring — neither that file nor `navTree.ts` is touched.
 */

const ReportsScreen = lazy(() =>
  import("@/features/reports").then((module) => ({ default: module.ReportsScreen })),
);

export const routes: RouteObject[] = [
  {
    path: REPORTS_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the reports" />}>
        <ReportsScreen />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const reportsRoutes = routes;
