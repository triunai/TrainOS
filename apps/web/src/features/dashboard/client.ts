/**
 * TEMPORARY — a stand-in for `useApi()` and `apiErrorFromThrown()` in
 * `@/shared/api`, which do not exist yet.
 *
 * CLAUDE.md R1 puts every read and write behind the typed client in
 * `shared/api/client.ts`. That boundary is still the `Result`-shaped
 * `TrainOsClient` whose `fixture-client.ts` answers `NOT_IMPLEMENTED` for all
 * 41 methods, while the screens are built against `@trainos/fixtures`'
 * throwing `FixtureClient`. The two surfaces have not been joined yet.
 *
 * Both helpers have been requested from the agent that owns `shared/api`, with
 * the exact signatures below. When they land, this file is deleted and the two
 * imports in `api.ts` move to `@/shared/api` — nothing else in the feature
 * changes. An identical file exists in `features/approvals` for the same
 * reason and dies in the same pass.
 *
 * It is a hook rather than a bare import so a test can inject a client with
 * `latencyMs: 0` once a provider exists, without rewriting a call site.
 */

import { fixtureClient, isContractError, type FixtureClient } from "@trainos/fixtures";
import { domainErrorFromEnvelope, toApiError, type ApiError } from "@/shared/api";

/** The client this feature reads and writes through. */
export function useApi(): FixtureClient {
  return fixtureClient;
}

/**
 * A thrown `ContractError` is the server answering — `FORBIDDEN`,
 * `VALIDATION_FAILED`, the `409` on a money-carrying bulk decide. Keeping its
 * code is what lets `ErrorState` render a refusal without a retry button, which
 * is CLAUDE.md R2. Anything else is a transport failure.
 */
export function apiErrorFromThrown(thrown: unknown): ApiError {
  if (isContractError(thrown)) return domainErrorFromEnvelope(thrown.toEnvelope());
  return toApiError(thrown);
}
