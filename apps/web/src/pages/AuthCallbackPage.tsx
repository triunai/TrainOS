import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthShell, LoadingState, PrimaryButton } from "@/shared/components/kit";
import { DEFAULT_ROUTE_PATH } from "@/shared/config/nav";
import { SIGN_IN_PATH, takeReturnPath, useAuth } from "@/shared/auth";

/**
 * `/auth/callback` — where Google sends the browser back.
 *
 * supabase-js has already exchanged `?code=` for a session by the time this
 * reads anything (`AuthPort.ready`), so the page's only jobs are to wait for
 * that, report it honestly, and put the reader where they were going.
 *
 * Two failures, one screen. Google or Supabase refusing (the reader cancelled,
 * the redirect URL is not allow-listed) arrives as the exchange's error. A
 * callback opened with no verifier in this browser — a copied link, a different
 * origin — exchanges nothing and leaves no session. Both end in the same place:
 * start again.
 */
const EXCHANGE_FAILED =
  "Google didn't finish signing you in. It may have been cancelled or the link may have expired. Start the sign-in again from this browser.";

export function AuthCallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (auth === null) return;
    let active = true;
    void auth.completeSignIn().then(({ error, user }) => {
      if (!active) return;
      /* Never the error text itself: it can be the callback URL's
         `error_description`, which anyone can write into a link, and the
         TrainOS domain would show it as its own sentence. */
      if (error !== null) return setFailure(EXCHANGE_FAILED);
      if (user === null) {
        return setFailure(
          "No session came back from Google. Start the sign-in again from this browser.",
        );
      }
      navigate(takeReturnPath() ?? DEFAULT_ROUTE_PATH, { replace: true });
    });
    return () => {
      active = false;
    };
    // Once per mount: the exchange is single-use, and `auth` changes identity
    // when the session it is completing lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failure !== null) {
    return (
      <AuthShell title="Sign-in didn't complete" description={failure}>
        <PrimaryButton className="w-full" onClick={() => navigate(SIGN_IN_PATH, { replace: true })}>
          Back to sign in
        </PrimaryButton>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Signing you in" description="Finishing the Google sign-in.">
      <LoadingState rows={2} label="Finishing sign-in" className="p-0" />
    </AuthShell>
  );
}
