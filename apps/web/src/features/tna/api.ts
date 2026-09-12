import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionRequest, ActionResponse, Actor, Role } from "@trainos/contract";
import {
  TRAINER_FARAH,
  USER_AMIRAH,
  USER_JASON,
  USER_KELVIN,
  USER_KHAIRUL,
  USER_SITI,
} from "@trainos/contract";
import { fixtureClient, isContractError, type FixtureClient } from "@trainos/fixtures";
import { queryKeys } from "@/shared/api";
import { useMe } from "@/shared/hooks/useMe";

/**
 * The TNA data layer — M05-S02.
 *
 * TEMPORARY SHAPE — `useApi()` belongs in `src/shared/api` and is duplicated
 * here only because `shared/api` is still the scaffold's NOT_IMPLEMENTED stub
 * and this feature may not write outside `features/tna`. When the shared hook
 * lands, delete `useApi` from this file and import it.
 */

const ACTOR_FOR_ROLE: Readonly<Record<Role, string>> = {
  SALES: USER_AMIRAH,
  SALES_MANAGER: USER_KELVIN,
  OPS: USER_SITI,
  FINANCE: USER_JASON,
  MD: "u_lim",
  ADMIN: USER_KHAIRUL,
  TRAINER: TRAINER_FARAH,
  CLIENT: USER_AMIRAH,
  AGENT: USER_AMIRAH,
};

export function useApi(): FixtureClient {
  const { me } = useMe();
  const actorId = ACTOR_FOR_ROLE[me.role];
  if (fixtureClient.actorId !== actorId) fixtureClient.signInAs(actorId);
  return fixtureClient;
}

export function useActor(): Actor {
  const { me } = useMe();
  return { id: ACTOR_FOR_ROLE[me.role], name: me.name, kind: "HUMAN" };
}

export function errorCodeOf(error: unknown): string | null {
  return isContractError(error) ? error.code : null;
}

export function errorMessageOf(error: unknown): string {
  if (isContractError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function useTna(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.tnas.detail(id ?? ""),
    queryFn: () => client.getTna(id as string),
    enabled: Boolean(id),
  });
}

/**
 * The client behind the TNA, for the record's title.
 *
 * A TNA identifies itself by its reference and its client — "TNA-0042 · Aurora
 * Manufacturing" — but the record carries only an opportunity reference, so the
 * organisation is two reads away. Doing that walk here keeps the screen free of
 * it, and the second read waits on the first rather than guessing.
 */
export function useTnaClient(opportunityRef: string | undefined) {
  const client = useApi();

  const opportunity = useQuery({
    queryKey: queryKeys.opportunities.detail(opportunityRef ?? ""),
    queryFn: () => client.getOpportunity(opportunityRef as string),
    enabled: Boolean(opportunityRef),
  });

  const organisationRef = opportunity.data?.organisationRef;

  return useQuery({
    queryKey: queryKeys.organisations.detail(organisationRef ?? ""),
    queryFn: () => client.getOrganisation(organisationRef as string),
    enabled: Boolean(organisationRef),
  });
}

export function useTnaRecommendations(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.tnas.detail(id ?? ""), "recommendations"] as const,
    queryFn: () => client.getTnaRecommendations(id as string),
    enabled: Boolean(id),
  });
}

export function useReopenTna(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.reopenTna(id as string),
    onSuccess: (tna) => {
      queryClient.setQueryData(queryKeys.tnas.detail(id ?? ""), tna);
    },
  });
}

/**
 * Any action request, whatever the concrete shape of its payload.
 *
 * The contract's payloads are named interfaces, not index-signature records, so
 * a screen passing `OpportunityConvertPayload` needs this rather than a cast at
 * the call site.
 */
export type AnyActionRequest = Omit<ActionRequest, "payload"> & { payload?: object };

export function useAction() {
  const client = useApi();
  const queryClient = useQueryClient();

  return useMutation<ActionResponse, unknown, AnyActionRequest>({
    mutationFn: (request) =>
      client.performAction(
        /* `ActionRequest<P>` defaults its payload to an index-signature record,
           which a named contract payload such as `OpportunityConvertPayload`
           does not structurally satisfy. Widening happens once, here, rather
           than at every call site. */
        { ...request, payload: request.payload as Record<string, unknown> | undefined },
        { idempotencyKey: `${request.type}:${request.targetRef}:${Date.now()}` },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tnas.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all });
    },
  });
}
