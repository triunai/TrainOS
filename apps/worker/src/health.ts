/**
 * `/healthz`.
 *
 * Railway needs an HTTP origin to call, and doc 08 §10 puts the four inbound
 * webhooks on this same service later, so the server is here from the start
 * rather than bolted on.
 *
 * The check is honest about the one thing that actually matters: can this
 * worker still reach the database? A process that is alive but has failed its
 * last few claims is not healthy, and reporting 200 for it means a stuck
 * worker is never replaced.
 */

import { createServer, type Server } from "node:http";
import type { LoopStats } from "./loop";

export interface HealthOptions {
  port: number;
  workerId: string;
  stats: LoopStats;
  /** Consecutive claim failures after which the worker reports unhealthy. */
  claimErrorThreshold?: number;
  startedAt?: number;
  now?: () => number;
}

export interface HealthReport {
  status: "ok" | "degraded";
  workerId: string;
  uptimeSeconds: number;
  stats: LoopStats;
}

export function healthReport(opts: HealthOptions): HealthReport {
  const now = (opts.now ?? Date.now)();
  const startedAt = opts.startedAt ?? now;
  const threshold = opts.claimErrorThreshold ?? 3;
  return {
    status: opts.stats.claimErrors >= threshold ? "degraded" : "ok",
    workerId: opts.workerId,
    uptimeSeconds: Math.floor((now - startedAt) / 1000),
    stats: opts.stats,
  };
}

export function createHealthServer(opts: HealthOptions): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== "/healthz") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const report = healthReport(opts);
    res.writeHead(report.status === "ok" ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(report));
  });
  server.listen(opts.port);
  return server;
}
