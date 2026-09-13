import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { ASSESSMENTS_PATH } from "@/features/assessments";

/** The assessments register — `/training/assessments`. */

const AssessmentsScreen = lazy(() =>
  import("@/features/assessments").then((module) => ({ default: module.AssessmentsScreen })),
);

export const routes: RouteObject[] = [
  {
    path: ASSESSMENTS_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the evaluation register" />}>
        <AssessmentsScreen />
      </Suspense>
    ),
  },
];

export const assessmentsRoutes = routes;
