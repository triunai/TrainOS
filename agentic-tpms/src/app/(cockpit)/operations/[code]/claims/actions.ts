"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { approveClaimPack, collateClaim, recordHrdcApproval, recordQuery, recordRemittance, redraftTaxInvoice, resubmitAfterQuery, verifyEvidence } from "@/server/claims";
import { DomainError } from "@/server/domain/errors";
import { uploadEvidence } from "@/server/evidence/upload";
import { adjustVoucher, markVoucherPaid, settlePackage } from "@/server/finance";
import { packageIdByCode } from "@/server/packages/queries";

async function idFor(code: string) {
  const id = await packageIdByCode(code);
  if (!id) throw new DomainError("PACKAGE_NOT_FOUND", code);
  return id;
}

async function fileOf(form: FormData, field: string) {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new DomainError("FILE_REQUIRED", "Attach the file");
  return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || "application/pdf", fileName: file.name };
}

export async function uploadEvidenceAction(form: FormData) {
  return act(async () => {
    const id = await idFor(String(form.get("code")));
    const f = await fileOf(form, "file");
    await uploadEvidence(id, { documentType: String(form.get("documentType")), fileName: f.fileName, mimeType: f.mime, bytes: f.bytes }, currentActor());
  }, { message: "Stored in the vault (pending verification)" });
}

export async function verifyEvidenceAction(form: FormData) {
  return act(async () => {
    await verifyEvidence(
      String(form.get("vaultId")),
      {
        status: String(form.get("status")) as "VERIFIED" | "FLAGGED",
        notes: (form.get("notes") as string) || undefined,
        checks: { managerialSignature: form.get("managerialSignature") === "on", companyStamp: form.get("companyStamp") === "on" },
      },
      currentActor(),
    );
  }, { message: "Verification recorded" });
}

export async function collateAction(code: string) {
  return act(async () => {
    const result = await collateClaim(await idFor(code));
    return result as unknown as Record<string, unknown>;
  }, { message: "Claim collation ran" });
}

export async function redraftInvoiceAction(code: string) {
  return act(async () => void (await redraftTaxInvoice(await idFor(code), currentActor())), { message: "Tax invoice re-drafted" });
}

export async function approveClaimPackAction(form: FormData) {
  return act(async () => {
    const id = await idFor(String(form.get("code")));
    await approveClaimPack(id, { submissionRef: String(form.get("submissionRef") ?? ""), note: (form.get("note") as string) || undefined }, currentActor());
  }, { message: "Claim pack approved — submitted to e-TRiS" });
}

export async function recordQueryAction(code: string, note?: string) {
  return act(async () => void (await recordQuery(await idFor(code), note ?? "", currentActor())), { message: "Query recorded" });
}

export async function resubmitAction(code: string, note?: string) {
  return act(async () => void (await resubmitAfterQuery(await idFor(code), note ?? "", currentActor())), { message: "Resubmitted" });
}

export async function recordApprovalAction(form: FormData) {
  return act(async () => {
    const id = await idFor(String(form.get("code")));
    await recordHrdcApproval(id, String(form.get("amount") ?? ""), currentActor());
  }, { message: "HRD Corp approval recorded" });
}

export async function recordRemittanceAction(form: FormData) {
  return act(async () => {
    const id = await idFor(String(form.get("code")));
    const f = await fileOf(form, "advice");
    await recordRemittance(id, { amount: String(form.get("amount") ?? ""), reference: String(form.get("reference") ?? ""), adviceBytes: f.bytes, mime: f.mime, fileName: f.fileName }, currentActor());
  }, { message: "Remittance recorded — payment vouchers are being drafted" });
}

export async function adjustVoucherAction(form: FormData) {
  return act(async () => {
    const adjustments: Array<{ kind: "MILEAGE" | "WITHHOLDING_TAX" | "ALLOWANCE" | "DEDUCTION" | "OTHER"; label: string; amount: number }> = [];
    const mileage = Number(form.get("mileage") || 0);
    const wht = Number(form.get("wht") || 0);
    const allowance = Number(form.get("allowance") || 0);
    if (mileage) adjustments.push({ kind: "MILEAGE", label: "Verified mileage", amount: Math.abs(mileage) });
    if (allowance) adjustments.push({ kind: "ALLOWANCE", label: "Travel allowance", amount: Math.abs(allowance) });
    if (wht) adjustments.push({ kind: "WITHHOLDING_TAX", label: "Withholding tax", amount: -Math.abs(wht) });
    await adjustVoucher(String(form.get("pvId")), adjustments, currentActor());
  }, { message: "Voucher approved with adjustments" });
}

export async function markPaidAction(form: FormData) {
  return act(async () => {
    const f = await fileOf(form, "receipt");
    await markVoucherPaid(String(form.get("pvId")), { bankReference: String(form.get("bankReference") ?? ""), receiptBytes: f.bytes, mime: f.mime, fileName: f.fileName }, currentActor());
  }, { message: "Payment recorded with bank reference and receipt" });
}

export async function settleAction(code: string) {
  return act(async () => void (await settlePackage(await idFor(code), currentActor())), { message: "Settled and closed — AP_DISBURSEMENT_CONFIRMED" });
}
