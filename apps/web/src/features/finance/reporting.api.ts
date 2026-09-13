import { useQuery } from "@tanstack/react-query";
import type { Engagement, ListResponse, Programme, RateCard } from "@trainos/contract";
import type { FixtureCommission } from "@trainos/fixtures";
import { queryKeys, useApi } from "@/shared/api";
import { call } from "./api";

/**
 * The data boundary for the two finance REPORTING screens — commissions and
 * profitability.
 *
 * Separate from `api.ts` rather than appended to it for one reason: `api.ts`
 * holds the invoice and collections hooks, which are worked on by another lane,
 * and R9 makes taking someone else's in-flight edits under this lane's commit
 * the specific failure to avoid. Same feature, same barrel, same `call()`
 * translation at the boundary — a second file, not a second boundary.
 *
 * Neither screen writes. Both read collections the contract does not declare an
 * endpoint for (`listCommissions`) or declares only per-record (the rate card's
 * margin floors), so the derivation lives in `packages/fixtures` where it can
 * be asserted, and these hooks only fetch.
 */

/**
 * Commission accruals. Gated on `quotation:read` server-side, so an OPS
 * principal gets a 403 here and the screen renders the refusal rather than an
 * empty table — a page that cannot say why it is blank has said nothing.
 */
export function useCommissions() {
  const api = useApi();
  return useQuery<ListResponse<FixtureCommission>>({
    queryKey: queryKeys.commissions.list(),
    queryFn: () => call(() => api.listCommissions()),
  });
}

/**
 * Every engagement, as THIS principal is allowed to see it.
 *
 * `Engagement.finance` is optional because the OPS projection drops the block
 * entirely rather than zeroing it. Profitability is that block, so the
 * screen has to treat its absence as a withheld fact and not as a margin of
 * zero — the difference between "you may not see this" and "this deal made
 * nothing".
 */
export function useEngagements() {
  const api = useApi();
  return useQuery<ListResponse<Engagement>>({
    queryKey: queryKeys.engagements.list(),
    queryFn: () => call(() => api.listEngagements()),
  });
}

/** The catalogue, for the programme type each margin floor is set against. */
export function useProgrammeCatalogue() {
  const api = useApi();
  return useQuery<ListResponse<Programme>>({
    queryKey: queryKeys.programmes.list(),
    queryFn: () => call(() => api.listProgrammes()),
  });
}

/**
 * The rate card, which is where the margin floor comes from.
 *
 * CLAUDE.md's rule about pipeline configuration applies to money the same way:
 * a floor typed into a screen is a floor that stops matching Finance's the day
 * they change it, and nobody finds out because the screen keeps rendering.
 */
export function useRateCard() {
  const api = useApi();
  return useQuery<RateCard>({
    queryKey: queryKeys.rateCard,
    queryFn: () => call(() => api.getRateCard()),
  });
}
