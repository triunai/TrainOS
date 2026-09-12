import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { resetPrimaries } from "@/shared/components/kit";
import { BreadcrumbProvider } from "@/shared/components/layout";
import { BreadcrumbProbe } from "./BreadcrumbProbe";

/**
 * One render harness for the portal's tests.
 *
 * The fixture singleton is reset and its latency zeroed per test so a case
 * cannot inherit another's acceptance, and `resetPrimaries()` clears the
 * single-primary registry so the "no solid primary in the locked state"
 * assertion measures this render and not the previous one.
 *
 * `BreadcrumbProvider` is here only so a test can prove the portal declares
 * NOTHING into it. The real portal route mounts outside the shell and has no
 * provider above it at all; `useBreadcrumb` is safe there either way.
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
      <BreadcrumbProvider>
        <BreadcrumbProbe />
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={pattern} element={element} />
          </Routes>
        </MemoryRouter>
      </BreadcrumbProvider>
    </QueryClientProvider>
  );
}
