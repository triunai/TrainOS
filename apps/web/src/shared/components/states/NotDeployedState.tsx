import { useState } from "react";
import type { ApiError } from "@/shared/api/errors";
import { notDeployedState } from "@/shared/api/notDeployed";
import { EmptyState } from "./EmptyState";
import { ErrorDetails } from "./ErrorDetails";
import { apiErrorRows, errorDetailsEnabled } from "./errorDetailRows";

export interface NotDeployedStateProps {
  /**
   * What the reader was looking at, as a noun phrase that can start a
   * sentence — "The enquiry queue", "This proposal".
   */
  subject: string;
  /**
   * The failure behind the state. Optional because the copy does not depend on
   * it; passed so Details can name the operation a tester has to report.
   */
  error?: ApiError | undefined;
  className?: string;
}

/**
 * "This is not deployed here yet", drawn.
 *
 * The one component for the state `notDeployedState()` words, so every screen
 * over an endpoint this environment does not serve says the same sentence AND
 * carries the same Details — which operation is missing, and what the database
 * answered. Before this, a dozen screens spread `notDeployedState()` into a bare
 * `EmptyState`, which was fine for copy and left nowhere to put the operation.
 */
export function NotDeployedState({ subject, error, className }: NotDeployedStateProps) {
  const [at] = useState(() => new Date().toISOString());

  /* Details ride in the state's own centred column. `action` is the only slot
     there; the disclosure is a quiet text control, not a primary, so it does
     not spend the view's one solid button. Passed only when it will draw, so a
     production build gets no empty action row. */
  return (
    <EmptyState
      {...notDeployedState(subject)}
      {...(error && errorDetailsEnabled()
        ? { action: <ErrorDetails rows={apiErrorRows(error, at)} /> }
        : {})}
      {...(className === undefined ? {} : { className })}
    />
  );
}
