/**
 * R2 — a refusal is not a failure.
 *
 * A DomainError is the system answering: an illegal transition, a guard that
 * did not pass, a cap breach. It is never retried and it always has a surface
 * the operator can act on. Anything else thrown is a transport/programming
 * error and is the only kind a retry can help.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Codes the database raises from its guards, mapped back into DomainErrors. */
const DB_CODES = [
  "ILLEGAL_TRANSITION",
  "TRANSITION_REASON_REJECTED",
  "TRANSITION_ACTOR_REJECTED",
  "STAGE_CHANGE_WITHOUT_CONTEXT",
  "PACKAGE_UPDATE_WITHOUT_CONTEXT",
  "PACKAGE_MUST_START_AT_INITIAL_STAGES",
  "PACKAGE_DELETE_FORBIDDEN",
  "PACKAGE_IDENTITY_IMMUTABLE",
  "AUDIT_APPEND_ONLY",
  "VAULT_IMMUTABLE",
  "PAY_WHEN_PAID",
  "PV_PAID_IS_FINAL",
  "UNKNOWN_ACTOR_TYPE",
  "CERTIFICATE_IMMUTABLE",
  "CERTIFICATE_REVOCATION_FINAL",
  "ASSESSMENT_FINAL",
] as const;

export function fromDatabaseError(error: unknown): DomainError | undefined {
  if (!(error instanceof Error)) return undefined;
  const pgError = error as Error & { code?: string; constraint?: string };
  const code = DB_CODES.find((c) => pgError.message.startsWith(`${c}:`) || pgError.message === c);
  if (code) return new DomainError(code, pgError.message);
  if (pgError.code === "23514" && pgError.constraint) {
    return new DomainError("CONSTRAINT_VIOLATION", `Check constraint ${pgError.constraint} refused the write`, {
      constraint: pgError.constraint,
    });
  }
  if (pgError.code === "23505") {
    return new DomainError("DUPLICATE", pgError.message, { constraint: pgError.constraint });
  }
  return undefined;
}

/** Serialisable result for server actions (R3: the UI must be able to show it). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; kind: "domain"; code: string; message: string; details?: Record<string, unknown> }
  | { ok: false; kind: "transport"; message: string };
