import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { ORGANISATIONS_LIST_PATH, ORGANISATION_DETAIL_PATTERN } from "@/features/organisations";

/**
 * The organisations feature's routes — M04-S02.
 *
 * The directory and the record. The list is declared FIRST: React Router scores
 * `/sales/organisations` and `/sales/organisations/:organisationId` differently
 * so the order is not load-bearing here, but keeping a literal segment ahead of
 * the param that could swallow it is the rule every feature file follows.
 */

const OrganisationsListPage = lazy(() =>
  import("@/features/organisations").then((module) => ({
    default: module.OrganisationsListPage,
  })),
);

const Organisation360Page = lazy(() =>
  import("@/features/organisations").then((module) => ({ default: module.Organisation360Page })),
);

export const routes: RouteObject[] = [
  {
    path: ORGANISATIONS_LIST_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the organisation directory" />}>
        <OrganisationsListPage />
      </Suspense>
    ),
  },
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
