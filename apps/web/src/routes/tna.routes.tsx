import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { TNA_DETAIL_PATTERN } from "@/features/tna";

/**
 * The TNA feature's routes — M05-S02.
 *
 * Only the record route is claimed. `/sales/tna` keeps the generated
 * placeholder until a TNA list screen exists.
 */

const TnaDetailPage = lazy(() =>
  import("@/features/tna").then((module) => ({ default: module.TnaDetailPage })),
);

export const routes: RouteObject[] = [
  {
    path: TNA_DETAIL_PATTERN,
    element: (
      <Suspense fallback={<LoadingState label="Loading the TNA" />}>
        <TnaDetailPage />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const tnaRoutes = routes;
