import { describe, it, expect } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KnowledgeSourcesScreen } from "../KnowledgeSourcesScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * M16-S05, against the real fixture client.
 *
 * The rewrite (tightening brief §18) moved most of what this file used to
 * assert OFF the page and into a drawer, so the tests follow the facts rather
 * than delete them: the chunk count, the embedding state and the hash are still
 * checked, one click further in. What is genuinely gone is asserted gone —
 * the metric band, the per-row button pair and the two explanatory cards.
 */

function rowFor(name: string): HTMLElement {
  const table = screen.getByRole("table", { name: "Knowledge sources" });
  return within(table).getByText(name).closest("tr") as HTMLElement;
}

describe("M16-S05 · knowledge sources", () => {
  it("answers 'is anything asking for me' in the header, before the inventory", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    expect(await screen.findByRole("heading", { name: "Knowledge sources" })).toBeInTheDocument();
    /* Counted from the data, not written down: six sources, two of which have
       changed or are failing to fetch. */
    expect(screen.getByText(/6 sources · 4 healthy · 2 need attention/)).toBeInTheDocument();
  });

  it("offers Add source as its one solid primary", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    expect(await screen.findByRole("button", { name: "Add source" })).toBeInTheDocument();
  });

  it("has no metric band — the six numbers moved into the row drawer", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });
    expect(screen.queryByText("Last full check")).not.toBeInTheDocument();
    expect(screen.queryByText("Embedded")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Chunks$/)).not.toBeInTheDocument();
  });

  it("is four columns wide, in sentence case", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const table = await screen.findByRole("table", { name: "Knowledge sources" });
    const headings = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim());
    expect(headings).toEqual(["Source", "Used for", "Status", "Checked", "Actions"]);
  });

  it("names the document and its type and version, and what it is read for", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });

    const changed = rowFor("Circular 09/2026");
    expect(within(changed).getByText(/HRD Corp circular/)).toBeInTheDocument();
    expect(within(changed).getByText("v1")).toBeInTheDocument();
    /* The only source carrying CLIENT_FACING. */
    expect(within(changed).getByText("Client answers")).toBeInTheDocument();

    const sop = rowFor("Akademi Perdana delivery SOP");
    expect(within(sop).getByText("Internal")).toBeInTheDocument();
  });

  it("promotes exactly one action, and only on a row with something wrong", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });

    expect(
      within(rowFor("Circular 09/2026")).getByRole("button", { name: /Review changes/ }),
    ).toBeInTheDocument();
    expect(
      within(rowFor("eTRIS submission help centre")).getByRole("button", { name: /Retry/ }),
    ).toBeInTheDocument();
    expect(
      within(rowFor("HRD Corp trainer guidelines")).getByRole("button", { name: /View progress/ }),
    ).toBeInTheDocument();

    /* A healthy row promotes nothing. An action in a row MEANS something is
       wrong with that row, which is the whole asymmetry. */
    const healthy = rowFor("Circular 04/2026");
    expect(within(healthy).getByText("Healthy")).toBeInTheDocument();
    expect(
      within(healthy).queryByRole("button", { name: /Review|Retry|View progress/ }),
    ).toBeNull();
  });

  it("keeps Check and Re-ingest out of every row, in the overflow of the healthy ones", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const table = await screen.findByRole("table", { name: "Knowledge sources" });

    /* The pair of ghost buttons on all six rows is gone from the table. */
    expect(within(table).queryByRole("button", { name: "Check" })).toBeNull();
    expect(within(table).queryByRole("button", { name: "Re-ingest" })).toBeNull();

    const healthy = rowFor("Circular 04/2026");
    const overflow = within(healthy).getByRole("button", {
      name: "More actions for Circular 04/2026",
    });
    /* Hidden until the row is hovered or the control is focused — present in
       the DOM the whole time, so the keyboard can still reach it. */
    expect(overflow.className).toContain("opacity-0");

    fireEvent.keyDown(overflow, { key: "Enter" });
    expect(await screen.findByRole("menuitem", { name: "Check" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Re-ingest" })).toBeInTheDocument();
  });

  it("carries no overflow on a row that already promoted its action", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });
    expect(
      within(rowFor("eTRIS submission help centre")).queryByRole("button", {
        name: /More actions/,
      }),
    ).toBeNull();
  });

  it("dates the last check relatively, against the freshest check in the set", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });
    expect(within(rowFor("Circular 04/2026")).getByText("4 days ago")).toBeInTheDocument();
    expect(
      within(rowFor("eTRIS submission help centre")).getByText("last week"),
    ).toBeInTheDocument();
  });

  it("splits the inventory into All and Needs attention, and narrows to the two", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const tabs = await screen.findByRole("tablist", { name: "Sources" });
    expect(within(tabs).getByRole("tab", { name: /All/ })).toHaveTextContent("6");
    expect(within(tabs).getByRole("tab", { name: /Needs attention/ })).toHaveTextContent("2");

    await userEvent.click(within(tabs).getByRole("tab", { name: /Needs attention/ }));

    const table = screen.getByRole("table", { name: "Knowledge sources" });
    expect(within(table).getByText("Circular 09/2026")).toBeInTheDocument();
    expect(within(table).getByText("eTRIS submission help centre")).toBeInTheDocument();
    expect(within(table).queryByText("Circular 04/2026")).toBeNull();
  });

  it("puts the tabs and the filters on ONE row, per §10b", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const tabs = await screen.findByRole("tablist", { name: "Sources" });
    const filters = screen.getByRole("group", { name: "Filters" });
    /* The assertion every migrated list screen shares: both halves resolve to
       the same ListToolbar, so the tab band and the filter band cannot drift
       back into two rows with two rules between the heading and the data. */
    expect(tabs.closest("[data-list-toolbar]")).toBe(filters.closest("[data-list-toolbar]"));
    expect(tabs.closest("[data-list-toolbar]")).not.toBeNull();
  });

  it("narrows by name and by what a source is read for, on the tab row", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });

    await userEvent.selectOptions(screen.getByLabelText("Used for"), "Client answers");
    const table = screen.getByRole("table", { name: "Knowledge sources" });
    expect(within(table).getByText("Circular 09/2026")).toBeInTheDocument();
    expect(within(table).queryByText("Akademi Perdana delivery SOP")).toBeNull();
  });

  it("states the change in one sentence and keeps the quarantine rule behind Why?", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Circular 09/2026 has changed");
    expect(banner).toHaveTextContent(
      "Existing answers remain available. Review the changes before new rules become active.",
    );

    const why = within(banner).getByRole("button", { name: "Why?" });
    expect(why).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    const revealed = document.getElementById(why.getAttribute("aria-controls") ?? "");
    expect(revealed).toHaveTextContent(/quarantined from rule extraction/);
    expect(revealed).toHaveTextContent(/stays searchable/);
  });

  it("is the page's only banner", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("holds every number that left the page in the row's drawer", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });

    await userEvent.click(within(rowFor("Circular 04/2026")).getByText("Circular 04/2026"));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("HRD Corp circular · v2")).toBeInTheDocument();
    /* Chunks, embedding state, monitor cadence, hash, version, retrieval
       permissions, last ingestion — §18's list, in one place. */
    expect(within(drawer).getByText("118")).toBeInTheDocument();
    expect(within(drawer).getByText(/Indexed — retrieval uses the vectors/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Weekly · content hash/)).toBeInTheDocument();
    expect(within(drawer).getByText(/^sha256:41b8e7c2/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Excluded from client-facing generation/)).toBeInTheDocument();
    expect(within(drawer).getByText("18 Jun 2026 · 08:00")).toBeInTheDocument();
    /* Not a dead end: the row's own actions are reachable from inside it. */
    expect(within(drawer).getByRole("button", { name: "Check" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Re-ingest" })).toBeInTheDocument();
  });

  it("says a pending embedding is not zero chunks", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });

    await userEvent.click(
      within(rowFor("HRD Corp trainer guidelines")).getByText("HRD Corp trainer guidelines"),
    );

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Not vectorised yet")).toBeInTheDocument();
    expect(within(drawer).getByText(/answers from keyword matching/)).toBeInTheDocument();
  });

  it("moves the two explanatory cards behind a quiet link beside the title", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await screen.findByRole("table", { name: "Knowledge sources" });

    /* Off the page. */
    expect(screen.queryByText("Retrieval policy")).not.toBeInTheDocument();
    expect(screen.queryByText("Monitoring")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "How sources work" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getAllByRole("listitem")).toHaveLength(4);
    expect(within(drawer).getByText(/excluded from client-facing generation/)).toBeInTheDocument();
    expect(within(drawer).getByText(/fetched weekly and hashed/)).toBeInTheDocument();
    expect(within(drawer).getByText(/never rewrites the corpus/)).toBeInTheDocument();
  });

  it("opens the add-source drawer and makes retrieval scope a decision, not a default", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Add source" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Compliance answers and rule extraction")).toBeInTheDocument();
    expect(within(drawer).getByText("Client-facing generation")).toBeInTheDocument();
    expect(within(drawer).getByText(/Scope is the control, not a tag/)).toBeInTheDocument();
    expect(within(drawer).getByText(/A new source is ingested unindexed/)).toBeInTheDocument();
  });

  it("ingests a source through createKnowledgeSource", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Add source" }));

    const drawer = await screen.findByRole("dialog");
    await userEvent.type(
      within(drawer).getByPlaceholderText("Circular 10/2026"),
      "Circular 11/2026",
    );
    await userEvent.click(within(drawer).getByRole("button", { name: "Add source" }));

    const table = await screen.findByRole("table", { name: "Knowledge sources" });
    expect(await within(table).findByText("Circular 11/2026")).toBeInTheDocument();
  });
});
