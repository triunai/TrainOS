import { z } from "zod";
import { DomainError } from "@/server/domain/errors";
import type { HandlerMap } from "@/server/queue/registry";
import { SEQUENCE_STEPS, type SequenceStep } from "./harvey";
import { dispatchBatch, draftSequence } from "./service";

/**
 * Queue handlers for the outbound lane. A malformed payload is a DomainError
 * (dead-lettered at once), because retrying it cannot make it well-formed.
 */
const dispatchPayload = z.object({
  batchId: z.string().uuid(),
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
});

const draftPayload = z.object({
  targets: z.array(z.record(z.unknown())).min(1),
  campaignNote: z.string().optional(),
  requestedBy: z.object({ type: z.literal("USER"), id: z.string().min(1) }),
});

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, payload: unknown, type: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new DomainError("TASK_PAYLOAD_INVALID", `${type}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}

export const handlers: HandlerMap = {
  "outbound.dispatch_batch": async (task) => {
    const { batchId, step } = parse(dispatchPayload, task.payload, task.taskType);
    if (!SEQUENCE_STEPS.includes(step as SequenceStep)) throw new DomainError("UNKNOWN_SEQUENCE_STEP", `step ${step}`);
    return { ...(await dispatchBatch(batchId, step as SequenceStep)) };
  },
  /** Large lists are drafted off the request path; the requesting operator stays the drafter of record. */
  "outbound.draft_sequence": async (task) => {
    const { targets, campaignNote, requestedBy } = parse(draftPayload, task.payload, task.taskType);
    const result = await draftSequence(
      { targets: targets as unknown as Parameters<typeof draftSequence>[0]["targets"], campaignNote },
      requestedBy,
    );
    return { ...result };
  },
};
