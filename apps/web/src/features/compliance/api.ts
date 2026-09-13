import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ClaimPacket, HrdcDeadline, ListResponse, Organisation } from "@trainos/contract";
import { useApi } from "@/shared/api";

/**
 * The compliance registers' data boundary.
 *
 * TWO FAN-OUTS, both unavoidable and both deliberate. `GET /v1/hrdc/packets/
 * {engagementRef}` is per engagement and there is no packets list; `GET
 * /v1/organisations/{id}` is per organisation and there is no organisations
 * list in the §13 matrix either. So a register that spans engagements has to
 * ask for each one.
 *
 * `useQueries` rather than one composite query, for the same reason
 * `useAllParticipants` uses it: each packet keeps its own cache entry, so one
 * engagement's refetch does not invalidate the other three, and a single
 * failure is one failed row rather than a failed page.
 */

export const complianceKeys = {
  deadlines: ["hrdc-deadlines", "list"] as const,
  packet: (ref: string) => ["claim-packets", "detail", ref] as const,
  organisation: (ref: string) => ["organisations", "detail", ref] as const,
};

export function useHrdcDeadlines(): UseQueryResult<ListResponse<HrdcDeadline>> {
  const api = useApi();
  return useQuery({
    queryKey: complianceKeys.deadlines,
    queryFn: () => api.listHrdcDeadlines(),
  });
}

export function useClaimPackets(refs: readonly string[]) {
  const api = useApi();
  return useQueries({
    queries: refs.map((ref) => ({
      queryKey: complianceKeys.packet(ref),
      queryFn: () => api.getClaimPacket(ref),
    })),
  });
}

/** Organisation names, one query per distinct ref. */
export function useOrganisations(refs: readonly string[]) {
  const api = useApi();
  return useQueries({
    queries: refs.map((ref) => ({
      queryKey: complianceKeys.organisation(ref),
      queryFn: () => api.getOrganisation(ref),
      staleTime: Infinity,
    })),
  });
}

export type { ClaimPacket, HrdcDeadline, Organisation };
