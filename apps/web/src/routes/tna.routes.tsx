import { lazy, Suspense } from "react";
import { LoadingState } from "@/shared/components/states";
import { TNA_DETAIL_PATTERN } from "@/features/tna";
import type { FeatureRoute } from "./enquiries.routes";

/**
 * The TNA feature's route registrations — M05-S02.
 *
 * Only the record route is claimed. `/sales/tna` keeps the generated
 * placeholder until a TNA list screen exists.
 */

const TnaDetailPage = lazy(() =>
  import("@/features/tna").then((module) => ({ default: module.TnaDetailPage })),
);

export const tnaRoutes: FeatureRoute[] = [
  {
    path: TNA_DETAIL_PATTERN,
    label: "TNA detail",
    element: (
      <Suspense fallback={<LoadingState label="Loading the TNA" />}>
        <TnaDetailPage />
      </Suspense>
    ),
  },
];
