import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Me, Role } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { MeContext, FIXTURE_ME } from "@/shared/hooks/useMe";
import { resetPrimaries } from "@/shared/components/kit";

/**
 * One harness for every screen test in this feature.
 *
 * Fresh store and zero latency per test. The role is a parameter because the
 * fixture client enforces `quotation:read` for real, and "Operations cannot see
 * pricing" is a rendered state on M07-S03 rather than a hidden route.
 */
export function renderScreen(
  element: ReactElement,
  options: { path: string; route: string; role?: Role },
) {
  resetStore();
  resetPrimaries();
  fixtureClient.setLatency(0);

  const me: Me = { ...FIXTURE_ME, role: options.role ?? "SALES" };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <MemoryRouter initialEntries={[options.path]}>
          <Routes>
            <Route path={options.route} element={element} />
          </Routes>
        </MemoryRouter>
      </MeContext.Provider>
    </QueryClientProvider>,
  );
}
