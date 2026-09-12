import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import { COSTING_WORKSHEET_PATTERN, PROPOSAL_BUILDER_PATTERN } from "@/features/proposals";

/**
 * The proposals feature's route registrations.
 *
 * Declared here and spread into `routes.tsx` by one line, so several screen
 * features can land at once without any of them editing the shared route
 * table. These must be mounted BEFORE the nav-generated routes, which point
 * every path at `PlaceholderPage`.
 *
 * The costing worksheet sits under `/finance/quotations/:ref` because that is
 * where the navigation tree puts quotations, even though Sales is its primary
 * user. One tree, one path.
 */

export interface FeatureRoute {
  path: string;
  element: ReactElement;
  label: string;
}

const ProposalBuilderPage = lazy(() =>
  import("@/features/proposals").then((module) => ({ default: module.ProposalBuilderPage })),
);

const CostingWorksheetPage = lazy(() =>
  import("@/features/proposals").then((module) => ({ default: module.CostingWorksheetPage })),
);

export const proposalsRoutes: FeatureRoute[] = [
  {
    path: PROPOSAL_BUILDER_PATTERN,
    label: "Proposal builder",
    element: (
      <Suspense fallback={<LoadingState label="Loading the proposal" />}>
        <ProposalBuilderPage />
      </Suspense>
    ),
  },
  {
    path: COSTING_WORKSHEET_PATTERN,
    label: "Costing worksheet",
    element: (
      <Suspense fallback={<LoadingState label="Loading the costing worksheet" />}>
        <CostingWorksheetPage />
      </Suspense>
    ),
  },
];
