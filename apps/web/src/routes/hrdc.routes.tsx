import { lazy, Suspense, type ReactElement } from "react";
import { LoadingState } from "@/shared/components/states";
import {
  HRDC_PACKET_PATH,
  HRDC_PACKET_PATTERN,
  HRDC_RULES_PATH,
  HRDC_RULE_CHANGES_PATH,
  HRDC_RULE_CHANGE_PATTERN,
} from "@/features/hrdc";

/**
 * The HRD Corp feature's route registrations — M12-S02, M12-S07, M12-S08.
 *
 * `routes.tsx` builds every nav path from `ALL_NAV_ROUTES` and points it at
 * `PlaceholderPage`, so a real screen has to be mounted BEFORE that generated
 * list or the placeholder wins on the same path. `FEATURE_ROUTES` there does
 * exactly that; this array only has to be added to it.
 *
 * Order matters inside the array: the bare leaf is declared before its
 * `/:param` sibling so a record pattern cannot swallow the leaf it hangs from.
 *
 * Lazy from the start, so the compliance screens and the rules registry stay
 * out of the entry chunk for everyone who never opens them.
 */

export interface FeatureRoute {
  /** Path exactly as the navigation rule derives it. */
  path: string;
  element: ReactElement;
  /** For a dev index and for error copy. A few words. */
  label: string;
}

const ClaimPacketPage = lazy(() =>
  import("@/features/hrdc").then((module) => ({ default: module.ClaimPacketPage })),
);

const RulesRegistryScreen = lazy(() =>
  import("@/features/hrdc").then((module) => ({ default: module.RulesRegistryScreen })),
);

const RuleChangeReviewPage = lazy(() =>
  import("@/features/hrdc").then((module) => ({ default: module.RuleChangeReviewPage })),
);

export const hrdcRoutes: FeatureRoute[] = [
  {
    path: HRDC_PACKET_PATH,
    label: "Claim packet",
    element: (
      <Suspense fallback={<LoadingState label="Loading the claim packet" />}>
        <ClaimPacketPage />
      </Suspense>
    ),
  },
  {
    path: HRDC_PACKET_PATTERN,
    label: "Claim packet",
    element: (
      <Suspense fallback={<LoadingState label="Loading the claim packet" />}>
        <ClaimPacketPage />
      </Suspense>
    ),
  },
  {
    path: HRDC_RULES_PATH,
    label: "Rules registry",
    element: (
      <Suspense fallback={<LoadingState label="Loading the rules registry" />}>
        <RulesRegistryScreen />
      </Suspense>
    ),
  },
  {
    path: HRDC_RULE_CHANGES_PATH,
    label: "Rule change review",
    element: (
      <Suspense fallback={<LoadingState label="Loading the rule changes" />}>
        <RuleChangeReviewPage />
      </Suspense>
    ),
  },
  {
    path: HRDC_RULE_CHANGE_PATTERN,
    label: "Rule change review",
    element: (
      <Suspense fallback={<LoadingState label="Loading the rule changes" />}>
        <RuleChangeReviewPage />
      </Suspense>
    ),
  },
];
