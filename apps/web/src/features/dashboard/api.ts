/**
 * §10 · The dashboard data layer — M01-S01.
 *
 * Every cell, chart and list on the executive dashboard is a read. No money
 * moves on this screen and nothing here writes, which is why there is not a
 * single mutation in this file: the one action M01-S01 offers is navigation to
 * the approval inbox.
 */

import { useQuery } from "@tanstack/react-query";
import type { ExecutiveDashboard, HoursSavedReport, ProposalsVsWonReport } from "@trainos/contract";
import { ApiErrorException, queryKeys } from "@/shared/api";
import { apiErrorFromThrown, useApi } from "./client";

const call = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (thrown) {
    throw new ApiErrorException(apiErrorFromThrown(thrown));
  }
};

/** §10 `GET /v1/dashboards/executive?period=` — metrics, approvals, agents, spend. */
export function useExecutiveDashboard(period: string) {
  const api = useApi();

  return useQuery<ExecutiveDashboard, ApiErrorException>({
    queryKey: [...queryKeys.executiveDashboard, period],
    queryFn: () => call(() => api.getExecutiveDashboard(period)),
  });
}

/** §10 `GET /v1/reports/proposals-vs-won?months=` — the bar chart. */
export function useProposalsVsWon(months: number) {
  const api = useApi();

  return useQuery<ProposalsVsWonReport, ApiErrorException>({
    queryKey: ["reports", "proposals-vs-won", months],
    queryFn: () => call(() => api.getProposalsVsWon(months)),
  });
}

/**
 * §18 `GET /v1/reports/hours-saved`.
 *
 * DECISIONS §4: the tile MUST render `basis` and may not display a bare number.
 * The report is fetched separately from the dashboard metric so the basis and
 * the haircut travel with the figure rather than being reconstructed.
 */
export function useHoursSaved() {
  const api = useApi();

  return useQuery<HoursSavedReport, ApiErrorException>({
    queryKey: ["reports", "hours-saved"],
    queryFn: () => call(() => api.getHoursSaved()),
  });
}
