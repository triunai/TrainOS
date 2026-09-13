/**
 * Data access for `/my-tasks`.
 *
 * The queue has no endpoint of its own. There is no `GET /v1/tasks` in the
 * contract, and inventing one in the client would be inventing a seam the
 * server has not agreed to. What a human owes the business is already
 * published in three places, so this screen reads those three and merges them:
 *
 *   · `GET /v1/approvals`      — decisions waiting on a role (§7)
 *   · `GET /v1/rule-changes`   — proposed HRD Corp changes awaiting review (§17)
 *   · `GET /v1/follow-ups`     — contacts owed a reply (§4)
 *
 * Three reads, three independent failures. Each keeps its own query so a
 * refusal on one does not blank the other two, and so the screen can say which
 * source is missing instead of showing a short list as if it were complete.
 * Merging happens in the screen, not here: this file's only job is the boundary.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  ApprovalListResponse,
  FollowUp,
  ListResponse,
  Policy,
  RuleChangeSet,
} from "@trainos/contract";
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

/**
 * Approvals, grouped by urgency by the server.
 *
 * `group: "URGENCY"` matters: the bucket a decision belongs in is the server's
 * call, because it knows the SLA clock. The screen renders `urgencyGroup` and
 * never recomputes it from `slaDueAt`.
 */
export function useApprovalTasks(): UseQueryResult<ApprovalListResponse, ApiError> {
  const api = useApi();
  /* An explicit size, not the client's default of 25. A queue that quietly
     stopped at the first page would be a filtered list that does not say it is
     filtered, which is how a reader concludes a task disappeared. The screen
     still renders `page.next` when there is more. */
  const page = { group: "URGENCY", page: { size: 100 } } as const;
  return useQuery<ApprovalListResponse, ApiError>({
    queryKey: queryKeys.approvals.list(page),
    queryFn: () => api.listApprovals(page).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/** Circulars whose extracted changes are still proposed — §17's review queue. */
export function useRuleChangeTasks(): UseQueryResult<ListResponse<RuleChangeSet>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<RuleChangeSet>, ApiError>({
    queryKey: queryKeys.ruleChanges.list({ page: { size: 100 } }),
    queryFn: () =>
      api
        .listRuleChanges({ page: { size: 100 } })
        .catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * The policies, read only to answer "who decides this".
 *
 * `ApprovalRequest` carries `policyId` but not `approverRole`, so the role that
 * has to make a decision is one join away. The queue names it rather than
 * offering a button: a reader who cannot approve should learn that from the
 * row, not from a refusal after they press it.
 */
export function usePolicyIndex(): UseQueryResult<ListResponse<Policy>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<Policy>, ApiError>({
    queryKey: queryKeys.policies.lists(),
    queryFn: () => api.listPolicies().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/** Contacts owed a reply — §4's follow-up queue, unfiltered. */
export function useFollowUpTasks(): UseQueryResult<ListResponse<FollowUp>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<FollowUp>, ApiError>({
    queryKey: queryKeys.followUps.list({ page: { size: 100 } }),
    queryFn: () =>
      api
        .listFollowUps({ page: { size: 100 } })
        .catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}
