import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Me } from "@trainos/contract";
import { fixtureClient, forbidden, resetStore } from "@trainos/fixtures";
import { InvoicesListScreen } from "../index";
import { INVOICES_PATH, INVOICE_DETAIL_PATTERN } from "../paths";
import { currentPrimaries, resetPrimaries } from "@/shared/components/kit";
import { BreadcrumbProvider } from "@/shared/components/layout";
import { ApiProvider } from "@/shared/api";
import { FIXTURE_ME, MeContext } from "@/shared/hooks/useMe";
import { renderScreen } from "@/test/renderScreen";

/**
 * `/finance/invoices` — the list the leaf did not have.
 *
 * Loading, error and empty are asserted here rather than left to the happy
 * path: they are the branches nobody opens twice and the ones a list screen
 * gets wrong. Every failure is injected through the shared fixture client, so
 * what is under test is the real client answering badly rather than a stub
 * written to match the screen.
 */

const at = { path: INVOICES_PATH, route: INVOICES_PATH, role: "FINANCE" as const };

const list = () => renderScreen(<InvoicesListScreen />, at);

/** Reports the URL a navigation actually reached. */
function Landed() {
  return <div data-testid="landed" data-path={useLocation().pathname} />;
}

/**
 * The list with the RECORD route mounted beside it.
 *
 * `renderScreen` mounts one route, which is right for every other assertion
 * here and useless for a row click: with nowhere for the navigation to land, a
 * click that went nowhere and a click that went to the wrong invoice both
 * render a blank tree and the test passes either way.
 */
function renderWithDetailRoute() {
  resetStore();
  resetPrimaries();
  fixtureClient.setLatency(0);
  fixtureClient.signInAs("u_amirah");

  const me: Me = { ...FIXTURE_ME, role: "FINANCE" };

  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MeContext.Provider value={{ me, setRole: () => undefined }}>
        <ApiProvider>
          <BreadcrumbProvider>
            <MemoryRouter initialEntries={[INVOICES_PATH]}>
              <Routes>
                <Route path={INVOICES_PATH} element={<InvoicesListScreen />} />
                <Route path={INVOICE_DETAIL_PATTERN} element={<Landed />} />
              </Routes>
            </MemoryRouter>
          </BreadcrumbProvider>
        </ApiProvider>
      </MeContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  fixtureClient.setLatency(0);
});

describe("the invoices list", () => {
  it("renders a LIST on the leaf, and its breadcrumb is the path rather than a record", async () => {
    list();

    await screen.findByRole("table", { name: "Invoices" });
    expect(screen.getByRole("heading", { name: "Invoices" })).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumb-trail")).toHaveAttribute(
      "data-trail",
      "Finance › Invoices",
    );
  });

  it("carries no solid primary — raising one is policy-gated and paying happens on the record", async () => {
    list();
    await screen.findByRole("table", { name: "Invoices" });
    expect(currentPrimaries()).toHaveLength(0);
  });

  it("names the client rather than printing its reference", async () => {
    list();

    const table = await screen.findByRole("table", { name: "Invoices" });
    expect(within(table).getAllByText(/Sdn Bhd|Berhad|Group/).length).toBeGreaterThan(0);
  });

  it("opens the invoice the clicked row names", async () => {
    const user = userEvent.setup();
    renderWithDetailRoute();

    const table = await screen.findByRole("table", { name: "Invoices" });
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    const ref = (within(row).getByText(/^INV-/).textContent ?? "").trim();
    await user.click(row);

    expect(await screen.findByTestId("landed")).toHaveAttribute(
      "data-path",
      `${INVOICES_PATH}/${ref}`,
    );
  });

  it("shows a loading state before the invoices arrive", () => {
    fixtureClient.setLatency(50);
    list();
    expect(screen.getByText("Loading the invoices")).toBeInTheDocument();
  });

  it("says the invoices could not be loaded, and withholds the retry on a refusal", async () => {
    vi.spyOn(fixtureClient, "listInvoices").mockRejectedValue(
      forbidden("You may not read invoices.") as never,
    );

    list();

    expect(await screen.findByText("The invoices could not be loaded")).toBeInTheDocument();
    /* R2: a refusal is a fact about the request, and a second try does not
       change the answer. */
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("keeps the ledger readable when only the client names fail", async () => {
    vi.spyOn(fixtureClient, "searchOrganisations").mockRejectedValue(
      forbidden("You may not read the organisation book.") as never,
    );

    list();

    /* The table still renders — a name is support, not the subject — and the
       banner says which read is missing rather than leaving the reader to
       wonder why every row is a reference. */
    await screen.findByRole("table", { name: "Invoices" });
    expect(await screen.findByText(/the client names/)).toBeInTheDocument();
  });

  it("renders an empty state when the ledger is empty", async () => {
    const original = fixtureClient.listInvoices.bind(fixtureClient);
    vi.spyOn(fixtureClient, "listInvoices").mockImplementation((async (...args: unknown[]) => {
      const answer = await (original as (...a: unknown[]) => Promise<{ data: unknown[] }>)(...args);
      return { ...answer, data: [] };
    }) as never);

    list();

    expect(await screen.findByText("No invoice has been raised")).toBeInTheDocument();
  });

  it("distinguishes an empty SEARCH from an empty tab", async () => {
    const user = userEvent.setup();
    list();

    await screen.findByRole("table", { name: "Invoices" });
    await user.type(screen.getByLabelText("Search invoices"), "no such client");

    expect(await screen.findByText("No invoice matches this search")).toBeInTheDocument();
  });
});
