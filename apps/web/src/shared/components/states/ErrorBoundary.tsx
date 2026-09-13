import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { PrimaryButton, SecondaryButton } from "@/shared/components/kit/Button";
import { cn } from "@/shared/lib/utils";
import { ErrorDetails } from "./ErrorDetails";
import { crashRows } from "./errorDetailRows";

export interface ErrorBoundaryProps {
  /** What to draw once a descendant has thrown while rendering. */
  fallback: (error: unknown, reset: () => void) => ReactNode;
  /**
   * Clears a caught crash when it changes — the route path, for a screen
   * boundary, so navigating away from a broken screen is a way out of it.
   */
  resetKey?: unknown;
  children: ReactNode;
}

interface ErrorBoundaryState {
  /** Boxed, so a thrown `undefined` still counts as a crash. */
  caught: { error: unknown } | null;
}

/**
 * A render crash, contained.
 *
 * Without one, an exception thrown while rendering unmounts the whole tree and
 * the reader gets a white page with the explanation in the console. React only
 * offers this as a class; it is the one class component in the app for that
 * reason alone. It catches RENDER failures — a failed request is not a crash,
 * and still belongs to `ErrorState`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { caught: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { caught: { error } };
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.caught !== null && previous.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    /* React already reports the error and its component stack to the console
       in development. Nothing is sent anywhere else. */
  }

  reset = (): void => {
    this.setState({ caught: null });
  };

  override render(): ReactNode {
    if (this.state.caught !== null) return this.props.fallback(this.state.caught.error, this.reset);
    return this.props.children;
  }
}

export interface CrashStateProps {
  error: unknown;
  /**
   * `app` replaces the whole page — nothing above it survived, so the way out
   * is a reload. `screen` replaces one routed screen inside the shell, which
   * is still standing, so the way out is to try that screen again.
   */
  scope: "app" | "screen";
  /** Leave for the dashboard. The caller decides how: a router, or the window. */
  onGoHome: () => void;
  /** `screen` only: render the screen again. */
  onRetry?: () => void;
  className?: string;
}

/**
 * What a crash looks like — the kit's error-state anatomy at page or screen
 * scope, with the same Details disclosure a failed request carries. The stack
 * is in Details in development only.
 */
export function CrashState({ error, scope, onGoHome, onRetry, className }: CrashStateProps) {
  const [at] = useState(() => new Date().toISOString());
  const app = scope === "app";

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        app && "min-h-dvh bg-card",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-ink">
        {app ? "TrainOS hit an error it could not recover from" : "This screen hit an error"}
      </p>
      <p className="max-w-prose text-[13px] text-ink-muted">
        {app
          ? "Reload the page, or go to the dashboard."
          : "The rest of TrainOS still works. Try this screen again, or go to the dashboard."}
      </p>
      <div className="flex items-center gap-2 pt-1">
        {app ? (
          <PrimaryButton onClick={() => window.location.reload()}>Reload</PrimaryButton>
        ) : onRetry ? (
          <SecondaryButton onClick={onRetry}>Try again</SecondaryButton>
        ) : null}
        <SecondaryButton onClick={onGoHome}>Go to dashboard</SecondaryButton>
      </div>
      <ErrorDetails rows={crashRows(error, at)} />
    </div>
  );
}
