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
import { fixtureClient, isContractError, type FixtureClient } from "@trainos/fixtures";
import { queryKeys } from "@/shared/api";
import { useMe } from "@/shared/hooks/useMe";

/**
 * The programmes data layer.
 *
 * TEMPORARY SHAPE — `useApi()` belongs in `src/shared/api` and is duplicated
 * here only because `shared/api` is still the scaffold's NOT_IMPLEMENTED stub
 * and this feature may not write outside `features/programmes`. When the shared
 * hook lands, delete `useApi` from this file and import it; nothing else moves.
 *
 * The fixture client enforces permissions for real, so the signed-in actor must
 * track the shell's role toggle — otherwise `putProgramme` would always answer
 * as Amirah and the L&D gate on M06-S02 would be decorative.
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

/**
 * The catalogue is human-maintained, so editing it is restricted. The fixture
 * client is the boundary; this only decides whether to draw the button.
 */
export const canEditCatalogue = (role: Role): boolean => role === "ADMIN";

/** A contract error's code, or null when the failure was not a refusal. */
export function errorCodeOf(error: unknown): string | null {
  return isContractError(error) ? error.code : null;
}

export function errorMessageOf(error: unknown): string {
  if (isContractError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.programmes.all });
    },
  });
}
