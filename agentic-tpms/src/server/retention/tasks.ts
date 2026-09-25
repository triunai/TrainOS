import { z } from "zod";
import { DomainError } from "../domain/errors";
import type { HandlerMap } from "../queue/registry";
import { packagePayload } from "../claims/tasks";
import { runRetention } from "./run";
import { scheduleRetention } from "./schedule";

const SchedulePayload = z.object({ scheduleId: z.string().uuid() });

export const handlers: HandlerMap = {
  "retention.schedule": async (task) => {
    const { packageId } = packagePayload(task.payload, "retention.schedule");
    return { ...(await scheduleRetention(packageId)) };
  },
  "retention.run": async (task) => {
    const parsed = SchedulePayload.safeParse(task.payload);
    if (!parsed.success) throw new DomainError("BAD_PAYLOAD", "retention.run needs { scheduleId: uuid }");
    return { ...(await runRetention(parsed.data.scheduleId, { taskId: task.id })) };
  },
};
