import { lazy, Suspense } from "react";
import { LoadingState } from "@/shared/components/states";
import { AGENT_REGISTRY_PATH, RUNS_PATH, RUN_TRACE_PATH } from "@/features/agents";
import type { FeatureRoute } from "./enquiries.routes";

/**
 * The agents feature's route registrations — M18-S01 and M18-S04.
 *
 * `routes.tsx` builds every nav path from `ALL_NAV_ROUTES` and points it at
 * `PlaceholderPage`, so a real screen has to be declared BEFORE that generated
 * list or the placeholder wins the tie on the same path.
 *
 * Order inside this array matters for the same reason it does elsewhere:
 * `/automation/runs` is declared before `/automation/runs/:runRef` so the bare
 * path resolves to the most recent run rather than being read as a run whose
 * reference is the empty string.
 *
 * Both run paths mount the same screen. The trace viewer carries its own run
 * rail, so "the newest run" and "this particular run" are the same view with a
 * different selection, not two screens.
 *
 * Lazy, so the trace viewer's tree, state card and event log pull their own
 * chunk rather than riding in the registry's.
 */

const AgentRegistryScreen = lazy(() =>
  import("@/features/agents").then((module) => ({ default: module.AgentRegistryScreen })),
);

const RunTraceScreen = lazy(() =>
  import("@/features/agents").then((module) => ({ default: module.RunTraceScreen })),
);

export const agentsRoutes: FeatureRoute[] = [
  {
    path: AGENT_REGISTRY_PATH,
    label: "Agent registry",
    element: (
      <Suspense fallback={<LoadingState label="Loading the agent registry" />}>
        <AgentRegistryScreen />
      </Suspense>
    ),
  },
  {
    path: RUNS_PATH,
    label: "Runs",
    element: (
      <Suspense fallback={<LoadingState label="Loading the most recent run" />}>
        <RunTraceScreen />
      </Suspense>
    ),
  },
  {
    path: RUN_TRACE_PATH,
    label: "Run trace",
    element: (
      <Suspense fallback={<LoadingState label="Loading the run trace" />}>
        <RunTraceScreen />
      </Suspense>
    ),
  },
];
