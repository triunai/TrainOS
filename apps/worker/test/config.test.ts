import { describe, expect, it } from "vitest";
import { assertNotAnonKey, defaultWorkerId, loadConfig, type Env } from "../src/config";
import { MAX_LEASE_SECONDS } from "../src/jobs/rpc";

const BASE: Env = { WORKER_DATABASE_URL: "postgresql://postgres:pw@localhost:5432/postgres" };

describe("loadConfig", () => {
  it("refuses to start without a database URL and says why", () => {
    expect(() => loadConfig({})).toThrow(/app` schema/);
  });

  it("defaults the session role to service_role, which is the role 012 granted", () => {
    expect(loadConfig(BASE).databaseRole).toBe("service_role");
  });

  it("keeps the heartbeat comfortably inside the lease", () => {
    const config = loadConfig({ ...BASE, WORKER_LEASE_SECONDS: "300" });
    expect(config.heartbeatSeconds).toBeLessThan(config.leaseSeconds);
    expect(config.heartbeatSeconds).toBe(100);
  });

  it("refuses a lease 012 would raise on", () => {
    expect(() =>
      loadConfig({ ...BASE, WORKER_LEASE_SECONDS: String(MAX_LEASE_SECONDS + 1) }),
    ).toThrow(/1\.\.360/);
  });

  it("derives the slice budget from the lease, not from the Edge runtime's 300s", () => {
    const config = loadConfig({ ...BASE, WORKER_LEASE_SECONDS: "120" });
    expect(config.sliceWallClockMs).toBe(90_000);
  });

  it("parses the job-type filter into a list and drops the blanks", () => {
    expect(
      loadConfig({ ...BASE, WORKER_JOB_TYPES: "SEND_EMAIL, ,OUTBOX_PUBLISH" }).jobTypes,
    ).toEqual(["SEND_EMAIL", "OUTBOX_PUBLISH"]);
    expect(loadConfig({ ...BASE, WORKER_JOB_TYPES: "  " }).jobTypes).toBeNull();
  });

  it("rejects a non-integer where an integer is expected", () => {
    expect(() => loadConfig({ ...BASE, WORKER_BATCH_SIZE: "five" })).toThrow(/integer/);
  });

  it("rejects an unknown log level rather than silently choosing one", () => {
    expect(() => loadConfig({ ...BASE, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });

  it("defaults the BYOK rpc to the function a later migration must supply", () => {
    expect(loadConfig(BASE).byokRpc).toBe("app.provider_key_for_tenant");
  });

  it("is frozen, so nothing downstream can edit the boot decision", () => {
    expect(Object.isFrozen(loadConfig(BASE))).toBe(true);
  });
});

describe("assertNotAnonKey", () => {
  it("refuses a connection string carrying the anon key", () => {
    expect(() =>
      assertNotAnonKey({
        SUPABASE_ANON_KEY: "anon-abc",
        WORKER_DATABASE_URL: "postgres://x/anon-abc",
      }),
    ).toThrow(/never authenticates as anon/);
  });

  it("is silent when the anon key is merely present in the environment", () => {
    expect(() => assertNotAnonKey({ SUPABASE_ANON_KEY: "anon-abc", ...BASE })).not.toThrow();
  });
});

describe("defaultWorkerId", () => {
  it("is unique per process, because two workers sharing one id pass each other's ownership checks", () => {
    expect(defaultWorkerId()).not.toBe(defaultWorkerId());
    expect(defaultWorkerId()).toContain(String(process.pid));
  });
});
