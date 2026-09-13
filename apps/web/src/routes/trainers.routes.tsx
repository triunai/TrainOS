import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { TRAINERS_LIST_PATH, TRAINER_DETAIL_PATTERN } from "@/features/trainers";

/**
 * The trainers feature's routes — the pool list and the record.
 *
 * The literal list path is declared before the `:trainerRef` pattern, as every
 * feature here orders its own entries: a parameter segment that came first
 * would swallow the sibling it is nested under.
 */

const TrainersListPage = lazy(() =>
  import("@/features/trainers").then((module) => ({ default: module.TrainersListPage })),
);

const TrainerRecordPage = lazy(() =>
  import("@/features/trainers").then((module) => ({ default: module.TrainerRecordPage })),
);

export const routes: RouteObject[] = [
  {
    path: TRAINERS_LIST_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the trainer pool" />}>
        <TrainersListPage />
      </Suspense>
    ),
  },
  {
    path: TRAINER_DETAIL_PATTERN,
    element: (
      <Suspense fallback={<LoadingState label="Loading the trainer" />}>
        <TrainerRecordPage />
      </Suspense>
    ),
  },
];

export const trainersRoutes = routes;
