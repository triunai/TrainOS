import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { ApiProvider, queryClient } from "@/shared/api";
import { MeProvider } from "@/shared/hooks/MeProvider";
import { ThemeProvider } from "@/shared/theme";
import { AppRoutes } from "@/routes/routes";
import { useScrollbarReveal } from "@/shared/components/layout";

/**
 * The provider stack, in the order the dependencies actually run:
 * theme (paints), query client (data), principal (identity), api (the client,
 * whose signed-in principal follows the role toggle), router (routes).
 *
 * `ApiProvider` sits INSIDE both the query client and the principal because it
 * needs both: it reads the role and invalidates the cache when that role
 * changes. Hoisting it above either one is what leaves a role switch showing
 * the previous principal's data.
 *
 * One toast surface for the whole app. A second toast library is debt, not a
 * pattern — the centralised MutationCache in `shared/api/queryClient.ts` is the
 * only thing that should be calling it for a failed write.
 */
export default function App() {
  /* Above the router on purpose: the rule is site-wide, and the external
     proposal shell and the dev routes mount OUTSIDE `AppShell`. */
  useScrollbarReveal();

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MeProvider>
          <ApiProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
            <Toaster position="bottom-right" richColors closeButton />
          </ApiProvider>
        </MeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
