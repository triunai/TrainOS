import { useQuery } from "@tanstack/react-query";
import type { BadgeCounts } from "@trainos/contract";
import { fixtureClient } from "@trainos/fixtures";
import { queryKeys } from "@/shared/api";

/**
 * §2 `GET /v1/badges` — what the top bar's bell counts.
 *
 * The bell is not a notification list. §2 returns three numbers that each mean
 * "something is waiting on a person", and the bell is their sum: approvals to
 * decide, HRDC deadlines closing, agent runs that failed. A bell showing only
 * approvals would go quiet while a claim window ran out.
 *
 * The count is also LIVE. `decideApproval` recomputes `badgeCounts` and
 * publishes on the `badges` channel, and both approval mutations invalidate
 * `queryKeys.badges`, so deciding an approval decrements the bell without a
 * reload. That is the whole reason this reads through the query cache rather
 * than holding its own state.
 *
 * TEMPORARY — the import. This should read `useApi()` from `@/shared/api`,
 * which another agent owns and has not landed yet. When it does, the one line
 * below becomes `const api = useApi();` and nothing else in this file changes.
 * Reaching for the singleton here is the same shortcut the screens are making,
 * and it dies in the same pass.
 */
export function useBadgeCounts() {
  return useQuery<BadgeCounts>({
    queryKey: queryKeys.badges,
    queryFn: () => fixtureClient.getBadges(),
  });
}

/** The bell's number: everything waiting on a person, in one count. */
export function useUnreadCount(): number {
  const badges = useBadgeCounts();
  if (!badges.data) return 0;

  return badges.data.approvals + badges.data.hrdcDeadlines + badges.data.agentFailures;
}
