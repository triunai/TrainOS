/**
 * The claim loop.
 *
 * Claim a batch, run it, report each outcome, sleep when there is nothing to
 * do. The concurrency safety is not here — it is inside `app.claim_jobs`,
 * whose `FOR UPDATE SKIP LOCKED` gives two workers disjoint batches. This file
 * therefore takes no locks and coordinates with no other instance, which is
 * the whole point of putting the claim in SQL.
 *
 * What this file does own: the lease. A claimed row is ours only until
 * `visible_after`, so every in-flight job carries a heartbeat timer, and the
 * timer is cleared in `finally` — the one place it is cleared from, because a
 * heartbeat that outlives its job extends a lease nobody is working under and
 * defeats `app.reap_jobs`.
 */

import { JobsRpc } from "./jobs/rpc";
import {
  WORKER_YIELD_ERROR_CODE,
  type JobContext,
  type JobOutcome,
  type OutboxJob,
} from "./jobs/types";
import { dispatch, type HandlerRegistry } from "./handlers";
import type { Logger } from "./logging";
import type { TenantKeyResolver } from "./keys";

export interface LoopStats {
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
  yielded: number;
  reaped: number;
  /** Consecutive claim failures. The health check reads this. */
  claimErrors: number;
  lastClaimAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  inFlight: number;
}

export interface JobRunnerOptions {
  rpc: JobsRpc;
  handlers: HandlerRegistry;
  keys: TenantKeyResolver;
  logger: Logger;
  workerId: string;
  tenantId: string | null;
  jobTypes: string[] | null;
  batchSize: number;
  concurrency: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
  pacingMs: number;
  /** Injected so tests do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export class JobRunner {
  readonly stats: LoopStats = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    yielded: 0,
    reaped: 0,
    claimErrors: 0,
    lastClaimAt: null,
    lastErrorAt: null,
    lastError: null,
    inFlight: 0,
  };

  private readonly abort = new AbortController();
  private stopped = false;

  constructor(private readonly opts: JobRunnerOptions) {}

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** Stop claiming. In-flight jobs finish; the caller waits on `drain()`. */
  stop(): void {
    this.stopped = true;
    this.abort.abort();
  }

  /**
   * One pass: claim, dispatch, report. Returns how many jobs ran.
   *
   * Separate from {@link run} so the suite exercises the whole pass without a
   * timer anywhere near it.
   */
  async runOnce(): Promise<number> {
    let jobs: OutboxJob[];
    try {
      jobs = await this.opts.rpc.claimJobs({
        workerId: this.opts.workerId,
        tenantId: this.opts.tenantId,
        types: this.opts.jobTypes,
        limit: this.opts.batchSize,
        leaseSeconds: this.opts.leaseSeconds,
      });
      this.stats.claimErrors = 0;
      this.stats.lastClaimAt = this.clock().toISOString();
    } catch (cause) {
      this.stats.claimErrors += 1;
      this.noteError(cause, "claim failed");
      throw cause;
    }

    this.stats.claimed += jobs.length;
    if (jobs.length === 0) return 0;

    // A bounded window rather than Promise.all over the whole batch: the batch
    // size is a database-side fairness knob (012 ranks per tenant before it
    // takes any tenant's second job) and the concurrency is a local resource
    // limit. Conflating them makes one of the two unadjustable.
    const queue = [...jobs];
    const lanes = Math.min(this.opts.concurrency, queue.length);
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        for (;;) {
          const job = queue.shift();
          if (!job) return;
          if (this.opts.pacingMs > 0) await this.sleep(this.opts.pacingMs);
          await this.runJob(job);
        }
      }),
    );
    return jobs.length;
  }

  /** Claim forever, sleeping `idleMs` on an empty batch and `errorMs` on a fault. */
  async run(opts: { idleMs: number; errorMs: number }): Promise<void> {
    while (!this.stopped) {
      try {
        const count = await this.runOnce();
        if (count === 0) await this.sleep(opts.idleMs);
      } catch {
        // Already recorded in stats by runOnce; the sleep is the back-off that
        // keeps a database outage from becoming a tight reconnect loop.
        await this.sleep(opts.errorMs);
      }
    }
  }

  /** Sweep expired leases. Doc 08 §10 moves this to pg_cron once 015 exists. */
  async reap(limit = 1000): Promise<number> {
    try {
      const count = await this.opts.rpc.reapJobs(limit, this.opts.tenantId);
      this.stats.reaped += count;
      return count;
    } catch (cause) {
      this.noteError(cause, "reap failed");
      return 0;
    }
  }

  private async runJob(job: OutboxJob): Promise<void> {
    const log = this.opts.logger.child({
      jobId: job.id,
      jobType: job.job_type,
      tenantId: job.tenant_id,
    });
    const beat = setInterval(() => {
      // Extend by the FULL lease, not by the heartbeat interval. 012's
      // heartbeat_job sets `visible_after = now() + p_extend`, so passing
      // anything shorter than the lease resets the expiry to "now plus a
      // sliver" — sooner than what the original claim already granted (S4) —
      // and races app.reap_jobs on every single beat instead of only if a
      // beat is missed entirely.
      void this.opts.rpc
        .heartbeatJob(job, this.opts.workerId, this.opts.leaseSeconds)
        .catch((cause: unknown) => {
          // The lease is gone — reaped, cancelled, or taken. Nothing to do but
          // say so: complete_job and fail_job will refuse for the same reason.
          log.warn("heartbeat refused; the lease is no longer ours", { error: String(cause) });
        });
    }, this.opts.heartbeatSeconds * 1_000);
    // `unref` so a pending heartbeat cannot hold the process open at shutdown.
    beat.unref?.();

    this.stats.inFlight += 1;
    try {
      const ctx: JobContext = {
        job,
        workerId: this.opts.workerId,
        heartbeat: () =>
          this.opts.rpc.heartbeatJob(job, this.opts.workerId, this.opts.leaseSeconds),
        keys: this.opts.keys.forTenant(job.tenant_id),
        log,
        signal: this.abort.signal,
      };
      const outcome = await dispatch(this.opts.handlers, ctx);
      await this.report(job, outcome, log);
    } catch (cause) {
      // A handler that threw told us nothing about whether it can succeed
      // later, so the safe reading is transient: 012 caps the attempts and
      // dead-letters it if it is not.
      this.noteError(cause, "handler threw");
      await this.reportFailure(
        job,
        {
          code: "HANDLER_EXCEPTION",
          message: cause instanceof Error ? cause.message : String(cause),
          retryable: true,
        },
        log,
      );
    } finally {
      clearInterval(beat);
      this.stats.inFlight -= 1;
    }
  }

  private async report(job: OutboxJob, outcome: JobOutcome, log: Logger): Promise<void> {
    if (outcome.status === "SUCCEEDED") {
      await this.opts.rpc.completeJob(job, this.opts.workerId, outcome.result ?? {}, outcome.event);
      this.stats.succeeded += 1;
      log.info("job completed");
      return;
    }
    if (outcome.status === "YIELDED") {
      // The only in-grant way to put this row back on the queue. It costs an
      // attempt, which is why a multi-slice run needs `max_attempts` headroom.
      this.stats.yielded += 1;
      await this.reportFailure(
        job,
        {
          code: WORKER_YIELD_ERROR_CODE,
          message: `slice yielded (${outcome.reason}); resume from the checkpoint`,
          retryable: true,
          ...(outcome.checkpointId || outcome.detail
            ? { detail: { ...(outcome.detail ?? {}), checkpointId: outcome.checkpointId ?? null } }
            : {}),
        },
        log,
      );
      return;
    }
    await this.reportFailure(job, outcome.error, log);
  }

  private async reportFailure(
    job: OutboxJob,
    error: { code: string; message: string; retryable: boolean; detail?: Record<string, unknown> },
    log: Logger,
  ): Promise<void> {
    const state = await this.opts.rpc.failJob(job, this.opts.workerId, error);
    if (state === "DEAD") this.stats.dead += 1;
    else this.stats.failed += 1;
    log.warn("job reported as failed", { state, code: error.code, retryable: error.retryable });
  }

  private noteError(cause: unknown, message: string): void {
    this.stats.lastErrorAt = this.clock().toISOString();
    this.stats.lastError = `${message}: ${cause instanceof Error ? cause.message : String(cause)}`;
    this.opts.logger.error(message, { error: String(cause) });
  }

  private clock(): Date {
    return (this.opts.now ?? (() => new Date()))();
  }

  private sleep(ms: number): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }
}
