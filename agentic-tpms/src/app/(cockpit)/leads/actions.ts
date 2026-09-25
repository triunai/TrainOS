"use server";

import { LEAD_STATUS } from "@/components/demand/labels";
import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";
import { convertLeadToPackage, createManualLead, resolveTriage, triageLead, type TriageRoute } from "@/server/ingestion";

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const int = (form: FormData, key: string) => {
  const v = text(form, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new DomainError("NOT_A_WHOLE_NUMBER", `${key}: ${v} is not a whole number`);
  return n;
};

/**
 * An operator typing a lead in (phone call, walk-in, event badge). The keys
 * are the field-bag aliases the intake normaliser reads; anything it cannot
 * place stays visible to the L1 classifier as a "Question: answer" line.
 */
export async function createLeadAction(form: FormData) {
  const result = await act(async () => {
    const ingested = await createManualLead(
      {
        company: text(form, "company"),
        name: text(form, "name"),
        email: text(form, "email"),
        phone: text(form, "phone"),
        ssm: text(form, "ssm"),
        topic: text(form, "topic"),
        participants: text(form, "pax"),
        training_mode: text(form, "delivery"),
        whatsapp_opt_in: form.get("whatsappOptIn") === "on" ? "yes" : undefined,
        source: text(form, "source"),
        message: text(form, "message"),
      },
      currentActor(),
    );
    if (ingested.status === "REJECTED") throw new DomainError(ingested.code, ingested.message);
    return { href: `/leads/${ingested.leadId}`, status: ingested.status, reason: ingested.reason };
  }, { message: "Lead recorded — L1 triage is queued" });
  if (result.ok && result.data.status === "DUPLICATE") {
    result.message = "Recorded as a duplicate of an open lead from the same company or number";
  }
  return result;
}

export async function resolveTriageAction(leadId: string, route: TriageRoute, note?: string) {
  return act(async () => {
    const { microTnaTaskId } = await resolveTriage(leadId, { route, note: note?.trim() || undefined }, currentActor());
    return { microTnaQueued: Boolean(microTnaTaskId) };
  }, { message: "Triage recorded in the audit ledger" });
}

/** Runs the L1 classifier now instead of waiting for the worker; a lead already routed is left alone. */
export async function runTriageAction(leadId: string) {
  const result = await act(async () => triageLead(leadId), { message: "L1 triage ran" });
  if (result.ok && result.data.skipped) result.message = `Nothing to do: ${result.data.skipped.toLowerCase().replace(/_/g, " ")}`;
  else if (result.ok && result.data.route) {
    result.message = `L1 routed the lead to ${LEAD_STATUS[result.data.route as keyof typeof LEAD_STATUS]?.label ?? result.data.route}`;
  }
  return result;
}

export async function convertLeadAction(form: FormData) {
  return act(async () => {
    const leadId = text(form, "leadId");
    if (!leadId) throw new DomainError("LEAD_REQUIRED", "No lead given");
    const pax = int(form, "pax");
    if (pax === undefined) throw new DomainError("PACKAGE_INPUT_INVALID", "pax: give the expected headcount");
    const result = await convertLeadToPackage(
      leadId,
      {
        title: text(form, "title") ?? "",
        deliveryMode: (text(form, "deliveryMode") ?? "") as never,
        startDate: text(form, "startDate") ?? null,
        endDate: text(form, "endDate") ?? null,
        pax,
        minParticipants: int(form, "minParticipants"),
        courseId: text(form, "courseId") ?? null,
        venueByClient: form.get("venueByClient") === "on",
      },
      currentActor(),
    );
    return { href: `/operations/${result.package.packageCode}`, code: result.package.packageCode, clientCreated: result.clientCreated };
  }, { message: "Converted — the package is in DRAFT and the proposal draft is queued" });
}
