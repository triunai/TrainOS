/**
 * §1 · Errors.
 *
 * Every failure the client raises is a `ContractError` carrying the §1 code,
 * the HTTP status that code maps to, and the `details` bag the §1 table
 * prescribes — so a screen can render the explanation rather than a generic
 * failure.
 */

import type { ErrorCode, ErrorDetails, ErrorEnvelope } from "@trainos/contract";
import { ERROR_STATUS } from "@trainos/contract";

export class ContractError extends Error {
  readonly code: ErrorCode;
  readonly http: number;
  readonly details?: ErrorDetails;
  readonly approvalRequestId?: string;

  constructor(code: ErrorCode, message: string, details?: ErrorDetails, approvalRequestId?: string) {
    super(message);
    this.name = "ContractError";
    this.code = code;
    this.http = ERROR_STATUS[code];
    this.details = details;
    this.approvalRequestId = approvalRequestId;
  }

  /** The §1 error body, as it would arrive over the wire. */
  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        ...(this.approvalRequestId ? { approvalRequestId: this.approvalRequestId } : {}),
      },
    };
  }
}

/**
 * Recognises a thrown `ContractError`.
 *
 * The `instanceof` check is the fast path, but it is not the whole test: a
 * bundler that ends up with two copies of this module gives two distinct
 * classes, and an error thrown by one would fail `instanceof` against the
 * other. A boundary that mis-classifies a refusal as a transport failure puts
 * a retry button on a policy decision, so the guard also accepts the structure
 * — a `ContractError` name, a string `code`, and the `toEnvelope()` every
 * consumer actually calls.
 */
export const isContractError = (value: unknown): value is ContractError => {
  if (value instanceof ContractError) return true;
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { name?: unknown; code?: unknown; toEnvelope?: unknown };
  return (
    candidate.name === "ContractError" &&
    typeof candidate.code === "string" &&
    typeof candidate.toEnvelope === "function"
  );
};

/** §1 `404` — the collection has no such id or ref. */
export const notFound = (what: string, id: string): ContractError =>
  new ContractError("NOT_FOUND", `${what} ${id} was not found.`);

/** §1 `403` — carries `requiredRole` so the UI can explain, not just disable. */
export const forbidden = (message: string, details?: ErrorDetails): ContractError =>
  new ContractError("FORBIDDEN", message, details);

/** §1 `422` — `details.fields[]` with field and reason. */
export const validationFailed = (message: string, details?: ErrorDetails): ContractError =>
  new ContractError("VALIDATION_FAILED", message, details);
