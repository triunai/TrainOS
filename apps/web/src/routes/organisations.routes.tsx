import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { ORGANISATION_DETAIL_PATTERN } from "@/features/organisations";

/**
 * The organisations feature's routes — M04-S02.
 *
 * Only the record route is claimed. `/sales/organisations` keeps the generated
 * placeholder until a list screen exists, so nothing pretends to be finished
 * that is not.
 */

const Organisation360Page = lazy(() =>
  import("@/features/organisations").then((module) => ({ default: module.Organisation360Page })),
);

export const routes: RouteObject[] = [
  {
    path: ORGANISATION_DETAIL_PATTERN,
    element: (
      <Suspense fallback={<LoadingState label="Loading the organisation" />}>
        <Organisation360Page />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const organisationsRoutes = routes;
