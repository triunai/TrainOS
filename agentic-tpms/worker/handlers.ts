import type { HandlerMap } from "../src/server/queue/registry";
import { handlers as operations } from "../src/server/operations/tasks";
import { handlers as certificates } from "../src/server/certificates";
import { handlers as assessments } from "../src/server/assessments";
import { handlers as claims } from "../src/server/claims/tasks";
import { handlers as finance } from "../src/server/finance/tasks";
import { handlers as retention } from "../src/server/retention/tasks";
import { handlers as commercial } from "../src/server/commercial/tasks";
import { handlers as ingestion } from "../src/server/ingestion/tasks";
import { handlers as outbound } from "../src/server/outbound/tasks";
import { handlers as attendance } from "../src/server/attendance/tasks";

/**
 * Every lane's task handlers, composed. The worker refuses to start if a task
 * type has no handler, so adding a type to TASK_TYPES without wiring it here
 * is caught at boot rather than by a task that silently never runs.
 */
export const allHandlers: HandlerMap = {
  ...operations,
  ...certificates,
  ...assessments,
  ...claims,
  ...finance,
  ...retention,
  ...commercial,
  ...ingestion,
  ...outbound,
  ...attendance,
};
