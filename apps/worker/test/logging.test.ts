import { describe, expect, it } from "vitest";
import { createLogger, redact } from "../src/logging";

describe("redact", () => {
  it("removes a value under a secret-shaped key", () => {
    expect(redact({ api_key: "sk-ant-live", nested: { authorization: "Bearer x" } })).toEqual({
      api_key: "[redacted]",
      nested: { authorization: "[redacted]" },
    });
  });

  it("removes a provider key that turns up inside a free-text message", () => {
    expect(redact("failed with sk-ant-api03-abcdefghijkl")).toBe("failed with [redacted]");
  });

  it("removes a JWT-shaped value, which is what a leaked service-role key looks like", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
    expect(redact(`url=${jwt}`)).toBe("url=[redacted]");
  });

  it("leaves ordinary values alone", () => {
    expect(redact({ jobId: "job-1", attempts: 2, retryable: true })).toEqual({
      jobId: "job-1",
      attempts: 2,
      retryable: true,
    });
  });
});

describe("createLogger", () => {
  it("emits one JSON object per line, carrying its bindings", () => {
    const lines: string[] = [];
    createLogger({ sink: (line) => lines.push(line), bindings: { workerId: "w1" } }).info(
      "claimed",
      {
        count: 2,
      },
    );
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: "info",
      msg: "claimed",
      workerId: "w1",
      count: 2,
    });
  });

  it("drops anything under the configured level", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "warn", sink: (line) => lines.push(line) });
    log.info("quiet");
    log.error("loud");
    expect(lines).toHaveLength(1);
  });

  it("redacts on the way out, so a call site cannot leak a key by forgetting", () => {
    const lines: string[] = [];
    createLogger({ sink: (line) => lines.push(line) }).error("provider rejected", {
      apiKey: "sk-ant-api03-zzzzzzzzzzzz",
    });
    expect(lines[0]).not.toContain("sk-ant-api03");
  });

  it("carries a child's bindings alongside the parent's", () => {
    const lines: string[] = [];
    createLogger({ sink: (line) => lines.push(line), bindings: { workerId: "w1" } })
      .child({ jobId: "j1" })
      .info("x");
    expect(JSON.parse(lines[0]!)).toMatchObject({ workerId: "w1", jobId: "j1" });
  });
});
