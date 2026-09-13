/**
 * @trainos/fixtures — the demo dataset and an in-memory client that implements
 * the TrainOS API contract against it.
 *
 * ```ts
 * import { createFixtureClient } from "@trainos/fixtures";
 *
 * const api = createFixtureClient({ latencyMs: 0 });
 * const inbox = await api.listApprovals({ page: { size: 10 } });
 * ```
 *
 * Every screen in the design pack has a read here that returns real-looking
 * data, and every primary button has a `performAction` call that returns one of
 * the three §3 outcomes — EXECUTED, QUEUED_FOR_APPROVAL or SUGGESTED — with the
 * diff, the effects and the errors the contract prescribes.
 */

export * as fixtures from "./data";
export * from "./data";

export { FixtureClient } from "./client/FixtureClient";
export type {
  ComputedQuotation,
  FixtureClientConfig,
  ProposalDraftResult,
  RequestOptions,
  ResponseMeta,
} from "./client/FixtureClient";

export { ContractError, isContractError, forbidden, notFound, validationFailed } from "./client/errors";
export { EventBus } from "./client/events";
export type { DomainEventHandler, RealtimeHandler, Unsubscribe } from "./client/events";
export { matchesClause, mergeFilters, paginate, readPath, applySort } from "./client/query";
export {
  evaluateFloors,
  floorPriceBreach,
  marginFloorPrice,
  reconcileInvoice,
  resultingMarginRate,
  withFloors,
} from "./client/pricing";
export type { FloorEvaluation, InvoiceReconciliation } from "./client/pricing";
export {
  DEFAULT_MINIMUM_CONFIDENCE,
  MINIMUM_CONFIDENCE,
  assignApprover,
  computeContextFlags,
  grantedAutonomy,
  matchPolicy,
  payloadValue,
} from "./client/policy";
export { byIdOrRef, createStore } from "./client/store";
export type { FixtureStore, IdempotencyRecord } from "./client/store";

import { FixtureClient, type FixtureClientConfig } from "./client/FixtureClient";

/** Builds a client over a fresh copy of the seed data. */
export const createFixtureClient = (config: FixtureClientConfig = {}): FixtureClient =>
  new FixtureClient(config);

/**
 * The shared client, for a UI that wants one instance without threading it
 * through props. Tests should prefer `createFixtureClient()`.
 */
export const fixtureClient = new FixtureClient();

/** Rebuilds the shared client's store from the seed data. */
export const resetStore = (): void => {
  fixtureClient.reset();
};
