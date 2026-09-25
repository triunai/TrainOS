import { eq } from "drizzle-orm";
import { type Executor, schema } from "../db/client";
import type { AgentTier, Provenance } from "./types";

/** One row per agent execution; the Agents screen and the cost breakdown read these. */
export async function startAgentRun(
  executor: Executor,
  input: { agent: string; tier: AgentTier; packageId?: string | null; leadId?: string | null; taskId?: string | null; inputSummary?: string },
): Promise<string> {
  const [row] = await executor
    .insert(schema.agentRuns)
    .values({
      agent: input.agent,
      tier: input.tier,
      packageId: input.packageId ?? null,
      leadId: input.leadId ?? null,
      taskId: input.taskId ?? null,
      inputSummary: (input.inputSummary ?? "").slice(0, 2000),
    })
    .returning({ id: schema.agentRuns.id });
  return row.id;
}

export async function finishAgentRun(
  executor: Executor,
  runId: string,
  result: {
    status: "SUCCEEDED" | "FAILED" | "FALLBACK";
    output?: Record<string, unknown>;
    provenance?: Provenance | Record<string, unknown>;
    costMyr?: number;
    error?: string;
  },
): Promise<void> {
  await executor
    .update(schema.agentRuns)
    .set({
      status: result.status,
      output: result.output ?? {},
      provenance: (result.provenance ?? {}) as Record<string, unknown>,
      costMyr: (result.costMyr ?? 0).toFixed(8),
      error: result.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(schema.agentRuns.id, runId));
}
