"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { confirmTrainer, signVenueBeo } from "@/server/commercial";
import { DomainError } from "@/server/domain/errors";

/**
 * Stage 4 row actions on the Logistics tab: confirm a held trainer
 * (TENTATIVE_HOLD → CONFIRMED) and vault a vendor-signed BEO for a
 * provisional venue (PROVISIONAL → BEO_SIGNED). Lane B's services do the
 * checks (TTT verified and valid through the last day, venue only, not
 * cancelled); a refusal comes back as a domain error the button toasts.
 */
export async function confirmTrainerAction(engagementId: string) {
  return act(async () => {
    const confirmed = await confirmTrainer(engagementId, currentActor());
    return { status: confirmed.status };
  }, { message: "Trainer confirmed — the hold is now a booking (pay-when-paid)" });
}

export async function signVenueBeoAction(form: FormData) {
  return act(async () => {
    const commitmentId = String(form.get("commitmentId") ?? "");
    if (!commitmentId) throw new DomainError("COMMITMENT_REQUIRED", "No venue commitment selected");
    const file = form.get("beo");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("FILE_REQUIRED", "Attach the vendor-signed BEO");
    const reference = String(form.get("referenceNumber") ?? "").trim();
    const { commitment } = await signVenueBeo(
      commitmentId,
      { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, mimeType: file.type || undefined, referenceNumber: reference || null },
      currentActor(),
    );
    return { status: commitment.status, referenceNumber: commitment.referenceNumber };
  }, { message: "BEO signed and stored in the vault" });
}
