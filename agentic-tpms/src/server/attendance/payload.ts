import type { ZodType } from "zod";
import { DomainError } from "../domain/errors";

/**
 * A task payload that fails its schema will fail the same way on every
 * retry, so it is a refusal (dead-letter now), not a transport error.
 */
export function parsePayload<T>(schema: ZodType<T>, payload: unknown, taskType: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ");
    throw new DomainError("INVALID_TASK_PAYLOAD", `${taskType}: ${issues}`);
  }
  return parsed.data;
}
