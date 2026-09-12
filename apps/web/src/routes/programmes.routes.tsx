import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import { PROGRAMMES_LIST_PATH, PROGRAMME_DETAIL_PATTERN } from "@/features/programmes";

/**
 * The programmes feature's route registrations.
 *
 * The scaffold's `routes.tsx` builds every nav path from `ALL_NAV_ROUTES` and
 * points it at `PlaceholderPage`. A real screen therefore has to be mounted
 * BEFORE that generated list, or the placeholder wins on the same path.
 *
 * This file only declares the routes; one line in `routes.tsx` spreads them in.
 * Keeping the declaration here is what lets several screen features land at
 * once without any of them touching the shared route table.
 *
 * Lazy from the start: a programme record pulls its own chunk and nothing else
 * pays for it.
 */

export interface FeatureRoute {
  /** Path exactly as the navigation rule derives it. */
  path: string;
  element: ReactElement;
  /** For a dev index and for error copy. A few words. */
  label: string;
}

const ProgrammesListPage = lazy(() =>
  import("@/features/programmes").then((module) => ({ default: module.ProgrammesListPage })),
);

const ProgrammeDetailPage = lazy(() =>
  import("@/features/programmes").then((module) => ({ default: module.ProgrammeDetailPage })),
);

export const programmesRoutes: FeatureRoute[] = [
  {
    path: PROGRAMMES_LIST_PATH,
    label: "Programmes",
    element: (
      <Suspense fallback={<LoadingState label="Loading programmes" />}>
        <ProgrammesListPage />
      </Suspense>
    ),
  },
  {
    path: PROGRAMME_DETAIL_PATTERN,
    label: "Programme detail",
    element: (
      <Suspense fallback={<LoadingState label="Loading the programme" />}>
        <ProgrammeDetailPage />
      </Suspense>
    ),
  },
];
