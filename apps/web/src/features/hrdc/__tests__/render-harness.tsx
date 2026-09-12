import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Me, Role } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { resetPrimaries } from "@/shared/components/kit";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";

/**
 * One harness for every screen test in the hrdc feature.
 *
 * The screens read the shared fixture client, so each test starts from a fresh
 * store and zero latency — a 120ms simulated round trip per call would make the
 * suite slow for no signal.
 *
 * `resetPrimaries()` matters as much as `resetStore()`: the kit's
 * one-solid-primary check is module state, and a leaked registration from the
 * previous test would make the next one warn about a clash that is not there.
 */
export function renderScreen(
  element: ReactElement,
  options: { path?: string; route?: string; role?: Role } = {},
) {
  resetStore();
  resetPrimaries();
  fixtureClient.setLatency(0);

  const me: Me = { ...FIXTURE_ME, role: options.role ?? "FINANCE" };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <MemoryRouter initialEntries={[options.path ?? "/"]}>
          <Routes>
            <Route path={options.route ?? "/"} element={element} />
          </Routes>
        </MemoryRouter>
      </MeContext.Provider>
    </QueryClientProvider>,
  );
}
