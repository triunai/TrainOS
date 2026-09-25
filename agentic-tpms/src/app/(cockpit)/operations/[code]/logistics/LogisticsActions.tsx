"use client";

import { Field, TextInput } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { confirmTrainerAction, signVenueBeoAction } from "./actions";

/**
 * Trainer and vendor row actions on the Logistics tab. Each action is offered
 * only in the one status lane B's service accepts it from — confirm a
 * TENTATIVE_HOLD engagement, sign the BEO of a PROVISIONAL venue — and
 * nothing renders otherwise (the row's status chip already says where it is).
 */
export function LogisticsActions({ kind, id, status, vendorType }: { kind: "trainer" | "vendor"; id: string; status: string; vendorType?: string }) {
  if (kind === "trainer" && status === "TENTATIVE_HOLD") {
    return (
      <ActionButton
        action={confirmTrainerAction}
        args={[id]}
        label="Confirm trainer"
        confirm={{
          title: "Confirm this trainer?",
          body: "The tentative hold becomes a booking on pay-when-paid terms: the trainer is paid after HRD Corp remits the claim. Refused if the HRD Corp TTT certificate is unverified or expires before the last training day.",
          confirmLabel: "Confirm trainer",
        }}
      />
    );
  }
  if (kind === "vendor" && vendorType === "VENUE" && status === "PROVISIONAL") {
    return (
      <FormDrawer trigger="Sign BEO" title="Signed Banquet Event Order" subtitle="PROVISIONAL → BEO_SIGNED · the venue is committed" action={signVenueBeoAction} submitLabel="Store signed BEO">
        <input type="hidden" name="commitmentId" value={id} />
        <p className="text-[13px] text-ink-secondary">Upload the BEO the venue countersigned. It is stored content-addressed in the evidence vault, marked verified by you, and filed with the claim pack later.</p>
        <Field label="Signed BEO"><input name="beo" type="file" accept="application/pdf,image/png,image/jpeg" required className="text-[13px]" /></Field>
        <Field label="Venue reference number" hint="As printed on the BEO; optional"><TextInput name="referenceNumber" maxLength={64} placeholder="BEO-…" /></Field>
      </FormDrawer>
    );
  }
  return null;
}
