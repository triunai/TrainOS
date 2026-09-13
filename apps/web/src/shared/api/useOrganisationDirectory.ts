import { useCallback, useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Organisation, Ref } from "@trainos/contract";
import { queryKeys } from "./queryKeys";
import { useApi } from "./useApi";

/**
 * The organisation book, and a resolver from `organisationRef` to a name.
 *
 * Six screens across sales and relationships list records that carry an
 * `organisationRef` and nothing else: an `Opportunity`, a `Contact` and an
 * engagement projection all name their client by reference. Rendering
 * `ORG-0121` where a human expects "Kenanga Retail Group Berhad" is the kind of
 * machine value the tightening brief §1 reserves for refs and versions, so the
 * name has to be resolved — once, here, rather than in six feature folders with
 * six chances to diverge.
 *
 * §5 publishes no `GET /v1/organisations` collection: the organisation surface
 * is `GET /v1/organisations/{id}` plus the search the relation pickers use.
 * Search with an empty needle is therefore the whole book, and that is what
 * this asks for. When a list endpoint lands, this file changes and no screen
 * does — which is the point of R1's one data boundary.
 *
 * The query is returned WHOLE, not as `data ?? []`. Half the app's swallowed
 * errors are hooks that collapsed a failure into an empty array, and an
 * organisation list that failed to load must be able to say so rather than
 * render every row as an unnamed reference.
 */
export interface OrganisationDirectory {
  /** The query itself, so a screen can render its loading and error states. */
  query: UseQueryResult<Organisation[], Error>;
  /** The book, empty while pending or failed. Check `query` before trusting it. */
  organisations: Organisation[];
  /** The record behind a ref, or undefined when it is not in the book. */
  byRef: (ref: Ref | undefined) => Organisation | undefined;
  /**
   * The name behind a ref. Falls back to the REF rather than to an empty
   * string or an invented placeholder: a reader who sees `ORG-0140` can look it
   * up, and a reader who sees nothing cannot.
   */
  nameOf: (ref: Ref | undefined) => string;
}

export function useOrganisationDirectory(search = ""): OrganisationDirectory {
  const client = useApi();

  const query = useQuery({
    queryKey: [...queryKeys.organisations.all, "directory", search] as const,
    queryFn: () => client.searchOrganisations(search),
  });

  const organisations = useMemo(() => query.data ?? [], [query.data]);

  const index = useMemo(() => {
    const map = new Map<string, Organisation>();
    for (const organisation of organisations) {
      map.set(organisation.ref, organisation);
      map.set(organisation.id, organisation);
    }
    return map;
  }, [organisations]);

  const byRef = useCallback((ref: Ref | undefined) => (ref ? index.get(ref) : undefined), [index]);

  const nameOf = useCallback(
    (ref: Ref | undefined) => (ref ? (index.get(ref)?.name ?? ref) : "—"),
    [index],
  );

  return { query, organisations, byRef, nameOf };
}
