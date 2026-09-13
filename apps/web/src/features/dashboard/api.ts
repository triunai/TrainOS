/**
 * §10 · The dashboard data layer — M01-S01.
 *
 * Every cell, chart and list on the executive dashboard is a read. No money
 * moves on this screen and nothing here writes, which is why there is not a
 * single mutation in this file: the one action M01-S01 offers is navigation to
 * the approval inbox.
 */

import { useQuery } from "@tanstack/react-query";
import type {
  ApprovalListResponse,
  ExecutiveDashboard,
  HoursSavedReport,
  PageRequest,
  ProposalsVsWonReport,
} from "@trainos/contract";
import { ApiErrorException, queryKeys, toApiError, useApi } from "@/shared/api";

const call = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (thrown) {
    throw new ApiErrorException(toApiError(thrown));
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

/**
 * The pending rail's fallback — §7 `GET /v1/approvals`, used ONLY while the
 * dashboard read itself is not deployed.
 *
 * The database already serves the approval list, so the one section of this
 * page a signed-in reader can act on need not wait for the dashboard endpoint.
 * `enabled` keeps it silent wherever the dashboard answers, which is every
 * environment that serves the dashboard and the fixtures.
 */
const PENDING_APPROVALS: PageRequest = {
  filter: [{ field: "status", op: "eq", value: "PENDING" }],
  sort: "slaDueAt",
  page: { size: 5 },
};

export function usePendingApprovals(enabled: boolean) {
  const api = useApi();

  return useQuery<ApprovalListResponse, ApiErrorException>({
    queryKey: [...queryKeys.approvals.list(PENDING_APPROVALS), "dashboard"],
    queryFn: () => call(() => api.listApprovals(PENDING_APPROVALS)),
    enabled,
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
