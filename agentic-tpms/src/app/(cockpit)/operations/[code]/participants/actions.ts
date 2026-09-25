"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";
import { packageIdByCode } from "@/server/packages/queries";
import { addParticipant, importParticipantsCsv, setRegistrationStatus } from "@/server/participants/service";

async function idFor(code: string) {
  const id = await packageIdByCode(code);
  if (!id) throw new DomainError("PACKAGE_NOT_FOUND", code);
  return id;
}

export async function addParticipantAction(form: FormData) {
  return act(async () => {
    const id = await idFor(String(form.get("code")));
    await addParticipant(
      id,
      {
        fullName: String(form.get("fullName") ?? ""),
        nric: String(form.get("nric") ?? ""),
        workEmail: (form.get("workEmail") as string) || null,
        phone: (form.get("phone") as string) || null,
        dietaryPreference: (form.get("dietaryPreference") as string) || null,
        confirmed: form.get("confirmed") === "on",
      },
      currentActor(),
    );
  }, { message: "Participant registered (NRIC encrypted and masked)" });
}

export async function importCsvAction(form: FormData) {
  return act(async () => {
    const id = await idFor(String(form.get("code")));
    const file = form.get("file");
    const text = file instanceof File && file.size > 0 ? await file.text() : String(form.get("csv") ?? "");
    const results = await importParticipantsCsv(id, text, currentActor());
    const bad = results.filter((r) => !r.ok);
    if (bad.length && bad.length === results.length) throw new DomainError("CSV_ALL_REJECTED", bad.map((b) => `line ${b.line}: ${b.error}`).join(" · "));
    return { imported: results.length - bad.length, rejected: bad.map((b) => `line ${b.line}: ${b.error}`) };
  }, { message: "Import finished — see the roster" });
}

export async function setStatusAction(participantId: string, status: "CONFIRMED" | "WITHDRAWN" | "REGISTERED") {
  return act(async () => setRegistrationStatus(participantId, status, currentActor()), { message: `Participant ${status.toLowerCase()}` });
}
