import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Role } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { resetPrimaries } from "@/shared/components/kit";
import { BreadcrumbProvider } from "@/shared/components/layout";
import { ApiProvider } from "@/shared/api";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { BreadcrumbProbe } from "./BreadcrumbProbe";

/**
 * One render harness for the engagements tests.
 *
 * The ROLE is a parameter because it changes the answer: `getEngagement`
 * projects a different record per principal, and OPS gets no `finance` block at
 * all. A test that could only run as one role could not prove that.
 *
 * `MeContext` is provided directly rather than through `MeProvider`, which
 * hardcodes the fixture principal's starting role.
 *
 * `BreadcrumbProvider` is included so a test can read back the path a screen
 * DECLARES. The shell renders the trail in the top bar; a screen that quietly
 * stopped declaring one would otherwise fail silently.
 */
export function resetFixtures(): void {
  resetStore();
  fixtureClient.setLatency(0);
  resetPrimaries();
}

export function renderAt(
  path: string,
  pattern: string,
  element: ReactNode,
  role: Role = FIXTURE_ME.role,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me: { ...FIXTURE_ME, role }, setRole: () => {} }}>
        <ApiProvider>
          <BreadcrumbProvider>
            <BreadcrumbProbe />
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path={pattern} element={element} />
              </Routes>
            </MemoryRouter>
          </BreadcrumbProvider>
        </ApiProvider>
      </MeContext.Provider>
    </QueryClientProvider>
  );
}
