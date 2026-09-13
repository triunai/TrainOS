import { useCallback, useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Opportunity, Ref } from "@trainos/contract";
import { queryKeys } from "./queryKeys";
import { useApi } from "./useApi";

/**
 * The opportunity book, and the hop from an `opportunityRef` to its client.
 *
 * A `Tna` and a `Proposal` both name their client indirectly: each carries an
 * `opportunityRef`, and the opportunity carries the `organisationRef`. Reaching
 * the name is therefore two hops, which every record screen already does on its
 * own — `useTnaClient` and `useProposalClient` are the same walk written twice.
 * A list cannot make that walk per row without one request per row, so the book
 * is read once here and the hop becomes a lookup.
 *
 * Sits beside `useOrganisationDirectory` and composes with it: this resolves a
 * ref to an `organisationRef`, that one resolves an `organisationRef` to a
 * name. Neither knows about the other, so a screen that needs only one pays for
 * only one.
 *
 * The query is returned WHOLE rather than as `data ?? []`. A book that failed
 * to load must be able to say so; collapsing it into an empty array is how a
 * transport failure ends up rendering as "this record has no client".
 */
export interface OpportunityIndex {
  /** The query itself, so a screen can render its loading and error states. */
  query: UseQueryResult<Opportunity[], Error>;
  /** The book, empty while pending or failed. Check `query` before trusting it. */
  opportunities: Opportunity[];
  /** The opportunity behind a ref, or undefined when it is not in the book. */
  byRef: (ref: Ref | undefined) => Opportunity | undefined;
  /**
   * The client reference behind an opportunity reference. Undefined rather than
   * a guess when the book does not hold it — a caller that cannot resolve the
   * name should say so, not invent one.
   */
  organisationRefOf: (ref: Ref | undefined) => Ref | undefined;
}

export function useOpportunityIndex(): OpportunityIndex {
  const client = useApi();

  const query = useQuery({
    queryKey: [...queryKeys.opportunities.all, "index"] as const,
    queryFn: async () => (await client.listOpportunities({ page: { size: 200 } })).data,
  });

  const opportunities = useMemo(() => query.data ?? [], [query.data]);

  const index = useMemo(() => {
    const map = new Map<string, Opportunity>();
    for (const opportunity of opportunities) {
      map.set(opportunity.ref, opportunity);
      map.set(opportunity.id, opportunity);
    }
    return map;
  }, [opportunities]);

  const byRef = useCallback((ref: Ref | undefined) => (ref ? index.get(ref) : undefined), [index]);

  const organisationRefOf = useCallback(
    (ref: Ref | undefined) => (ref ? index.get(ref)?.organisationRef : undefined),
    [index],
  );

  return { query, opportunities, byRef, organisationRefOf };
}
