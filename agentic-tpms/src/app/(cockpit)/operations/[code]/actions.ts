"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";
import { packageIdByCode } from "@/server/packages/queries";
import {
  cancelPackage,
  completeDelivery,
  confirmReschedule,
  lockOperations,
  resolveViability,
  runT14Check,
  startDelivery,
  type ViabilityChoice,
} from "@/server/operations/viability";

async function idFor(code: string): Promise<string> {
  const id = await packageIdByCode(code);
  if (!id) throw new DomainError("PACKAGE_NOT_FOUND", `No package ${code}`);
  return id;
}

export async function lockOperationsAction(code: string) {
  return act(async () => void (await lockOperations(await idFor(code), currentActor())), { message: "Operations locked" });
}

export async function startDeliveryAction(code: string) {
  return act(async () => void (await startDelivery(await idFor(code), currentActor())), { message: "Delivery started" });
}

export async function completeDeliveryAction(code: string) {
  return act(async () => void (await completeDelivery(await idFor(code), currentActor())), { message: "Delivery verified and completed" });
}

export async function cancelPackageAction(code: string, reason?: string) {
  return act(async () => void (await cancelPackage(await idFor(code), reason ?? "", currentActor())), { message: "Package cancelled" });
}

export async function runT14NowAction(code: string) {
  return act(async () => {
    const id = await idFor(code);
    const result = await runT14Check(id, null);
    return result;
  }, { message: "Viability check ran" });
}

export async function resolveViabilityAction(code: string, choice: ViabilityChoice, newStartDate?: string, newEndDate?: string, note?: string) {
  return act(async () => resolveViability(await idFor(code), { choice, newStartDate, newEndDate, note }, currentActor()), {
    message: `Gate 2 resolved: ${choice.replace("_", " ").toLowerCase()}`,
  });
}

export async function confirmRescheduleAction(code: string, note?: string) {
  return act(async () => void (await confirmReschedule(await idFor(code), currentActor(), note)), { message: "Reschedule confirmed; T-14 re-armed" });
}
