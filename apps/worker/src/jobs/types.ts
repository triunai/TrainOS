/**
 * The row shape migration 012 hands back, and the vocabulary the handlers
 * answer in.
 *
 * `app.claim_jobs` returns `SETOF app.outbox`, so this interface is that table
 * column-for-column with the columns the worker actually reads. It is written
 * out rather than inferred because the worker is the only consumer that sees
 * these columns — `app` is not an exposed PostgREST schema, so there is no
 * generated type to lean on.
 */

/** `app.outbox.state`. */
export type JobState = "QUEUED" | "CLAIMED" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED";

/** One claimed row. */
export interface OutboxJob {
  id: string;
  tenant_id: string;
  job_type: string;
  state: JobState;
  priority: number;
  payload: Record<string, unknown>;
  event_id: string | null;
  run_id: string | null;
  action_request_id: string | null;
  correlation_id: string;
  effect_id: string | null;
  job_key: string | null;
  idempotency_subject: string | null;
  submission_attempt: number | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  claimed_at: string | null;
  claimed_by: string | null;
  visible_after: string | null;
}

/**
 * The error object `app.fail_job` demands: an object carrying `code`,
 * `message` and a BOOLEAN `retryable`. 012 checks all three and the
 * `outbox_last_error_shape` constraint checks them again at the column, so a
 * loosely typed bag here becomes a raised exception there.
 */
export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
  /** Anything else a handler wants in the audit trail. Never a secret. */
  detail?: Record<string, unknown>;
}

/**
 * The event `app.complete_job` will emit alongside the completion.
 *
 * 012 requires exactly `type`, `aggregateType`, `aggregateId` and `summary`
 * and refuses the call without them, so they are required here too.
 */
export interface JobEvent {
  type: string;
  aggregateType: string;
  aggregateId: string;
  summary: string;
  aggregateRef?: string;
  payload?: Record<string, unknown>;
  actor?: Record<string, unknown>;
  related?: unknown[];
}

/** A handler finished the work. */
export interface JobSucceeded {
  status: "SUCCEEDED";
  /** Becomes `app.outbox.result`, and 011's effect result via report_effect_result. */
  result?: Record<string, unknown>;
  /** Emitted by complete_job inside the same transaction as the state change. */
  event?: JobEvent;
}

/** A handler could not finish. `retryable` decides FAILED-with-backoff vs DEAD. */
export interface JobFailed {
  status: "FAILED";
  error: JobError;
}

/**
 * The slice ran out of budget with work still owed.
 *
 * 012 grants the worker `claim_jobs`, `heartbeat_job`, `complete_job`,
 * `fail_job`, `reap_jobs`, `cancel_jobs`, `replay_dead_letter` and
 * `enqueue_effect_jobs` — and `enqueue_effect_jobs` only enqueues jobs derived
 * from an 011 effect. There is no RPC that re-enqueues *this* row for a later
 * slice, so the only in-grant way to put the row back on the queue is a
 * retryable `fail_job`, which reschedules it with backoff. That is what the
 * loop does, and it is why {@link WORKER_YIELD_ERROR_CODE} is a code rather
 * than a free-text message: the yield must be greppable and must not read as
 * a genuine failure in the audit drawer.
 */
export interface JobYielded {
  status: "YIELDED";
  /** Why the slice stopped, for the rescheduling error's message. */
  reason: string;
  /** Checkpoint id the next slice resumes from, when one was written. */
  checkpointId?: string;
  detail?: Record<string, unknown>;
}

export type JobOutcome = JobSucceeded | JobFailed | JobYielded;

/** The code a yielded slice reschedules itself under. */
export const WORKER_YIELD_ERROR_CODE = "SLICE_YIELDED";

/** The code an unmapped job type dies under. Never retryable: it cannot improve. */
export const UNKNOWN_JOB_TYPE_ERROR_CODE = "UNKNOWN_JOB_TYPE";

/** Everything a handler is given. */
export interface JobContext {
  job: OutboxJob;
  /** This worker instance's id — the same string `claim_jobs` was called with. */
  workerId: string;
  /** Extends the lease. Safe to call repeatedly; the loop also does it on a timer. */
  heartbeat(): Promise<void>;
  /** Resolves a per-tenant BYOK provider key. Never reads the anon key. */
  keys: TenantKeys;
  log: JobLogger;
  /** Aborts when the process is shutting down or the lease can no longer be held. */
  signal: AbortSignal;
}

/** The narrow slice of the logger a handler needs. */
export interface JobLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Per-tenant key resolution, as the handlers see it. */
export interface TenantKeys {
  /** The secret for one provider in this job's tenant, or undefined when unset. */
  get(provider: string): Promise<string | undefined>;
  /** Which providers this tenant has a key for. */
  list(): Promise<string[]>;
}

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>;
