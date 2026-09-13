import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { AuthShell, GoogleGlyph, PrimaryButton } from "@/shared/components/kit";
import { DEFAULT_ROUTE_PATH } from "@/shared/config/nav";
import { safeReturnPath, useAuth } from "@/shared/auth";

/**
 * `/sign-in` — supabase mode only.
 *
 * Google is the ONE live method, so it is the one solid button. Email sign-in
 * is on the roadmap and is said so as a muted line under a divider: a disabled
 * button would look like a control that is broken today, and invite exactly
 * the click it cannot answer.
 *
 * An already signed-in reader who lands here (a bookmark, the back button) is
 * sent on rather than offered a second sign-in.
 */
export function SignInPage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const next = safeReturnPath(params.get("next"));

  if (auth?.session.status === "signedIn") {
    return <Navigate to={next ?? DEFAULT_ROUTE_PATH} replace />;
  }

  const start = async () => {
    if (auth === null) return;
    setPending(true);
    setFailure(null);
    /* On success the browser leaves for Google and nothing after this runs.
       Only a redirect that could not START comes back here. */
    const { error } = await auth.signInWithGoogle(next);
    if (error !== null) {
      setFailure(error);
      setPending(false);
    }
  };

  return (
    <AuthShell
      title="Sign in to TrainOS"
      description="Use the Google account your workspace added you with."
      note="Email sign-in — coming soon"
    >
      <div className="flex flex-col gap-2">
        <PrimaryButton
          className="w-full"
          leading={<GoogleGlyph />}
          onClick={() => void start()}
          disabled={pending}
          aria-busy={pending}
        >
          Continue with Google
        </PrimaryButton>
        {failure !== null ? (
          <p role="alert" className="text-[12px] text-ink-secondary">
            {failure}
          </p>
        ) : null}
      </div>
    </AuthShell>
  );
}
