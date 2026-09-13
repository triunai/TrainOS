/**
 * The `agents` feature's public surface — M18-S01 and M18-S04.
 *
 * Sibling features import from HERE and never from a path inside this folder;
 * that is the one rule `no-cross-feature-internals` enforces. Everything else
 * in this directory is internal and may move without a caller noticing.
 */

export { AgentRegistryScreen } from "./AgentRegistryScreen";
export { RunTraceScreen } from "./RunTraceScreen";
export { AGENT_REGISTRY_PATH, RUNS_PATH, RUN_TRACE_PATH, runTracePath } from "./paths";

/* M18-S07 and the policy gates, added 13 Sep. Their paths live in
   `automationPaths.ts` and their two extra reads in `automationApi.ts` rather
   than in `paths.ts` and `api.ts`, because several agents were working this
   feature at once — see the note at the top of each. The barrel is still the
   one public surface, which is what matters to a caller. */
export { AutomationFailuresScreen } from "./AutomationFailuresScreen";
export { AutomationPoliciesScreen } from "./AutomationPoliciesScreen";
export { AUTOMATION_FAILURES_PATH, AUTOMATION_POLICIES_PATH } from "./automationPaths";
