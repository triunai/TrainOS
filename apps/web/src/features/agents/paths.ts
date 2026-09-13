import { navPath } from "@/shared/config/nav";

/**
 * The feature's route paths, derived from the nav tree's own rule.
 *
 * `navPath` is the single place a URL is built (`shared/config/nav.ts`), so
 * these cannot drift from the sidebar: rename "Agents" in `navTree.ts` and both
 * the rail entry and this path move together. Nothing here is a string literal
 * for that reason.
 */

/** `/automation/agents` — M18-S01. */
export const AGENT_REGISTRY_PATH = navPath("Automation", "Agents");

/** `/automation/runs` — M18-S04, showing the most recent run. */
export const RUNS_PATH = navPath("Automation", "Runs");

/** `/automation/runs/:runRef` — M18-S04 for one run. */
export const RUN_TRACE_PATH = `${RUNS_PATH}/:runRef`;

/** The route for one run, by its id or its `#4821` business ref. */
export function runTracePath(runRef: string): string {
  return `${RUNS_PATH}/${encodeURIComponent(runRef)}`;
}

/** `/automation/failures` — M18-S07, the dead-letter list. */
export const AUTOMATION_FAILURES_PATH = navPath("Automation", "Failures");

/** `/automation/policies` — the gates, and what is queued against them. */
export const AUTOMATION_POLICIES_PATH = navPath("Automation", "Policies");
