import { z } from "zod";
import { DomainError } from "../domain/errors";
import type { HandlerMap } from "../queue/registry";
import { issueCertificates } from "./issue";

/**
 * `certificates.issue` is enqueued by the FSM service when a package reaches
 * DELIVERY_COMPLETED (idempotency key `certs:<packageId>`). A malformed
 * payload or NOT_DELIVERED is a DomainError, so the worker dead-letters it
 * instead of retrying a refusal.
 */
const payloadSchema = z.object({ packageId: z.string().uuid() });

export const handlers: HandlerMap = {
  "certificates.issue": async (task) => {
    const parsed = payloadSchema.safeParse(task.payload);
    if (!parsed.success) throw new DomainError("INVALID_TASK_PAYLOAD", "certificates.issue needs { packageId: uuid }");
    const result = await issueCertificates(parsed.data.packageId, { taskId: task.id });
    return { issued: result.issued.length, skipped: result.skipped.length, serials: result.issued };
  },
};
