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

/** The client's own type, re-exported so no module reaches past this barrel. */
export type { FixtureClient } from "@trainos/fixtures";

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

export { useOrganisationDirectory, type OrganisationDirectory } from "./useOrganisationDirectory";

export { queryClient } from "./queryClient";
export { queryKeys } from "./queryKeys";
