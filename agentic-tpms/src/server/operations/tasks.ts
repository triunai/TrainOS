import { eq } from "drizzle-orm";
import { db, schema, SYSTEM_ACTOR } from "../db/client";
import { DomainError } from "../domain/errors";
import type { HandlerMap } from "../queue/registry";
import { expireHolds, runT14Check, startDelivery } from "./viability";

export const handlers: HandlerMap = {
  "viability.t14_check": async (task) => {
    const { packageId, startDate } = task.payload as { packageId: string; startDate?: string };
    return runT14Check(packageId, startDate ?? null, task.id);
  },

  /** Day 1, 07:00 MYT. Stale if the package moved on or was rescheduled. */
  "delivery.start": async (task) => {
    const { packageId } = task.payload as { packageId: string };
    const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
    if (!pkg) return { skipped: "PACKAGE_NOT_FOUND" };
    if (pkg.operationalStage !== "READY_FOR_EVENT") return { skipped: `STAGE_${pkg.operationalStage}` };
    try {
      await startDelivery(packageId, SYSTEM_ACTOR);
      return { started: true };
    } catch (error) {
      if (error instanceof DomainError && error.code === "GUARD_FAILED") return { skipped: "GUARD_FAILED", reason: error.message };
      throw error;
    }
  },

  "system.expire_holds": async () => expireHolds(),
};
