import { useQuery } from "@tanstack/react-query";
import type { MeProfile } from "@trainos/contract";
import { queryKeys, toApiError, useApi, type ApiError } from "@/shared/api";

/**
 * §2 ruled R14 · `GET /v1/me/profile` — the eleven fields the Kit §07 profile
 * modal draws that `Me` does not carry.
 *
 * Its own query rather than part of `useMe()`, for the reason the contract
 * gives: `/v1/me` is the shell bootstrap that every screen reads on every page
 * load, and widening it would put a personal mobile number, a staff number and
 * the account's two-factor state into every screen's cache to serve a modal
 * most sessions never open.
 *
 * `enabled` is the point of the hook. The modal is closed almost always, so the
 * request is not made until somebody opens it — which is also what makes the
 * narrower payload worth having.
 *
 * The key hangs off `queryKeys.me`, so signing in as a different principal
 * clears the profile with the identity it belongs to rather than leaving the
 * previous holder's mobile number on screen.
 */
export function useMeProfile(enabled: boolean) {
  const api = useApi();
  return useQuery<MeProfile, ApiError>({
    queryKey: [...queryKeys.me, "profile"] as const,
    queryFn: () => api.getMeProfile().catch((thrown) => Promise.reject(toApiError(thrown))),
    enabled,
  });
}
