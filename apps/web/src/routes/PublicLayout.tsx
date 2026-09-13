import { Outlet } from "react-router-dom";
import { Toaster } from "sonner";

/**
 * Everything that must open WITHOUT a principal: the client proposal link.
 *
 * A sibling of `PrincipalLayout`, never inside it. In supabase mode that layout
 * starts with the session guard and `core.me()`, and a client holding a signed
 * proposal token has no account to satisfy either — nesting the portal there
 * sends them to Google sign-in. The token is the authorization (`portal.routes`),
 * so the only thing this layout supplies is the one toast outlet the page's
 * confirmations need. The portal reads `useApi()`, whose default is the mounted
 * client, and nothing that needs `Me`.
 */
export function PublicLayout() {
  return (
    <>
      <Outlet />
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
