import { isDomainError, type ApiError } from "@/shared/api";
import { ExceptionBanner } from "@/shared/components/kit";

/**
 * What to show when the server refuses a write on this feature.
 *
 * All three §17 settings screens write through a role gate — ADMIN for tiers,
 * routing and reveal; the MD for raising a cap — so all three need the same
 * answer to the same question, and one component gives it once.
 *
 * A refusal is NOT a failure. `FORBIDDEN` with `details.requiredRole` is the
 * server telling the reader exactly who decides this, which is actionable
 * information and is rendered as such: the role is named, and the tone is
 * warning rather than danger because nothing is broken. Only a transport
 * failure — the request never got an answer — is drawn in danger.
 */

export interface RefusalBannerProps {
  /** What the user was trying to do, e.g. "Routing was not applied". */
  title: string;
  error: ApiError;
}

export function RefusalBanner({ title, error }: RefusalBannerProps) {
  if (!isDomainError(error)) {
    return (
      <ExceptionBanner
        severity="DANGER"
        title={title}
        subtitle={`${error.message} Nothing was changed.`}
      />
    );
  }

  const requiredRole = error.details?.requiredRole;

  return (
    <ExceptionBanner
      severity="WARN"
      title={title}
      subtitle={
        requiredRole
          ? `${error.message} This is decided by ${requiredRole}, and you are not signed in as one. Nothing was changed, and your edits are still staged.`
          : `${error.message} (${error.code}) Nothing was changed.`
      }
    />
  );
}
