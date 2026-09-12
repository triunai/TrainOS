import { lazy, Suspense } from "react";
import { LoadingState } from "@/shared/components/states";
import { AI_MODELS_PATH, PROVIDERS_PATH, USAGE_PATH } from "@/features/settings-ai";
import type { FeatureRoute } from "./enquiries.routes";

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

export const settingsAiRoutes: FeatureRoute[] = [
  {
    path: AI_MODELS_PATH,
    label: "AI models",
    element: (
      <Suspense fallback={<LoadingState label="Loading tiers and routing" />}>
        <AiModelsScreen />
      </Suspense>
    ),
  },
  {
    path: PROVIDERS_PATH,
    label: "Provider keys",
    element: (
      <Suspense fallback={<LoadingState label="Loading provider keys" />}>
        <ProviderKeysScreen />
      </Suspense>
    ),
  },
  {
    path: USAGE_PATH,
    label: "Usage and budgets",
    element: (
      <Suspense fallback={<LoadingState label="Loading usage and budgets" />}>
        <UsageBudgetsScreen />
      </Suspense>
    ),
  },
];
