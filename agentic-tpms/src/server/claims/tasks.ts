import { z } from "zod";
import { DomainError } from "../domain/errors";
import type { HandlerMap } from "../queue/registry";
import { collateClaim } from "./collate";

const PackagePayload = z.object({ packageId: z.string().uuid() });

/** A malformed payload can never succeed on retry: refuse it (dead-lettered immediately). */
export function packagePayload(payload: unknown, taskType: string): { packageId: string } {
  const parsed = PackagePayload.safeParse(payload);
  if (!parsed.success) throw new DomainError("BAD_PAYLOAD", `${taskType} needs { packageId: uuid }`);
  return parsed.data;
}

export const handlers: HandlerMap = {
  "claims.collate": async (task) => {
    const { packageId } = packagePayload(task.payload, "claims.collate");
    return { ...(await collateClaim(packageId, { taskId: task.id })) };
  },
};
