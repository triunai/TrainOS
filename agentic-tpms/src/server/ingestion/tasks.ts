import { z } from "zod";
import { DomainError } from "@/server/domain/errors";
import type { HandlerMap } from "@/server/queue/registry";
import { sendMicroTna } from "./microTna";
import { triageLead } from "./triage";

/**
 * Queue handlers for Stage 1 intake. Both are idempotent: a lead already
 * routed is skipped by triage, and a micro-TNA already sent is not re-sent.
 */
const leadPayload = z.object({ leadId: z.string().uuid() });

function leadIdOf(payload: unknown, type: string): string {
  const parsed = leadPayload.safeParse(payload);
  if (!parsed.success) throw new DomainError("TASK_PAYLOAD_INVALID", `${type} needs {leadId: uuid}`);
  return parsed.data.leadId;
}

export const handlers: HandlerMap = {
  "lead.triage": async (task) => ({ ...(await triageLead(leadIdOf(task.payload, task.taskType), { taskId: task.id })) }),
  "lead.whatsapp_micro_tna": async (task) => ({ ...(await sendMicroTna(leadIdOf(task.payload, task.taskType), { taskId: task.id })) }),
};
