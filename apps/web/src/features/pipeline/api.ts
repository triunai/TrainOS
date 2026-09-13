import { useQuery } from "@tanstack/react-query";
import type { PageRequest } from "@trainos/contract";
import { queryKeys, useApi } from "@/shared/api";

/**
 * The pipeline data layer.
 *
 * Both queries are returned whole. The stage list is not decoration here — it
 * IS the board, so a failure to load it has to reach the screen rather than
 * render as a board with no columns.
 */

/** §5 `GET /v1/config/pipelines?object=OPPORTUNITY`. The columns, in order. */
export function usePipelineStages() {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.pipelineConfig, "OPPORTUNITY"] as const,
    queryFn: () => client.getPipelineConfig("OPPORTUNITY"),
  });
}

/** §5 `GET /v1/opportunities`. The cards. */
export function useOpportunities(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.opportunities.list(page),
    queryFn: () => client.listOpportunities(page),
  });
}
