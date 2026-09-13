import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { CALENDAR_PATH } from "@/features/calendar";

/**
 * The calendar feature's routes — `/training/calendar`.
 *
 * Mounted before `ALL_NAV_ROUTES` in `routes.tsx`, so this entry wins the tie
 * against the generated placeholder and no nav edit is needed.
 */

const TrainingCalendarScreen = lazy(() =>
  import("@/features/calendar").then((module) => ({ default: module.TrainingCalendarScreen })),
);

export const routes: RouteObject[] = [
  {
    path: CALENDAR_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the training calendar" />}>
        <TrainingCalendarScreen />
      </Suspense>
    ),
  },
];

export const calendarRoutes = routes;
