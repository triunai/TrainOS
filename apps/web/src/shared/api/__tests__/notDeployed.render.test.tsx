import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Me } from "@trainos/contract";
import { BreadcrumbProvider } from "@/shared/components/layout";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { EnquiryInboxPage } from "@/features/enquiries";

import { createRpcApiClient } from "../apiClient";
import { ApiProvider } from "../useApi";
import { __setTransportForTests } from "../supabase";
import { unexposedSchemaTransport } from "./oracleTransport";

/**
 * The screens, against the hosted project as it actually answers today.
 *
 * `PGRST106 Invalid schema: core` is what every call in the app currently gets
 * back, and the question this file settles is not how it is CLASSIFIED — the
 * conformance suites pin that — but what a reader SEES. An error surface with
 * "Try again" on it invites a retry of a Dashboard setting; the not-deployed
 * state says the true thing, that this environment does not serve this part of
 * TrainOS yet.
 *
 * WHY IT LIVES HERE AND NOT IN EACH FEATURE. It is one invariant across three
 * features, and `shared/api` owns both halves of it: the classification and the
 * copy. Three copies of this harness in three `__tests__` folders is the
 * divergence CLAUDE.md calls a defect, and the first fix that landed in one and
 * not the others would leave a screen quietly drawing a retry button again.
 * Dependency-cruiser excludes `*.test.tsx`, so importing a screen here does not
 * put a `shared -> features` edge in the graph.
 *
 * The RENDER TESTS THEMSELVES still run on fixtures, as every feature suite
 * does: what changes here is the CLIENT mounted behind `ApiProvider`, which is
 * exactly the seam this lane exists to make swappable.
 */

/** The one harness, with the client as the variable. */
function renderWithRpcClient(element: ReactElement, route: string): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const me: Me = { ...FIXTURE_ME, role: "SALES" };

  render(
    <QueryClientProvider client={queryClient}>
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <ApiProvider client={createRpcApiClient()}>
          <BreadcrumbProvider>
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route path={route} element={element} />
              </Routes>
            </MemoryRouter>
          </BreadcrumbProvider>
        </ApiProvider>
      </MeContext.Provider>
    </QueryClientProvider>,
  );
}

describe("an undeployed `core` schema reads as a state, not as a failure", () => {
  beforeEach(() => {
    __setTransportForTests(unexposedSchemaTransport());
  });

  afterEach(() => {
    __setTransportForTests(null);
  });

  it("M03-S01 · the enquiry inbox says the queue is not available yet", async () => {
    renderWithRpcClient(<EnquiryInboxPage />, "/sales/enquiries");

    expect(await screen.findByText(/The enquiry queue is not available here yet/)).toBeVisible();
    /* No alert, and nothing to click: a retry cannot change a schema that is
       not exposed, and offering one trains people to click through facts. */
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
