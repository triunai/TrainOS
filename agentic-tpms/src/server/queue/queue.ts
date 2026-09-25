import { sql } from "drizzle-orm";
import { type Executor, db, rows } from "../db/client";
import type { Task } from "../db/schema";

/**
 * The transactional task queue. `enqueue` takes the caller's executor, so a
 * reaction is committed in the same transaction as the state change that
 * caused it (a transactional outbox): there is no window where the package
 * moved but its follow-up work was lost.
 *
 * Leasing is `tpms.claim_due`, a SELECT ... FOR UPDATE SKIP LOCKED. Two
 * workers never lease the same row, and a row whose lease lapsed because its
 * worker died is reclaimable after `leaseSeconds` (NFR-2: five minutes).
 */
export const TASK_TYPES = [
  "lead.triage",
  "lead.whatsapp_micro_tna",
  "outbound.draft_sequence",
  "outbound.dispatch_batch",
  "commercial.draft_proposal",
  "commercial.dispatch_quotation",
  "grant.compile_dossier",
  "grant.extract_letter",
  "viability.t14_check",
  "delivery.issue_magic_links",
  "delivery.start",
  "attendance.ocr_t3",
  "evidence.photo_exif",
  "certificates.issue",
  "claims.collate",
  "finance.draft_payment_vouchers",
  "retention.schedule",
  "retention.run",
  "knowledge.embed",
  "system.expire_holds",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface EnqueueInput {
  type: TaskType;
  payload: Record<string, unknown>;
  dueAt?: Date;
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
}

export const DEFAULT_LEASE_SECONDS = 300;

/** Returns the task id, or null when the idempotency key already exists. */
export async function enqueue(executor: Executor, input: EnqueueInput): Promise<string | null> {
  if (!(TASK_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`Unknown task type: ${input.type}`);
  }
  const result = await rows<{ id: string }>(
    executor,
    sql`insert into tpms.task_queue (task_type, payload, claim_due, idempotency_key, priority, max_attempts)
        values (${input.type}, ${JSON.stringify(input.payload)}::jsonb, ${input.dueAt ?? new Date()},
                ${input.idempotencyKey ?? null}, ${input.priority ?? 0}, ${input.maxAttempts ?? 5})
        on conflict (idempotency_key) do nothing
        returning id`,
  );
  return result[0]?.id ?? null;
}

export async function claimDue(
  workerId: string,
  limit = 5,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  types?: TaskType[],
  executor: Executor = db(),
): Promise<Task[]> {
  const typeArray = types && types.length ? sql`${`{${types.join(",")}}`}::text[]` : sql`null::text[]`;
  const leased = await rows<Record<string, unknown>>(
    executor,
    sql`select * from tpms.claim_due(${workerId}, ${limit}, ${leaseSeconds}, ${typeArray})`,
  );
  return leased.map(toTask);
}

export async function completeTask(id: string, result: Record<string, unknown> = {}, executor: Executor = db()): Promise<void> {
  await executor.execute(sql`update tpms.task_queue
       set status = 'COMPLETED', completed_at = now(), locked_until = null, result = ${JSON.stringify(result)}::jsonb
     where id = ${id}::uuid`);
}

/** Exponential backoff: 30s, 60s, 120s ... capped at one hour. */
export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}

export async function failTask(task: Pick<Task, "id" | "attempts" | "maxAttempts">, error: string, executor: Executor = db()): Promise<"RETRY" | "DEAD"> {
  const dead = task.attempts >= task.maxAttempts;
  await executor.execute(sql`update tpms.task_queue
       set status = ${dead ? "FAILED" : "QUEUED"},
           last_error = ${error.slice(0, 4000)},
           locked_until = null,
           locked_by = null,
           claim_due = now() + make_interval(secs => ${backoffSeconds(task.attempts)})
     where id = ${task.id}::uuid`);
  return dead ? "DEAD" : "RETRY";
}

export async function extendLease(id: string, seconds = DEFAULT_LEASE_SECONDS, executor: Executor = db()): Promise<void> {
  await executor.execute(sql`update tpms.task_queue
       set locked_until = now() + make_interval(secs => ${seconds})
     where id = ${id}::uuid and status = 'PROCESSING'`);
}

function toTask(r: Record<string, unknown>): Task {
  return {
    id: r.id as string,
    taskType: r.task_type as string,
    payload: r.payload as Record<string, unknown>,
    status: r.status as string,
    priority: Number(r.priority),
    lockedUntil: (r.locked_until as Date) ?? null,
    lockedBy: (r.locked_by as string) ?? null,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    claimDue: r.claim_due as Date,
    idempotencyKey: (r.idempotency_key as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    result: (r.result as Record<string, unknown>) ?? null,
    startedAt: (r.started_at as Date) ?? null,
    completedAt: (r.completed_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}
