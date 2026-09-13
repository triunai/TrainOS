/**
 * The entry point.
 *
 * Assembles config, transport, RPCs, key resolver, handlers, loop and health
 * server, then hands the process over to the loop. Deploy order matters and is
 * not this file's to enforce: SQL first, then the worker, then the schedule —
 * doc 08 §10's "edge-deploy-skew" trap, which applies to Railway exactly as it
 * did to an Edge Function.
 */

import { pathToFileURL } from "node:url";

import { loadConfig } from "./config";
import { buildHandlers, JOB_TYPES, UNIMPLEMENTED_012_JOB_TYPES } from "./handlers";
import { createHealthServer } from "./health";
import { JobsRpc } from "./jobs/rpc";
import { TenantKeyResolver } from "./keys";
import { createLogger } from "./logging";
import { JobRunner } from "./loop";
import { PostgresTransport } from "./transport";

export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, bindings: { workerId: config.workerId } });

  const transport = new PostgresTransport({
    connectionString: config.databaseUrl,
    role: config.databaseRole,
    max: config.poolMax,
    ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  const rpc = new JobsRpc(transport);
  const keys = new TenantKeyResolver({ transport, rpc: config.byokRpc, ttlMs: config.byokTtlMs });
  const handlers = buildHandlers({
    sliceWallClockMs: config.sliceWallClockMs,
    email: config.email,
    whatsapp: config.whatsapp,
  });

  // A typo in WORKER_JOB_TYPES is otherwise a queue that never drains and a
  // worker that looks perfectly healthy while doing nothing.
  for (const type of config.jobTypes ?? []) {
    if (!(type in handlers)) {
      throw new Error(
        `WORKER_JOB_TYPES names ${type}, which this worker has no handler for. Known: ${Object.keys(handlers).join(", ")}`,
      );
    }
  }

  const runner = new JobRunner({
    rpc,
    handlers,
    keys,
    logger,
    workerId: config.workerId,
    tenantId: config.tenantId,
    jobTypes: config.jobTypes,
    batchSize: config.batchSize,
    concurrency: config.concurrency,
    leaseSeconds: config.leaseSeconds,
    heartbeatSeconds: config.heartbeatSeconds,
    pacingMs: config.pacingMs,
  });

  const startedAt = Date.now();
  const health = createHealthServer({
    port: config.port,
    workerId: config.workerId,
    stats: runner.stats,
    startedAt,
  });

  const reaper =
    config.reapIntervalMs > 0
      ? setInterval(() => {
          void runner.reap();
        }, config.reapIntervalMs)
      : null;
  reaper?.unref?.();

  logger.info("worker started", {
    port: config.port,
    jobTypes: config.jobTypes ?? Object.keys(handlers),
    unimplemented012JobTypes: UNIMPLEMENTED_012_JOB_TYPES,
    leaseSeconds: config.leaseSeconds,
    concurrency: config.concurrency,
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal, inFlight: runner.stats.inFlight });
    runner.stop();
    if (reaper) clearInterval(reaper);
    health.close();
    // In-flight jobs keep their lease while they finish. Anything still running
    // when the grace period ends is left to `app.reap_jobs`, which is exactly
    // the case that function exists for.
    const timer = setTimeout(() => {
      void transport.close().finally(() => process.exit(0));
    }, config.shutdownGraceMs);
    timer.unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await runner.run({ idleMs: config.idleSleepMs, errorMs: config.errorSleepMs });
  await transport.close();
}

export { JOB_TYPES };

// Started, not imported. The suite imports this module to type-check the
// assembly, and a worker that boots on import would claim real jobs from it.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((cause: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ level: "error", msg: "worker failed to start", error: String(cause) })}\n`,
    );
    process.exit(1);
  });
}
