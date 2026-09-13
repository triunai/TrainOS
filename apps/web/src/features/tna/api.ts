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
import { queryKeys, useAction, useActor, useApi } from "@/shared/api";

/**
 * The TNA data layer — M05-S02.
 *
 * The client and the principal come from `useApi()` and `useActor()` in
 * `shared/api`. This file holds only what is specific to the TNA.
 */

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
    /* Fire-and-forget from a button: nothing awaits this call and no screen
       renders its `error`, so without the flag a refusal is invisible. R3. */
    meta: { toastOnError: true },
    onSuccess: (tna) => {
      queryClient.setQueryData(queryKeys.tnas.detail(id ?? ""), tna);
      /* The detail is not the only thing a reopen changes. The list renders
         the status, and the recommendations hang off the detail key under
         their own suffix, so neither is touched by `setQueryData` above and
         both kept showing the pre-reopen answer. */
      void queryClient.invalidateQueries({ queryKey: queryKeys.tnas.all });
    },
  });
}

/**
 * The envelope belongs to `shared/api`'s `useAction`; this adds only what a
 * recommendation acceptance makes stale. A refusal moved nothing, so it
 * invalidates nothing.
 */
export function useTnaAction() {
  const queryClient = useQueryClient();

  return useAction({
    onSettled: (result) => {
      if (result.kind === "error") return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.tnas.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all });
    },
  });
}
