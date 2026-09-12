import { navPath } from "@/shared/config/nav";

/**
 * Route paths for the three §17 settings screens, derived from the nav tree's
 * own rule rather than written out. Rename a child in `navTree.ts` and the rail
 * entry and the route move together.
 */

/** `/settings/ai-models` — M20-S20. */
export const AI_MODELS_PATH = navPath("Settings", "AI Models");

/** `/settings/providers` — M20-S21. */
export const PROVIDERS_PATH = navPath("Settings", "Providers");

/** `/settings/usage` — M20-S16. */
export const USAGE_PATH = navPath("Settings", "Usage");
