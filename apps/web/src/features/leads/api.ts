import { useQuery } from "@tanstack/react-query";
import type { PageRequest } from "@trainos/contract";
import { queryKeys, useApi } from "@/shared/api";

/**
 * The leads data layer — §5 opportunities, read through the one boundary.
 *
 * `useContacts` is a second wrapper over `GET /v1/contacts` and that is
 * deliberate rather than an oversight: features are black boxes, and reaching
 * into the contacts feature for a query hook would make two screens share an
 * internal. The key is the same, so React Query serves both callers from one
 * request — the duplication is a barrel boundary, not a second fetch.
 */

/**
 * §5 `GET /v1/config/pipelines?object=OPPORTUNITY`.
 *
 * The whole stage vocabulary on this screen comes from here. CLAUDE.md:
 * "Stage names and order render from pipeline configuration, never hardcoded."
 *
 * Returned whole. The screen renders this query's error, because a lead queue
 * that lost its stage list has lost its tab row and its chips, and silently
 * showing an unfiltered list would hide that.
 */
export function useOpportunityStages() {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.pipelineConfig, "OPPORTUNITY"] as const,
    queryFn: () => client.getPipelineConfig("OPPORTUNITY"),
  });
}

export function useOpportunities(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.opportunities.list(page),
    queryFn: () => client.listOpportunities(page),
  });
}

export function useOpportunity(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.opportunities.detail(id ?? ""),
    queryFn: () => client.getOpportunity(id as string),
    enabled: Boolean(id),
  });
}

/** §5 `GET /v1/contacts`, for the people behind the selected lead. */
export function useContacts(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.contacts.list(page),
    queryFn: () => client.listContacts(page),
  });
}
