import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { COMPLIANCE_DEADLINES_PATH, COMPLIANCE_DOCUMENTS_PATH } from "@/features/compliance";

/**
 * The compliance registers — `/compliance/documents` and
 * `/compliance/deadlines`.
 *
 * `features/hrdc` keeps its own routes file; these are a separate feature and
 * so are these entries. Neither file touches the other.
 */

const ComplianceDocumentsScreen = lazy(() =>
  import("@/features/compliance").then((module) => ({
    default: module.ComplianceDocumentsScreen,
  })),
);

const ComplianceDeadlinesScreen = lazy(() =>
  import("@/features/compliance").then((module) => ({
    default: module.ComplianceDeadlinesScreen,
  })),
);

export const routes: RouteObject[] = [
  {
    path: COMPLIANCE_DOCUMENTS_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the claim documents" />}>
        <ComplianceDocumentsScreen />
      </Suspense>
    ),
  },
  {
    path: COMPLIANCE_DEADLINES_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the claim deadlines" />}>
        <ComplianceDeadlinesScreen />
      </Suspense>
    ),
  },
];

export const complianceRoutes = routes;
