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
 * The organisations data layer — M04-S02.
 *
 * TEMPORARY SHAPE — `useApi()` belongs in `src/shared/api` and is duplicated
 * here only because `shared/api` is still the scaffold's NOT_IMPLEMENTED stub
 * and this feature may not write outside `features/organisations`. When the
 * shared hook lands, delete `useApi` from this file and import it.
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

export function useOrganisation(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.organisations.detail(id ?? ""),
    queryFn: () => client.getOrganisation(id as string),
    enabled: Boolean(id),
  });
}

export function useOrganisationRelations(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.organisations.detail(id ?? ""), "relations"] as const,
    queryFn: () => client.getOrganisationRelations(id as string),
    enabled: Boolean(id),
  });
}

export function useOrganisationSuggestions(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.organisations.detail(id ?? ""), "suggestions"] as const,
    queryFn: () => client.getOrganisationSuggestions(id as string),
    enabled: Boolean(id),
  });
}

/**
 * The chain stepper's stage names and order.
 *
 * CLAUDE.md: stage names and order render from pipeline configuration, never
 * hardcoded. `DEAL_CHAIN` is the object whose stages the record header's
 * variant-A stepper walks.
 */
export function useDealChainStages() {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.pipelineConfig, "DEAL_CHAIN"] as const,
    queryFn: () => client.getPipelineConfig("DEAL_CHAIN"),
  });
}

export function useAction() {
  const client = useApi();
  const queryClient = useQueryClient();

  return useMutation<ActionResponse, unknown, ActionRequest>({
    mutationFn: (request) =>
      client.performAction(request, {
        idempotencyKey: `${request.type}:${request.targetRef}:${Date.now()}`,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.organisations.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
    },
  });
}
