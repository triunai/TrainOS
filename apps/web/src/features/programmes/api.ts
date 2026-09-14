import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PageRequest, Programme, Role } from "@trainos/contract";
import {
  USER_AMIRAH,
  USER_JASON,
  USER_KELVIN,
  USER_KHAIRUL,
  USER_SITI,
  TRAINER_FARAH,
} from "@trainos/contract";
import { queryKeys, useApi } from "@/shared/api";

/**
 * The programmes data layer.
 *
 * The client comes from `useApi()` in `shared/api`, which also keeps the
 * signed-in principal in step with the role toggle. That matters here: the
 * fixture client enforces permissions for real, so without it `putProgramme`
 * would always answer as Amirah and the L&D gate on M06-S02 would be
 * decorative.
 */

/**
 * The catalogue is human-maintained, so editing it is restricted. The fixture
 * client is the boundary; this only decides whether to draw the button.
 */
export const canEditCatalogue = (role: Role): boolean => role === "ADMIN";

export function useProgrammes(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.programmes.list(page),
    queryFn: () => client.listProgrammes(page),
  });
}

export function useProgramme(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.programmes.detail(id ?? ""),
    queryFn: () => client.getProgramme(id as string),
    enabled: Boolean(id),
  });
}

export function useProgrammeDeliveries(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.programmes.detail(id ?? ""), "deliveries"] as const,
    queryFn: () => client.getProgrammeDeliveries(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Trainers, for the pool table's availability column. The programme carries the
 * pool but not the booked dates, and "already booked in the requested window"
 * is the state M06-S02 exists to render.
 */
export function useTrainers() {
  const client = useApi();
  return useQuery({
    queryKey: ["trainers", "list"] as const,
    queryFn: () => client.listTrainers(),
  });
}

/**
 * The engagements this programme is delivered in.
 *
 * The programme record names its trainer pool but not who is committed when;
 * the engagement is where a window and its assigned trainer live, so the pool's
 * availability column reads from here rather than inventing a schedule.
 */
export function useEngagementsForProgramme(programmeRef: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.engagements.lists(), { programmeRef: programmeRef ?? "" }] as const,
    queryFn: async () => {
      const response = await client.listEngagements();
      return response.data.filter((engagement) => engagement.programmeRef === programmeRef);
    },
    enabled: Boolean(programmeRef),
  });
}

/**
 * `PUT /v1/programmes/{id}` — ADMIN and L&D only. SALES gets a 403 carrying the
 * role it needs, which the screen renders rather than hides.
 */
export function useEditProgramme(id: string | undefined) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Programme>) => client.putProgramme(id as string, body),
    meta: { toastOnSuccess: "Programme saved" },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.programmes.all });
    },
  });
}
