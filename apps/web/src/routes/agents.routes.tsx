import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import {
  AGENT_REGISTRY_PATH,
  AUTOMATION_FAILURES_PATH,
  AUTOMATION_POLICIES_PATH,
  RUNS_PATH,
  RUN_TRACE_PATH,
} from "@/features/agents";

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

const AutomationFailuresScreen = lazy(() =>
  import("@/features/agents").then((module) => ({ default: module.AutomationFailuresScreen })),
);

const AutomationPoliciesScreen = lazy(() =>
  import("@/features/agents").then((module) => ({ default: module.AutomationPoliciesScreen })),
);

export const routes: RouteObject[] = [
  {
    path: AGENT_REGISTRY_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the agent registry" />}>
        <AgentRegistryScreen />
      </Suspense>
    ),
  },
  {
    path: RUNS_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the most recent run" />}>
        <RunTraceScreen />
      </Suspense>
    ),
  },
  {
    path: RUN_TRACE_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the run trace" />}>
        <RunTraceScreen />
      </Suspense>
    ),
  },
  {
    path: AUTOMATION_FAILURES_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the failed runs" />}>
        <AutomationFailuresScreen />
      </Suspense>
    ),
  },
  {
    path: AUTOMATION_POLICIES_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the policies" />}>
        <AutomationPoliciesScreen />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const agentsRoutes = routes;
