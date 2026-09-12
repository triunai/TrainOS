import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActionRequest,
  ActionResponse,
  Actor,
  EnquiryExtractionPatch,
  PageRequest,
  Role,
} from "@trainos/contract";
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
 * The enquiries data layer — M03-S01, M03-S02, M03-S06.
 *
 * TEMPORARY SHAPE — `useApi()` belongs in `src/shared/api` and is duplicated
 * here only because `shared/api` is still the scaffold's NOT_IMPLEMENTED stub
 * and this feature may not write outside `features/enquiries`. When the shared
 * hook lands, delete `useApi` from this file and import it; nothing else moves.
 * The same note stands in `features/organisations/api.ts` and `features/tna`.
 *
 * The fixture client enforces permissions for real, so the signed-in actor has
 * to track the shell's role toggle — otherwise every call would answer as
 * Amirah and a role-gated refusal would never be reachable from the UI.
 */

/** Shell role -> the fixture principal that holds that role's permissions. */
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

/** The signed-in principal as the action envelope wants it. */
export function useActor(): Actor {
  const { me } = useMe();
  return { id: ACTOR_FOR_ROLE[me.role], name: me.name, kind: "HUMAN" };
}

/** A contract error's code, or null when the failure was not a refusal. */
export function errorCodeOf(error: unknown): string | null {
  return isContractError(error) ? error.code : null;
}

export function errorMessageOf(error: unknown): string {
  if (isContractError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/* ---- §2 saved views (the inbox's pill tabs) ------------------------- */

export function useEnquiryViews() {
  const client = useApi();
  return useQuery({
    queryKey: ["views", "ENQUIRY"] as const,
    queryFn: () => client.listViews("ENQUIRY"),
  });
}

/* ---- §4 enquiries -------------------------------------------------- */

export function useEnquiries(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.enquiries.list(page),
    queryFn: () => client.listEnquiries(page),
  });
}

export function useEnquiry(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.enquiries.detail(id ?? ""),
    queryFn: () => client.getEnquiry(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Edit-before-use on one extracted field.
 *
 * The field's provenance flips to `AI_SUGGESTED` with `editedBy`, which is what
 * makes the AI chip on that field change from generated to human-corrected.
 */
export function usePatchExtraction(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: EnquiryExtractionPatch) =>
      client.patchEnquiryExtraction(id as string, patch),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.enquiries.detail(id ?? ""), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.enquiries.lists() });
    },
  });
}

/**
 * The matched organisation, for the levy metric on M03-S02.
 *
 * The enquiry payload carries the organisation's name and match reason but not
 * its metrics, and the header's fourth cell is the HRDC levy — the number that
 * decides whether this enquiry is worth working. One read, not a denormalised
 * copy on the enquiry.
 */
export function useOrganisation(ref: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.organisations.detail(ref ?? ""),
    queryFn: () => client.getOrganisation(ref as string),
    enabled: Boolean(ref),
  });
}

/* ---- §4 follow-ups ------------------------------------------------- */

export function useFollowUps(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.followUps.list(page),
    queryFn: () => client.listFollowUps(page),
  });
}

export function useFollowUpDraft(id: string | undefined, channel: "EMAIL" | "WHATSAPP") {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.followUps.detail(id ?? ""), "draft", channel] as const,
    queryFn: () => client.getFollowUpDraft(id as string, channel),
    enabled: Boolean(id),
  });
}

/* ---- §3 the action envelope ---------------------------------------- */

/**
 * Every primary button on these screens goes through here, and every caller
 * renders all three outcomes. An approval is a success, not an error — R2.
 */
export function useAction() {
  const client = useApi();
  const queryClient = useQueryClient();

  return useMutation<ActionResponse, unknown, ActionRequest>({
    mutationFn: (request) =>
      client.performAction(request, {
        idempotencyKey: `${request.type}:${request.targetRef}:${Date.now()}`,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.enquiries.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.followUps.all });
    },
  });
}
