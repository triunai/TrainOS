/**
 * Data access for the settings-ai feature — M20-S20 (tiers and routing),
 * M20-S21 (provider keys) and M20-S16 (usage, cost and budgets).
 *
 * Three §17 endpoints here are role-gated by the server: `putAiTier` and
 * `putAiRouting` need ADMIN, `revealProvider` needs ADMIN, and RAISING a budget
 * cap needs the MD. Those refusals are not errors to be hidden — §4 names the
 * MD approving cap raises as part of the screen. Each hook therefore surfaces
 * the `ApiError` with its contract code intact so the screen can say which role
 * decides, rather than collapsing a policy decision into "try again".
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  Budget,
  BudgetWrite,
  ListResponse,
  ModelTier,
  ProviderKey,
  ProviderKeyCreateRequest,
  ProviderKeyRevealResponse,
  ProviderKeyTestResponse,
  RoutingEntry,
  RoutingResponse,
  UsageResponse,
} from "@trainos/contract";
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

/**
 * Keys for the §17 AI-ops surface.
 *
 * `queryKeys.modelTiers` and `queryKeys.usage` exist in the shared factory;
 * routing, providers and budgets do not. They hang off the tier and usage roots
 * here so one invalidation still clears a coherent slice, but the shared
 * factory is the right home for all five. Reported.
 */
export const aiKeys = {
  tiers: queryKeys.modelTiers,
  routing: [...queryKeys.modelTiers, "routing"] as const,
  providers: [...queryKeys.modelTiers, "providers"] as const,
  usage: (period: string, groupBy: string) => [...queryKeys.usage, period, groupBy] as const,
  usageRoot: queryKeys.usage,
  budgets: [...queryKeys.usage, "budgets"] as const,
} as const;

export type UsageGroupBy = "TIER" | "AGENT" | "ACTION_TYPE";

export function useAiTiers(): UseQueryResult<ListResponse<ModelTier>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<ModelTier>, ApiError>({
    queryKey: aiKeys.tiers,
    queryFn: () => api.getAiTiers().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

export function useAiRouting(): UseQueryResult<RoutingResponse, ApiError> {
  const api = useApi();
  return useQuery<RoutingResponse, ApiError>({
    queryKey: aiKeys.routing,
    queryFn: () => api.getAiRouting().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §17 `PUT /v1/ai/routing` — **future runs only**, never retroactive.
 *
 * The whole reason the screen's primary button is worded "Apply to future runs"
 * rather than "Save" is that a routing change cannot reach a run that has
 * already started, and a button called Save would imply otherwise.
 */
export function usePutAiRouting() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<RoutingResponse, ApiError, RoutingEntry[]>({
    mutationFn: (entries) =>
      api.putAiRouting(entries).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: aiKeys.routing });
    },
  });
}

export function useProviders(): UseQueryResult<ListResponse<ProviderKey>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<ProviderKey>, ApiError>({
    queryKey: aiKeys.providers,
    queryFn: () => api.listProviders().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * `gcTime: 0` because the mutation's VARIABLES are the request body, and the
 * body carries the raw key. TanStack keeps a finished mutation — variables and
 * all — in the MutationCache for five minutes by default after its observer
 * unmounts; with 0 it is dropped the moment the drawer closes.
 */
export function useCreateProvider() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<ProviderKey, ApiError, ProviderKeyCreateRequest>({
    gcTime: 0,
    mutationFn: (body) =>
      api.createProvider(body).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: aiKeys.providers });
    },
  });
}

/** §17 a live probe. Updates `lastTestedAt` whatever the verdict. */
export function useTestProvider() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<ProviderKeyTestResponse, ApiError, string>({
    mutationFn: (id) => api.testProvider(id).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: aiKeys.providers });
    },
  });
}

/**
 * §17 reveal — ADMIN only, returns the key ONCE, and writes
 * `ProviderKeyRevealed` to the audit log.
 *
 * Deliberately a mutation and not a query: it has a side effect, it must never
 * be cached, and it must never be re-run by a refetch. A revealed key that a
 * cache could replay is not an audited reveal.
 *
 * A mutation is still CACHED, though: TanStack holds its `data` in the
 * MutationCache for `gcTime` (five minutes by default) after the screen that
 * asked unmounts. `gcTime: 0` drops it with its last observer, so the key lives
 * exactly as long as the card showing it. Pinned by provider-secrets.test.tsx.
 */
export function useRevealProvider() {
  const api = useApi();
  return useMutation<ProviderKeyRevealResponse, ApiError, string>({
    gcTime: 0,
    mutationFn: (id) =>
      api.revealProvider(id).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

export function useUsage(
  period: string,
  groupBy: UsageGroupBy,
): UseQueryResult<UsageResponse, ApiError> {
  const api = useApi();
  return useQuery<UsageResponse, ApiError>({
    queryKey: aiKeys.usage(period, groupBy),
    queryFn: () =>
      api.getUsage(period, groupBy).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

export function useBudgets(): UseQueryResult<ListResponse<Budget>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<Budget>, ApiError>({
    queryKey: aiKeys.budgets,
    queryFn: () => api.getBudgets().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §17 `PUT /v1/ai/budgets/{scope}/{key}`.
 *
 * LOWERING a cap is an admin change. RAISING one is the MD's decision and the
 * server refuses it with `FORBIDDEN` and `details.requiredRole: "MD"` for
 * anyone else — which is what M20-S16's primary button is for, and why its
 * refusal is rendered as a routing instruction rather than as a failure.
 */
export function usePutBudget() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<Budget, ApiError, { scope: Budget["scope"]; key: string; body: BudgetWrite }>({
    mutationFn: ({ scope, key, body }) =>
      api.putBudget(scope, key, body).catch((thrown) => Promise.reject(toApiError(thrown))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: aiKeys.usageRoot });
    },
  });
}
