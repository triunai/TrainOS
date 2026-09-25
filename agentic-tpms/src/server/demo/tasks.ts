import { and, asc, eq, sql } from "drizzle-orm";
import { db, rows, schema } from "../db/client";
import type { Task } from "../db/schema";
import type { TaskType } from "../queue/queue";
import type { HandlerMap } from "../queue/registry";
import { runTask } from "../queue/worker";

/**
 * Running one package's queued task the way the worker would.
 *
 * `runTask` is the worker's own settle logic (handler, then COMPLETED, or a
 * DomainError dead-lettered at once, or a retry with backoff). The demo only
 * adds targeting — the task row for THIS package, not whatever `claim_due`
 * leases next — so a seed that builds a dozen packages never runs another
 * package's work by accident.
 *
 * Time: a task whose `claim_due` is still in the future is refused unless the
 * caller asks for a fast-forward, and every fast-forward is reported back so
 * the step log says plainly what ran ahead of its schedule.
 */
export class GoldenPathError extends Error {
  constructor(
    readonly step: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`[${step}] ${message}`);
    this.name = "GoldenPathError";
  }
}

export interface TaskRun {
  taskId: string;
  type: TaskType;
  dueAt: Date;
  fastForwarded: boolean;
  /** The handler's result as stored on the task row. */
  result: Record<string, unknown>;
  /** A worker other than this process ran it (it was already leased or completed). */
  byLiveWorker: boolean;
}

export interface RunOptions {
  step: string;
  handlers: HandlerMap;
  /** Allow running a task before its `claim_due` (the demo's explicit time travel). */
  fastForward?: boolean;
  /** Pick a specific row when several match. */
  taskId?: string;
  now?: Date;
}

const MYT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const formatMyt = (d: Date) => `${MYT.format(d)} MYT`;

/** Queued (or still-running) rows of one type whose payload contains `match`, oldest due first. */
export async function tasksFor(type: TaskType, match: Record<string, string>, statuses = ["QUEUED"]): Promise<Task[]> {
  return db()
    .select()
    .from(schema.taskQueue)
    .where(
      and(
        eq(schema.taskQueue.taskType, type),
        sql`${schema.taskQueue.status} = any (${`{${statuses.join(",")}}`}::text[])`,
        sql`${schema.taskQueue.payload} @> ${JSON.stringify(match)}::jsonb`,
      ),
    )
    .orderBy(asc(schema.taskQueue.claimDue), asc(schema.taskQueue.createdAt));
}

async function reload(id: string): Promise<Task> {
  const [task] = await db().select().from(schema.taskQueue).where(eq(schema.taskQueue.id, id));
  return task;
}

/** Wait for a row another worker leased; the golden path never races it. */
async function awaitSettled(id: string, step: string): Promise<Task> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const task = await reload(id);
    if (task.status !== "PROCESSING") return task;
    if (Date.now() > deadline) throw new GoldenPathError(step, `task ${task.taskType} ${id} stayed PROCESSING for 2 minutes`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Run the oldest queued `type` task for this payload match. Throws a
 * GoldenPathError naming the task if there is none, if it is not due and no
 * fast-forward was allowed, or if the handler did not complete.
 */
export async function runQueuedTask(type: TaskType, match: Record<string, string>, opts: RunOptions): Promise<TaskRun> {
  const now = opts.now ?? new Date();
  const queued = (await tasksFor(type, match, ["QUEUED", "PROCESSING"])).filter((t) => !opts.taskId || t.id === opts.taskId);
  let task = queued[0];
  if (!task) {
    // A live worker may already have run it (the dev database can have one attached).
    const [done] = (await tasksFor(type, match, ["COMPLETED"])).filter((t) => !opts.taskId || t.id === opts.taskId).slice(-1);
    if (done) return { taskId: done.id, type, dueAt: done.claimDue, fastForwarded: false, result: done.result ?? {}, byLiveWorker: true };
    throw new GoldenPathError(opts.step, `no queued ${type} task for ${JSON.stringify(match)}`);
  }
  if (task.status === "PROCESSING") {
    task = await awaitSettled(task.id, opts.step);
    if (task.status !== "COMPLETED") throw new GoldenPathError(opts.step, `${type} failed in a live worker: ${task.lastError}`, { taskId: task.id });
    return { taskId: task.id, type, dueAt: task.claimDue, fastForwarded: false, result: task.result ?? {}, byLiveWorker: true };
  }
  const notDue = task.claimDue.getTime() > now.getTime();
  if (notDue && !opts.fastForward) {
    throw new GoldenPathError(opts.step, `${type} is not due until ${formatMyt(task.claimDue)}; this step must fast-forward it explicitly`, { taskId: task.id });
  }

  const lines: string[] = [];
  const verdict = await runTask(task, { handlers: opts.handlers, workerId: "golden-path", log: (l) => lines.push(l) });
  const settled = await reload(task.id);
  if (verdict !== "COMPLETED" || settled.status !== "COMPLETED") {
    throw new GoldenPathError(opts.step, `${type} did not complete (${verdict}): ${settled.lastError ?? lines.join("; ")}`, {
      taskId: task.id,
      status: settled.status,
    });
  }
  return { taskId: task.id, type, dueAt: task.claimDue, fastForwarded: notDue, result: settled.result ?? {}, byLiveWorker: false };
}

/** Run every queued `type` task for the match, oldest first, until none is left. */
export async function runAllQueued(type: TaskType, match: Record<string, string>, opts: RunOptions): Promise<TaskRun[]> {
  const runs: TaskRun[] = [];
  for (let guard = 0; guard < 50; guard += 1) {
    const [next] = await tasksFor(type, match);
    if (!next) return runs;
    runs.push(await runQueuedTask(type, match, { ...opts, taskId: next.id }));
  }
  throw new GoldenPathError(opts.step, `${type} kept re-enqueueing itself (50 runs)`);
}

export interface TaskTotals {
  byStatus: Record<string, number>;
  /** FAILED rows: attempts exhausted, or a refusal dead-lettered at once. */
  deadLettered: Array<{ id: string; taskType: string; lastError: string | null }>;
  /** QUEUED rows carrying an error: a failure waiting for its retry. */
  retrying: Array<{ id: string; taskType: string; lastError: string | null }>;
  /** QUEUED rows not yet due, by type (the genuinely future work). */
  future: Record<string, number>;
}

/** Task queue totals, optionally for one package (tasks keyed by packageId, or by a retention schedule of it). */
export async function taskTotals(packageId?: string): Promise<TaskTotals> {
  const scope = packageId
    ? sql`where payload->>'packageId' = ${packageId}
             or payload->>'scheduleId' in (select id::text from tpms.renewal_schedules where source_package_id = ${packageId}::uuid)`
    : sql``;
  const all = await rows<{ id: string; task_type: string; status: string; last_error: string | null; claim_due: Date }>(
    db(),
    sql`select id, task_type, status, last_error, claim_due from tpms.task_queue ${scope}`,
  );
  const byStatus: Record<string, number> = {};
  const future: Record<string, number> = {};
  const now = Date.now();
  for (const t of all) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    if (t.status === "QUEUED" && new Date(t.claim_due).getTime() > now) future[t.task_type] = (future[t.task_type] ?? 0) + 1;
  }
  return {
    byStatus,
    deadLettered: all.filter((t) => t.status === "FAILED").map((t) => ({ id: t.id, taskType: t.task_type, lastError: t.last_error })),
    retrying: all.filter((t) => t.status === "QUEUED" && t.last_error).map((t) => ({ id: t.id, taskType: t.task_type, lastError: t.last_error })),
    future,
  };
}
