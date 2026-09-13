/**
 * Data access for `/reports`.
 *
 * Two published reports, two queries. The executive dashboard is NOT read here:
 * it has its own screen at `/dashboard`, and a second copy of it under Reports
 * would be the divergence CLAUDE.md forbids — this page links to it instead.
 *
 * `months` is part of the key, not just the request. A window switcher that
 * reuses one cache entry shows the previous window's bars for a frame, which
 * reads as data changing when only the question did.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { HoursSavedReport, ProposalsVsWonReport } from "@trainos/contract";
import { toApiError, useApi, type ApiError } from "@/shared/api";

/** §10 `GET /v1/reports/proposals-vs-won?months=`. */
export function useProposalsVsWon(months: number): UseQueryResult<ProposalsVsWonReport, ApiError> {
  const api = useApi();
  return useQuery<ProposalsVsWonReport, ApiError>({
    queryKey: ["reports", "proposals-vs-won", months] as const,
    queryFn: () =>
      api.getProposalsVsWon(months).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §18 `GET /v1/reports/hours-saved`.
 *
 * The contract is explicit that the tile must render `basis` and may not show a
 * bare number, so the screen never reads `hours` without it.
 */
export function useHoursSaved(): UseQueryResult<HoursSavedReport, ApiError> {
  const api = useApi();
  return useQuery<HoursSavedReport, ApiError>({
    queryKey: ["reports", "hours-saved"] as const,
    queryFn: () => api.getHoursSaved().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}
