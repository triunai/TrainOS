"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { issueCertificates, revokeCertificate } from "@/server/certificates";
import { packageIdByCode } from "@/server/packages/queries";
import { DomainError } from "@/server/domain/errors";

export async function revokeCertificateAction(serial: string, reason?: string) {
  return act(() => revokeCertificate(serial, reason ?? "", currentActor()), { message: `${serial} revoked` });
}

export async function issueCertificatesAction(code: string) {
  return act(async () => {
    const id = await packageIdByCode(code);
    if (!id) throw new DomainError("PACKAGE_NOT_FOUND", code);
    const result = await issueCertificates(id);
    return { issued: result.issued.length, skipped: result.skipped.length };
  }, { message: "Certificate run complete" });
}
