import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { AI_MODELS_PATH, PROVIDERS_PATH, USAGE_PATH } from "@/features/settings-ai";

/**
 * The settings-ai feature's route registrations — M20-S20, M20-S21, M20-S16.
 *
 * Three sibling settings screens with no nesting between them: each is a leaf
 * under Settings in the nav tree, and each links to the other two rather than
 * owning them. Declared before the generated placeholder list, per `routes.tsx`.
 */

const AiModelsScreen = lazy(() =>
  import("@/features/settings-ai").then((module) => ({ default: module.AiModelsScreen })),
);

const ProviderKeysScreen = lazy(() =>
  import("@/features/settings-ai").then((module) => ({ default: module.ProviderKeysScreen })),
);

const UsageBudgetsScreen = lazy(() =>
  import("@/features/settings-ai").then((module) => ({ default: module.UsageBudgetsScreen })),
);

export const routes: RouteObject[] = [
  {
    path: AI_MODELS_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading tiers and routing" />}>
        <AiModelsScreen />
      </Suspense>
    ),
  },
  {
    path: PROVIDERS_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading provider keys" />}>
        <ProviderKeysScreen />
      </Suspense>
    ),
  },
  {
    path: USAGE_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading usage and budgets" />}>
        <UsageBudgetsScreen />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const settingsAiRoutes = routes;
