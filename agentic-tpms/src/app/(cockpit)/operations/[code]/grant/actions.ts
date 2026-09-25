"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";
import { compileDossier, confirmGrant, fileUpfrontClaim, flagApprovalLetter, recordApprovalLetter } from "@/server/grant";
import { packageIdByCode } from "@/server/packages/queries";

async function idFor(code: string) {
  const id = await packageIdByCode(code);
  if (!id) throw new DomainError("PACKAGE_NOT_FOUND", code);
  return id;
}

export async function uploadLetterAction(form: FormData) {
  return act(async () => {
    const file = form.get("letter");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("FILE_REQUIRED", "Attach the e-TRiS approval letter");
    await recordApprovalLetter(await idFor(String(form.get("code"))), new Uint8Array(await file.arrayBuffer()), file.type || "application/pdf", file.name, currentActor());
  }, { message: "Letter stored — L2 extraction queued; the verification form fills in when it returns" });
}

export async function confirmGrantAction(form: FormData) {
  return act(async () => {
    await confirmGrant(
      await idFor(String(form.get("code"))),
      {
        grantId: String(form.get("grantId") ?? ""),
        approvedAmount: String(form.get("approvedAmount") ?? ""),
        approvedPax: Number(form.get("approvedPax") ?? 0),
        startDate: (form.get("startDate") as string) || undefined,
        endDate: (form.get("endDate") as string) || undefined,
      },
      currentActor(),
    );
  }, { message: "Grant verified and locked — T-14 viability check scheduled" });
}

export async function flagLetterAction(code: string, vaultId: string, note?: string) {
  return act(async () => void (await flagApprovalLetter(await idFor(code), vaultId, note ?? "", currentActor())), { message: "Letter flagged" });
}

export async function upfrontClaimAction(code: string) {
  return act(async () => void (await fileUpfrontClaim(await idFor(code), currentActor())), { message: "30% upfront claim filed" });
}

export async function compileDossierAction(code: string) {
  return act(async () => {
    const r = await compileDossier(await idFor(code));
    return { files: r.files.length, missing: r.missing };
  }, { message: "e-TRiS support dossier compiled" });
}
