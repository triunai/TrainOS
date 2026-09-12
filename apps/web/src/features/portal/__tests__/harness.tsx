import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { resetPrimaries } from "@/shared/components/kit";

/**
 * One render harness for the portal's tests.
 *
 * The fixture singleton is reset and its latency zeroed per test so a case
 * cannot inherit another's acceptance, and `resetPrimaries()` clears the
 * single-primary registry so the "no solid primary in the locked state"
 * assertion measures this render and not the previous one.
 */
export function resetFixtures(): void {
  resetStore();
  fixtureClient.setLatency(0);
  resetPrimaries();
}

export function renderAt(path: string, pattern: string, element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
