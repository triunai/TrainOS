import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ListResponse } from "@trainos/contract";
import type { FixtureTrainer } from "@trainos/fixtures";
import { useApi } from "@/shared/api";

/**
 * The trainers data boundary.
 *
 * `GET /v1/trainers` is the only trainer endpoint the §13 matrix declares —
 * there is no `/v1/trainers/{id}`. So the record screen resolves ITS trainer
 * out of the list rather than calling an endpoint that does not exist. The
 * alternative would have been to add one to the fixture client, which would be
 * inventing an API surface the contract has decided not to have.
 *
 * The cost is one list read to open one record, and the list is four rows. The
 * benefit is that the day a real `/v1/trainers/{id}` exists, this file changes
 * and no screen does.
 */

export const trainerKeys = {
  all: ["trainers"] as const,
  list: () => ["trainers", "list"] as const,
};

export function useTrainers(): UseQueryResult<ListResponse<FixtureTrainer>> {
  const api = useApi();
  return useQuery({
    queryKey: trainerKeys.list(),
    queryFn: () => api.listTrainers(),
  });
}
