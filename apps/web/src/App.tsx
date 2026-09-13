import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "@/shared/api";
import { AuthProvider } from "@/shared/auth";
import { ThemeProvider } from "@/shared/theme";
import { AppRoutes } from "@/routes/routes";
import { useScrollbarReveal } from "@/shared/components/layout";
import { CrashState, ErrorBoundary } from "@/shared/components/states";
import { DEFAULT_ROUTE_PATH } from "@/shared/config/nav";

/**
 * The provider stack, in the order the dependencies actually run:
 * theme (paints), query client (data), router (routes), session (who is signed
 * in — supabase mode only, inert on fixtures), then the routes.
 *
 * The principal, i18n and api providers are NOT here. They need a `Me`, and the
 * sign-in and callback screens exist precisely because there is none yet, so
 * they moved one level down into `routes/PrincipalLayout.tsx`, in the same
 * order: `ApiProvider` still sits inside both the query client and the
 * principal, because it reads the role and invalidates the cache when that role
 * changes.
 *
 * The session sits INSIDE the query client because signing out, or signing in
 * as somebody else, has to clear it.
 *
 * One toast surface for the whole app, mounted by `PrincipalLayout`. A second
 * toast library is debt, not a pattern — the centralised MutationCache in
 * `shared/api/queryClient.ts` is the only thing that should be calling it for a
 * failed write.
 *
 * The outermost error boundary is inside the theme (so the crash page is
 * painted) and outside everything else, because a crash in the session or the
 * router has to be caught too. Its way home is the window, not the router —
 * the router may be what broke. Each routed screen has its own boundary in
 * `AppShell`, so this one only sees what the shell could not contain.
 */
export default function App() {
  /* Above the router on purpose: the rule is site-wide, and the external
     proposal shell, the account screens and the dev routes mount OUTSIDE
     `AppShell`. */
  useScrollbarReveal();

  return (
    <ThemeProvider>
      <ErrorBoundary
        fallback={(error) => (
          <CrashState
            scope="app"
            error={error}
            onGoHome={() => window.location.assign(DEFAULT_ROUTE_PATH)}
          />
        )}
      >
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
