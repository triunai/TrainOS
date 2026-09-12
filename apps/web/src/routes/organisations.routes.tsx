import { lazy, Suspense } from "react";
import { LoadingState } from "@/shared/components/states";
import { ORGANISATION_DETAIL_PATTERN } from "@/features/organisations";
import type { FeatureRoute } from "./enquiries.routes";

/**
 * The organisations feature's route registrations — M04-S02.
 *
 * Only the record route is claimed here. `/sales/organisations` keeps the
 * scaffold's generated placeholder until a list screen exists, so nothing
 * pretends to be finished that is not.
 */

const Organisation360Page = lazy(() =>
  import("@/features/organisations").then((module) => ({ default: module.Organisation360Page })),
);

export const organisationsRoutes: FeatureRoute[] = [
  {
    path: ORGANISATION_DETAIL_PATTERN,
    label: "Organisation 360",
    element: (
      <Suspense fallback={<LoadingState label="Loading the organisation" />}>
        <Organisation360Page />
      </Suspense>
    ),
  },
];
