/**
 * The client is selected ONCE, here. Everything else imports `apiClient` and
 * has no idea whether it is talking to fixtures or to the network.
 *
 * Swapping in the HTTP client is a one-line change in this file.
 */
import type { TrainOsClient } from "./client";
import { fixtureClient } from "./fixture-client";

export const apiClient: TrainOsClient = fixtureClient;

export type {
  TrainOsClient,
  TrainOsClientMethod,
  ShellApi,
  ActionsApi,
  EnquiriesApi,
  OrganisationsApi,
  ProposalsApi,
  ApprovalsApi,
  EngagementsApi,
  ComplianceFinanceApi,
  KnowledgeApi,
  AgentsApi,
  AiOpsApi,
  ReportsApi,
} from "./client";

export {
  ApiErrorException,
  NOT_IMPLEMENTED,
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

export { queryClient } from "./queryClient";
export { queryKeys } from "./queryKeys";
