/**
 * The data boundary. Everything outside `shared/api` imports from here.
 *
 * `useApi()` is the seam: it hands back the client, and swapping the fixture
 * client for an HTTP one is a change inside this folder rather than at six
 * hundred call sites. The scaffold's `TrainOsClient` interface and its
 * all-`NOT_IMPLEMENTED` stub are gone — they described a boundary the app had
 * already outgrown, and keeping a second client surface alive next to the real
 * one is the divergence CLAUDE.md forbids.
 */
export {
  ACTOR_FOR_ROLE,
  ApiProvider,
  defaultClient,
  derivedIdempotencyKey,
  newIdempotencyKey,
  stableIdempotencyKey,
  useAction,
  useActor,
  useApi,
  type ActionResult,
  type ApiProviderProps,
  type UseActionOptions,
} from "./useApi";

/**
 * The seam's type: the fixture client's public surface with the class brand
 * removed, so the fixture client and the Supabase client both satisfy it.
 * `useApi()` returns this — annotate against it, not against `FixtureClient`.
 */
export type { ApiClient } from "./apiClient";
export { createRpcApiClient } from "./apiClient";

/**
 * The oracle itself — its type, the singleton, and the store reset.
 *
 * Re-exported as VALUES and not only as a type, because "no module reaches past
 * this barrel" has to hold for the tests too. A feature test that imports
 * `fixtureClient` from `@trainos/fixtures` is a feature that knows which client
 * is mounted behind the seam, and it is one search-and-replace away from being
 * the reason the swap cannot happen. Here, the same test asks the data boundary
 * for the oracle and keeps working whichever client production mounts.
 *
 * `resetStore` is part of the same surface: the fixture store is a mutable
 * singleton, so a test that decides an approval leaves it decided for the next
 * one.
 *
 * `ContractError` and `isContractError` come through here for a sharper reason
 * than tidiness. They are the CONTRACT's refusal, not the fixture client's, and
 * a module that imports them from the fixture package is a module that believes
 * a refusal is something the oracle does. It is not: `core.put_quotation`
 * raises the same refusal as SQLSTATE `TRNOS`, and `toApiError` narrows both.
 */
export type { FixtureClient } from "@trainos/fixtures";
export { ContractError, fixtureClient, isContractError, resetStore } from "@trainos/fixtures";

/** The typed RPC surface and its Supabase implementation. */
export type {
  ActionInput,
  BulkDecideInput,
  DecideInput,
  Idempotent,
  ProposalInput,
  QuotationInput,
  TrainOsClient,
} from "./client";
export { SupabaseRpcClient, createRpcClient, unwrapEnvelope } from "./rpcClient";
export { apiMode, isSupabaseConfigured } from "./supabase";

export {
  ApiErrorException,
  domainErrorFromEnvelope,
  fail,
  isDomainError,
  isRetryable,
  isTransportError,
  ok,
  readableMessage,
  toApiError,
  transportError,
  type ApiError,
  type DomainError,
  type Result,
  type TransportError,
  type TransportErrorCode,
} from "./errors";

export { isNotDeployed, notDeployedState, type NotDeployedState } from "./notDeployed";

export { useOrganisationDirectory, type OrganisationDirectory } from "./useOrganisationDirectory";
export { useOpportunityIndex, type OpportunityIndex } from "./useOpportunityIndex";

export { queryClient } from "./queryClient";
export { queryKeys } from "./queryKeys";
