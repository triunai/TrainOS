/**
 * The render harness for the approvals screens.
 *
 * Real fixture client, real query client, real router. Nothing is mocked: the
 * point of these tests is that the screen and the §7 payload agree, and a stub
 * that returns what the screen expects proves only that the stub was written
 * to match the screen.
 *
 * `resetStore()` matters because `decideApproval` MUTATES the shared singleton
 * — an approved approval stays approved for the next test in the file.
 */

import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fixtureClient, resetStore } from "@/shared/api";
import { resetPrimaries } from "@/shared/components/kit";

/** A fresh cache per test, with retries off so a refusal surfaces immediately. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: 0 },
    },
  });
}

/** Put the shared fixture store and the single-primary registry back to zero. */
export function resetFixtures(): void {
  resetStore();
  fixtureClient.setLatency(0);
  resetPrimaries();
}

/**
 * Render a screen at `path`, with `pattern` as its route so `useParams` works.
 */
export function renderScreen(
  element: ReactElement,
  options: { path: string; pattern: string },
): RenderResult {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter initialEntries={[options.path]}>
        <Routes>
          <Route path={options.pattern} element={element} />
          {/* Somewhere for a navigation to land, so a click under test does not
              fall through to a blank tree. */}
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
