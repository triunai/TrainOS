import { navPath } from "@/shared/config/nav";

/**
 * The two Automation paths added on 13 Sep, derived from the nav tree's rule.
 *
 * Same note as `automationApi.ts`: these belong in `paths.ts` beside the agent
 * and run paths and are only separate because several agents were working this
 * feature at once. Nothing here is a string literal, so a rename in
 * `navTree.ts` still moves the rail entry and the route together.
 * TODO(consolidation): fold into `paths.ts` once the tree is quiet.
 */

/** `/automation/failures` — M18-S07, the dead-letter list. */
export const AUTOMATION_FAILURES_PATH = navPath("Automation", "Failures");

/** `/automation/policies` — the gates, and what is queued against them. */
export const AUTOMATION_POLICIES_PATH = navPath("Automation", "Policies");
