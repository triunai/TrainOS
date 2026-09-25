import { hostname } from "node:os";
import { isDomainError } from "../domain/errors";
import type { Task } from "../db/schema";
import { claimDue, completeTask, DEFAULT_LEASE_SECONDS, enqueue, extendLease, failTask, TASK_TYPES, type TaskType } from "./queue";
import type { HandlerMap } from "./registry";
import { db } from "../db/client";
import { todayMY } from "@/lib/dates";

/**
 * The task worker. Leases due tasks with claimDue (SKIP LOCKED), runs the
 * registered handler, heartbeats the lease while it runs, and settles the row:
 *   - success           → COMPLETED with the handler's small JSON result
 *   - DomainError       → FAILED immediately (a refusal is not retried, R2)
 *   - anything else     → retried with exponential backoff, then FAILED
 * A task type with no handler is a startup error, not a silent skip (R14).
 */
export interface WorkerOptions {
  handlers: HandlerMap;
  workerId?: string;
  concurrency?: number;
  leaseSeconds?: number;
  log?: (line: string) => void;
}

export function assertHandlersComplete(handlers: HandlerMap, allowMissing: readonly TaskType[] = []): void {
  const missing = TASK_TYPES.filter((t) => !handlers[t] && !allowMissing.includes(t));
  if (missing.length) throw new Error(`No handler registered for task types: ${missing.join(", ")}`);
}

export async function runTask(task: Task, opts: WorkerOptions): Promise<"COMPLETED" | "RETRY" | "DEAD"> {
  const log = opts.log ?? (() => undefined);
  const handler = opts.handlers[task.taskType as TaskType];
  if (!handler) {
    await failTask({ ...task, attempts: task.maxAttempts }, `NO_HANDLER: ${task.taskType}`);
    return "DEAD";
  }
  const workerId = opts.workerId ?? "worker";
  const lease = opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const beat = setInterval(() => void extendLease(task.id, lease).catch(() => undefined), Math.max(1000, (lease * 1000) / 3));
  try {
    const result = await handler(task, { workerId, heartbeat: () => extendLease(task.id, lease) });
    await completeTask(task.id, result ?? {});
    log(`✓ ${task.taskType} ${task.id.slice(0, 8)}`);
    return "COMPLETED";
  } catch (error) {
    const message = error instanceof Error ? `${isDomainError(error) ? `${error.code}: ` : ""}${error.message}` : String(error);
    const verdict = await failTask(isDomainError(error) ? { ...task, attempts: task.maxAttempts } : task, message);
    log(`✗ ${task.taskType} ${task.id.slice(0, 8)} ${verdict} — ${message}`);
    return verdict;
  } finally {
    clearInterval(beat);
  }
}

/** Process due tasks until none are left (tests, the golden path, `npm run worker -- --drain`). */
export async function drain(opts: WorkerOptions & { maxTasks?: number; types?: TaskType[] }): Promise<Record<string, number>> {
  const counts: Record<string, number> = { COMPLETED: 0, RETRY: 0, DEAD: 0 };
  const max = opts.maxTasks ?? 500;
  let processed = 0;
  while (processed < max) {
    const batch = await claimDue(opts.workerId ?? "drain", opts.concurrency ?? 4, opts.leaseSeconds, opts.types);
    if (batch.length === 0) break;
    const results = await Promise.all(batch.map((t) => runTask(t, opts)));
    for (const r of results) counts[r] += 1;
    processed += batch.length;
  }
  return counts;
}

/** Daily housekeeping tasks, enqueued idempotently per calendar day (MYT). */
export async function scheduleDailyTasks(): Promise<void> {
  const today = todayMY();
  await enqueue(db(), { type: "system.expire_holds", payload: { date: today }, idempotencyKey: `expire_holds:${today}` });
}

export async function runForever(opts: WorkerOptions & { pollMs?: number; signal?: AbortSignal }): Promise<void> {
  const workerId = opts.workerId ?? `worker-${hostname()}-${process.pid}`;
  const log = opts.log ?? console.log;
  const concurrency = opts.concurrency ?? 4;
  let lastDaily = "";
  log(`worker ${workerId} up · concurrency ${concurrency} · lease ${opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS}s`);
  while (!opts.signal?.aborted) {
    if (lastDaily !== todayMY()) {
      await scheduleDailyTasks().catch((e) => log(`daily schedule failed: ${String(e)}`));
      lastDaily = todayMY();
    }
    let batch: Task[] = [];
    try {
      batch = await claimDue(workerId, concurrency, opts.leaseSeconds);
    } catch (error) {
      log(`claim failed: ${String(error)}`);
    }
    if (batch.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 1000));
      continue;
    }
    await Promise.all(batch.map((t) => runTask(t, { ...opts, workerId, log })));
  }
  log(`worker ${workerId} stopped`);
}
