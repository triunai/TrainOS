import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { AuthShell, PrimaryButton, SecondaryButton } from "@/shared/components/kit";

/**
 * Signed in with Google, and in no workspace. Supabase mode only.
 *
 * This is a normal state, not an error: it is what every new account sees
 * between signing in and an administrator adding them. So it says who they are
 * signed in as — the address the administrator needs — and offers the two
 * things that can change it.
 *
 * "Check again" re-mints the access token before asking `core.me()` again.
 * The tenant is a JWT claim written when the token is issued
 * (002 `app.custom_access_token_hook`), so re-asking with the OLD token would
 * answer "not linked" forever, however long ago the membership was created.
 */
export function NoWorkspacePage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const email = auth?.session.status === "signedIn" ? auth.session.user.email : null;

  const checkAgain = async () => {
    if (auth === null) return;
    setChecking(true);
    setOutcome(null);
    const { error } = await auth.refresh();
    if (error !== null) {
      setOutcome(error);
    } else {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      /* Still mounted means `core.me()` still refused. On success the provider
         above swaps this page for the app and this line never shows. */
      setOutcome("Still not linked. Your administrator may not have added you yet.");
    }
    setChecking(false);
  };

  return (
    <AuthShell
      title="Your account isn't linked to a workspace yet"
      description={
        <>
          You're signed in as{" "}
          <span className="font-medium text-ink">{email ?? "an account with no email"}</span>. Ask
          your TrainOS administrator to add this address to your workspace, then check again.
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <PrimaryButton
          className="w-full"
          onClick={() => void checkAgain()}
          disabled={checking}
          aria-busy={checking}
        >
          Check again
        </PrimaryButton>
        <SecondaryButton className="w-full" onClick={() => void auth?.signOut()}>
          Sign out
        </SecondaryButton>
        {outcome !== null ? (
          <p role="status" className="text-center text-[12px] text-ink-muted">
            {outcome}
          </p>
        ) : null}
      </div>
    </AuthShell>
  );
}
