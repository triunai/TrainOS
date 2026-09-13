import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KnowledgeSourcesScreen } from "../KnowledgeSourcesScreen";
import { renderScreen } from "@/test/renderScreen";

/** The §4 "states rendered" for M16-S05, against the real fixture client. */

describe("M16-S05 · knowledge sources", () => {
  it("offers Add source as its one solid primary", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    expect(await screen.findByRole("button", { name: "Add source" })).toBeInTheDocument();
  });

  it("says the changed source is quarantined from rule extraction AND still searchable", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/Circular 09\/2026 changed since its last ingest/);
    expect(banner).toHaveTextContent(
      /quarantined from rule extraction until its diffs are reviewed/,
    );
    expect(banner).toHaveTextContent(/stays searchable meanwhile/);

    const table = screen.getByRole("table", { name: "Knowledge sources" });
    const row = within(table).getByText("Circular 09/2026").closest("tr") as HTMLElement;
    expect(within(row).getByText("Changed · review pending")).toBeInTheDocument();
    expect(
      within(row).getByText("quarantined from rule extraction · still searchable"),
    ).toBeInTheDocument();
  });

  it("shows the source whose embedding is still pending", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const table = await screen.findByRole("table", { name: "Knowledge sources" });
    const row = within(table).getByText("HRD Corp trainer guidelines").closest("tr") as HTMLElement;
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    /* Zero chunks is not zero-the-number; it is "not vectorised yet". */
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("shows the source whose fetch has been failing, with the date it started", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const table = await screen.findByRole("table", { name: "Knowledge sources" });
    const row = within(table)
      .getByText("eTRIS submission help centre")
      .closest("tr") as HTMLElement;
    expect(within(row).getByText("Failed · fetch")).toBeInTheDocument();
    expect(within(row).getByText(/failing since/)).toHaveTextContent("07 Nov 2026");
  });

  it("states the retrieval policy and the monitoring rule on the screen", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    expect(await screen.findByText("Retrieval policy")).toBeInTheDocument();
    expect(
      screen.getByText(/Internal SOPs are retrievable for staff answers and excluded/),
    ).toBeInTheDocument();
    expect(screen.getByText("Monitoring")).toBeInTheDocument();
    expect(
      screen.getByText(/A changed hash opens a rule-change review rather than updating anything/),
    ).toBeInTheDocument();
    /* The failing source is named in the monitoring copy, not left abstract. */
    expect(
      screen.getByText(/eTRIS submission help centre has been failing since/),
    ).toBeInTheDocument();
  });

  it("marks which sources may be cited in client-facing text and which may not", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const table = await screen.findByRole("table", { name: "Knowledge sources" });
    const changed = within(table).getByText("Circular 09/2026").closest("tr") as HTMLElement;
    expect(within(changed).getByText(/Compliance · Client-facing/)).toBeInTheDocument();

    const sop = within(table)
      .getByText("Akademi Perdana delivery SOP")
      .closest("tr") as HTMLElement;
    expect(within(sop).getByText("excluded from client text")).toBeInTheDocument();
  });

  it("checks a source without rewriting the corpus", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const table = await screen.findByRole("table", { name: "Knowledge sources" });
    const row = within(table).getByText("Circular 04/2026").closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Check" }));

    expect(
      await screen.findByText(/A check compares hashes and never rewrites the corpus/),
    ).toBeInTheDocument();
  });

  it("re-ingests a source and reports the new chunk count and embedding state", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    const table = await screen.findByRole("table", { name: "Knowledge sources" });
    const row = within(table).getByText("HRD Corp trainer guidelines").closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Re-ingest" }));

    expect(await screen.findByText(/^Re-ingested · \d+ chunks, embedding /)).toBeInTheDocument();
  });
  it("opens the add-source drawer and makes retrieval scope a decision, not a default", async () => {
    renderScreen(<KnowledgeSourcesScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Add source" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Compliance answers and rule extraction")).toBeInTheDocument();
    expect(within(drawer).getByText("Client-facing generation")).toBeInTheDocument();
    /* Scope is the control the retrieval policy describes, so the drawer says
       what it buys rather than offering it as a tag. */
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
