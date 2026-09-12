import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  PortalAcceptRequest,
  PortalAcceptResponse,
  PortalCommentRequest,
  PortalProposal,
} from "@trainos/contract";
import { fixtureClient, isContractError, type FixtureClient } from "@trainos/fixtures";
import { domainErrorFromEnvelope, transportError, type ApiError } from "@/shared/api";

/**
 * The portal's data boundary.
 *
 * `useApi()` is a hook rather than a bare import so the single shared provider
 * that `shared/api` will eventually expose is a one-line swap here and nothing
 * in the screen moves. Today it hands back the `@trainos/fixtures` singleton:
 * `shared/api`'s own `TrainOsClient` is the scaffold's `Result<T>` interface
 * whose every method is `NOT_IMPLEMENTED`, and it carries none of the §11
 * portal endpoints this screen is built on.
 *
 * The fixture client THROWS `ContractError`; TanStack Query wants a thrown
 * error, so nothing is caught here. `asApiError` translates a refusal into the
 * `ApiError` the kit's `ErrorState` already knows how to render, which keeps a
 * domain refusal (a revoked or expired token) out of the "something went wrong"
 * bucket where a retry button would be offered for a fact.
 */
export function useApi(): FixtureClient {
  return fixtureClient;
}

/** A thrown fixture error, in the shape `ErrorState` and `readableMessage` read. */
export function asApiError(thrown: unknown): ApiError {
  if (isContractError(thrown)) return domainErrorFromEnvelope(thrown.toEnvelope());
  if (thrown instanceof Error) return transportError("UNKNOWN", thrown.message, { cause: thrown });
  return transportError("UNKNOWN", "Unknown error", { cause: thrown });
}

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: portalKeys.proposal(token) });
    },
  });
}
