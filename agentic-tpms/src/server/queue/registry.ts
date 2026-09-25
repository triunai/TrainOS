import type { Task } from "../db/schema";
import type { TaskType } from "./queue";

/**
 * A task handler. Throw a DomainError for a refusal that must not be retried
 * (the worker dead-letters it immediately with the code); throw anything else
 * for a transient failure (retried with backoff). Return a small JSON result.
 *
 * Each feature module exports `handlers` from its own `tasks.ts`, and
 * `worker/handlers.ts` composes them. A task type with no handler is an error
 * at startup, not a silent skip.
 */
export interface TaskContext {
  workerId: string;
  /** Extend the lease for long work (OCR, PDF bundles). */
  heartbeat: () => Promise<void>;
}

export type TaskHandler = (task: Task, ctx: TaskContext) => Promise<Record<string, unknown>>;
export type HandlerMap = Partial<Record<TaskType, TaskHandler>>;
