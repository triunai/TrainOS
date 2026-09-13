/**
 * Data access for the agents feature — M18-S01 (registry) and M18-S04 (run
 * trace viewer).
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
  AutomationRun,
  ListResponse,
} from "@trainos/contract";
import { isContractError } from "@trainos/fixtures";
import {
  domainErrorFromEnvelope,
  queryKeys,
  transportError,
  useApi,
  type ApiError,
} from "@/shared/api";

/**
 * `ContractError` → the scaffold's `ApiError`.
 *
 * DUPLICATED in `features/settings-ai/api.ts` and `features/knowledge/api.ts`.
 * It belongs in `shared/api`, next to `domainErrorFromEnvelope`, and this agent
 * does not own that directory. Reported to the team lead; hoist it and delete
 * all three copies.
 */
export function toApiError(thrown: unknown): ApiError {
  if (isContractError(thrown)) return domainErrorFromEnvelope(thrown.toEnvelope());
  const message = thrown instanceof Error ? thrown.message : "Unknown error";
  return transportError("UNKNOWN", message, { cause: thrown });
}

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
