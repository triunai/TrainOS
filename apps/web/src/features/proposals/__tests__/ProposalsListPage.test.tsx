import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RATE_CARD_PLACEHOLDER_VERSION } from "@trainos/contract";
import { currentPrimaries } from "@/shared/components/kit";
import { ProposalsListPage } from "../ProposalsListPage";
import { QuotationsListPage } from "../QuotationsListPage";
import { renderScreen } from "@/test/renderScreen";

const PROPOSALS = "/sales/proposals";
const QUOTATIONS = "/finance/quotations";

describe("M07 · proposal list", () => {
  const renderList = () =>
    renderScreen(<ProposalsListPage />, { path: PROPOSALS, route: PROPOSALS });

  it("resolves each client two hops out and names the document by it", async () => {
    renderList();

    expect(await screen.findByText("Aurora Manufacturing Sdn Bhd")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proposals", level: 1 })).toBeInTheDocument();
  });

  it("has no solid primary — a proposal is drafted from its opportunity", async () => {
    renderList();
    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    await waitFor(() => expect(currentPrimaries()).toEqual([]));
  });

  it("shows a warning count only on the rows that carry one", async () => {
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    const table = screen.getByRole("table", { name: "Proposals" });

    /* Nothing where there is nothing: a "0 warnings" cell on every clean row
       would spend a column teaching the reader to ignore it. */
    expect(within(table).queryByText(/^0 warnings$/)).not.toBeInTheDocument();
  });

  it("separates an agent's drafts from a person's, reading `runId` not a badge", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");

    /* The unfiltered size is read from the table, not from the counter: §16b
       stopped printing "N of M shown" until a filter has actually narrowed the
       set, so the old reading of it here was of an element that is now
       deliberately absent. What the test is for — that `runId` splits an
       agent's drafts from a person's — is unchanged. */
    const before = screen.getAllByRole("row").length;

    await user.selectOptions(screen.getByLabelText("Drafted by"), "HUMAN");

    expect(await screen.findByText("Drafted by:")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole("row").length).toBeLessThan(before);
    });

    /* And now that a filter HAS narrowed it, the count is owed again. */
    expect(screen.getByText(/of \d+ shown/)).toBeInTheDocument();
  });

  it("empties honestly when the search matches nothing", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");
    await user.type(screen.getByLabelText("Search"), "no client by this name");

    expect(await screen.findByText("No proposal matches these filters")).toBeInTheDocument();
  });

  it("puts the proposal status track and the filter controls on ONE row, per brief §10b", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Aurora Manufacturing Sdn Bhd");

    const tabs = screen.getByRole("tablist", { name: "Proposal status" });
    const filters = screen.getByRole("group", { name: "Filters" });

    /* Not "both exist" — both resolve to the SAME toolbar row. The filter row
       used to be a second band under the track, which is what §10b forbids. */
    const row = tabs.closest("[data-list-toolbar]");
    expect(row).not.toBeNull();
    expect(filters.closest("[data-list-toolbar]")).toBe(row);

    /* §16b: unfiltered, nothing counts anything — the active tab already
       prints the number, and the counter said it again on the same row. */
    expect(screen.queryByText(/\d+ of \d+ shown/)).toBeNull();

    /* Narrow it and the count comes back, inside the same row. */
    await user.type(screen.getByLabelText("Search"), "Aurora");
    const counter = await screen.findByText(/\d+ of \d+ shown/);
    expect(counter.closest("[data-list-toolbar]")).toBe(row);
  });
});

describe("M07 · quotation list", () => {
  const renderList = (role: "SALES" | "OPS" = "SALES") =>
    renderScreen(<QuotationsListPage />, { path: QUOTATIONS, route: QUOTATIONS, role });

  it("names which floor binds each price, with the floor itself beneath it", async () => {
    renderList();

    expect(await screen.findByText("QUO-2026-0184")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quotations", level: 1 })).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Quotations" });
    /* The column this screen exists for. `Quotation` carries both floors and
       the basis that chose between them, so the list can say which constraint
       holds a price up without opening the record. */
    expect(within(table).getAllByText(/Tier floor|Margin floor/).length).toBeGreaterThan(0);
  });

  it("keeps the rate card version mono, per §1's machine-value rule", async () => {
    renderList();

    await screen.findByText("QUO-2026-0184");
    const table = screen.getByRole("table", { name: "Quotations" });

    /* Mono is reserved for refs and versions. A version rendered in the UI font
       beside money in the UI font is how a reader stops being able to tell a
       machine value from a human one. */
    const version = within(table).getAllByText(RATE_CARD_PLACEHOLDER_VERSION)[0];
    expect(version).toHaveClass("font-mono");
  });

  it("narrows to the prices held up by cost rather than by the tier", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("QUO-2026-0184");
    await user.selectOptions(screen.getByLabelText("Binding floor"), "MARGIN");

    expect(await screen.findByText("Binding floor:")).toBeInTheDocument();
  });

  it("renders the OPS refusal as a refusal, not as an empty table", async () => {
    renderScreen(<QuotationsListPage />, {
      path: QUOTATIONS,
      route: QUOTATIONS,
      /* The principal, not the painted role: `quotation:read` is withheld from
         OPS server-side, so this is the client actually being refused. */
      actorId: "u_siti",
    });

    expect(await screen.findByText("The quotations could not be loaded")).toBeInTheDocument();
    /* R2: a refusal is never retried, so no retry affordance is offered. */
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Quotations" })).not.toBeInTheDocument();
  });

  it("has no solid primary — pricing happens on the worksheet", async () => {
    renderList();
    await screen.findByText("QUO-2026-0184");
    await waitFor(() => expect(currentPrimaries()).toEqual([]));
  });

  it("puts the quotation status track and the filter controls on ONE row, per brief §10b", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText("QUO-2026-0184");

    const tabs = screen.getByRole("tablist", { name: "Quotation status" });
    const filters = screen.getByRole("group", { name: "Filters" });

    const row = tabs.closest("[data-list-toolbar]");
    expect(row).not.toBeNull();
    expect(filters.closest("[data-list-toolbar]")).toBe(row);

    expect(screen.queryByText(/\d+ of \d+ shown/)).toBeNull();

    await user.type(screen.getByLabelText("Search"), "QUO-2026-0184");
    const counter = await screen.findByText(/\d+ of \d+ shown/);
    expect(counter.closest("[data-list-toolbar]")).toBe(row);
  });
});
