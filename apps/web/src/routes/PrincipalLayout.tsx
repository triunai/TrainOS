import { Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import { ApiProvider } from "@/shared/api";
import { RequireSession } from "@/shared/auth";
import { MeProvider } from "@/shared/hooks/MeProvider";
import { I18nProvider } from "@/shared/i18n";

/**
 * Everything that needs a principal, as ONE layout route.
 *
 * This is the provider stack `App.tsx` used to hold, in the same order —
 * principal (identity), i18n (reads the principal's locale), api (whose
 * signed-in principal follows the role) — moved under the router so the
 * sign-in and callback routes can sit BESIDE it. They cannot sit inside: there
 * is no `Me` to give `I18nProvider` or `ApiProvider` before somebody signs in.
 *
 * `RequireSession` goes first and is a pass-through in fixtures mode, so the
 * fixture app renders the exact tree it rendered before, one level lower.
 *
 * A layout route's element stays mounted while its children change, so the
 * role toggle's state survives navigation the way it did above the router.
 */
export function PrincipalLayout() {
  return (
    <RequireSession>
      <MeProvider>
        <I18nProvider>
          <ApiProvider>
            <Outlet />
            <Toaster position="bottom-right" richColors closeButton />
          </ApiProvider>
        </I18nProvider>
      </MeProvider>
    </RequireSession>
  );
}
