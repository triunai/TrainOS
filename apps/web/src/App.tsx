import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { queryClient } from "@/shared/api";
import { MeProvider } from "@/shared/hooks/MeProvider";
import { ThemeProvider } from "@/shared/theme";
import { AppRoutes } from "@/routes/routes";

/**
 * The provider stack, in the order the dependencies actually run:
 * theme (paints), query client (data), principal (identity), router (routes).
 *
 * One toast surface for the whole app. A second toast library is debt, not a
 * pattern — the centralised MutationCache in `shared/api/queryClient.ts` is the
 * only thing that should be calling it for a failed write.
 */
export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MeProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
          <Toaster position="bottom-right" richColors closeButton />
        </MeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
