import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  PortalAcceptRequest,
  PortalAcceptResponse,
  PortalCommentRequest,
  PortalProposal,
} from "@trainos/contract";
import { useApi, type ApiError } from "@/shared/api";

/**
 * The portal's data boundary.
 *
 * The client comes from `useApi()` in `shared/api`, the one seam for the whole
 * app. The portal is signed out by design, so it reads whatever principal the
 * provider holds and relies on the §11 token for its authority.
 *
 * The fixture client THROWS `ContractError`; TanStack Query wants a thrown
 * error, so nothing is caught here. `asApiError` translates a refusal into the
 * `ApiError` the kit's `ErrorState` already knows how to render, which keeps a
 * domain refusal (a revoked or expired token) out of the "something went wrong"
 * bucket where a retry button would be offered for a fact.
 */
export const portalKeys = {
  all: ["portal"] as const,
  proposal: (token: string) => ["portal", "proposal", token] as const,
};

export function usePortalProposal(token: string): UseQueryResult<PortalProposal> {
  const api = useApi();
  return useQuery({
    queryKey: portalKeys.proposal(token),
    queryFn: () => api.getPortalProposal(token),
    /** A bad token is a fact about the link, not a flaky network. */
    retry: false,
  });
}

/**
 * A comment is the one write a client may make on a locked proposal, so it is
 * deliberately not a primary action — see `ClientProposalPage`.
 */
export function useAddPortalComment(token: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<PortalProposal, unknown, PortalCommentRequest>({
    mutationFn: (body) => api.addPortalComment(token, body),
    /* The refusal is already shown inline (`ClientProposalPage` passes
       `comment.error` to the panel unconditionally), which the success half
       had no equivalent of — the comment simply appeared lower in a thread the
       client may not be looking at. */
    meta: { toastOnSuccess: "Comment posted" },
    onSuccess: (proposal) => {
      queryClient.setQueryData(portalKeys.proposal(token), proposal);
    },
  });
}

/**
 * §11 accept is idempotent by token: a second accept returns the original
 * acceptance rather than signing twice. The idempotency key is the token so a
 * double-submit from a client's second browser tab cannot create a second
 * engagement.
 */
export function useAcceptPortalProposal(token: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<PortalAcceptResponse, unknown, PortalAcceptRequest>({
    mutationFn: (body) => api.acceptPortalProposal(token, body, { idempotencyKey: token }),
    /* No `toastOnSuccess` here: `ClientProposalPage` already fires a richer
       one per call — signature ref and the new engagement ref — which a
       generic central copy would only flatten. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: portalKeys.proposal(token) });
    },
  });
}
