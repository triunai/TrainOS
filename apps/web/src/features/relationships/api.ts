import { useQueries, useQuery } from "@tanstack/react-query";
import type { OrganisationSuggestion, PageRequest, TemplateType } from "@trainos/contract";
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

/**
 * The relationships data layer — §5 suggestions, §8 engagements, §2 templates
 * and contacts, all read through the one boundary.
 */

export function useEngagements(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.engagements.list(page),
    queryFn: () => client.listEngagements(page),
  });
}

export function useContacts(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.contacts.list(page),
    queryFn: () => client.listContacts(page),
  });
}

export function useTemplates(type?: TemplateType) {
  const client = useApi();
  return useQuery({
    queryKey: ["templates", type ?? "ALL"] as const,
    queryFn: () => client.listTemplates(type),
  });
}

export interface SuggestionIndex {
  /** Suggestions by organisation ref. An organisation with none is absent. */
  byOrganisation: Map<string, OrganisationSuggestion[]>;
  /** Every suggestion, paired with the organisation it belongs to. */
  all: { organisationRef: string; suggestion: OrganisationSuggestion }[];
  pending: boolean;
  /** The FIRST failure, so the screen can say a read failed rather than hide it. */
  error: ApiError | undefined;
  /** How many organisations were asked but did not answer. */
  failed: number;
}

/**
 * §5 `GET /v1/organisations/{id}/suggestions`, for every organisation at once.
 *
 * There is no collection endpoint for suggestions: §5 hangs them off an
 * organisation, so a book-wide view is N reads and this is where the N lives.
 * The fan-out is bounded by the organisation list and every call shares the
 * cache key the organisation record uses, so opening a record after this screen
 * costs nothing.
 *
 * `failed` is counted rather than swallowed. An organisation whose suggestions
 * did not load is NOT an organisation with nothing to suggest, and a screen
 * that renders the two the same way tells a sales manager there is no
 * opportunity when what happened is that nobody asked.
 */
export function useSuggestionsByOrganisation(refs: readonly string[]): SuggestionIndex {
  const client = useApi();

  const results = useQueries({
    queries: refs.map((ref) => ({
      queryKey: [...queryKeys.organisations.detail(ref), "suggestions"] as const,
      queryFn: () => client.getOrganisationSuggestions(ref),
    })),
  });

  const byOrganisation = new Map<string, OrganisationSuggestion[]>();
  const all: { organisationRef: string; suggestion: OrganisationSuggestion }[] = [];
  let pending = false;
  let error: ApiError | undefined;
  let failed = 0;

  results.forEach((result, index) => {
    const ref = refs[index];
    if (!ref) return;
    if (result.isPending) pending = true;
    if (result.isError) {
      failed += 1;
      error = error ?? toApiError(result.error);
      return;
    }
    const rows = result.data?.data ?? [];
    if (rows.length === 0) return;
    byOrganisation.set(ref, rows);
    for (const suggestion of rows) all.push({ organisationRef: ref, suggestion });
  });

  return { byOrganisation, all, pending, error, failed };
}
