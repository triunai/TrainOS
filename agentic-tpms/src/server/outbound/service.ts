import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, type Tx, db, one, rows, schema, withTx } from "@/server/db/client";
import { recordAudit } from "@/server/audit/ledger";
import { raiseDecision, resolvePendingFor } from "@/server/decisions/service";
import { DomainError } from "@/server/domain/errors";
import { env } from "@/server/env";
import { finishAgentRun, runTier, startAgentRun } from "@/server/ai";
import { sendMail } from "@/server/messaging/mail";
import { enqueue } from "@/server/queue/queue";
import { isFreeMailDomain } from "@/server/ingestion/text";
import {
  type Draft,
  HARVEY_AGENT,
  MAX_WORDS,
  type OutboundTarget,
  SEQUENCE_STEPS,
  STEP_DELAY_DAYS,
  type SequenceStep,
  acceptDraft,
  draftSchema,
  harveySystemPrompt,
  templateTouch,
  withOptOut,
  wordCount,
} from "./harvey";
import { isSuppressed } from "./suppression";

/**
 * The HITL outbox. Drafting stages rows as WAITING_APPROVAL and raises one
 * OUTBOX_BATCH decision; only a named operator's approval makes a row
 * dispatchable, and the table's `outbox_dispatch_requires_human` CHECK makes
 * the same rule a database fact — no code path, including a bug in this
 * file, can put an unapproved row into DISPATCHED.
 *
 * Scope (PRD): targets come only from permissioned sources — a CSV the
 * provider has the right to use, or our own webhooks. Scraping private
 * channels or registries (LinkedIn profiles, SSM e-Info bulk pulls, WhatsApp
 * groups) is out of scope, and signal enrichment accepts nothing else.
 */
export type OutboxRow = typeof schema.outboundCampaignOutbox.$inferSelect;

const MAX_TARGETS = 200;
const DISPATCH_ACTOR: Actor = { type: "SYSTEM", id: "sys_outbound_dispatch" };

const targetSchema = z.object({
  company: z.string().trim().min(2).max(255),
  picName: z.string().trim().max(150).nullish(),
  picEmail: z.string().trim().toLowerCase().max(150).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "not an email address"),
  ssm: z.string().trim().max(50).nullish(),
  hiringSignal: z.string().trim().max(1000).nullish(),
});

export interface DraftSequenceInput {
  targets: OutboundTarget[];
  campaignNote?: string;
}

export interface SkippedTarget {
  email: string;
  reason: string;
}

export interface DraftSequenceResult {
  batchId: string;
  rows: number;
  targets: number;
  skipped: SkippedTarget[];
  decisionId: string;
  templated: number;
}

export async function draftSequence(input: DraftSequenceInput, actor: Actor): Promise<DraftSequenceResult> {
  if (!Array.isArray(input.targets) || input.targets.length === 0) throw new DomainError("OUTBOX_NO_TARGETS", "Give at least one target");
  if (input.targets.length > MAX_TARGETS) {
    throw new DomainError("OUTBOX_TOO_MANY_TARGETS", `A batch holds at most ${MAX_TARGETS} targets; split the list`);
  }
  const skipped: SkippedTarget[] = [];
  const accepted: Array<z.output<typeof targetSchema>> = [];
  const seen = new Set<string>();
  for (const raw of input.targets) {
    const parsed = targetSchema.safeParse(raw);
    const email = String((raw as { picEmail?: unknown })?.picEmail ?? "").trim().toLowerCase();
    if (!parsed.success) {
      skipped.push({ email, reason: `INVALID: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` });
      continue;
    }
    const target = parsed.data;
    if (seen.has(target.picEmail)) skipped.push({ email: target.picEmail, reason: "DUPLICATE_IN_BATCH" });
    else if (isFreeMailDomain(target.picEmail.split("@")[1])) skipped.push({ email: target.picEmail, reason: "FREE_MAIL_ADDRESS" });
    else if (await isSuppressed(target.picEmail)) skipped.push({ email: target.picEmail, reason: "SUPPRESSED" });
    else if (await inSequence(target.picEmail)) skipped.push({ email: target.picEmail, reason: "ALREADY_IN_SEQUENCE" });
    else {
      seen.add(target.picEmail);
      accepted.push(target);
    }
  }
  if (accepted.length === 0) throw new DomainError("OUTBOX_NO_TARGETS", "No target survived validation", { skipped });

  const batchId = randomUUID();
  const providerName = env().TPMS_PROVIDER_NAME;
  const runId = await startAgentRun(db(), {
    agent: HARVEY_AGENT,
    tier: "L4",
    inputSummary: `${accepted.length} targets x ${SEQUENCE_STEPS.length} touches · batch ${batchId}`,
  });

  try {
    const drafted: Array<{ target: (typeof accepted)[number]; step: SequenceStep; draft: Draft; words: number; provenance: Record<string, unknown> }> = [];
    let costMyr = 0;
    let templated = 0;
    for (const target of accepted) {
      for (const step of SEQUENCE_STEPS) {
        const fallback = templateTouch(target, step, providerName);
        const { output, provenance } = await runTier(
          {
            tier: "L4",
            agent: HARVEY_AGENT,
            system: harveySystemPrompt(providerName),
            prompt: JSON.stringify({
              touch: step,
              company: target.company,
              recipientName: target.picName ?? null,
              hiringSignal: target.hiringSignal ?? null,
              campaignNote: input.campaignNote ?? null,
            }),
            json: { schema: draftSchema },
            maxTokens: 500,
            template: () => fallback,
          },
          { runId },
        );
        costMyr += provenance.costMyr;
        const verdict = acceptDraft(output, fallback, provenance.mode === "LLM");
        if (verdict.words >= MAX_WORDS) {
          // Only reachable with an absurdly long name: never stage a body the rule forbids.
          throw new DomainError("OUTBOX_TEMPLATE_OVER_BUDGET", `The template for ${target.company} is ${verdict.words} words`);
        }
        if (verdict.source === "TEMPLATE") templated += 1;
        drafted.push({
          target,
          step,
          draft: verdict.draft,
          words: verdict.words,
          provenance: {
            agent: HARVEY_AGENT,
            tier: "L4",
            mode: provenance.mode,
            provider: provenance.provider,
            model: provenance.model,
            fallbackReason: provenance.fallbackReason ?? null,
            source: verdict.source,
            rejectedReason: verdict.accepted ? null : verdict.rejectedReason,
            angle: "LEVY_UTILISATION",
            agentRunId: runId,
            campaignNote: input.campaignNote ?? null,
            draftedBy: actor.id,
            picName: target.picName ?? null,
          },
        });
      }
    }

    const decisionId = await withTx(actor, { reasonCode: "OUTBOX_BATCH_DRAFTED" }, async (tx) => {
      await tx.insert(schema.outboundCampaignOutbox).values(
        drafted.map((d) => ({
          batchId,
          sequenceStep: d.step,
          targetCompany: d.target.company,
          targetPicEmail: d.target.picEmail,
          ssmNumber: d.target.ssm ?? null,
          hiringSignalNotes: d.target.hiringSignal ?? null,
          subjectLine: d.draft.subject,
          emailBodyText: d.draft.body,
          wordCount: d.words,
          hasOptOutLink: true,
          provenance: d.provenance,
        })),
      );
      const decision = await raiseDecision(tx, {
        gate: "OUTBOX_BATCH",
        subjectRef: batchId,
        title: `Outbound batch · ${accepted.length} target${accepted.length === 1 ? "" : "s"} · ${drafted.length} emails`,
        summary:
          `Three-touch levy-utilisation sequence for ${accepted.length} permissioned target(s). ` +
          `${templated} of ${drafted.length} bodies are the deterministic template. Nothing is sent until you approve.` +
          (skipped.length ? ` ${skipped.length} target(s) were skipped.` : ""),
        payload: { batchId, targets: accepted.length, rows: drafted.length, skipped, campaignNote: input.campaignNote ?? null },
        options: [
          { id: "APPROVE", label: "Approve batch", description: "Mark the rows approved by you and dispatch touch 1 now" },
          { id: "REJECT", label: "Reject batch", description: "Nothing is sent" },
        ],
        raisedBy: HARVEY_AGENT,
        raisedByTier: "L4",
        slaHours: 48,
      });
      await recordAudit(tx, {
        entityType: "OUTBOX_BATCH",
        entityId: batchId,
        reasonCode: "OUTBOX_BATCH_DRAFTED",
        details: `${drafted.length} drafts for ${accepted.length} targets`,
        metadata: { rows: drafted.length, targets: accepted.length, skipped: skipped.length, templated, agent_run_id: runId },
      });
      return decision.id;
    });

    await finishAgentRun(db(), runId, {
      status: templated === drafted.length ? "FALLBACK" : "SUCCEEDED",
      output: { batchId, rows: drafted.length, templated, skipped: skipped.length },
      costMyr,
    });
    return { batchId, rows: drafted.length, targets: accepted.length, skipped, decisionId, templated };
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** Queue a large list instead of drafting in the request (each touch is one L4 call). */
export async function requestDraftSequence(input: DraftSequenceInput, actor: Actor): Promise<{ taskId: string | null }> {
  if (actor.type !== "USER") throw new DomainError("OUTBOX_REQUIRES_HUMAN", "Only an operator can start an outbound batch");
  if (!Array.isArray(input.targets) || input.targets.length === 0) throw new DomainError("OUTBOX_NO_TARGETS", "Give at least one target");
  if (input.targets.length > MAX_TARGETS) {
    throw new DomainError("OUTBOX_TOO_MANY_TARGETS", `A batch holds at most ${MAX_TARGETS} targets; split the list`);
  }
  const taskId = await enqueue(db(), {
    type: "outbound.draft_sequence",
    payload: { targets: input.targets, campaignNote: input.campaignNote, requestedBy: { type: "USER", id: actor.id } },
  });
  return { taskId };
}

async function inSequence(email: string): Promise<boolean> {
  const hit = await one<{ n: number }>(
    db(),
    sql`select 1 as n from tpms.outbound_campaign_outbox
         where lower(target_pic_email) = ${email} and status in ('WAITING_APPROVAL', 'APPROVED') limit 1`,
  );
  return !!hit;
}

// ---------------------------------------------------------------- review

async function requireApprover(actor: Actor): Promise<void> {
  if (actor.type !== "USER") throw new DomainError("OUTBOX_REQUIRES_HUMAN", "Only an operator can review an outbound batch");
  const operator = await one<{ id: string }>(db(), sql`select id from tpms.operators where id = ${actor.id}`);
  if (!operator) throw new DomainError("APPROVER_NOT_OPERATOR", `${actor.id} is not a registered operator`);
}

export interface ReviewResult {
  approved: number;
  rejected: number;
  dispatchTaskIds: string[];
}

/**
 * The human gate. Every WAITING_APPROVAL row in the batch becomes APPROVED
 * (stamped with this operator and time) unless its id is in `rejectIds`.
 * An id that is not in the batch is refused rather than ignored (R14).
 */
export async function approveBatch(batchId: string, actor: Actor, opts: { rejectIds?: string[]; note?: string } = {}): Promise<ReviewResult> {
  await requireApprover(actor);
  const rejectIds = [...new Set(opts.rejectIds ?? [])];
  return withTx(actor, { reasonCode: "OUTBOX_BATCH_REVIEWED", reasonDetails: opts.note }, async (tx) => {
    const batch = await rows<{ id: string; status: string }>(
      tx,
      sql`select id, status from tpms.outbound_campaign_outbox where batch_id = ${batchId}::uuid order by id for update`,
    );
    if (batch.length === 0) throw new DomainError("OUTBOX_BATCH_NOT_FOUND", `Batch ${batchId} not found`);
    const unknown = rejectIds.filter((id) => !batch.some((r) => r.id === id));
    if (unknown.length) throw new DomainError("UNKNOWN_OUTBOX_ROW", `Not in batch ${batchId}: ${unknown.join(", ")}`, { unknown });
    if (!batch.some((r) => r.status === "WAITING_APPROVAL")) {
      throw new DomainError("OUTBOX_BATCH_NOT_PENDING", "This batch has already been reviewed");
    }
    const rejectArray = sql`${`{${rejectIds.join(",")}}`}::uuid[]`;
    const rejected = await rows<{ id: string }>(
      tx,
      sql`update tpms.outbound_campaign_outbox
             set status = 'REJECTED', provenance = provenance || jsonb_build_object('reviewedBy', ${actor.id}::text)
           where batch_id = ${batchId}::uuid and status = 'WAITING_APPROVAL' and id = any(${rejectArray})
           returning id`,
    );
    const approved = await rows<{ id: string }>(
      tx,
      sql`update tpms.outbound_campaign_outbox
             set status = 'APPROVED', is_approved_by_human = true, approved_by_user_id = ${actor.id}, approved_at = now()
           where batch_id = ${batchId}::uuid and status = 'WAITING_APPROVAL' and not (id = any(${rejectArray}))
           returning id`,
    );
    const anyApproved = approved.length > 0;
    await resolvePendingFor(tx, "OUTBOX_BATCH", batchId, {
      status: anyApproved ? "APPROVED" : "REJECTED",
      by: actor.id,
      chosenOption: anyApproved ? "APPROVE" : "REJECT",
      note: opts.note ?? `${approved.length} approved, ${rejected.length} rejected`,
    });
    await recordAudit(tx, {
      entityType: "OUTBOX_BATCH",
      entityId: batchId,
      reasonCode: anyApproved ? "OUTBOX_BATCH_APPROVED" : "OUTBOX_BATCH_REJECTED",
      details: `${approved.length} approved, ${rejected.length} rejected`,
      metadata: { approved: approved.length, rejected: rejected.length, rejected_ids: rejected.map((r) => r.id) },
    });
    const dispatchTaskIds: string[] = [];
    if (anyApproved) {
      for (const step of SEQUENCE_STEPS) {
        const id = await enqueue(tx, {
          type: "outbound.dispatch_batch",
          payload: { batchId, step },
          dueAt: new Date(Date.now() + STEP_DELAY_DAYS[step] * 86_400_000),
          idempotencyKey: `outbox:${batchId}:step${step}`,
        });
        if (id) dispatchTaskIds.push(id);
      }
    }
    return { approved: approved.length, rejected: rejected.length, dispatchTaskIds };
  });
}

export async function rejectBatch(batchId: string, actor: Actor, note?: string): Promise<ReviewResult> {
  await requireApprover(actor);
  const ids = await rows<{ id: string }>(
    db(),
    sql`select id from tpms.outbound_campaign_outbox where batch_id = ${batchId}::uuid and status = 'WAITING_APPROVAL'`,
  );
  return approveBatch(batchId, actor, { rejectIds: ids.map((r) => r.id), note: note ?? "Batch rejected" });
}

/** An operator's edit of one staged draft. The same L0 rules apply to human words as to a model's. */
export async function editOutboxDraft(rowId: string, input: { subject?: string; body?: string }, actor: Actor): Promise<OutboxRow> {
  await requireApprover(actor);
  return withTx(actor, { reasonCode: "OUTBOX_DRAFT_EDITED" }, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.outboundCampaignOutbox)
      .where(eq(schema.outboundCampaignOutbox.id, rowId))
      .for("update");
    if (!row) throw new DomainError("OUTBOX_ROW_NOT_FOUND", `Outbox row ${rowId} not found`);
    if (row.status !== "WAITING_APPROVAL") throw new DomainError("OUTBOX_ROW_LOCKED", "Only a draft waiting for approval can be edited");
    const subject = (input.subject ?? row.subjectLine).replace(/\s+/g, " ").trim();
    const body = withOptOut(input.body ?? row.emailBodyText);
    const words = wordCount(body);
    if (!subject || subject.length > 255) throw new DomainError("OUTBOX_BAD_SUBJECT", "A subject is 1 to 255 characters");
    if (words >= MAX_WORDS) throw new DomainError("OUTBOX_OVER_WORD_BUDGET", `The body is ${words} words; the limit is under ${MAX_WORDS}`);
    const [updated] = await tx
      .update(schema.outboundCampaignOutbox)
      .set({ subjectLine: subject, emailBodyText: body, wordCount: words, provenance: { ...row.provenance, editedBy: actor.id, source: "HUMAN_EDIT" } })
      .where(eq(schema.outboundCampaignOutbox.id, rowId))
      .returning();
    await recordAudit(tx, {
      entityType: "OUTBOX_BATCH",
      entityId: row.batchId,
      reasonCode: "OUTBOX_DRAFT_EDITED",
      details: `Touch ${row.sequenceStep} edited`,
      metadata: { row_id: rowId, words },
    });
    return updated;
  });
}

// ---------------------------------------------------------------- dispatch

/** Belt and braces over the CHECK constraint: a row without a named human approval is never handed to the mailer. */
export function assertDispatchable(row: Pick<OutboxRow, "id" | "status" | "isApprovedByHuman" | "approvedByUserId" | "approvedAt">): void {
  if (row.status !== "APPROVED" || !row.isApprovedByHuman || !row.approvedByUserId || !row.approvedAt) {
    throw new DomainError("OUTBOX_ROW_NOT_APPROVED", `Outbox row ${row.id} has no human approval and cannot be sent`);
  }
}

export interface DispatchResult {
  batchId: string;
  step: SequenceStep;
  sent: number;
  logged: number;
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Sends one touch of a batch. Each row is its own transaction: lock it (SKIP
 * LOCKED, so two workers never send the same email), re-check approval and
 * the suppression list, send, mark DISPATCHED. A follow-up only goes to a
 * target whose previous touch was actually dispatched — a rejected, replied
 * or bounced earlier touch ends that target's sequence.
 */
export async function dispatchBatch(batchId: string, step: SequenceStep): Promise<DispatchResult> {
  if (!SEQUENCE_STEPS.includes(step)) throw new DomainError("UNKNOWN_SEQUENCE_STEP", `Unknown sequence step: ${String(step)}`);
  const candidates = await rows<{ id: string }>(
    db(),
    sql`select id from tpms.outbound_campaign_outbox
         where batch_id = ${batchId}::uuid and sequence_step = ${step} and status = 'APPROVED'
           and is_approved_by_human and approved_by_user_id is not null
         order by target_pic_email`,
  );
  const result: DispatchResult = { batchId, step, sent: 0, logged: 0, skipped: [] };
  for (const { id } of candidates) {
    const outcome = await withTx(DISPATCH_ACTOR, { reasonCode: "OUTBOX_DISPATCH" }, (tx) => dispatchRow(tx, id, step));
    if (outcome === "SENT") result.sent += 1;
    else if (outcome === "LOGGED") result.logged += 1;
    else if (outcome !== "LOCKED") result.skipped.push({ id, reason: outcome });
  }
  return result;
}

type RowOutcome = "SENT" | "LOGGED" | "LOCKED" | "SUPPRESSED" | "SEQUENCE_STOPPED" | "INVALID_RECIPIENT";

async function dispatchRow(tx: Tx, id: string, step: SequenceStep): Promise<RowOutcome> {
  const [row] = await tx
    .select()
    .from(schema.outboundCampaignOutbox)
    .where(and(eq(schema.outboundCampaignOutbox.id, id), eq(schema.outboundCampaignOutbox.status, "APPROVED")))
    .for("update", { skipLocked: true });
  if (!row) return "LOCKED";
  assertDispatchable(row);

  const stop = async (reason: "SUPPRESSED" | "SEQUENCE_STOPPED" | "INVALID_RECIPIENT") => {
    await tx.execute(sql`update tpms.outbound_campaign_outbox
         set status = 'REJECTED', provenance = provenance || jsonb_build_object('dispatchSkipped', ${reason}::text)
       where id = ${id}::uuid`);
    return reason;
  };
  if (await isSuppressed(row.targetPicEmail, tx)) return stop("SUPPRESSED");
  if (step > 1) {
    const previous = await one<{ status: string }>(
      tx,
      sql`select status from tpms.outbound_campaign_outbox
           where batch_id = ${row.batchId}::uuid and sequence_step = ${step - 1}
             and lower(target_pic_email) = lower(${row.targetPicEmail})`,
    );
    if (previous?.status !== "DISPATCHED") return stop("SEQUENCE_STOPPED");
  }

  let sent: Awaited<ReturnType<typeof sendMail>>;
  try {
    sent = await sendMail({ to: row.targetPicEmail, subject: row.subjectLine, text: row.emailBodyText, kind: "OUTBOUND_COLD" });
  } catch (error) {
    // One undeliverable address must not stall the rest of the batch; a
    // configuration or transport failure must (the task retries).
    if (error instanceof DomainError && error.code === "MAIL_INVALID_RECIPIENT") return stop("INVALID_RECIPIENT");
    throw error;
  }
  await tx.execute(sql`update tpms.outbound_campaign_outbox
       set status = 'DISPATCHED', sent_at = now(),
           provenance = provenance || jsonb_build_object('outboundMessageId', ${sent.id}::text, 'deliveryStatus', ${sent.status}::text)
     where id = ${id}::uuid`);
  return sent.status;
}

// ---------------------------------------------------------------- read models

export interface OutboxBatchSummary {
  batchId: string;
  createdAt: Date;
  targets: number;
  rows: number;
  counts: Record<string, number>;
  decisionId: string | null;
  decisionStatus: string | null;
  approvedBy: string | null;
}

export async function listOutboxBatches(limit = 50): Promise<OutboxBatchSummary[]> {
  const result = await rows<{
    batch_id: string;
    created_at: Date;
    targets: number;
    rows: number;
    counts: Record<string, number>;
    decision_id: string | null;
    decision_status: string | null;
    approved_by: string | null;
  }>(
    db(),
    sql`with b as (
          select batch_id, min(created_at) as created_at, count(distinct lower(target_pic_email))::int as targets,
                 count(*)::int as rows, max(approved_by_user_id) as approved_by
            from tpms.outbound_campaign_outbox group by batch_id
        ), c as (
          select batch_id, jsonb_object_agg(status, n) as counts
            from (select batch_id, status, count(*)::int as n from tpms.outbound_campaign_outbox group by batch_id, status) s
           group by batch_id
        )
        select b.*, c.counts, d.id as decision_id, d.status as decision_status
          from b join c using (batch_id)
          left join lateral (
            select id, status from tpms.decisions
             where gate = 'OUTBOX_BATCH' and subject_ref = b.batch_id::text
             order by created_at desc limit 1
          ) d on true
         order by b.created_at desc
         limit ${limit}`,
  );
  return result.map((r) => ({
    batchId: r.batch_id,
    createdAt: r.created_at,
    targets: r.targets,
    rows: r.rows,
    counts: r.counts,
    decisionId: r.decision_id,
    decisionStatus: r.decision_status,
    approvedBy: r.approved_by,
  }));
}

export async function listOutbox(batchId: string): Promise<OutboxRow[]> {
  return db()
    .select()
    .from(schema.outboundCampaignOutbox)
    .where(sql`batch_id = ${batchId}::uuid`)
    .orderBy(schema.outboundCampaignOutbox.targetPicEmail, schema.outboundCampaignOutbox.sequenceStep);
}
