import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { TNA_DETAIL_PATTERN, TNA_LIST_PATH } from "@/features/tna";

/**
 * The TNA feature's routes — M05-S02.
 *
 * The list and the record. A literal segment is declared ahead of the `:param`
 * that could otherwise swallow it, which is the rule every feature file here
 * follows.
 */

const TnaListPage = lazy(() =>
  import("@/features/tna").then((module) => ({ default: module.TnaListPage })),
);

const TnaDetailPage = lazy(() =>
  import("@/features/tna").then((module) => ({ default: module.TnaDetailPage })),
);

export const routes: RouteObject[] = [
  {
    path: TNA_LIST_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the needs analyses" />}>
        <TnaListPage />
      </Suspense>
    ),
  },
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
