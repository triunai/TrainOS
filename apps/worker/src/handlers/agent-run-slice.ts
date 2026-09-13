/**
 * `AGENT_RUN_SLICE` — one slice of an agent run.
 *
 * **What changed from the Edge shape.** `packages/agent-runtime` was written
 * against doc 05 §2.6: an Edge Function is killed at a 400s wall clock, so a
 * slice budgets 300s (`DEFAULT_SLICE_WALL_CLOCK_MS`) and yields. A Node worker
 * on Railway has no such lifetime, so the constant is *not* what bounds a
 * slice here — the lease is. `sliceWallClockMs` is derived from
 * `WORKER_LEASE_SECONDS` with a margin for the yield itself, and the lease is
 * a real ceiling because `app.claim_jobs` refuses anything over six minutes.
 *
 * **What did not change.** Checkpoints. They are still how a run outlives the
 * process that started it, still keyed on the same `run_id`, and still
 * round-tripped through JSON so the next slice can be a different worker. The
 * Edge assumption is dropped; the mechanism it forced is kept, because it is
 * the only thing that makes a resumable run resumable.
 *
 * **The gap.** Migrations 001-012 have no checkpoint table, and `service_role`
 * holds no RPC that re-enqueues this row for a later slice. So the store is
 * injected (in-process by default) and a yield reschedules through a retryable
 * `app.fail_job`, which is the only in-grant way to put the row back on the
 * queue. Both are recorded in the README.
 */

import {
  InMemoryCheckpointStore,
  createRuntime,
  leadToProposalAgent,
  runAgent,
  type AgentDefinition,
  type CheckpointStore,
  type KeyStore,
  type ProviderId,
} from "@trainos/agent-runtime";
import type { JobContext, JobOutcome } from "../jobs/types";

/** Agents this worker is allowed to run, by the id the payload names. */
export type AgentRegistry = Readonly<Record<string, AgentDefinition>>;

export const DEFAULT_AGENT_REGISTRY: AgentRegistry = Object.freeze({
  [leadToProposalAgent.id]: leadToProposalAgent,
});

export interface AgentRunSliceOptions {
  sliceWallClockMs: number;
  agents?: AgentRegistry;
  checkpoints?: CheckpointStore;
  /** Overridden in tests so no model is ever called. */
  createRuntimeImpl?: typeof createRuntime;
  runAgentImpl?: typeof runAgent;
}

interface AgentRunPayload {
  agentId?: string;
  runId?: string;
  runRef?: string;
  input?: Record<string, unknown>;
  tokenLimit?: number;
  resumeFrom?: string;
}

export function createAgentRunSliceHandler(opts: AgentRunSliceOptions) {
  const agents = opts.agents ?? DEFAULT_AGENT_REGISTRY;
  const checkpoints = opts.checkpoints ?? new InMemoryCheckpointStore();
  const build = opts.createRuntimeImpl ?? createRuntime;
  const run = opts.runAgentImpl ?? runAgent;

  return async function agentRunSlice(ctx: JobContext): Promise<JobOutcome> {
    const payload = ctx.job.payload as AgentRunPayload;
    const agentId = payload.agentId;
    if (!agentId || !(agentId in agents)) {
      return {
        status: "FAILED",
        error: {
          code: "UNKNOWN_AGENT",
          message: `no agent registered as ${JSON.stringify(agentId ?? null)}`,
          retryable: false,
        },
      };
    }
    const agent = agents[agentId] as AgentDefinition;

    const keyStore = await tenantKeyStore(ctx);
    if (!keyStore) {
      // Falling back to `EnvKeyStore` here would run one tenant's work on
      // whatever key the process happens to hold. Refusing is the only correct
      // answer, and the reason says so rather than reporting a model error.
      return {
        status: "FAILED",
        error: {
          code: "NO_TENANT_PROVIDER_KEY",
          message: "tenant has no BYOK provider key; the worker never falls back to a shared key",
          retryable: false,
          detail: { tenantId: ctx.job.tenant_id },
        },
      };
    }

    const runtime = build({ agentId: agent.id, keyStore });

    const result = await run({
      agent,
      router: runtime.router,
      tools: runtime.tools,
      input: payload.input ?? {},
      ...(payload.runId ? { runId: payload.runId } : {}),
      ...(payload.runRef ? { runRef: payload.runRef } : {}),
      ...(payload.tokenLimit ? { tokenLimit: payload.tokenLimit } : {}),
      ...(payload.resumeFrom ? { resumeFrom: payload.resumeFrom } : {}),
      slice: { wallClockMs: opts.sliceWallClockMs },
      checkpoints,
    });

    if (result.disposition === "RESUMABLE") {
      ctx.log.info("agent run yielded with work owed", {
        runId: result.run.id,
        checkpointId: result.resumeFrom,
      });
      return {
        status: "YIELDED",
        reason: result.checkpoints.at(-1)?.reason ?? "WALL_CLOCK",
        ...(result.resumeFrom ? { checkpointId: result.resumeFrom } : {}),
        detail: { runId: result.run.id, agentId: agent.id },
      };
    }

    if (result.disposition === "FAILED") {
      return {
        status: "FAILED",
        error: {
          code: "AGENT_RUN_FAILED",
          message: result.haltedBy?.reason ?? "the agent run ended in failure",
          // The runtime already exhausted its own escalation ladder, so a
          // re-run would repeat the same decisions against the same input.
          retryable: false,
          detail: { runId: result.run.id, agentId: agent.id },
        },
      };
    }

    return {
      status: "SUCCEEDED",
      result: {
        runId: result.run.id,
        status: result.run.status,
        durationMs: result.run.durationMs,
        ...(result.approval ? { approvalRequestId: result.approval.id } : {}),
      },
      event: {
        type: "AgentRunCompleted",
        aggregateType: "AGENT",
        aggregateId: ctx.job.id,
        aggregateRef: result.run.ref ?? result.run.id,
        summary: `Agent ${agent.id} completed run ${result.run.id}`,
        payload: { agentId: agent.id, runId: result.run.id },
      },
    };
  };
}

/**
 * One tenant's keys, snapshotted for the length of a slice.
 *
 * `KeyStore.get` is synchronous and the BYOK read is an RPC, so the rows are
 * pulled once up front. A slice therefore holds one consistent set of keys
 * from first model call to last, which is also what makes a resumed slice
 * comparable to the one before it.
 */
async function tenantKeyStore(ctx: JobContext): Promise<KeyStore | null> {
  const providers = await ctx.keys.list();
  if (providers.length === 0) return null;
  const entries = new Map<string, string>();
  for (const provider of providers) {
    const key = await ctx.keys.get(provider);
    if (key) entries.set(provider, key);
  }
  if (entries.size === 0) return null;
  return {
    list: () =>
      [...entries.keys()].map((provider) => ({ id: provider, provider: provider as ProviderId })),
    get: (ref) => entries.get(ref.id),
  };
}
