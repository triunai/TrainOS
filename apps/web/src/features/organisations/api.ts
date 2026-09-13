import { useQuery } from "@tanstack/react-query";
import { isContractError } from "@trainos/fixtures";
import { queryKeys, useApi } from "@/shared/api";

/**
 * The organisations data layer — M04-S02.
 *
 * The client and the principal come from `useApi()` and `useActor()` in
 * `shared/api`. This file holds only what is specific to organisations.
 */

export function errorCodeOf(error: unknown): string | null {
  return isContractError(error) ? error.code : null;
}

export function errorMessageOf(error: unknown): string {
  if (isContractError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function useOrganisation(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.organisations.detail(id ?? ""),
    queryFn: () => client.getOrganisation(id as string),
    enabled: Boolean(id),
  });
}

export function useOrganisationRelations(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.organisations.detail(id ?? ""), "relations"] as const,
    queryFn: () => client.getOrganisationRelations(id as string),
    enabled: Boolean(id),
  });
}

export function useOrganisationSuggestions(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.organisations.detail(id ?? ""), "suggestions"] as const,
    queryFn: () => client.getOrganisationSuggestions(id as string),
    enabled: Boolean(id),
  });
}

/**
 * The chain stepper's stage names and order.
 *
 * CLAUDE.md: stage names and order render from pipeline configuration, never
 * hardcoded. `DEAL_CHAIN` is the object whose stages the record header's
 * variant-A stepper walks.
 */
export function useDealChainStages() {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.pipelineConfig, "DEAL_CHAIN"] as const,
    queryFn: () => client.getPipelineConfig("DEAL_CHAIN"),
  });
}
