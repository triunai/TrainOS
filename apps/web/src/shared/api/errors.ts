import type { ErrorCode, ErrorDetails, ErrorEnvelope } from "@trainos/contract";
import { ERROR_STATUS } from "@trainos/contract";
import { isContractError } from "@trainos/fixtures";

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

/**
 * Transport failure codes. Deliberately small and closed.
 *
 * `NOT_DEPLOYED` is the one that is not a fault at all. PostgREST answers
 * `PGRST202`/`PGRST106`/`PGRST205` — and Postgres `42883`/`42P01` — when the
 * function, the schema or the table it was asked for does not exist. That is a
 * DEPLOYMENT fact about this environment, not an outage and not a refusal, and
 * it is the app's normal state for every RPC the migrations lane has not landed
 * yet. Folded into `SERVER` it reads as "TrainOS is down" and draws a retry
 * button over a configuration setting; as its own code a screen can render the
 * "not deployed" state instead. Classified on CODE, never on message text.
 */
export type TransportErrorCode =
  | "NETWORK"
  | "TIMEOUT"
  | "ABORTED"
  | "MALFORMED"
  | "UNAUTHENTICATED"
  | "NOT_DEPLOYED"
  | "SERVER"
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
    case "NOT_DEPLOYED":
      return "This part of TrainOS is not available in this environment yet.";
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

/**
 * Is this value already one of ours?
 *
 * Structural rather than `instanceof`, for the same reason `isContractError`
 * is: the two branches of `ApiError` are plain objects with a closed `kind`,
 * and a bundler that ends up with two copies of this module must still
 * recognise both.
 */
function isApiErrorValue(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ApiError>;
  return (
    (candidate.kind === "domain" || candidate.kind === "transport") &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

/**
 * Narrow an unknown thrown value back to an `ApiError`.
 *
 * The `ContractError` branch is the one that matters. The client throws a
 * refusal rather than returning it, and every thrown value is an `Error`, so
 * without this check a `403` came back classified as a transport `UNKNOWN` —
 * and `ErrorState` reads that classification to decide whether to draw "Try
 * again". The result was a retry button on a policy decision, which is the
 * exact failure the domain/transport split in this file exists to prevent, and
 * a `readableMessage()` of "Something went wrong" over a server message that
 * had already explained which role and permission were missing.
 *
 * `isContractError` is deliberately not `instanceof`-only: it also matches the
 * structural shape, so a bundler that ends up with two copies of the fixtures
 * module still classifies a refusal as a refusal.
 */
export function toApiError(thrown: unknown): ApiError {
  if (thrown instanceof ApiErrorException) return thrown.apiError;

  /* Already converted. Several data layers narrow a refusal at the `queryFn`
     and reject with the `ApiError` itself, and the centralised `MutationCache`
     then calls this on whatever it was handed. Without this branch that second
     pass falls through to the `instanceof Error` test, fails it — an `ApiError`
     is a plain object — and reclassifies a 403 as a transport `UNKNOWN`, which
     is "Something went wrong. Try again." printed over a policy decision, plus
     a retry `ErrorState` would then offer. Conversion has to be idempotent. */
  if (isApiErrorValue(thrown)) return thrown;

  if (isContractError(thrown)) {
    return {
      kind: "domain",
      code: thrown.code,
      message: thrown.message,
      /* The error's own status, not a second lookup. They agree today because
         `ContractError` sets `http` from `ERROR_STATUS`, and trusting the
         instance keeps them agreeing if that ever stops being true. */
      status: thrown.http,
      ...(thrown.details === undefined ? {} : { details: thrown.details }),
      ...(thrown.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: thrown.approvalRequestId }),
    };
  }

  if (thrown instanceof Error) return transportError("UNKNOWN", thrown.message, { cause: thrown });
  return transportError("UNKNOWN", "Unknown error", { cause: thrown });
}
