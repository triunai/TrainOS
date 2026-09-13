import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { isDomainError, readableMessage, type ApiError } from "@/shared/api/errors";
import { isNotDeployed, notDeployedState } from "@/shared/api/notDeployed";
import { EmptyState } from "./EmptyState";

export interface ErrorStateProps {
  /** What failed, in the reader's terms. */
  title?: string;
  /**
   * The error itself. A DOMAIN error's message comes from the server and is
   * written for a person, so it is shown as-is; a transport error gets a plain
   * fallback instead of leaking internals.
   */
  error?: ApiError;
  /** Overrides the message derived from `error`. */
  description?: string;
  /** A retry affordance. Omit it when retrying cannot help — a refusal. */
  onRetry?: () => void;
  /** Anything the reader can do instead, e.g. a link to request access. */
  action?: ReactNode;
  className?: string;
}

/**
 * The error state.
 *
 * It says what failed and what the reader can do. A retry button is offered
 * only when a retry could plausibly work: a domain refusal is a fact about the
 * request, and a retry button on one trains people to click through refusals.
 *
 * A `NOT_DEPLOYED` failure is not drawn as an error at all. It is a fact about
 * this environment — the endpoint has not shipped to this database — so it gets
 * the standard not-available empty state: no alert, no retry. Deciding it here
 * rather than per screen is what lets every screen over an unserved endpoint say
 * the true thing without each one learning the rule.
 */
export function ErrorState({
  title = "Something went wrong",
  error,
  description,
  onRetry,
  action,
  className,
}: ErrorStateProps) {
  if (isNotDeployed(error)) {
    return (
      <EmptyState
        {...notDeployedState("This part of TrainOS")}
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  const message = description ?? (error ? readableMessage(error) : undefined);
  const refused = error !== undefined && isDomainError(error);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {message ? <p className="max-w-prose text-[13px] text-ink-muted">{message}</p> : null}
      {error && isDomainError(error) ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-disabled">
          {error.code}
        </p>
      ) : null}
      <div className="flex items-center gap-2 pt-1">
        {onRetry && !refused ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-control border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-hover"
          >
            Try again
          </button>
        ) : null}
        {action}
      </div>
    </div>
  );
}
