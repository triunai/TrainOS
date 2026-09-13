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
import { isContractError } from "@trainos/fixtures";
import { queryKeys, useAction, useActor, useApi } from "@/shared/api";

/**
 * The enquiries data layer — M03-S01, M03-S02, M03-S06.
 *
 * The client comes from `useApi()` in `shared/api`, which also keeps the
 * signed-in principal in step with the role toggle. That matters here: the
 * fixture client enforces permissions for real, so without it every call would
 * answer as Amirah and a role-gated refusal would never be reachable from the
 * UI.
 */

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
    /* Fire-and-forget from a button: nothing awaits this call and no screen
       renders its `error`, so without the flag a refusal is invisible. R3. */
    meta: { toastOnError: true },
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
 *
 * The envelope itself belongs to `shared/api`'s `useAction`; this adds only
 * what is specific to the feature, which is what a converted enquiry makes
 * stale. Refusals are skipped deliberately: nothing moved, so there is nothing
 * to refetch.
 */
export function useEnquiryAction() {
  const queryClient = useQueryClient();

  return useAction({
    onSettled: (result) => {
      if (result.kind === "error") return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.enquiries.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.followUps.all });
    },
  });
}
