/**
 * Migration 012's worker surface, and nothing else.
 *
 * Every statement here is a call to one of the five functions `service_role`
 * holds EXECUTE on for the run loop — `claim_jobs`, `heartbeat_job`,
 * `complete_job`, `fail_job`, `reap_jobs` (`012:2718-2722`). Keeping them in
 * one file is what makes "worker-only RPCs are never part of the client
 * contract" (doc 08 §10) a property of the tree rather than a convention.
 *
 * The SQL text is literal and the arguments are bound. `interval` arguments go
 * through `make_interval(secs => $n)` so a duration crosses the boundary as a
 * number instead of as a string the server has to parse.
 */

import type { SqlTransport } from "../transport";
import type { JobError, JobEvent, OutboxJob } from "./types";

/**
 * `app.claim_jobs` and `app.heartbeat_job` both RAISE above six minutes,
 * because 012 was written when the worker was an Edge Function and six minutes
 * was its wall clock. A Node worker has no such lifetime, but the cap is
 * enforced in SQL, so the ceiling is real for us whatever our process can do —
 * the answer is to heartbeat inside the window, not to ask for a longer lease.
 */
export const MAX_LEASE_SECONDS = 360;

export interface ClaimOptions {
  workerId: string;
  /** NULL claims across every tenant, which is the normal shape. */
  tenantId?: string | null;
  /** NULL claims every type; a list is how a worker pool is split by job type. */
  types?: readonly string[] | null;
  limit: number;
  leaseSeconds: number;
  /** How deep the fair-ranking scan goes. NULL lets 012 pick `limit * 20`. */
  scan?: number | null;
}

export class JobsRpc {
  constructor(private readonly transport: SqlTransport) {}

  /**
   * Claim a batch.
   *
   * The FOR UPDATE SKIP LOCKED semantics live inside 012 — two workers calling
   * this concurrently take disjoint batches. Nothing on this side needs a lock,
   * and adding one would only serialise what the RPC already made parallel.
   */
  async claimJobs(opts: ClaimOptions): Promise<OutboxJob[]> {
    assertLease(opts.leaseSeconds, "claim");
    if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 1000) {
      throw new Error(`claimJobs: limit must be an integer in 1..1000, got ${opts.limit}`);
    }
    return this.transport.query<OutboxJob>(
      "SELECT * FROM app.claim_jobs($1, $2, $3, $4, make_interval(secs => $5), $6)",
      [
        opts.workerId,
        opts.tenantId ?? null,
        opts.types && opts.types.length > 0 ? [...opts.types] : null,
        opts.limit,
        opts.leaseSeconds,
        opts.scan ?? null,
      ],
    );
  }

  /**
   * Extend one lease.
   *
   * 012 checks `claimed_by = p_worker` and the tenant, and raises
   * `object_not_in_prerequisite_state` when either fails — which is precisely
   * what a worker whose lease the reaper already took back should hear.
   */
  async heartbeatJob(
    job: Pick<OutboxJob, "id" | "tenant_id">,
    workerId: string,
    extendSeconds: number,
  ): Promise<void> {
    assertLease(extendSeconds, "heartbeat");
    await this.transport.query("SELECT app.heartbeat_job($1, $2, $3, make_interval(secs => $4))", [
      job.id,
      job.tenant_id,
      workerId,
      extendSeconds,
    ]);
  }

  /**
   * Mark one job done.
   *
   * `event` rides in the same transaction as the state change, so a completion
   * that is visible in the drawer is a completion that happened. 012 also
   * reports the 011 effect result from inside this call when the job carries
   * an `effect_id` — the worker never writes a core table itself.
   */
  async completeJob(
    job: Pick<OutboxJob, "id" | "tenant_id">,
    workerId: string,
    result: Record<string, unknown> = {},
    event?: JobEvent,
  ): Promise<void> {
    await this.transport.query("SELECT app.complete_job($1, $2, $3, $4::jsonb, $5::jsonb)", [
      job.id,
      job.tenant_id,
      workerId,
      JSON.stringify(result ?? {}),
      event ? JSON.stringify(event) : null,
    ]);
  }

  /**
   * Report a failure with a reason, and learn what 012 decided.
   *
   * The return value is the new state: `FAILED` means rescheduled with
   * exponential backoff and full jitter, `DEAD` means dead-lettered, either
   * because attempts hit `max_attempts` or because the reason said the failure
   * is not retryable.
   */
  async failJob(
    job: Pick<OutboxJob, "id" | "tenant_id">,
    workerId: string,
    error: JobError,
  ): Promise<"FAILED" | "DEAD"> {
    const rows = await this.transport.query<{ state: "FAILED" | "DEAD" }>(
      "SELECT app.fail_job($1, $2, $3, $4::jsonb, $5) AS state",
      [
        job.id,
        job.tenant_id,
        workerId,
        JSON.stringify(normaliseError(error)),
        Boolean(error.retryable),
      ],
    );
    return rows[0]?.state ?? "FAILED";
  }

  /**
   * Requeue jobs whose lease expired, and dead-letter the ones out of attempts.
   *
   * Doc 08 §10 wants this on pg_cron once migration 015 exists. Until then the
   * worker runs it on a timer, because a crashed worker's rows are otherwise
   * invisible until something sweeps them.
   */
  async reapJobs(limit = 1000, tenantId: string | null = null): Promise<number> {
    const rows = await this.transport.query<{ reaped: number }>(
      "SELECT app.reap_jobs($1, $2) AS reaped",
      [tenantId, limit],
    );
    return Number(rows[0]?.reaped ?? 0);
  }
}

function assertLease(seconds: number, what: string): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_LEASE_SECONDS) {
    throw new Error(
      `${what}: lease must be > 0 and <= ${MAX_LEASE_SECONDS}s (012 raises above six minutes), got ${seconds}`,
    );
  }
}

/**
 * 012 checks `code`, `message` and a *boolean* `retryable`, and the
 * `outbox_last_error_shape` column constraint checks the JSON types of all
 * three again. Coercing here means a handler that returns a truthy string can
 * never reach the seam.
 */
function normaliseError(error: JobError): Record<string, unknown> {
  return {
    code: String(error.code),
    message: String(error.message),
    retryable: Boolean(error.retryable),
    ...(error.detail ? { detail: error.detail } : {}),
  };
}
