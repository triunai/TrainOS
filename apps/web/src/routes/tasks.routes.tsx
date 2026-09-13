import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { MY_TASKS_PATH } from "@/features/tasks";

/**
 * The tasks feature's routes — `/my-tasks`.
 *
 * `routes.tsx` spreads `FEATURE_ROUTES` before the generated placeholder list,
 * and React Router breaks a tie on identical paths by declaration order, so
 * declaring the path here is the whole wiring: the placeholder for `/my-tasks`
 * becomes unreachable and neither `navTree.ts` nor `routes.tsx` is touched.
 *
 * Lazy, like every other feature — the queue merges four reads and pulls the
 * table, the tab group and the record header with it.
 */

const MyTasksScreen = lazy(() =>
  import("@/features/tasks").then((module) => ({ default: module.MyTasksScreen })),
);

export const routes: RouteObject[] = [
  {
    path: MY_TASKS_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading your tasks" />}>
        <MyTasksScreen />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const tasksRoutes = routes;
