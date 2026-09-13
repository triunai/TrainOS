import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { PIPELINE_BOARD_PATH } from "@/features/pipeline";

/** Sales › Pipeline. One route; the generated placeholder stops rendering. */

const PipelineBoardPage = lazy(() =>
  import("@/features/pipeline").then((module) => ({ default: module.PipelineBoardPage })),
);

export const routes: RouteObject[] = [
  {
    path: PIPELINE_BOARD_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the pipeline" />}>
        <PipelineBoardPage />
      </Suspense>
    ),
  },
];

export const pipelineRoutes = routes;
