/**
 * §7 · The approvals data layer — M02-S01 (inbox) and M02-S02 (detail).
 *
 * Every read and write on both screens passes through here. A component never
 * touches the client directly, so the query keys, the invalidation fan-out and
 * the domain-versus-transport error split are decided once.
 *
 * THE ASYMMETRY RULE (CLAUDE.md R3) is applied deliberately and differently to
 * the two writes below:
 *
 *   · `useDecideApproval` is fired from a button and nothing awaits it, so it
 *     carries `meta.toastOnError`. Omitting the flag there is exactly the bug
 *     where a refused approve shows nothing and the only symptom reported is
 *     "the button does nothing".
 *   · `useBulkDecideApprovals` is awaited inside a try/catch because its
 *     failure — a money-carrying row in the selection — has a DESIGNED surface
 *     on M02-S01. A toast there would double-report what the banner says.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApprovalBulkDecideRequest,
  ApprovalBulkDecideResponse,
  ApprovalDecideRequest,
  ApprovalDecideResponse,
  ApprovalDetail,
  ApprovalListResponse,
  AuditEntry,
  ListResponse,
  PageRequest,
  SavedView,
} from "@trainos/contract";
import {
  ApiErrorException,
  derivedIdempotencyKey,
  queryKeys,
  toApiError,
  useApi,
} from "@/shared/api";

/** `listApprovals` takes the §7 urgency grouping alongside the §1 page request. */
export type ApprovalPageRequest = PageRequest & { group?: "URGENCY" };

/**
 * The fixture client throws; TanStack Query wants a rejection it can classify.
 * One wrapper converts a thrown `ContractError` into an exception carrying the
 * `ApiError` union, so a consumer can tell a refusal from a dropped connection.
 *
 * Unwrap it with `toApiError` at the point of use: TanStack hands back the
 * EXCEPTION, and testing `kind` on the exception silently reads every refusal
 * as a transport failure.
 */
const call = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (thrown) {
    throw new ApiErrorException(toApiError(thrown));
  }
};

/**
 * Every write carries a key, so a double-click cannot decide an approval twice.
 *
 * The key has to come from the DECISION, not the attempt. This helper used to
 * return a fresh `randomUUID()` per call, which made the sentence above false:
 * §3 recognises a repeat by the key, so two clicks produced two keys, two
 * decisions and two audit entries for one human judgement. Deriving it from the
 * approval and the body means the second click replays the first response,
 * while a genuinely different decision — an approve after a reject, a changed
 * note — still gets its own key rather than a spurious 409.
 */
const idempotencyKey = (id: string, body: unknown): string =>
  derivedIdempotencyKey("approval-decide", id, body);

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * §2 `GET /v1/views?object=APPROVAL` — the pill tabs.
 *
 * The tab strip is a saved-view switcher, not a hardcoded facet list. A new
 * view created in settings appears as a tab with no screen change, which is
 * the whole reason `tabsFromViews` exists in the kit.
 */
export function useApprovalViews() {
  const api = useApi();

  return useQuery<ListResponse<SavedView>, ApiErrorException>({
    queryKey: [...queryKeys.approvals.all, "views"],
    queryFn: () => call(() => api.listViews("APPROVAL")),
  });
}

/** §7 `GET /v1/approvals?group=URGENCY` — the grouped inbox. */
export function useApprovalInbox(page: ApprovalPageRequest) {
  const api = useApi();

  return useQuery<ApprovalListResponse, ApiErrorException>({
    queryKey: queryKeys.approvals.list(page),
    queryFn: () => call(() => api.listApprovals(page)),
  });
}

/** §7 `GET /v1/approvals/{id}` — the whole decision payload. */
export function useApproval(id: string) {
  const api = useApi();

  return useQuery<ApprovalDetail, ApiErrorException>({
    queryKey: queryKeys.approvals.detail(id),
    queryFn: () => call(() => api.getApproval(id)),
    enabled: id.length > 0,
  });
}

/**
 * §2 `GET /v1/audit/{resourceType}/{id}` — the trail on M02-S02.
 *
 * The approval is the resource, not the thing it acts on: the trail an
 * approver needs is how this decision reached them, which is what
 * `approvals::{ref}` records.
 */
export function useApprovalAudit(id: string) {
  const api = useApi();

  return useQuery<ListResponse<AuditEntry>, ApiErrorException>({
    queryKey: [...queryKeys.approvals.detail(id), "audit"],
    queryFn: () => call(() => api.getAudit("approvals", id)),
    enabled: id.length > 0,
  });
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * §7 `POST /v1/approvals/{id}/decide`.
 *
 * Fire-and-forget from the three buttons on M02-S02, so `toastOnError` is
 * mandatory. The success path returns `effects[]`, which §7 requires to match
 * the `diff[]` the screen rendered — the caller shows them side by side.
 */
export function useDecideApproval(id: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<ApprovalDecideResponse, ApiErrorException, ApprovalDecideRequest>({
    mutationFn: (body) =>
      call(() => api.decideApproval(id, body, { idempotencyKey: idempotencyKey(id, body) })),
    meta: { toastOnError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.badges });
    },
  });
}

/**
 * §7 `POST /v1/approvals/bulk-decide`.
 *
 * `409` when any selected id carries a monetary value. That refusal is the
 * point of the screen, not an accident, so no `toastOnError` here — M02-S01
 * awaits this call and renders the blocked refs inline.
 */
export function useBulkDecideApprovals() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<ApprovalBulkDecideResponse, ApiErrorException, ApprovalBulkDecideRequest>({
    mutationFn: (body) =>
      call(() =>
        api.bulkDecideApprovals(body, {
          /* The selection IS the subject here — there is no single record — so
             the ids ride in the body half of the derivation. */
          idempotencyKey: idempotencyKey("bulk", body),
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.badges });
    },
  });
}
