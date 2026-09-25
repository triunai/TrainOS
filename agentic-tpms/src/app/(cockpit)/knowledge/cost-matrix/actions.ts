"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { correctPolicyBands, publishPolicyVersion } from "@/server/pricing";

export interface BandInput {
  minPax: number;
  maxPax: number;
  dailyCap: number;
}

/** A revision is a new version with its own effective date; the version it revises is left exactly as it was. */
export async function publishVersionAction(fromId: string, input: { version: string; effectiveFrom: string; bands: BandInput[]; sourceNote?: string }) {
  return act(async () => {
    const created = await publishPolicyVersion(fromId, input, currentActor());
    return { id: created.id, version: created.version };
  }, { message: "New version published — it applies to quotes priced for dates from its effective date" });
}

/** Only while no quotation cites the version; the domain refuses otherwise. */
export async function correctBandsAction(id: string, bands: BandInput[]) {
  return act(async () => {
    const updated = await correctPolicyBands(id, bands, currentActor());
    return { id: updated.id, version: updated.version };
  }, { message: "Bands corrected in place — old and new values are in the audit ledger" });
}
