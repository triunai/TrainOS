"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";
import { approveBatch, editOutboxDraft, importTargetsCsv, rejectBatch, requestDraftSequence } from "@/server/outbound";

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** The HITL gate: every waiting row becomes APPROVED under this operator's name; touch 1 dispatches now. */
export async function approveBatchAction(batchId: string) {
  const result = await act(async () => approveBatch(batchId, currentActor()), { message: "Batch approved" });
  if (result.ok) result.message = `Approved ${result.data.approved} email${result.data.approved === 1 ? "" : "s"} — touch 1 dispatches now, touches 2 and 3 on day 3 and day 7`;
  return result;
}

export async function rejectBatchAction(batchId: string, note?: string) {
  return act(async () => rejectBatch(batchId, currentActor(), note?.trim() || undefined), { message: "Batch rejected — nothing is sent" });
}

export async function editDraftAction(form: FormData) {
  return act(async () => {
    const rowId = text(form, "rowId");
    if (!rowId) throw new DomainError("OUTBOX_ROW_NOT_FOUND", "No draft given");
    const updated = await editOutboxDraft(rowId, { subject: text(form, "subject"), body: text(form, "body") }, currentActor());
    return { words: updated.wordCount };
  }, { message: "Draft saved — the opt-out line and word limit were re-checked" });
}

/** A permissioned target list: parse it, then queue the Harvey writer for the targets that parsed. */
export async function importCsvAction(form: FormData) {
  const result = await act(async () => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("FILE_REQUIRED", "Attach the CSV file");
    if (file.size > 2_000_000) throw new DomainError("CSV_TOO_LARGE", "Keep a target list under 2 MB");
    const parsed = importTargetsCsv(await file.text());
    if (parsed.targets.length === 0) {
      throw new DomainError("OUTBOX_NO_TARGETS", `No usable rows. ${parsed.errors.slice(0, 3).map((e) => `Line ${e.line}: ${e.message}`).join("; ")}`);
    }
    await requestDraftSequence({ targets: parsed.targets, campaignNote: text(form, "campaignNote") }, currentActor());
    return { targets: parsed.targets.length, errors: parsed.errors };
  }, { message: "Targets queued for drafting" });
  if (result.ok) {
    const { targets, errors } = result.data;
    result.message =
      `${targets} target${targets === 1 ? "" : "s"} queued for the L4 writer` +
      (errors.length ? ` · ${errors.length} row${errors.length === 1 ? "" : "s"} skipped (${errors.slice(0, 2).map((e) => `line ${e.line}: ${e.message}`).join("; ")})` : "");
  }
  return result;
}

/** One target typed in by hand (a referral, a name from an event list the provider may use). */
export async function draftSequenceAction(form: FormData) {
  return act(async () => {
    const company = text(form, "company");
    const picEmail = text(form, "picEmail");
    if (!company || !picEmail) throw new DomainError("OUTBOX_NO_TARGETS", "A target needs a company and a work email");
    await requestDraftSequence(
      { targets: [{ company, picEmail, picName: text(form, "picName") ?? null, ssm: text(form, "ssm") ?? null, hiringSignal: text(form, "hiringSignal") ?? null }], campaignNote: text(form, "campaignNote") },
      currentActor(),
    );
  }, { message: "Queued — the L4 writer drafts three touches for review" });
}
