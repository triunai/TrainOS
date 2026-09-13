import { describe, expect, it, vi } from "vitest";
import {
  InMemoryCheckpointStore,
  leadToProposalAgent,
  type KeyStore,
} from "@trainos/agent-runtime";
import {
  createAgentRunSliceHandler,
  DEFAULT_AGENT_REGISTRY,
} from "../src/handlers/agent-run-slice";
import { createLogger } from "../src/logging";
import type { JobContext, OutboxJob } from "../src/jobs/types";
import { fakeJob } from "./fake-transport";

/** Only the fields the handler reads; the runtime's own shape is not under test here. */
interface RunOpts {
  runId?: string;
  resumeFrom?: string;
  slice?: { wallClockMs?: number };
  input?: Record<string, unknown>;
}

const AGENT = { id: "lead-to-proposal" } as never;
const REGISTRY = { "lead-to-proposal": AGENT };

function ctxFor(
  payload: Record<string, unknown>,
  keys: Record<string, string> = { anthropic: "sk-ant-x" },
): JobContext {
  const job: OutboxJob = fakeJob({ job_type: "AGENT_RUN_SLICE", payload });
  return {
    job,
    workerId: "worker-agent",
    heartbeat: async () => {},
    keys: { get: async (provider) => keys[provider], list: async () => Object.keys(keys) },
    log: createLogger({ level: "error", sink: () => {} }),
    signal: new AbortController().signal,
  };
}

function runResult(overrides: Record<string, unknown> = {}) {
  return {
    run: { id: "run_1", ref: "RUN-0001", status: "SUCCEEDED", durationMs: 1_200 },
    disposition: "COMPLETE",
    provenance: {},
    checkpoints: [],
    blackboard: {},
    ...overrides,
  } as never;
}

describe("AGENT_RUN_SLICE", () => {
  it("runs the agent and reports the run id and an event", async () => {
    const runAgentImpl = vi.fn(async () => runResult());
    const handler = createAgentRunSliceHandler({
      sliceWallClockMs: 270_000,
      agents: REGISTRY,
      createRuntimeImpl: (() => ({ router: {}, tools: {} })) as never,
      runAgentImpl: runAgentImpl as never,
    });

    const outcome = await handler(
      ctxFor({ agentId: "lead-to-proposal", input: { enquiryId: "ENQ-1" } }),
    );
    expect(outcome).toMatchObject({ status: "SUCCEEDED", result: { runId: "run_1" } });
    expect(outcome).toMatchObject({ event: { type: "AgentRunCompleted", aggregateType: "AGENT" } });
  });

  it("budgets the slice from the lease, not from the Edge runtime's 300s constant", async () => {
    const seen: RunOpts[] = [];
    const handler = createAgentRunSliceHandler({
      sliceWallClockMs: 90_000,
      agents: REGISTRY,
      createRuntimeImpl: (() => ({ router: {}, tools: {} })) as never,
      runAgentImpl: (async (opts: RunOpts) => {
        seen.push(opts);
        return runResult();
      }) as never,
    });
    await handler(ctxFor({ agentId: "lead-to-proposal" }));
    expect(seen[0]?.slice).toEqual({ wallClockMs: 90_000 });
  });

  it("keeps checkpoints: a resumable slice yields with the checkpoint to resume from", async () => {
    const handler = createAgentRunSliceHandler({
      sliceWallClockMs: 1_000,
      agents: REGISTRY,
      checkpoints: new InMemoryCheckpointStore(),
      createRuntimeImpl: (() => ({ router: {}, tools: {} })) as never,
      runAgentImpl: (async () =>
        runResult({
          disposition: "RESUMABLE",
          resumeFrom: "ckpt_run_1_2_wall_clock_7",
          run: { id: "run_1", status: "RUNNING", durationMs: 900 },
          checkpoints: [{ reason: "WALL_CLOCK" }],
        })) as never,
    });

    const outcome = await handler(ctxFor({ agentId: "lead-to-proposal" }));
    expect(outcome).toMatchObject({
      status: "YIELDED",
      reason: "WALL_CLOCK",
      checkpointId: "ckpt_run_1_2_wall_clock_7",
    });
  });

  it("passes the checkpoint id straight back in, so the next slice continues the same run", async () => {
    const seen: RunOpts[] = [];
    const handler = createAgentRunSliceHandler({
      sliceWallClockMs: 1_000,
      agents: REGISTRY,
      createRuntimeImpl: (() => ({ router: {}, tools: {} })) as never,
      runAgentImpl: (async (opts: RunOpts) => {
        seen.push(opts);
        return runResult();
      }) as never,
    });
    await handler(
      ctxFor({
        agentId: "lead-to-proposal",
        runId: "run_1",
        resumeFrom: "ckpt_run_1_1_stage_complete_3",
      }),
    );
    expect(seen[0]).toMatchObject({ runId: "run_1", resumeFrom: "ckpt_run_1_1_stage_complete_3" });
  });

  it("refuses, without falling back to a shared key, when the tenant has no BYOK key", async () => {
    const runAgentImpl = vi.fn(async () => runResult());
    const handler = createAgentRunSliceHandler({
      sliceWallClockMs: 1_000,
      agents: REGISTRY,
      createRuntimeImpl: (() => ({ router: {}, tools: {} })) as never,
      runAgentImpl: runAgentImpl as never,
    });
    const outcome = await handler(ctxFor({ agentId: "lead-to-proposal" }, {}));
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "NO_TENANT_PROVIDER_KEY", retryable: false },
    });
    expect(runAgentImpl).not.toHaveBeenCalled();
  });

  it("hands the runtime a key store built from the tenant's own keys", async () => {
    const stores: KeyStore[] = [];
    const handler = createAgentRunSliceHandler({
      sliceWallClockMs: 1_000,
      agents: REGISTRY,
      createRuntimeImpl: ((opts: { keyStore: KeyStore }) => {
        stores.push(opts.keyStore);
        return { router: {}, tools: {} };
      }) as never,
      runAgentImpl: (async () => runResult()) as never,
    });
    await handler(ctxFor({ agentId: "lead-to-proposal" }, { anthropic: "sk-ant-tenant" }));
    const store = stores[0]!;
    expect(store.list().map((ref) => ref.id)).toEqual(["anthropic"]);
    expect(store.get({ id: "anthropic", provider: "anthropic" })).toBe("sk-ant-tenant");
  });

  it("dead-letters an unknown agent id", async () => {
    const handler = createAgentRunSliceHandler({
      sliceWallClockMs: 1_000,
      agents: REGISTRY,
      createRuntimeImpl: (() => ({ router: {}, tools: {} })) as never,
      runAgentImpl: (async () => runResult()) as never,
    });
    const outcome = await handler(ctxFor({ agentId: "nope" }));
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "UNKNOWN_AGENT", retryable: false },
    });
  });

  it("does not retry a run the runtime already gave up on", async () => {
    const handler = createAgentRunSliceHandler({
      sliceWallClockMs: 1_000,
      agents: REGISTRY,
      createRuntimeImpl: (() => ({ router: {}, tools: {} })) as never,
      runAgentImpl: (async () =>
        runResult({
          disposition: "FAILED",
          haltedBy: { reason: "jury could not agree" },
        })) as never,
    });
    const outcome = await handler(ctxFor({ agentId: "lead-to-proposal" }));
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "AGENT_RUN_FAILED", retryable: false },
    });
  });

  it("ships with the lead-to-proposal agent registered", () => {
    expect(Object.keys(DEFAULT_AGENT_REGISTRY)).toEqual([leadToProposalAgent.id]);
  });
});
