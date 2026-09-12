import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Me, Role } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { resetPrimaries } from "@/shared/components/kit";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";

/**
 * One harness for every screen test in this feature.
 *
 * The screens read the shared fixture client, so each test starts from a fresh
 * store and zero latency — a 120ms simulated round trip per call would make the
 * suite slow for no signal.
 *
 * `resetPrimaries()` matters as much as `resetStore()`: the kit's
 * one-solid-primary check is module state, and a leaked registration from the
 * previous test would make the next one warn about a clash that is not there.
 *
 * `actorId` is this feature's addition to the shared harness shape. Every write
 * on the three §17 settings screens is role-gated SERVER-side — ADMIN for tiers,
 * routing and reveal, MD for raising a cap — and `useMe()`'s role is a rendering
 * convenience that the fixture client neither reads nor trusts. So a test that
 * wants the write to succeed has to change the principal the CLIENT is acting
 * as, not the one the shell is painting. The default stays `u_amirah`, which is
 * what the running app uses, so the refusal paths are the ones exercised unless
 * a test says otherwise.
 */
export function renderScreen(
  element: ReactElement,
  options: { path?: string; route?: string; role?: Role; actorId?: string } = {},
) {
  resetStore();
  resetPrimaries();
  fixtureClient.setLatency(0);
  fixtureClient.signInAs(options.actorId ?? "u_amirah");

  const me: Me = { ...FIXTURE_ME, role: options.role ?? "SALES" };

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
