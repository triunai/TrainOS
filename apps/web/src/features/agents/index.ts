/**
 * The `agents` feature's public surface — M18-S01 and M18-S04.
 *
 * Sibling features import from HERE and never from a path inside this folder;
 * that is the one rule `no-cross-feature-internals` enforces. Everything else
 * in this directory is internal and may move without a caller noticing.
 */

export { AgentRegistryScreen } from "./AgentRegistryScreen";
export { RunTraceScreen } from "./RunTraceScreen";
export {
  AGENT_REGISTRY_PATH,
  AUTOMATION_FAILURES_PATH,
  AUTOMATION_POLICIES_PATH,
  RUNS_PATH,
  RUN_TRACE_PATH,
  runTracePath,
} from "./paths";

/* M18-S07 and the policy gates. Their paths and their two extra reads now sit
   in `paths.ts` and `api.ts` with the rest of the feature's; the split pair
   existed only because several agents held this tree open at once. */
export { AutomationFailuresScreen } from "./AutomationFailuresScreen";
export { AutomationPoliciesScreen } from "./AutomationPoliciesScreen";
