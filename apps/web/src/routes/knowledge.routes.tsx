import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import { KNOWLEDGE_SOURCES_PATH } from "@/features/knowledge";

/**
 * The knowledge feature's route registration — M16-S05.
 *
 * One screen today. The rest of the Knowledge nav group (Library, Templates,
 * Knowledge base) keeps its generated placeholder until somebody builds it,
 * which is what the placeholder is for.
 */

const KnowledgeSourcesScreen = lazy(() =>
  import("@/features/knowledge").then((module) => ({ default: module.KnowledgeSourcesScreen })),
);

export const routes: RouteObject[] = [
  {
    path: KNOWLEDGE_SOURCES_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading knowledge sources" />}>
        <KnowledgeSourcesScreen />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const knowledgeRoutes = routes;
