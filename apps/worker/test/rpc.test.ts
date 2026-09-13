import { describe, expect, it } from "vitest";
import { JobsRpc, MAX_LEASE_SECONDS } from "../src/jobs/rpc";
import { FakeTransport, TENANT, fakeJob } from "./fake-transport";

const WORKER = "worker-test-1";

describe("JobsRpc.claimJobs", () => {
  it("calls app.claim_jobs with the worker id, filters and an interval built from seconds", async () => {
    const transport = new FakeTransport().on("app.claim_jobs", [fakeJob()]);
    const rows = await new JobsRpc(transport).claimJobs({
      workerId: WORKER,
      tenantId: null,
      types: ["SEND_EMAIL", "OUTBOX_PUBLISH"],
      limit: 5,
      leaseSeconds: 300,
    });

    expect(rows).toHaveLength(1);
    const call = transport.callsTo("app.claim_jobs")[0]!;
    expect(call.text).toContain("make_interval(secs => $5)");
    expect(call.params).toEqual([WORKER, null, ["SEND_EMAIL", "OUTBOX_PUBLISH"], 5, 300, null]);
  });

  it("sends NULL rather than an empty array when no type filter is set", async () => {
    const transport = new FakeTransport().on("app.claim_jobs", []);
    await new JobsRpc(transport).claimJobs({
      workerId: WORKER,
      types: [],
      limit: 1,
      leaseSeconds: 60,
    });
    expect(transport.paramsFor("app.claim_jobs")[2]).toBeNull();
  });

  it("refuses a lease over six minutes before the statement is sent", async () => {
    const transport = new FakeTransport();
    await expect(
      new JobsRpc(transport).claimJobs({
        workerId: WORKER,
        limit: 1,
        leaseSeconds: MAX_LEASE_SECONDS + 1,
      }),
    ).rejects.toThrow(/six minutes/);
    expect(transport.calls).toHaveLength(0);
  });

  it("refuses a batch size outside 012's 1..1000", async () => {
    const transport = new FakeTransport();
    await expect(
      new JobsRpc(transport).claimJobs({ workerId: WORKER, limit: 1001, leaseSeconds: 60 }),
    ).rejects.toThrow(/1\.\.1000/);
    expect(transport.calls).toHaveLength(0);
  });
});

describe("JobsRpc.heartbeatJob", () => {
  it("passes the job, the tenant and the worker, because 012 checks all three", async () => {
    const transport = new FakeTransport().on("app.heartbeat_job", []);
    await new JobsRpc(transport).heartbeatJob(fakeJob(), WORKER, 60);
    expect(transport.paramsFor("app.heartbeat_job")).toEqual([fakeJob().id, TENANT, WORKER, 60]);
  });

  it("refuses an extension over the cap", async () => {
    const transport = new FakeTransport();
    await expect(new JobsRpc(transport).heartbeatJob(fakeJob(), WORKER, 400)).rejects.toThrow(
      /six minutes/,
    );
  });
});

describe("JobsRpc.completeJob", () => {
  it("serialises the result and the event as jsonb", async () => {
    const transport = new FakeTransport().on("app.complete_job", []);
    await new JobsRpc(transport).completeJob(
      fakeJob(),
      WORKER,
      { ok: true },
      {
        type: "EmailSent",
        aggregateType: "OUTBOX",
        aggregateId: fakeJob().id,
        summary: "sent",
      },
    );
    const params = transport.paramsFor("app.complete_job");
    expect(params.slice(0, 3)).toEqual([fakeJob().id, TENANT, WORKER]);
    expect(JSON.parse(params[3] as string)).toEqual({ ok: true });
    expect(JSON.parse(params[4] as string)).toMatchObject({ type: "EmailSent", summary: "sent" });
  });

  it("sends NULL for the event when the handler emitted none", async () => {
    const transport = new FakeTransport().on("app.complete_job", []);
    await new JobsRpc(transport).completeJob(fakeJob(), WORKER);
    expect(transport.paramsFor("app.complete_job")[4]).toBeNull();
  });
});

describe("JobsRpc.failJob", () => {
  it("returns the state 012 decided", async () => {
    const transport = new FakeTransport().on("app.fail_job", [{ state: "DEAD" }]);
    const state = await new JobsRpc(transport).failJob(fakeJob(), WORKER, {
      code: "X",
      message: "y",
      retryable: false,
    });
    expect(state).toBe("DEAD");
  });

  it("coerces retryable to a real boolean, which 012 and the column both require", async () => {
    const transport = new FakeTransport().on("app.fail_job", [{ state: "FAILED" }]);
    await new JobsRpc(transport).failJob(fakeJob(), WORKER, {
      code: "X",
      message: "y",
      retryable: "yes" as unknown as boolean,
    });
    const params = transport.paramsFor("app.fail_job");
    expect(JSON.parse(params[3] as string)).toEqual({ code: "X", message: "y", retryable: true });
    expect(params[4]).toBe(true);
  });

  it("keeps a handler's detail alongside the three required keys", async () => {
    const transport = new FakeTransport().on("app.fail_job", [{ state: "FAILED" }]);
    await new JobsRpc(transport).failJob(fakeJob(), WORKER, {
      code: "X",
      message: "y",
      retryable: true,
      detail: { checkpointId: "ckpt_1" },
    });
    expect(JSON.parse(transport.paramsFor("app.fail_job")[3] as string).detail).toEqual({
      checkpointId: "ckpt_1",
    });
  });
});

describe("JobsRpc.reapJobs", () => {
  it("returns the count 012 reaped", async () => {
    const transport = new FakeTransport().on("app.reap_jobs", [{ reaped: 7 }]);
    expect(await new JobsRpc(transport).reapJobs(500, null)).toBe(7);
    expect(transport.paramsFor("app.reap_jobs")).toEqual([null, 500]);
  });

  it("reports zero when the function returned nothing", async () => {
    const transport = new FakeTransport().on("app.reap_jobs", []);
    expect(await new JobsRpc(transport).reapJobs()).toBe(0);
  });
});
