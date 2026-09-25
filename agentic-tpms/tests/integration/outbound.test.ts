import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, one, rows } from "@/server/db/client";
import type { Task } from "@/server/db/schema";
import { MAX_WORDS, OPT_OUT_LINE } from "@/server/outbound/harvey";
import {
  approveBatch,
  assertDispatchable,
  dispatchBatch,
  draftSequence,
  editOutboxDraft,
  listOutbox,
  listOutboxBatches,
  rejectBatch,
  requestDraftSequence,
} from "@/server/outbound/service";
import { suppressAddress } from "@/server/outbound/suppression";
import { handlers } from "@/server/outbound/tasks";
import { importTargetsCsv } from "@/server/outbound/csv";
import { expectRefusal, releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator } from "../helpers/factory";

beforeAll(async () => {
  await useTestDatabase();
  await makeOperator();
});
afterAll(releaseTestDatabase);

let n = 0;
function targets(count: number) {
  return Array.from({ length: count }, () => {
    n += 1;
    return {
      company: `Target ${n} Manufacturing Sdn Bhd`,
      picName: `Person ${n}`,
      picEmail: `hr${n}@target${n}-mfg.com.my`,
      hiringSignal: n % 2 ? "Hiring 8 production supervisors for a new line" : null,
    };
  });
}

async function outboundLogCount(): Promise<number> {
  return (await one<{ n: number }>(db(), sql`select count(*)::int as n from tpms.outbound_messages where kind = 'OUTBOUND_COLD'`))?.n ?? 0;
}

describe("Harvey drafting into the HITL outbox", () => {
  it("stages three touches per target under the word budget, each with the opt-out line, and raises one OUTBOX_BATCH decision", async () => {
    const list = targets(2);
    const result = await draftSequence(
      {
        targets: [...list, { company: "Personal", picEmail: "someone@gmail.com" }, { company: "Dup", picEmail: list[0].picEmail }, { company: "x", picEmail: "bad" }],
        campaignNote: "Q4 levy push",
      },
      ALEX,
    );
    expect(result).toMatchObject({ rows: 6, targets: 2, templated: 6 });
    expect(result.skipped.map((s) => s.reason)).toEqual(["FREE_MAIL_ADDRESS", "DUPLICATE_IN_BATCH", expect.stringMatching(/^INVALID/)]);

    const staged = await listOutbox(result.batchId);
    expect(staged).toHaveLength(6);
    for (const row of staged) {
      expect(row.status).toBe("WAITING_APPROVAL");
      expect(row.isApprovedByHuman).toBe(false);
      expect(row.wordCount).toBeLessThan(MAX_WORDS);
      expect(row.wordCount).toBe(row.emailBodyText.trim().split(/\s+/).length);
      expect(row.emailBodyText.trimEnd().endsWith(OPT_OUT_LINE)).toBe(true);
      expect(row.hasOptOutLink).toBe(true);
      expect(row.provenance).toMatchObject({ agent: "outbound.harvey_writer", tier: "L4", angle: "LEVY_UTILISATION", draftedBy: ALEX.id });
    }
    expect(staged.map((r) => r.sequenceStep).sort()).toEqual([1, 1, 2, 2, 3, 3]);
    const decision = await one<{ gate: string; status: string; raised_by: string; raised_by_tier: string }>(
      db(),
      sql`select gate, status, raised_by, raised_by_tier from tpms.decisions where subject_ref = ${result.batchId}`,
    );
    expect(decision).toEqual({ gate: "OUTBOX_BATCH", status: "PENDING", raised_by: "outbound.harvey_writer", raised_by_tier: "L4" });
    const run = await one<{ tier: string; status: string }>(db(), sql`select tier, status from tpms.agent_runs where agent = 'outbound.harvey_writer' limit 1`);
    expect(run).toEqual({ tier: "L4", status: "FALLBACK" });

    // An address already in a live sequence is not drafted again.
    const again = await draftSequence({ targets: [list[1], ...targets(1)] }, ALEX);
    expect(again.skipped).toEqual([{ email: list[1].picEmail, reason: "ALREADY_IN_SEQUENCE" }]);
  });

  it("imports a permissioned CSV straight into a draft", async () => {
    const { targets: parsed, errors } = importTargetsCsv("company,name,email,notes\nCsv Foods Sdn Bhd,Aina,aina@csv-foods.com.my,Opening a second kitchen\n");
    expect(errors).toEqual([]);
    const result = await draftSequence({ targets: parsed }, ALEX);
    expect(result.rows).toBe(3);
  });
});

describe("the human gate", () => {
  it("an unapproved row can never be dispatched — not by the dispatcher, not by the database", async () => {
    const { batchId } = await draftSequence({ targets: targets(1) }, ALEX);
    const before = await outboundLogCount();
    expect(await dispatchBatch(batchId, 1)).toMatchObject({ sent: 0, logged: 0, skipped: [] });
    expect(await outboundLogCount()).toBe(before);

    const [row] = await listOutbox(batchId);
    expect(() => assertDispatchable(row)).toThrow(/no human approval/);
    await expectRefusal(
      db().execute(sql`update tpms.outbound_campaign_outbox set status = 'DISPATCHED', sent_at = now() where id = ${row.id}::uuid`),
      /outbox_dispatch_requires_human/,
    );
    await expectRefusal(
      db().execute(sql`update tpms.outbound_campaign_outbox set status = 'APPROVED' where id = ${row.id}::uuid`),
      /outbox_dispatch_requires_human/,
    );
  });

  it("only a registered operator may approve", async () => {
    const { batchId } = await draftSequence({ targets: targets(1) }, ALEX);
    await expect(approveBatch(batchId, { type: "AGENT", id: "outbound.harvey_writer" })).rejects.toMatchObject({ code: "OUTBOX_REQUIRES_HUMAN" });
    await expect(approveBatch(batchId, { type: "USER", id: "usr_ghost" })).rejects.toMatchObject({ code: "APPROVER_NOT_OPERATOR" });
    await expect(approveBatch(batchId, ALEX, { rejectIds: ["00000000-0000-4000-8000-000000000000"] })).rejects.toMatchObject({ code: "UNKNOWN_OUTBOX_ROW" });
  });

  it("approve -> dispatch: touch 1 goes out as LOGGED mail, follow-ups only to targets whose touch 1 went", async () => {
    const [kept, dropped] = targets(2);
    const { batchId } = await draftSequence({ targets: [kept, dropped] }, ALEX);
    const staged = await listOutbox(batchId);
    const rejectIds = staged.filter((r) => r.targetPicEmail === dropped.picEmail && r.sequenceStep === 1).map((r) => r.id);

    const review = await approveBatch(batchId, ALEX, { rejectIds, note: "Second target is a competitor" });
    expect(review).toMatchObject({ approved: 5, rejected: 1 });
    expect(review.dispatchTaskIds).toHaveLength(3);
    const scheduled = await rows<{ payload: { step: number }; due_days: number }>(
      db(),
      sql`select payload, round(extract(epoch from claim_due - now()) / 86400)::int as due_days
            from tpms.task_queue where task_type = 'outbound.dispatch_batch' and payload->>'batchId' = ${batchId} order by claim_due`,
    );
    expect(scheduled.map((s) => [s.payload.step, s.due_days])).toEqual([[1, 0], [2, 3], [3, 7]]);

    const approved = (await listOutbox(batchId)).filter((r) => r.status === "APPROVED");
    for (const row of approved) {
      expect(row).toMatchObject({ isApprovedByHuman: true, approvedByUserId: ALEX.id });
      expect(row.approvedAt).toBeInstanceOf(Date);
    }
    const decision = await one<{ status: string; resolved_by: string }>(db(), sql`select status, resolved_by from tpms.decisions where subject_ref = ${batchId}`);
    expect(decision).toEqual({ status: "APPROVED", resolved_by: ALEX.id });
    await expect(approveBatch(batchId, ALEX)).rejects.toMatchObject({ code: "OUTBOX_BATCH_NOT_PENDING" });

    const handler = handlers["outbound.dispatch_batch"];
    if (!handler) throw new Error("no dispatch handler");
    const step1 = await handler({ id: review.dispatchTaskIds[0], taskType: "outbound.dispatch_batch", payload: { batchId, step: 1 } } as unknown as Task, {
      workerId: "t",
      heartbeat: async () => undefined,
    });
    expect(step1).toMatchObject({ logged: 1, sent: 0 });
    const log = await rows<{ to_address: string; status: string; channel: string; subject: string }>(
      db(),
      sql`select to_address, status, channel, subject from tpms.outbound_messages where kind = 'OUTBOUND_COLD' and to_address = ${kept.picEmail}`,
    );
    expect(log).toEqual([{ to_address: kept.picEmail, status: "LOGGED", channel: "EMAIL", subject: expect.stringContaining("levy") }]);
    const dispatched = (await listOutbox(batchId)).find((r) => r.targetPicEmail === kept.picEmail && r.sequenceStep === 1);
    expect(dispatched?.status).toBe("DISPATCHED");
    expect(dispatched?.sentAt).toBeInstanceOf(Date);
    expect(dispatched?.provenance).toMatchObject({ deliveryStatus: "LOGGED" });

    // Touch 2: the kept target continues; the dropped target's sequence has ended.
    const step2 = await dispatchBatch(batchId, 2);
    expect(step2.logged).toBe(1);
    expect(step2.skipped).toEqual([{ id: expect.any(String), reason: "SEQUENCE_STOPPED" }]);
    // Re-running a dispatch sends nothing twice.
    expect(await dispatchBatch(batchId, 2)).toMatchObject({ logged: 0, sent: 0, skipped: [] });

    const [summary] = (await listOutboxBatches()).filter((b) => b.batchId === batchId);
    expect(summary).toMatchObject({ targets: 2, rows: 6, decisionStatus: "APPROVED", approvedBy: ALEX.id });
  });

  it("an opt-out outranks an approval", async () => {
    const [target] = targets(1);
    const { batchId } = await draftSequence({ targets: [target] }, ALEX);
    await approveBatch(batchId, ALEX);
    await suppressAddress(target.picEmail.toUpperCase(), "STOP_REPLY", "test", ALEX);
    const result = await dispatchBatch(batchId, 1);
    expect(result).toMatchObject({ logged: 0, sent: 0, skipped: [{ id: expect.any(String), reason: "SUPPRESSED" }] });
    const [touch1] = (await listOutbox(batchId)).filter((r) => r.sequenceStep === 1);
    expect(touch1).toMatchObject({ status: "REJECTED", provenance: expect.objectContaining({ suppressed: "STOP_REPLY", dispatchSkipped: "SUPPRESSED" }) });
    const log = await rows(db(), sql`select id from tpms.outbound_messages where to_address = ${target.picEmail}`);
    expect(log).toHaveLength(0);
    await expect(draftSequence({ targets: [target] }, ALEX)).rejects.toMatchObject({ code: "OUTBOX_NO_TARGETS" });
  });

  it("a STOP reply after touch 1 marks it REPLIED and ends the sequence", async () => {
    const [target] = targets(1);
    const { batchId } = await draftSequence({ targets: [target] }, ALEX);
    await approveBatch(batchId, ALEX);
    expect(await dispatchBatch(batchId, 1)).toMatchObject({ logged: 1 });
    await suppressAddress(target.picEmail, "STOP_REPLY", "Inbound mail STOP reply", { type: "SYSTEM", id: "sys_inbound_mail" });
    const byStep = Object.fromEntries((await listOutbox(batchId)).map((r) => [r.sequenceStep, r.status]));
    expect(byStep[1]).toBe("REPLIED");
    expect(await dispatchBatch(batchId, 2)).toMatchObject({ logged: 0, skipped: [{ id: expect.any(String), reason: "SUPPRESSED" }] });
  });

  it("rejecting a batch sends nothing and resolves the decision as rejected", async () => {
    const { batchId } = await draftSequence({ targets: targets(1) }, ALEX);
    expect(await rejectBatch(batchId, ALEX, "Wrong list")).toMatchObject({ approved: 0, rejected: 3, dispatchTaskIds: [] });
    const decision = await one<{ status: string }>(db(), sql`select status from tpms.decisions where subject_ref = ${batchId}`);
    expect(decision?.status).toBe("REJECTED");
  });

  it("an operator edit is held to the same word budget and keeps the opt-out", async () => {
    const { batchId } = await draftSequence({ targets: targets(1) }, ALEX);
    const [row] = await listOutbox(batchId);
    const edited = await editOutboxDraft(row.id, { body: "Hi there,\n\nShort and human.\n\nAlex" }, ALEX);
    expect(edited.emailBodyText.endsWith(OPT_OUT_LINE)).toBe(true);
    expect(edited.provenance).toMatchObject({ source: "HUMAN_EDIT", editedBy: ALEX.id });
    await expect(editOutboxDraft(row.id, { body: Array.from({ length: 80 }, () => "word").join(" ") }, ALEX)).rejects.toMatchObject({
      code: "OUTBOX_OVER_WORD_BUDGET",
    });
  });

  it("queues a large list for asynchronous drafting under the requesting operator", async () => {
    const { taskId } = await requestDraftSequence({ targets: targets(2) }, ALEX);
    const [task] = await rows<Task>(db(), sql`select id, task_type as "taskType", payload from tpms.task_queue where id = ${taskId}::uuid`);
    const handler = handlers["outbound.draft_sequence"];
    if (!handler) throw new Error("no draft handler");
    const result = await handler(task, { workerId: "t", heartbeat: async () => undefined });
    expect(result).toMatchObject({ rows: 6, targets: 2 });
  });
});
