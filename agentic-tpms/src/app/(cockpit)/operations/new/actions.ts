"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { createClient, createPackageDirect, type ClientInput, type PackageFields } from "@/server/ingestion";

/**
 * The form sends what the operator typed; the domain's zod schemas decide
 * (an unknown delivery mode or account type is a visible refusal, R2/R14),
 * so the vocabulary is not re-validated here.
 */
export async function createPackageAction(input: {
  clientId: string;
  title: string;
  deliveryMode: string;
  startDate: string | null;
  endDate: string | null;
  pax: number;
  minParticipants?: number;
  courseId: string | null;
  venueByClient: boolean;
  draftProposal: boolean;
}) {
  const result = await act(async () => {
    const created = await createPackageDirect({ ...input, deliveryMode: input.deliveryMode as PackageFields["deliveryMode"] }, currentActor());
    return { code: created.package.packageCode, proposalQueued: Boolean(created.proposalTaskId) };
  }, { message: "Package created in DRAFT — the L3 sourcing agent is queued to draft the proposal" });
  if (result.ok && !result.data.proposalQueued) result.message = `${result.data.code} created in DRAFT — no proposal draft requested`;
  return result;
}

export async function createClientAction(input: Omit<ClientInput, "accountType"> & { accountType: string }) {
  return act(async () => {
    const client = await createClient({ ...input, accountType: input.accountType as ClientInput["accountType"] }, currentActor());
    return { id: client.id, companyName: client.companyName };
  }, { message: "Client created and selected" });
}
