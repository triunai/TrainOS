"use server";

import { act } from "@/server/actions";
import { addProviderKey, disableProviderKey, testProviderKey, updateTierConfig, type TierKey } from "@/server/ai";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";

export async function addKeyAction(form: FormData) {
  return act(async () => {
    const tiers = form.getAll("tiers").map(String);
    const view = await addProviderKey(
      {
        provider: String(form.get("provider")) as never,
        label: String(form.get("label") ?? ""),
        key: String(form.get("key") ?? ""),
        baseUrl: (form.get("baseUrl") as string) || null,
        tiers: tiers as never,
        monthlyCapMyr: (form.get("monthlyCapMyr") as string) || null,
      },
      currentActor(),
    );
    return { id: view.id, masked: view.maskedKey };
  }, { message: "Key stored encrypted (AES-256-GCM); only the masked form is ever shown" });
}

export async function testKeyAction(id: string) {
  return act(async () => {
    const result = await testProviderKey(id, currentActor());
    if (!result.ok) throw new DomainError("KEY_TEST_FAILED", `${result.message}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ""}`);
    return result;
  }, { message: "Connection OK" });
}

export async function disableKeyAction(id: string) {
  return act(async () => void (await disableProviderKey(id, currentActor())), { message: "Key disabled; the tier falls back down its chain" });
}

export async function updateTierAction(form: FormData) {
  return act(async () => {
    const tier = String(form.get("tier")) as TierKey;
    await updateTierConfig(
      tier,
      {
        provider: String(form.get("provider")) as never,
        model: String(form.get("model") ?? ""),
        monthlyCapMyr: String(form.get("monthlyCapMyr") ?? "0"),
        maxTokens: Number(form.get("maxTokens") ?? 1024),
        enabled: form.get("enabled") === "on",
      } as never,
      currentActor(),
    );
  }, { message: "Tier routing updated" });
}
