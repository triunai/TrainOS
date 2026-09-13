/**
 * Reads the two automation SCREENS added on 13 Sep need and `api.ts` does not
 * already have — the approval policies, and the configured pipeline the
 * policies gate.
 *
 * WHY THIS IS NOT IN `api.ts`. It belongs there and should be merged into it.
 * It is separate only because several agents were working this tree at once and
 * `api.ts` is the agents feature's busiest file: appending to it would have
 * meant staging whatever another lane had open in it. A second file in one
 * feature is divergence under CLAUDE.md's consolidation rule, so this is a debt
 * with a note on it, not a pattern.
 * TODO(consolidation): fold these two hooks into `api.ts` once the tree is quiet.
 *
 * The run hooks are NOT duplicated here. `useRuns`, `useRetryRun` and
 * `useDeadLetterRun` already exist in `api.ts`, and a feature importing its own
 * internals is explicitly allowed — a second copy of a mutation is how two
 * screens end up invalidating different keys.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  ApprovalListResponse,
  ListResponse,
  PipelineConfig,
  PipelineObject,
  Policy,
} from "@trainos/contract";
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

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
