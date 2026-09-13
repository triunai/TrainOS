import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Me, Role } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { ApiProvider } from "@/shared/api";
import { MeContext, FIXTURE_ME } from "@/shared/hooks/useMe";
import { resetPrimaries } from "@/shared/components/kit";

/**
 * One harness for every screen test in this feature.
 *
 * The screens read the shared fixture client, so each test starts from a fresh
 * store and zero latency — a 120ms simulated round trip per call would make
 * this file slow for no signal.
 *
 * The role is a parameter because the catalogue's primary action is role-gated
 * and "Sales cannot edit" is a behaviour worth asserting, not a screenshot.
 */
export function renderScreen(
  element: ReactElement,
  options: { path: string; route: string; role?: Role } = {
    path: "/",
    route: "/",
  },
) {
  resetStore();
  resetPrimaries();
  fixtureClient.setLatency(0);

  const role = options.role ?? "SALES";
  const me: Me = { ...FIXTURE_ME, role };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <ApiProvider>
          <MemoryRouter initialEntries={[options.path]}>
            <Routes>
              <Route path={options.route} element={element} />
            </Routes>
          </MemoryRouter>
        </ApiProvider>
      </MeContext.Provider>
    </QueryClientProvider>,
  );
}
