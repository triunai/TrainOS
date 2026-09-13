import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { forbidden, validationFailed } from "@trainos/fixtures";
import { ErrorState } from "@/shared/components/states";
import { isDomainError, isRetryable, readableMessage, toApiError } from "../errors";

/** The §1 refusal M07-S03 actually produces for an OPS reader. */
const thrownForbidden = () =>
  forbidden("Operations cannot read pricing.", {
    requiredRole: "FINANCE",
    requiredPermission: "quotation:read",
  });

/**
 * A refusal must not arrive dressed as a dropped connection.
 *
 * `toApiError` is the only place that decides which of the two a thrown value
 * is, and everything downstream reads that decision rather than re-deriving it:
 * `ErrorState` draws "Try again" from it, the query client decides whether to
 * retry from it, and `readableMessage` decides whether the server's sentence is
 * fit to show from it. The client THROWS a `ContractError` and every thrown
 * value is an `Error`, so an `instanceof Error` check alone classifies every
 * refusal as transport — which is a retry button on a policy decision, the one
 * thing the domain/transport split exists to prevent.
 */
describe("toApiError · a thrown ContractError is the server answering", () => {
  const thrown = thrownForbidden();

  it("classifies a 403 as a domain refusal, with its code, status and details", () => {
    const error = toApiError(thrown);

    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({
      kind: "domain",
      code: "FORBIDDEN",
      status: 403,
      message: "Operations cannot read pricing.",
    });
    expect(isDomainError(error) ? error.details : undefined).toMatchObject({
      requiredRole: "FINANCE",
      requiredPermission: "quotation:read",
    });
  });

  it("never retries a refusal, and shows the server's own sentence", () => {
    const error = toApiError(thrown);

    expect(isRetryable(error)).toBe(false);
    expect(readableMessage(error)).toBe("Operations cannot read pricing.");
  });

  it("still calls a genuine transport failure a transport failure", () => {
    const error = toApiError(new TypeError("Failed to fetch"));

    expect(isDomainError(error)).toBe(false);
    expect(error).toMatchObject({ kind: "transport", code: "UNKNOWN" });
    /* The raw message is NOT shown to a reader. */
    expect(readableMessage(error)).toBe("Something went wrong. Try again.");
  });

  it("carries the approval a POLICY_APPROVAL_REQUIRED names", () => {
    const gated = validationFailed("Send needs an approval.", { blockers: ["FLOOR_PRICE"] });
    const error = toApiError(gated);

    expect(isDomainError(error) ? error.code : undefined).toBe("VALIDATION_FAILED");
    expect(isDomainError(error) ? error.details : undefined).toMatchObject({
      blockers: ["FLOOR_PRICE"],
    });
  });
});

describe("ErrorState · what a reader can do about it", () => {
  it("offers no retry on a 403, and names the refusal", () => {
    render(
      <ErrorState
        title="Costing is not available to you"
        error={toApiError(thrownForbidden())}
        onRetry={() => undefined}
      />,
    );

    /* `onRetry` is PASSED and still not drawn: the component refuses it on the
       error's kind, so a caller cannot reintroduce the bug by wiring a handler
       in. */
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByText("Operations cannot read pricing.")).toBeInTheDocument();
    expect(screen.getByText("FORBIDDEN")).toBeInTheDocument();
  });

  it("still offers retry when the request never got an answer", () => {
    render(
      <ErrorState
        title="Could not load"
        error={toApiError(new TypeError("Failed to fetch"))}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

/**
 * Conversion has to survive being applied twice.
 *
 * Several feature data layers narrow a refusal at the `queryFn` and reject with
 * the `ApiError` itself; the centralised `MutationCache` in `queryClient.ts`
 * then calls `toApiError` on whatever it was handed. A non-idempotent
 * conversion turns that second pass into a transport `UNKNOWN`, so the reader
 * gets "Something went wrong. Try again." over a 403 the server had already
 * explained — and `ErrorState` draws a retry button on it, which is the exact
 * failure the domain/transport split exists to prevent.
 */
describe("toApiError · converting an already-converted error", () => {
  it("returns a domain refusal unchanged rather than reclassifying it", () => {
    const once = toApiError(thrownForbidden());
    const twice = toApiError(once);

    expect(twice).toBe(once);
    expect(isDomainError(twice)).toBe(true);
    expect(readableMessage(twice)).toBe("Operations cannot read pricing.");
    expect(isRetryable(twice)).toBe(false);
  });

  it("returns a transport failure unchanged too", () => {
    const once = toApiError(new Error("socket hang up"));
    const twice = toApiError(once);

    expect(twice).toBe(once);
    expect(isDomainError(twice)).toBe(false);
  });

  it("still classifies a plain object that is not one of ours as transport", () => {
    const error = toApiError({ kind: "domain" });

    expect(isDomainError(error)).toBe(false);
  });
});
