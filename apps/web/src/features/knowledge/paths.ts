import { navPath } from "@/shared/config/nav";

/** `/knowledge/sources` — M16-S05. Derived from the nav tree, not written out. */
export const KNOWLEDGE_SOURCES_PATH = navPath("Knowledge", "Sources");

/** `/knowledge/library` — the content library. No artboard; see the screen. */
export const KNOWLEDGE_LIBRARY_PATH = navPath("Knowledge", "Library");

/** `/knowledge/templates` — §2 `GET /v1/templates`. */
export const KNOWLEDGE_TEMPLATES_PATH = navPath("Knowledge", "Templates");

/** `/knowledge/knowledge-base` — corpus coverage, not a second source list. */
export const KNOWLEDGE_BASE_PATH = navPath("Knowledge", "Knowledge base");
