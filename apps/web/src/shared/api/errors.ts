import type { ErrorCode, ErrorDetails, ErrorEnvelope } from "@trainos/contract";
import { ERROR_STATUS } from "@trainos/contract";

/**
 * Two kinds of failure, kept apart on purpose.
 *
 * A DOMAIN error is the server answering. `FORBIDDEN`, `FLOOR_PRICE_BREACH`,
 * `ATTENDANCE_LOCKED` are FACTS about the request, not flakiness. They must
 * never be retried, and they usually have a designed surface: an approval
 * banner, an inline field error, a locked-state explanation.
 *
 * A TRANSPORT error is the request never getting an answer it could read — a
 * dropped connection, a timeout, a body that is not the contract's envelope.
 * These are the only ones a retry can help.
 *
 * Collapsing the two is the failure this file exists to prevent: retrying a
 * refusal, or rendering "something went wrong" over a policy decision the user
 * could have acted on.
 */

export interface DomainError {
  kind: "domain";
  /** The contract's own code. */
  code: ErrorCode;
  message: string;
  /** HTTP status, from the contract's `ERROR_STATUS` map. */
  status: number;
  details?: ErrorDetails;
  /** Present on `POLICY_APPROVAL_REQUIRED` — the approval to route the user to. */
  approvalRequestId?: string;
}

/** Transport failure codes. Deliberately small and closed. */
export type TransportErrorCode =
  | "NETWORK"
  | "TIMEOUT"
  | "ABORTED"
  | "MALFORMED"
  | "UNAUTHENTICATED"
  | "SERVER"
  /** The client method exists in the interface but has no implementation yet. */
  | "NOT_IMPLEMENTED"
  | "UNKNOWN";

export interface TransportError {
  kind: "transport";
  code: TransportErrorCode;
  message: string;
  status?: number;
  cause?: unknown;
}

export type ApiError = DomainError | TransportError;

/** Every client method returns this. It never throws for an expected failure. */
export type Result<T> = { data: T; error: null } | { data: null; error: ApiError };

export const ok = <T>(data: T): Result<T> => ({ data, error: null });
export const fail = <T>(error: ApiError): Result<T> => ({ data: null, error });

export const isDomainError = (error: ApiError): error is DomainError => error.kind === "domain";
export const isTransportError = (error: ApiError): error is TransportError =>
  error.kind === "transport";

/**
 * Only transport failures that could plausibly succeed on a second attempt.
 * A domain refusal is never retryable — that is the whole point of the split.
 */
export function isRetryable(error: ApiError): boolean {
  if (error.kind === "domain") return false;
  return error.code === "NETWORK" || error.code === "TIMEOUT" || error.code === "SERVER";
}

/** Build a domain error from the contract's error body. */
export function domainErrorFromEnvelope(envelope: ErrorEnvelope): DomainError {
  const { code, message, details, approvalRequestId } = envelope.error;
  return {
    kind: "domain",
    code,
    message,
    status: ERROR_STATUS[code],
    ...(details === undefined ? {} : { details }),
    ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
  };
}

export function transportError(
  code: TransportErrorCode,
  message: string,
  extra?: { status?: number; cause?: unknown },
): TransportError {
  return {
    kind: "transport",
    code,
    message,
    ...(extra?.status === undefined ? {} : { status: extra.status }),
    ...(extra?.cause === undefined ? {} : { cause: extra.cause }),
  };
}

/** The marker every unimplemented client method returns. */
export const NOT_IMPLEMENTED = (method: string): TransportError =>
  transportError(
    "NOT_IMPLEMENTED",
    `${method}() is declared in the TrainOsClient interface but has no implementation in this client yet.`,
  );

/**
 * Message to show a reader. Domain messages come from the server and are
 * written for a person; transport messages are not, so they get a plain
 * fallback rather than leaking a stack.
 */
export function readableMessage(error: ApiError): string {
  if (error.kind === "domain") return error.message;
  switch (error.code) {
    case "NETWORK":
      return "Could not reach TrainOS. Check your connection and try again.";
    case "TIMEOUT":
      return "The request took too long. Try again.";
    case "UNAUTHENTICATED":
      return "Your session has expired. Sign in again.";
    case "NOT_IMPLEMENTED":
      return "This is not connected yet.";
    default:
      return "Something went wrong. Try again.";
  }
}

/** Thrown only where a caller needs an exception — a TanStack Query `queryFn`. */
export class ApiErrorException extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(readableMessage(apiError));
    this.name = "ApiErrorException";
    this.apiError = apiError;
  }
}

/** Narrow an unknown thrown value back to an `ApiError`. */
export function toApiError(thrown: unknown): ApiError {
  if (thrown instanceof ApiErrorException) return thrown.apiError;
  if (thrown instanceof Error) return transportError("UNKNOWN", thrown.message, { cause: thrown });
  return transportError("UNKNOWN", "Unknown error", { cause: thrown });
}
