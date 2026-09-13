/**
 * Data access for the agents feature — M18-S01 (registry), M18-S04 (run trace
 * viewer), M18-S07 (failures) and the policy gates.
 *
 * Every read is a TanStack Query hook over a `FixtureClient` method, and every
 * write is a mutation that invalidates the query root it touched. No component
 * in this feature calls the client directly: a screen that fetches inline
 * cannot be given a loading state, an error state or a cache, and those three
 * are exactly what the design pack asks each screen to render.
 *
 * `FixtureClient` THROWS a `ContractError`; the kit's `ErrorState` reads the
 * scaffold's `ApiError`. `toApiError` is the one place the two meet, so a
 * refusal keeps its contract code (`FORBIDDEN`, `AGENT_PAUSED`) all the way to
 * the screen instead of collapsing into "something went wrong".
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  Agent,
  AgentEval,
  AgentPauseRequest,
  AgentRegistryResponse,
  ApprovalListResponse,
  AutomationRun,
  ListResponse,
  PipelineConfig,
  PipelineObject,
  Policy,
} from "@trainos/contract";
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

/**
 * Keys for the two collections this feature reads.
 *
 * `queryKeys.agents` and `queryKeys.runs` come from the shared hierarchical
 * factory so invalidating `agents.all` clears the registry and every agent
 * detail beneath it. `evals` has no entry in that factory yet — noted for
 * whoever owns `shared/api/queryKeys.ts` — so it hangs off the agents root
 * here rather than inventing a second top-level namespace.
 */
export const agentKeys = {
  registry: queryKeys.agents.lists(),
  agent: (id: string) => queryKeys.agents.detail(id),
  evals: (agentId?: string) => [...queryKeys.agents.all, "evals", agentId ?? null] as const,
  runs: queryKeys.runs.lists(),
  run: (id: string) => queryKeys.runs.detail(id),
} as const;

export function useAgentRegistry(): UseQueryResult<AgentRegistryResponse, ApiError> {
  const api = useApi();
  return useQuery<AgentRegistryResponse, ApiError>({
    queryKey: agentKeys.registry,
    queryFn: () => api.listAgents().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

export function useAgentEvals(agentId?: string): UseQueryResult<ListResponse<AgentEval>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<AgentEval>, ApiError>({
    queryKey: agentKeys.evals(agentId),
    queryFn: () => api.listEvals(agentId).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

export function useRuns(): UseQueryResult<ListResponse<AutomationRun>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<AutomationRun>, ApiError>({
    queryKey: agentKeys.runs,
    queryFn: () => api.listRuns().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

export function useRun(id: string | undefined): UseQueryResult<AutomationRun, ApiError> {
  const api = useApi();
  return useQuery<AutomationRun, ApiError>({
    queryKey: agentKeys.run(id ?? ""),
    enabled: Boolean(id),
    queryFn: () => api.getRun(id as string).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * The kill switch. `actionType: null` pauses the whole agent.
 *
 * Immediate and audited — §10 is explicit that this is not queued behind an
 * approval, because a misbehaving agent that needs a second signature to stop
 * is not a kill switch.
 */
export function usePauseAgent() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<Agent, ApiError, { id: string; body: AgentPauseRequest }>({
    mutationFn: ({ id, body }) =>
      api.pauseAgent(id, body).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

/** §10 `POST /v1/runs/{id}/retry?from=checkpoint` — resumes from the state card. */
export function useRetryRun() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<AutomationRun, ApiError, { id: string; from?: "checkpoint" }>({
    mutationFn: ({ id, from }) =>
      api.retryRun(id, from).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.runs.all });
    },
  });
}

/** §10 `POST /v1/runs/{id}/dead-letter` — stop retrying and hold it for a human. */
export function useDeadLetterRun() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<AutomationRun, ApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      api.deadLetterRun(id, { reason }).catch((thrown) => Promise.reject(toApiError(thrown))),
    /* Fire-and-forget from a button: nothing awaits this call and no screen
       renders its `error`, so without the flag a refusal is invisible. R3. */
    meta: { toastOnError: true },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.runs.all });
    },
  });
}

/** §2 `GET /v1/policies` — read-only for the demo, and read-only here. */
export function usePolicies(): UseQueryResult<ListResponse<Policy>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<Policy>, ApiError>({
    queryKey: queryKeys.policies.lists(),
    queryFn: () => api.listPolicies().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §7 `GET /v1/approvals`, read here only to COUNT what each gate is holding.
 *
 * The approvals feature owns the inbox and the decision; this reads the same
 * list to answer a different question — which policies are firing — and links
 * to that inbox rather than offering a decision of its own. A failure is
 * rendered, not defaulted to zero: "nothing queued" and "we could not ask" look
 * identical in a count column and only one of them is safe to act on.
 */
export function useApprovalQueue(): UseQueryResult<ApprovalListResponse, ApiError> {
  const api = useApi();
  const page = { page: { size: 100 } } as const;
  return useQuery<ApprovalListResponse, ApiError>({
    queryKey: queryKeys.approvals.list(page),
    queryFn: () => api.listApprovals(page).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §5 `GET /v1/config/pipelines?object=` — the stage definitions.
 *
 * CLAUDE.md: stage names and order render from pipeline configuration, never
 * hardcoded. The policies screen draws the engagement pipeline as a reference
 * strip, so it reads the configuration rather than typing nine stage labels
 * that would silently stop matching the server.
 */
export function usePipelineConfig(
  object: PipelineObject,
): UseQueryResult<PipelineConfig, ApiError> {
  const api = useApi();
  return useQuery<PipelineConfig, ApiError>({
    queryKey: [...queryKeys.pipelineConfig, object] as const,
    queryFn: () =>
      api.getPipelineConfig(object).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}
