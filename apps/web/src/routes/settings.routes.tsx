import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import {
  SETTINGS_ORGANISATION_PATH,
  SETTINGS_POLICIES_PATH,
  SETTINGS_TEMPLATES_PATH,
} from "@/features/settings";

/**
 * The settings feature's routes — the three Settings leaves that are not about
 * AI operations. `settings-ai.routes.tsx` owns `/settings/ai-models`,
 * `/settings/providers` and `/settings/usage`; the two files share a nav parent
 * and nothing else.
 *
 * Declared before the generated placeholder list in `routes.tsx`, which is the
 * whole wiring — neither that file nor `navTree.ts` is touched.
 */

const OrganisationSettingsScreen = lazy(() =>
  import("@/features/settings").then((module) => ({ default: module.OrganisationSettingsScreen })),
);

const TemplatesSettingsScreen = lazy(() =>
  import("@/features/settings").then((module) => ({ default: module.TemplatesSettingsScreen })),
);

const PoliciesSettingsScreen = lazy(() =>
  import("@/features/settings").then((module) => ({ default: module.PoliciesSettingsScreen })),
);

export const routes: RouteObject[] = [
  {
    path: SETTINGS_ORGANISATION_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the organisation settings" />}>
        <OrganisationSettingsScreen />
      </Suspense>
    ),
  },
  {
    path: SETTINGS_TEMPLATES_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the templates" />}>
        <TemplatesSettingsScreen />
      </Suspense>
    ),
  },
  {
    path: SETTINGS_POLICIES_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the policies" />}>
        <PoliciesSettingsScreen />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const settingsRoutes = routes;
