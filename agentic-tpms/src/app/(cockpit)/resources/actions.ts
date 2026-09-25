"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";
import { createTrainer, createVendor, verifyTrainerTtt } from "@/server/resources/service";

export async function createTrainerAction(form: FormData) {
  return act(
    () =>
      createTrainer(
        {
          fullName: String(form.get("fullName") ?? ""),
          nric: String(form.get("nric") ?? ""),
          email: String(form.get("email") ?? ""),
          phone: String(form.get("phone") ?? ""),
          tttCertNumber: String(form.get("tttCertNumber") ?? ""),
          tttCertExpiryDate: (form.get("tttCertExpiryDate") as string) || null,
          standardDayRate: Number(form.get("standardDayRate") ?? 0),
          specialties: String(form.get("specialties") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          bioSummary: (form.get("bioSummary") as string) || null,
        },
        currentActor(),
      ),
    { message: "Trainer registered" },
  );
}

export async function verifyTttAction(form: FormData) {
  return act(async () => {
    const trainerId = String(form.get("trainerId") ?? "");
    const file = form.get("certificate");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("CERT_REQUIRED", "Attach the TTT certificate you verified against");
    const bytes = new Uint8Array(await file.arrayBuffer());
    await verifyTrainerTtt(trainerId, { bytes, mimeType: file.type || "application/pdf", fileName: file.name }, (form.get("expiry") as string) || null, currentActor());
  }, { message: "TTT certificate verified" });
}

export async function createVendorAction(form: FormData) {
  const num = (k: string) => (form.get(k) ? Number(form.get(k)) : null);
  return act(
    () =>
      createVendor(
        {
          vendorType: String(form.get("vendorType")) as "VENUE" | "CATERING" | "PRINTING",
          name: String(form.get("name") ?? ""),
          city: (form.get("city") as string) || null,
          latitude: num("latitude"),
          longitude: num("longitude"),
          capacity: num("capacity"),
          ddrPerPax: num("ddrPerPax"),
          unitCost: num("unitCost"),
          freePostponementDays: num("freePostponementDays") ?? 7,
          cancellationNoticeDays: num("cancellationNoticeDays") ?? 14,
          contactEmail: (form.get("contactEmail") as string) || null,
          contactPhone: (form.get("contactPhone") as string) || null,
        },
        currentActor(),
      ),
    { message: "Vendor added" },
  );
}
