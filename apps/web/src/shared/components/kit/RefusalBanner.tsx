import { isDomainError, type ApiError } from "@/shared/api";
import { ExceptionBanner } from "./ExceptionBanner";

/**
 * What to show when the server refuses a write.
 *
 * A refusal is NOT a failure. `FORBIDDEN` with `details.requiredRole` is the
 * server telling the reader exactly who decides this, which is actionable
 * information and is rendered as such: the role is named, and the tone is
 * warning rather than danger because nothing is broken. Only a transport
 * failure — the request never got an answer — is drawn in danger.
 *
 * It lived in `features/settings-ai` because the three §17 screens needed it
 * first. That is also why `agents` and `knowledge` each hand-rolled a worse
 * version — `subtitle={error.message}` at `severity="DANGER"`, which paints a
 * policy decision as a breakage and throws away `requiredRole`, the one piece
 * of information that tells the reader what to do next. A component nobody
 * outside one feature can import is a component everybody outside it rewrites,
 * so it belongs here.
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
