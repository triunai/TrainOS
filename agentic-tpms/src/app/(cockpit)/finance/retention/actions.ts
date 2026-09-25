"use server";

import { act } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { DomainError } from "@/server/domain/errors";
import { approveRetention, skipRetention } from "@/server/retention";

/**
 * Stage 7 HITL: a named operator approves a drafted cadence (optionally
 * editing it), which sends it, or skips it with a reason. Only fields the
 * operator changed are passed as edits, so an untouched draft is recorded as
 * approved-as-drafted in the audit metadata.
 */
export async function approveRetentionAction(form: FormData) {
  return act(async () => {
    const scheduleId = String(form.get("scheduleId") ?? "");
    if (!scheduleId) throw new DomainError("SCHEDULE_REQUIRED", "No retention cadence selected");
    // Form submission turns line breaks into CRLF; compare and send LF, or every draft reads as edited.
    const field = (name: string) => String(form.get(name) ?? "").replace(/\r\n?/g, "\n").trim();
    const subject = field("subject");
    const body = field("body");
    const edits = {
      ...(subject !== field("originalSubject") ? { subject } : {}),
      ...(body !== field("originalBody") ? { body } : {}),
    };
    const result = await approveRetention(scheduleId, currentActor(), edits);
    return { to: result.to, dispatch: result.dispatch.status };
  }, { message: "Approved and sent to the client" });
}

export async function skipRetentionAction(scheduleId: string, note?: string) {
  return act(async () => void (await skipRetention(scheduleId, note ?? "", currentActor())), { message: "Cadence skipped — reason recorded" });
}
