import { describe, expect, it, vi } from "vitest";
import { JobsRpc } from "../src/jobs/rpc";
import { JobRunner } from "../src/loop";
import { TenantKeyResolver } from "../src/keys";
import { createLogger } from "../src/logging";
import type { HandlerRegistry } from "../src/handlers";
import type { JobOutcome } from "../src/jobs/types";
import { FakeTransport, TENANT, fakeJob } from "./fake-transport";

const WORKER = "worker-loop-1";

function runnerFor(transport: FakeTransport, handlers: HandlerRegistry, overrides = {}) {
  const lines: string[] = [];
  const runner = new JobRunner({
    rpc: new JobsRpc(transport),
    handlers,
    keys: new TenantKeyResolver({ transport }),
    logger: createLogger({ level: "error", sink: (line) => lines.push(line) }),
    workerId: WORKER,
    tenantId: null,
    jobTypes: null,
    batchSize: 5,
    concurrency: 2,
    leaseSeconds: 300,
    heartbeatSeconds: 60,
    pacingMs: 0,
    sleep: async () => {},
    ...overrides,
  });
  return { runner, lines };
}

const succeed: JobOutcome = { status: "SUCCEEDED", result: { ok: true } };

describe("JobRunner.runOnce", () => {
  it("claims, dispatches by job type and completes through app.complete_job", async () => {
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob({ job_type: "OUTBOX_PUBLISH" })])
      .on("app.complete_job", []);
    const handler = vi.fn(async () => succeed);
    const { runner } = runnerFor(transport, { OUTBOX_PUBLISH: handler });

    expect(await runner.runOnce()).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
    expect(transport.callsTo("app.complete_job")).toHaveLength(1);
    expect(runner.stats.succeeded).toBe(1);
  });

  it("does nothing but sleep when the claim comes back empty", async () => {
    const transport = new FakeTransport().on("app.claim_jobs", []);
    const { runner } = runnerFor(transport, {});
    expect(await runner.runOnce()).toBe(0);
    expect(transport.callsTo("app.complete_job")).toHaveLength(0);
  });

  it("passes a handler's failure through to app.fail_job with its reason", async () => {
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob()])
      .on("app.fail_job", [{ state: "FAILED" }]);
    const { runner } = runnerFor(transport, {
      SEND_EMAIL: async () => ({
        status: "FAILED" as const,
        error: { code: "EMAIL_HTTP_429", message: "slow down", retryable: true },
      }),
    });

    await runner.runOnce();
    const error = JSON.parse(transport.paramsFor("app.fail_job")[3] as string);
    expect(error).toMatchObject({ code: "EMAIL_HTTP_429", retryable: true });
    expect(runner.stats.failed).toBe(1);
    expect(runner.stats.dead).toBe(0);
  });

  it("counts a dead-lettered job separately, because 012 tells it which happened", async () => {
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob()])
      .on("app.fail_job", [{ state: "DEAD" }]);
    const { runner } = runnerFor(transport, {
      SEND_EMAIL: async () => ({
        status: "FAILED" as const,
        error: { code: "INVALID_EMAIL_PAYLOAD", message: "no recipient", retryable: false },
      }),
    });
    await runner.runOnce();
    expect(runner.stats.dead).toBe(1);
    expect(runner.stats.failed).toBe(0);
  });

  it("reschedules a yielded slice as a retryable SLICE_YIELDED, carrying the checkpoint", async () => {
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob({ job_type: "AGENT_RUN_SLICE" })])
      .on("app.fail_job", [{ state: "FAILED" }]);
    const { runner } = runnerFor(transport, {
      AGENT_RUN_SLICE: async () => ({
        status: "YIELDED" as const,
        reason: "WALL_CLOCK",
        checkpointId: "ckpt_run_1_2_wall_clock_7",
      }),
    });

    await runner.runOnce();
    const params = transport.paramsFor("app.fail_job");
    const error = JSON.parse(params[3] as string);
    expect(error.code).toBe("SLICE_YIELDED");
    expect(error.retryable).toBe(true);
    expect(error.detail.checkpointId).toBe("ckpt_run_1_2_wall_clock_7");
    expect(params[4]).toBe(true);
    expect(runner.stats.yielded).toBe(1);
    expect(transport.callsTo("app.complete_job")).toHaveLength(0);
  });

  it("dead-letters an unmapped job type instead of retrying it five times", async () => {
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob({ job_type: "PUSH_INVOICE" })])
      .on("app.fail_job", [{ state: "DEAD" }]);
    const { runner } = runnerFor(transport, { SEND_EMAIL: async () => succeed });

    await runner.runOnce();
    const error = JSON.parse(transport.paramsFor("app.fail_job")[3] as string);
    expect(error.code).toBe("UNKNOWN_JOB_TYPE");
    expect(error.retryable).toBe(false);
  });

  it("treats a thrown handler as transient and lets 012 cap the attempts", async () => {
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob()])
      .on("app.fail_job", [{ state: "FAILED" }]);
    const { runner } = runnerFor(transport, {
      SEND_EMAIL: async () => {
        throw new Error("socket hang up");
      },
    });

    await runner.runOnce();
    const error = JSON.parse(transport.paramsFor("app.fail_job")[3] as string);
    expect(error).toMatchObject({ code: "HANDLER_EXCEPTION", retryable: true });
    expect(error.message).toContain("socket hang up");
  });

  it("runs a batch through a bounded number of lanes and completes every job", async () => {
    const jobs = Array.from({ length: 5 }, (_, index) =>
      fakeJob({ id: `4444444${index}-4444-4444-8444-444444444444`, job_type: "OUTBOX_PUBLISH" }),
    );
    const transport = new FakeTransport().on("app.claim_jobs", jobs).on("app.complete_job", []);
    let live = 0;
    let peak = 0;
    const { runner } = runnerFor(
      transport,
      {
        OUTBOX_PUBLISH: async () => {
          live += 1;
          peak = Math.max(peak, live);
          await new Promise((resolve) => setImmediate(resolve));
          live -= 1;
          return succeed;
        },
      },
      { concurrency: 2 },
    );

    expect(await runner.runOnce()).toBe(5);
    expect(peak).toBeLessThanOrEqual(2);
    expect(transport.callsTo("app.complete_job")).toHaveLength(5);
  });

  it("records a claim failure for the health check and rethrows", async () => {
    const transport = new FakeTransport().on("app.claim_jobs", () => {
      throw new Error("permission denied for function claim_jobs");
    });
    const { runner } = runnerFor(transport, {});
    await expect(runner.runOnce()).rejects.toThrow(/permission denied/);
    expect(runner.stats.claimErrors).toBe(1);
    expect(runner.stats.lastError).toContain("permission denied");
  });

  it("gives the handler the tenant's keys, not a shared key", async () => {
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob({ job_type: "AGENT_RUN_SLICE" })])
      .on("app.provider_key_for_tenant", [
        { provider: "anthropic", api_key: "sk-ant-secret", base_url: null },
      ])
      .on("app.complete_job", []);
    let seen: string | undefined;
    const { runner } = runnerFor(transport, {
      AGENT_RUN_SLICE: async (ctx) => {
        seen = await ctx.keys.get("anthropic");
        return succeed;
      },
    });

    await runner.runOnce();
    expect(seen).toBe("sk-ant-secret");
    expect(transport.paramsFor("app.provider_key_for_tenant")[0]).toBe(TENANT);
  });
});

describe("JobRunner heartbeat lease extension (S4)", () => {
  it("extends the lease by the full lease duration, not just the heartbeat interval", async () => {
    // 012's heartbeat_job sets visible_after = now() + p_extend. The extend
    // argument therefore has to be the lease length, not how often we beat —
    // passing the heartbeat interval resets the expiry to "now + a sliver",
    // which is shorter than what the original claim already granted.
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob({ job_type: "OUTBOX_PUBLISH" })])
      .on("app.heartbeat_job", [])
      .on("app.complete_job", []);
    let finish: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { runner } = runnerFor(
      transport,
      {
        OUTBOX_PUBLISH: async () => {
          await blocked;
          return succeed;
        },
      },
      { leaseSeconds: 300, heartbeatSeconds: 100 },
    );

    vi.useFakeTimers();
    try {
      const runOncePromise = runner.runOnce();
      await vi.advanceTimersByTimeAsync(100_000); // exactly one heartbeat tick
      finish();
      await runOncePromise;
    } finally {
      vi.useRealTimers();
    }

    expect(transport.paramsFor("app.heartbeat_job")[3]).toBe(300);
  });

  it("ctx.heartbeat() also extends by the full lease duration", async () => {
    const transport = new FakeTransport()
      .on("app.claim_jobs", [fakeJob({ job_type: "AGENT_RUN_SLICE" })])
      .on("app.heartbeat_job", [])
      .on("app.complete_job", []);
    const { runner } = runnerFor(
      transport,
      {
        AGENT_RUN_SLICE: async (ctx) => {
          await ctx.heartbeat();
          return succeed;
        },
      },
      { leaseSeconds: 300, heartbeatSeconds: 100 },
    );

    await runner.runOnce();

    expect(transport.paramsFor("app.heartbeat_job")[3]).toBe(300);
  });

  it("simulates a job running past one lease, with a heartbeat delayed by DB contention, and proves a concurrent reap does not reclaim it", async () => {
    // Reproduces the S4 race directly. lease=300s, heartbeat=100s. The first
    // heartbeat lands instantly; the second is slow (20s of simulated DB
    // contention), so at t=210s only the FIRST heartbeat's extension is in
    // effect. With the bug (extend = heartbeatSeconds), that first heartbeat
    // set visible_after to 200s at t=100 — already behind t=210 — so a
    // concurrent reap tick wrongly reclaims a job that is still actively
    // heartbeating. With the fix (extend = leaseSeconds), the first
    // heartbeat pushes visible_after to 400s, comfortably covering the gap
    // while the second heartbeat is still in flight.
    const leaseSeconds = 300;
    const heartbeatSeconds = 100;
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visibleAfterMs = leaseSeconds * 1_000; // what claim_jobs granted at t=0
    let heartbeatCalls = 0;

    try {
      const transport = new FakeTransport()
        .on("app.claim_jobs", [fakeJob({ job_type: "OUTBOX_PUBLISH" })])
        .on("app.heartbeat_job", (params) => {
          heartbeatCalls += 1;
          const extendSeconds = params[3] as number;
          const apply = () => {
            visibleAfterMs = Date.now() + extendSeconds * 1_000;
          };
          if (heartbeatCalls === 2) {
            // The second heartbeat is slow to land — DB contention, GC pause,
            // or plain network latency. A production reaper tick does not wait.
            return new Promise<unknown[]>((resolve) => {
              setTimeout(() => {
                apply();
                resolve([]);
              }, 20_000);
            });
          }
          apply();
          return [];
        })
        .on("app.reap_jobs", () => [{ reaped: Date.now() > visibleAfterMs ? 1 : 0 }])
        .on("app.complete_job", []);

      let finish: () => void = () => {};
      const blocked = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const { runner } = runnerFor(
        transport,
        {
          OUTBOX_PUBLISH: async () => {
            await blocked;
            return succeed;
          },
        },
        { leaseSeconds, heartbeatSeconds },
      );

      const runOncePromise = runner.runOnce();
      await vi.advanceTimersByTimeAsync(100_000); // t=100s: first heartbeat fires and lands
      await vi.advanceTimersByTimeAsync(100_000); // t=200s: second heartbeat starts, 20s from landing
      await vi.advanceTimersByTimeAsync(10_000); // t=210s: second heartbeat still in flight

      const reaped = await runner.reap();
      expect(reaped).toBe(0);

      await vi.advanceTimersByTimeAsync(20_000); // let the slow heartbeat land
      finish();
      await runOncePromise;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("JobRunner.reap", () => {
  it("sweeps expired leases and accumulates the count", async () => {
    const transport = new FakeTransport().on("app.reap_jobs", [{ reaped: 3 }]);
    const { runner } = runnerFor(transport, {});
    expect(await runner.reap()).toBe(3);
    expect(runner.stats.reaped).toBe(3);
  });

  it("swallows a reap failure rather than taking the loop down with it", async () => {
    const transport = new FakeTransport().on("app.reap_jobs", () => {
      throw new Error("deadlock detected");
    });
    const { runner } = runnerFor(transport, {});
    expect(await runner.reap()).toBe(0);
    expect(runner.stats.lastError).toContain("deadlock detected");
  });
});

describe("JobRunner.run", () => {
  it("stops claiming after stop() and leaves the loop", async () => {
    const transport = new FakeTransport().on("app.claim_jobs", []);
    const { runner } = runnerFor(transport, {});
    const loop = runner.run({ idleMs: 0, errorMs: 0 });
    runner.stop();
    await loop;
    expect(runner.signal.aborted).toBe(true);
  });
});
