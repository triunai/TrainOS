/**
 * M01-S01 · the executive dashboard.
 *
 * The pack's "States rendered" row is the test list:
 *   · the AR-overdue metric carries a warning delta AND earns a banner
 *   · one approval row is SLA-breached, in danger
 * plus the rules the annotation states outright: every metric drills through,
 * "Open approvals" is the only primary, and no money moves here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { resetPrimaries } from "@/shared/components/kit";
import { ApiErrorException, transportError, ApiProvider } from "@/shared/api";
import { createRpcApiClient } from "@/shared/api/apiClient";
import { __setTransportForTests } from "@/shared/api/supabase";
import { okEnvelope } from "@/shared/api/__tests__/oracleTransport";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { ExecutiveDashboard } from "../ExecutiveDashboard";
import { DASHBOARD_PATH } from "../paths";

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[DASHBOARD_PATH]}>
        <Routes>
          <Route path={DASHBOARD_PATH} element={<ExecutiveDashboard />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("M01-S01 executive dashboard", () => {
  beforeEach(() => {
    resetStore();
    fixtureClient.setLatency(0);
    resetPrimaries();
  });

  it("renders the five self-describing metric cells the server sent", async () => {
    renderDashboard();

    expect(await screen.findByText("Open pipeline")).toBeInTheDocument();
    expect(screen.getByText("AR overdue")).toBeInTheDocument();
    expect(screen.getByText("Proposals sent")).toBeInTheDocument();
    expect(screen.getByText("Claim value at risk")).toBeInTheDocument();
    expect(screen.getByText("Admin hours saved")).toBeInTheDocument();
  });

  it("raises a banner for the metric carrying the warning delta", async () => {
    renderDashboard();

    /* The pack: "AR overdue carries a warning delta and a banner." Which metric
       that is comes from `delta.severity` in the payload, so the banner follows
       the data rather than a hardcoded key. */
    const banner = await screen.findByText("AR overdue is up 18% on last month");
    expect(banner).toBeInTheDocument();
    expect(screen.getByText("4 invoices")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open collections" })).toBeInTheDocument();
  });

  it("shows the SLA-breached approval in danger in the pending rail", async () => {
    renderDashboard();

    const breached = await screen.findByText(/Discount below floor/);
    const row = breached.closest("button") as HTMLElement;

    const sla = within(row).getByText("SLA breached");
    expect(sla.className).toContain("text-danger");
  });

  it("labels admin hours saved as illustrative rather than measured", async () => {
    renderDashboard();

    /* DECISIONS §4: the tile may not display a bare number, and the basis must
       travel with it. The figure without its basis is the misleading claim the
       decision was written to prevent. It appears ONCE — the pack has one
       hours-saved tile, and a second copy in the rail would be the repetition
       CLAUDE.md opens by forbidding. */
    const cell = (await screen.findByText("Admin hours saved")).closest("div") as HTMLElement;
    expect(within(cell).getByText(/illustrative · baseline not yet measured/)).toBeInTheDocument();
    expect(screen.getAllByText("Admin hours saved")).toHaveLength(1);
  });

  it("drills a metric through to its filtered list", async () => {
    const user = userEvent.setup();
    renderDashboard();

    /* "Every metric drills through to a filtered list." A cell with a
       destination is a button; one without stays inert rather than pretending. */
    const pipeline = (await screen.findByText("Open pipeline")).closest("button");
    expect(pipeline).not.toBeNull();

    await user.click(pipeline as HTMLElement);
    expect(await screen.findByTestId("elsewhere")).toBeInTheDocument();
  });

  it("offers exactly one solid primary, and it opens the approval inbox", async () => {
    const user = userEvent.setup();
    renderDashboard();

    const primary = await screen.findByRole("button", { name: "Open approvals" });

    const solid = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("bg-primary"));
    expect(solid).toHaveLength(1);
    expect(solid[0]).toBe(primary);

    await user.click(primary);
    expect(await screen.findByTestId("elsewhere")).toBeInTheDocument();
  });

  it("reports agent activity without AI badges, because it is a reporting surface", async () => {
    renderDashboard();

    expect(await screen.findByText("Lead Agent")).toBeInTheDocument();
    expect(screen.getByText("Collections Agent")).toBeInTheDocument();

    /* The pack is explicit: "Agent activity and autonomy mix are reporting
       surfaces, not generated content, so no ✦." The autonomy chip is the only
       chip the table carries. */
    const table = screen.getByRole("table", { name: /What each agent did today/ });
    expect(within(table).queryByText(/✦/)).toBeNull();
    expect(within(table).getAllByText("Act w/ approval").length).toBeGreaterThan(0);
  });

  it("shows the whole autonomy mix and the spend against budget", async () => {
    renderDashboard();

    /* Scoped to the section: "Autonomous" is also a legitimate chip label in
       the agent table above, and a page-wide query would confuse the two. */
    const mix = (await screen.findByText("Autonomy mix")).closest("section") as HTMLElement;

    for (const rung of ["Observe", "Suggest", "Act with approval", "Autonomous"]) {
      expect(within(mix).getByText(rung)).toBeInTheDocument();
    }
    /* The share has to be legible, not merely announced — `MiniBar.valueText`
       is the accessible value and renders nothing a sighted reader can see. */
    expect(within(mix).getByText("46%")).toBeInTheDocument();

    expect(screen.getByText("Agent spend · November")).toBeInTheDocument();
  });

  it("renders the proposals sent-versus-won series for six months", async () => {
    renderDashboard();

    expect(await screen.findByText(/Proposals sent vs won · 6 months/)).toBeInTheDocument();
    expect(await screen.findByText("52 sent")).toBeInTheDocument();
    expect(screen.getByText("17 won")).toBeInTheDocument();
  });
});

/**
 * The landing route against a database that does not serve the dashboard yet.
 *
 * `/dashboard` is where sign-in lands, and in supabase mode neither the
 * dashboard read nor the proposals report has an endpoint. The page must still
 * be a page: the header and its one primary, the approvals the database CAN
 * list, and one quiet banner naming what is missing — not an error, not a retry
 * and not a blank screen.
 */
describe("M01-S01 executive dashboard · endpoints not deployed", () => {
  const undeployed = (method: string) =>
    Promise.reject(
      new ApiErrorException(
        transportError(
          "NOT_DEPLOYED",
          `${method}() is not implemented by the Supabase client yet.`,
        ),
      ),
    );

  beforeEach(() => {
    resetStore();
    fixtureClient.setLatency(0);
    resetPrimaries();
    vi.spyOn(fixtureClient, "getExecutiveDashboard").mockImplementation(() =>
      undeployed("getExecutiveDashboard"),
    );
    vi.spyOn(fixtureClient, "getProposalsVsWon").mockImplementation(() =>
      undeployed("getProposalsVsWon"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the header, lists pending approvals from the approvals read, and names the rest", async () => {
    const listApprovals = vi.spyOn(fixtureClient, "listApprovals");
    renderDashboard();

    expect(await screen.findByText("Part of this page is not available here yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open approvals" })).toBeVisible();

    /* The rail is real data from a read the database does serve. */
    expect(await screen.findByText(/Discount below floor/)).toBeInTheDocument();
    expect(listApprovals).toHaveBeenCalledWith(
      expect.objectContaining({ filter: [{ field: "status", op: "eq", value: "PENDING" }] }),
    );

    /* A report that could not be read is not "no proposals". */
    expect(screen.queryByText("No proposals in this window")).toBeNull();
    expect(screen.queryByText("Autonomy mix")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it("does not ask for the fallback approvals when the dashboard answers", async () => {
    vi.mocked(fixtureClient.getExecutiveDashboard).mockRestore();
    const listApprovals = vi.spyOn(fixtureClient, "listApprovals");
    renderDashboard();

    expect(await screen.findByText("Open pipeline")).toBeInTheDocument();
    expect(listApprovals).not.toHaveBeenCalled();
  });
});

/**
 * `ADMIN_HOURS_SAVED` against the real Supabase-backed client, not the
 * fixture oracle: the fixture always fills in a number (DECISIONS §4's
 * illustrative baseline), so it can never exercise the `null` case
 * `core.get_executive_dashboard` answers before anything measures a real
 * baseline. Driven the way `notDeployed.render.test.tsx` drives its cases —
 * `createRpcApiClient()` against a hand-built envelope — because this is
 * about what the WIRE sends, not what the fixture invents.
 */
describe("a dashboard metric with no data source", () => {
  afterEach(() => {
    __setTransportForTests(null);
  });

  it("says 'Not available' rather than folding the missing figure into a zero", async () => {
    const transport = {
      rpc: (name: string) => {
        if (name === "get_executive_dashboard") {
          return Promise.resolve(
            okEnvelope({
              metrics: [{ key: "ADMIN_HOURS_SAVED", label: "Admin hours saved", value: null }],
              approvalsPending: [],
              agentActivity: [],
              autonomyMix: [],
              agentSpend: {
                spent: { amount: 0, currency: "MYR" },
                budget: { amount: 0, currency: "MYR" },
              },
            }),
          );
        }
        if (name === "get_proposals_vs_won") {
          return Promise.resolve(okEnvelope({ series: [] }));
        }
        return Promise.reject(new Error(`unexpected rpc: ${name}`));
      },
      from: () => {
        throw new Error("ExecutiveDashboard does not read a view");
      },
    };
    __setTransportForTests(transport);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MeContext.Provider value={{ me: FIXTURE_ME, setRole: () => undefined }}>
          <ApiProvider client={createRpcApiClient()}>
            <MemoryRouter initialEntries={[DASHBOARD_PATH]}>
              <Routes>
                <Route path={DASHBOARD_PATH} element={<ExecutiveDashboard />} />
              </Routes>
            </MemoryRouter>
          </ApiProvider>
        </MeContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Admin hours saved")).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
