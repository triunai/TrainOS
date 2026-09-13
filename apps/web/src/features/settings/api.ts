/**
 * Data access for the three non-AI settings screens.
 *
 * Everything here is a READ. `GET /v1/policies` is read-only for the demo by
 * the contract's own words, `GET /v1/templates` publishes no write, and the
 * organisation has no endpoint at all. That is why these screens name the role
 * that would have to make a change rather than rendering a disabled Save: a
 * button that cannot write is a promise the API does not keep, and a disabled
 * one is the same promise with an excuse attached.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  ListResponse,
  Me,
  PipelineConfig,
  PipelineObject,
  Policy,
  Template,
} from "@trainos/contract";
import type { FixtureTenant } from "@trainos/fixtures";
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

/**
 * The tenant record.
 *
 * Fixture-only, and deliberately: §1 keeps tenancy implicit in the token, so
 * the contract publishes no tenant type and no endpoint that returns one. The
 * record exists in the store because every emitted event is stamped with it,
 * and `/settings/organisation` has to render the organisation it is
 * configuring. `FixtureTenant` is a fixture type for the same reason
 * `FixtureReceivable` is one.
 * TODO(contract §2): if organisation settings ever become writable, that is a
 * real endpoint and a real contract type, and this hook changes with it.
 */
export function useTenant(): UseQueryResult<FixtureTenant, ApiError> {
  const api = useApi();
  return useQuery<FixtureTenant, ApiError>({
    queryKey: ["tenant"] as const,
    queryFn: () => api.getTenant().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §2 `GET /v1/me`.
 *
 * Read from the client rather than from `useMe()`. The shell's hook serves the
 * role toggle, which is a rendering convenience; this screen is showing what
 * the SERVER believes about the signed-in principal — permissions, data scope,
 * locale — and those two can disagree, which is the whole point of the toggle.
 */
export function useMeRecord(): UseQueryResult<Me, ApiError> {
  const api = useApi();
  return useQuery<Me, ApiError>({
    queryKey: queryKeys.me,
    queryFn: () => api.getMe().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §5 `GET /v1/config/pipelines?object=`.
 *
 * CLAUDE.md: stage names and order render from pipeline configuration, never
 * hardcoded. The organisation screen shows all three configured pipelines, so
 * this is the only place those stage labels can come from.
 */
export function usePipeline(object: PipelineObject): UseQueryResult<PipelineConfig, ApiError> {
  const api = useApi();
  return useQuery<PipelineConfig, ApiError>({
    queryKey: [...queryKeys.pipelineConfig, object] as const,
    queryFn: () =>
      api.getPipelineConfig(object).catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/**
 * §2 `GET /v1/templates`. Nothing is hardcoded in the frontend.
 *
 * Fetched once, unfiltered, and narrowed in the screen. The endpoint takes a
 * `type`, but the screen's tabs have to show a COUNT per type as well as the
 * rows, and asking the server nine times to render nine numbers would be nine
 * round trips for one list of fourteen rows.
 */
export function useTemplates(): UseQueryResult<ListResponse<Template>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<Template>, ApiError>({
    queryKey: queryKeys.templates.lists(),
    queryFn: () =>
      api
        .listTemplates(undefined, { page: { size: 100 } })
        .catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}

/** §2 `GET /v1/policies` — the rule text, read-only. */
export function usePolicies(): UseQueryResult<ListResponse<Policy>, ApiError> {
  const api = useApi();
  return useQuery<ListResponse<Policy>, ApiError>({
    queryKey: queryKeys.policies.lists(),
    queryFn: () => api.listPolicies().catch((thrown) => Promise.reject(toApiError(thrown))),
  });
}
