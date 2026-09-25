import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { recordAudit } from "../audit/ledger";
import { type Actor, type Tx, schema, withTx } from "../db/client";
import { resolvePendingFor } from "../decisions/service";
import { DomainError } from "../domain/errors";
import { readDocument } from "../storage/vault";
import { assertUuid, requireOperator } from "../finance/common";
import { retentionSubjectRef } from "./run";
import { assertCadence, CADENCE_SHORT } from "./schedule";

/**
 * The human half of Stage 7: a named operator approves (optionally edits) a
 * drafted cadence and it is sent, or skips it.
 *
 *   approve: DRAFTED -> APPROVED (tx) -> sendMail (no tx: a sent email cannot
 *            roll back) -> DISPATCHED + audit RETENTION_CADENCE_DISPATCHED on
 *            the package (tx). A failed send leaves APPROVED; approving again
 *            retries the send.
 *   skip:    PENDING / DRAFTED / APPROVED -> SKIPPED, with the reason.
 *
 * Mail goes through lane F's adapter (`messaging/mail.sendMail`), loaded
 * dynamically so this module still works where that adapter is not
 * installed: the dispatch is then recorded as LOGGED here.
 */
type MailAttachment = { filename: string; content: Uint8Array; contentType?: string };
type MailInput = { to: string; subject: string; text: string; attachments?: MailAttachment[]; packageId?: string; kind: string };
type MailResult = { status: "SENT" | "LOGGED"; id: string };
type SendMail = (input: MailInput) => Promise<MailResult>;

function isModuleMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  if (e?.code === "ERR_MODULE_NOT_FOUND" || e?.code === "MODULE_NOT_FOUND") return true;
  const message = e?.message ?? "";
  return /messaging\/mail/.test(message) && /(Cannot find module|Failed to load url|Does the file exist)/.test(message);
}

async function loadSendMail(): Promise<SendMail | null> {
  try {
    const mod: { sendMail?: SendMail } = await import("../messaging/mail");
    return typeof mod.sendMail === "function" ? mod.sendMail : null;
  } catch (error) {
    // Only an absent adapter degrades to LOGGED; an adapter that fails to load is a real fault.
    if (isModuleMissing(error)) return null;
    throw error;
  }
}

/** R14: the adapter's answer is checked, not assumed. */
async function dispatchMail(input: MailInput): Promise<MailResult & { adapter: "messaging.mail" | "none" }> {
  const sendMail = await loadSendMail();
  if (!sendMail) return { status: "LOGGED", id: `logged-${randomUUID()}`, adapter: "none" };
  const result = await sendMail(input);
  if (result.status !== "SENT" && result.status !== "LOGGED") throw new Error(`Unknown mail status: ${String(result.status)}`);
  return { ...result, adapter: "messaging.mail" };
}

type Schedule = typeof schema.renewalSchedules.$inferSelect;

async function lockSchedule(tx: Tx, scheduleId: string): Promise<Schedule> {
  const locked = await tx.execute(sql`select id from tpms.renewal_schedules where id = ${scheduleId}::uuid for update`);
  if (locked.rows.length === 0) throw new DomainError("SCHEDULE_NOT_FOUND", `Retention schedule ${scheduleId} not found`);
  const [row] = await tx.select().from(schema.renewalSchedules).where(eq(schema.renewalSchedules.id, scheduleId));
  return row;
}

export type RetentionEdits = { subject?: string; body?: string };

export type ApproveRetentionResult = {
  scheduleId: string;
  status: "DISPATCHED";
  dispatch: { status: "SENT" | "LOGGED"; id: string; adapter: string };
  to: string;
  subject: string;
};

export async function approveRetention(scheduleId: string, actor: Actor, edits: RetentionEdits = {}): Promise<ApproveRetentionResult> {
  requireOperator(actor, "Approving a retention proposal");
  assertUuid(scheduleId, "scheduleId");
  const subjectEdit = edits.subject?.trim();
  const bodyEdit = edits.body?.trim();
  if (subjectEdit !== undefined && (subjectEdit.length < 5 || subjectEdit.length > 255)) {
    throw new DomainError("INVALID_DRAFT", "The subject must be 5 to 255 characters");
  }
  if (bodyEdit !== undefined && (bodyEdit.length < 20 || bodyEdit.length > 20_000)) {
    throw new DomainError("INVALID_DRAFT", "The body must be 20 to 20,000 characters");
  }

  const approved = await withTx(actor, { reasonCode: "RETENTION_APPROVED" }, async (tx) => {
    const schedule = await lockSchedule(tx, scheduleId);
    if (schedule.status === "PENDING") throw new DomainError("RETENTION_NOT_DRAFTED", "This cadence has not been drafted yet");
    if (schedule.status !== "DRAFTED" && schedule.status !== "APPROVED") {
      throw new DomainError("RETENTION_CLOSED", `This cadence is already ${schedule.status}`);
    }
    const subject = subjectEdit ?? schedule.draftSubject ?? "";
    const body = bodyEdit ?? schedule.draftBody ?? "";
    if (!subject || !body) throw new DomainError("INVALID_DRAFT", "The draft has no subject or body");
    const [pkg] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, schedule.sourcePackageId));
    const [client] = await tx.select().from(schema.corporateClients).where(eq(schema.corporateClients.id, schedule.clientId));
    const edited = subject !== schedule.draftSubject || body !== schedule.draftBody;
    await tx
      .update(schema.renewalSchedules)
      .set({
        status: "APPROVED",
        draftSubject: subject,
        draftBody: body,
        provenance: { ...schedule.provenance, approval: { by: actor.id, at: new Date().toISOString(), edited } },
      })
      .where(eq(schema.renewalSchedules.id, scheduleId));
    return { schedule, pkg, to: client.primaryPicEmail, subject, body, edited };
  });

  const cadence = assertCadence(approved.schedule.cadenceType);
  const attachments: MailAttachment[] = [];
  if (approved.schedule.vaultId) {
    const doc = await readDocument(approved.schedule.vaultId);
    if (!doc || !doc.intact) throw new DomainError("ATTACHMENT_CORRUPTED", "The attached pack no longer matches its recorded hash; redraft it");
    attachments.push({ filename: doc.doc.fileName, content: new Uint8Array(doc.bytes), contentType: doc.doc.mimeType });
  }
  const dispatch = await dispatchMail({
    to: approved.to,
    subject: approved.subject,
    text: approved.body,
    attachments,
    packageId: approved.pkg.id,
    kind: `RETENTION_${CADENCE_SHORT[cadence]}`,
  });

  await withTx(actor, { reasonCode: "RETENTION_CADENCE_DISPATCHED" }, async (tx) => {
    const schedule = await lockSchedule(tx, scheduleId);
    await tx
      .update(schema.renewalSchedules)
      .set({
        status: "DISPATCHED",
        dispatchedAt: new Date(),
        provenance: { ...schedule.provenance, dispatch: { status: dispatch.status, id: dispatch.id, adapter: dispatch.adapter, by: actor.id } },
      })
      .where(eq(schema.renewalSchedules.id, scheduleId));
    await recordAudit(tx, {
      entityType: "TRAINING_PACKAGE",
      entityId: approved.pkg.id,
      reasonCode: "RETENTION_CADENCE_DISPATCHED",
      details: `${cadence} to ${approved.to} (${dispatch.status})`,
      metadata: {
        package_id: approved.pkg.id,
        schedule_id: scheduleId,
        cadence_type: cadence,
        dispatch_status: dispatch.status,
        message_id: dispatch.id,
        edited: approved.edited,
      },
    });
    await resolvePendingFor(tx, "RETENTION_PROPOSAL", retentionSubjectRef(approved.pkg.packageCode, cadence), {
      status: "APPROVED",
      by: actor.id,
      chosenOption: "APPROVE",
      note: `Sent to ${approved.to} (${dispatch.status})`,
    });
  });

  return { scheduleId, status: "DISPATCHED", dispatch, to: approved.to, subject: approved.subject };
}

export async function skipRetention(scheduleId: string, note: string, actor: Actor): Promise<Schedule> {
  requireOperator(actor, "Skipping a retention cadence");
  assertUuid(scheduleId, "scheduleId");
  const reason = (note ?? "").trim();
  if (reason.length < 3) throw new DomainError("NOTES_REQUIRED", "Say why this cadence is skipped");
  return withTx(actor, { reasonCode: "RETENTION_CADENCE_SKIPPED", reasonDetails: reason }, async (tx) => {
    const schedule = await lockSchedule(tx, scheduleId);
    if (schedule.status === "DISPATCHED" || schedule.status === "SKIPPED") {
      throw new DomainError("RETENTION_CLOSED", `This cadence is already ${schedule.status}`);
    }
    const cadence = assertCadence(schedule.cadenceType);
    const [pkg] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, schedule.sourcePackageId));
    const [updated] = await tx
      .update(schema.renewalSchedules)
      .set({ status: "SKIPPED", responseNotes: reason, provenance: { ...schedule.provenance, skipped: { by: actor.id, at: new Date().toISOString() } } })
      .where(eq(schema.renewalSchedules.id, scheduleId))
      .returning();
    await recordAudit(tx, {
      entityType: "TRAINING_PACKAGE",
      entityId: pkg.id,
      reasonCode: "RETENTION_CADENCE_SKIPPED",
      details: `${cadence}: ${reason}`,
      metadata: { package_id: pkg.id, schedule_id: scheduleId, cadence_type: cadence },
    });
    await resolvePendingFor(tx, "RETENTION_PROPOSAL", retentionSubjectRef(pkg.packageCode, cadence), {
      status: "REJECTED",
      by: actor.id,
      chosenOption: "SKIP",
      note: reason,
    });
    return updated;
  });
}
