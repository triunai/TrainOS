import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rows } from "@/server/db/client";
import { claimDue, completeTask, enqueue, failTask } from "@/server/queue/queue";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

describe("task queue — claimDue with FOR UPDATE SKIP LOCKED", () => {
  it("never leases one task to two concurrent workers", async () => {
    for (let i = 0; i < 60; i += 1) {
      await enqueue(db(), { type: "knowledge.embed", payload: { i }, idempotencyKey: `concurrency-${i}` });
    }
    const workers = Array.from({ length: 6 }, (_, w) => claimDue(`w${w}`, 15, 300, ["knowledge.embed"]));
    const leased = (await Promise.all(workers)).flat();
    const ids = leased.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(60);
  });

  it("is idempotent on the idempotency key", async () => {
    const first = await enqueue(db(), { type: "system.expire_holds", payload: {}, idempotencyKey: "daily-2026-09-25" });
    const second = await enqueue(db(), { type: "system.expire_holds", payload: {}, idempotencyKey: "daily-2026-09-25" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("does not lease a task before it is due", async () => {
    await enqueue(db(), { type: "retention.run", payload: {}, dueAt: new Date(Date.now() + 3600_000), idempotencyKey: "future" });
    const leased = await claimDue("w-future", 10, 300, ["retention.run"]);
    expect(leased).toHaveLength(0);
  });

  it("reclaims a task whose worker died (lease expired)", async () => {
    await enqueue(db(), { type: "delivery.start", payload: {}, idempotencyKey: "crash" });
    const [task] = await claimDue("w-crashes", 1, 1, ["delivery.start"]);
    expect(task).toBeDefined();
    expect(await claimDue("w-other", 1, 300, ["delivery.start"])).toHaveLength(0);
    await db().execute(sql`update tpms.task_queue set locked_until = now() - interval '1 second' where id = ${task.id}::uuid`);
    const [again] = await claimDue("w-other", 1, 300, ["delivery.start"]);
    expect(again.id).toBe(task.id);
    expect(again.attempts).toBe(2);
    expect(again.lockedBy).toBe("w-other");
  });

  it("retries with backoff, then dead-letters after max attempts", async () => {
    await enqueue(db(), { type: "claims.collate", payload: {}, idempotencyKey: "flaky", maxAttempts: 2 });
    const [t1] = await claimDue("w", 1, 300, ["claims.collate"]);
    expect(await failTask(t1, "boom")).toBe("RETRY");
    await db().execute(sql`update tpms.task_queue set claim_due = now() where id = ${t1.id}::uuid`);
    const [t2] = await claimDue("w", 1, 300, ["claims.collate"]);
    expect(await failTask(t2, "boom again")).toBe("DEAD");
    const [row] = await rows<{ status: string; last_error: string }>(db(), sql`select status, last_error from tpms.task_queue where id = ${t1.id}::uuid`);
    expect(row).toEqual({ status: "FAILED", last_error: "boom again" });
  });

  it("completes a task and records its result", async () => {
    await enqueue(db(), { type: "lead.triage", payload: {}, idempotencyKey: "ok" });
    const [task] = await claimDue("w", 1, 300, ["lead.triage"]);
    await completeTask(task.id, { routed: "TNA" });
    const [row] = await rows<{ status: string; result: unknown }>(db(), sql`select status, result from tpms.task_queue where id = ${task.id}::uuid`);
    expect(row).toEqual({ status: "COMPLETED", result: { routed: "TNA" } });
  });
});
