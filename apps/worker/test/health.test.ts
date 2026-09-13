import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createHealthServer, healthReport } from "../src/health";
import type { LoopStats } from "../src/loop";

function stats(overrides: Partial<LoopStats> = {}): LoopStats {
  return {
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
    ...overrides,
  };
}

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = null;
});

describe("healthReport", () => {
  it("is ok while claims are landing", () => {
    expect(healthReport({ port: 0, workerId: "w", stats: stats() }).status).toBe("ok");
  });

  it("degrades once claims have failed consecutively, so a stuck worker is replaced", () => {
    expect(healthReport({ port: 0, workerId: "w", stats: stats({ claimErrors: 3 }) }).status).toBe(
      "degraded",
    );
  });

  it("reports uptime from the recorded start", () => {
    const report = healthReport({
      port: 0,
      workerId: "w",
      stats: stats(),
      startedAt: 1_000,
      now: () => 61_000,
    });
    expect(report.uptimeSeconds).toBe(60);
  });
});

describe("/healthz", () => {
  it("answers 200 with the worker id and the loop counters", async () => {
    server = createHealthServer({
      port: 0,
      workerId: "worker-health",
      stats: stats({ succeeded: 4 }),
    });
    await new Promise((resolve) => server!.once("listening", resolve));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { workerId: string; stats: LoopStats };
    expect(body.workerId).toBe("worker-health");
    expect(body.stats.succeeded).toBe(4);
  });

  it("answers 503 when the worker cannot claim", async () => {
    server = createHealthServer({ port: 0, workerId: "w", stats: stats({ claimErrors: 9 }) });
    await new Promise((resolve) => server!.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(503);
  });

  it("404s anything else, so the path is not a general-purpose endpoint by accident", async () => {
    server = createHealthServer({ port: 0, workerId: "w", stats: stats() });
    await new Promise((resolve) => server!.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
  });
});
