import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { LoadingState } from "@/shared/components/states";
import {
  KNOWLEDGE_BASE_PATH,
  KNOWLEDGE_LIBRARY_PATH,
  KNOWLEDGE_SOURCES_PATH,
  KNOWLEDGE_TEMPLATES_PATH,
} from "@/features/knowledge";

/**
 * The knowledge feature's route registration — M16-S05.
 *
 * All four Knowledge leaves. Sources is M16-S05; the other three have no
 * artboard and are composed under the tightening brief §18, which is written
 * about Sources and says in its last line that it governs every control-panel
 * screen.
 */

const KnowledgeSourcesScreen = lazy(() =>
  import("@/features/knowledge").then((module) => ({ default: module.KnowledgeSourcesScreen })),
);

const LibraryScreen = lazy(() =>
  import("@/features/knowledge").then((module) => ({ default: module.LibraryScreen })),
);

const TemplatesScreen = lazy(() =>
  import("@/features/knowledge").then((module) => ({ default: module.TemplatesScreen })),
);

const KnowledgeBaseScreen = lazy(() =>
  import("@/features/knowledge").then((module) => ({ default: module.KnowledgeBaseScreen })),
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
  {
    path: KNOWLEDGE_LIBRARY_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the content library" />}>
        <LibraryScreen />
      </Suspense>
    ),
  },
  {
    path: KNOWLEDGE_TEMPLATES_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the templates" />}>
        <TemplatesScreen />
      </Suspense>
    ),
  },
  {
    path: KNOWLEDGE_BASE_PATH,
    element: (
      <Suspense fallback={<LoadingState label="Loading the corpus" />}>
        <KnowledgeBaseScreen />
      </Suspense>
    ),
  },
];

/** The name `routes.tsx` imports today. Same array — see enquiries.routes.tsx. */
export const knowledgeRoutes = routes;
