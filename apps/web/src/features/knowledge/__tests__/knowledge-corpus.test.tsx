import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KnowledgeBaseScreen } from "../KnowledgeBaseScreen";
import { LibraryScreen } from "../LibraryScreen";
import { TemplatesScreen } from "../TemplatesScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * The three Knowledge leaves that are not Sources.
 *
 * None has an artboard. What is asserted here is the set of claims each screen
 * makes that would be silently wrong rather than visibly broken: that an
 * internal asset says it cannot reach client text, that the one template
 * section a model may not write says so, and that a source which is merely
 * degraded is not reported as unavailable.
 */

describe("Knowledge › Library", () => {
  it("leads with what is published and what needs review", async () => {
    renderScreen(<LibraryScreen />);

    expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
    await screen.findByRole("table", { name: "Library assets" });
    expect(screen.getByText(/10 assets/)).toBeInTheDocument();
    expect(screen.getByText(/1 needs review/)).toBeInTheDocument();
  });

  it("says an internal-only asset can never reach client text", async () => {
    renderScreen(<LibraryScreen />);

    const table = await screen.findByRole("table", { name: "Library assets" });
    const row = within(table)
      .getByText("Pricing and discount playbook")
      .closest("tr") as HTMLElement;

    expect(within(row).getByText("Internal")).toBeInTheDocument();
    expect(within(row).getByText("excluded from client text")).toBeInTheDocument();
  });

  it("names the stale asset and how often it has been drawn on since", async () => {
    renderScreen(<LibraryScreen />);

    const banner = await screen.findByText(
      /Safety Leadership Essentials — programme outline has not been reviewed/,
    );
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/drawn on 18 times since/)).toBeInTheDocument();
  });

  it("opens the file's machinery rather than giving it a column", async () => {
    const user = userEvent.setup();
    renderScreen(<LibraryScreen />);

    const table = await screen.findByRole("table", { name: "Library assets" });
    await user.click(
      within(table).getByText("Pricing and discount playbook").closest("tr") as HTMLElement,
    );

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Where it may be used")).toBeInTheDocument();
    expect(
      within(drawer).getByText(/excluded from every client-facing document/),
    ).toBeInTheDocument();
    expect(within(drawer).getByText("The file")).toBeInTheDocument();
  });

  it("offers an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderScreen(<LibraryScreen />);

    await screen.findByRole("table", { name: "Library assets" });
    await user.type(screen.getByRole("searchbox", { name: "Search the library" }), "zzzzz");
    expect(await screen.findByText("Nothing in the library matches")).toBeInTheDocument();
  });
});

describe("Knowledge › Templates", () => {
  it("separates the documents that get signed from the messages that get sent", async () => {
    const user = userEvent.setup();
    renderScreen(<TemplatesScreen />);

    const table = await screen.findByRole("table", { name: "Templates" });
    expect(within(table).getByText("Standard proposal")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Messages/ }));
    const messages = screen.getByRole("table", { name: "Templates" });
    expect(within(messages).queryByText("Standard proposal")).not.toBeInTheDocument();
    expect(within(messages).getByText("Programme announcement")).toBeInTheDocument();
  });

  it("prices a WhatsApp template by its category rather than its length", async () => {
    renderScreen(<TemplatesScreen />);

    const table = await screen.findByRole("table", { name: "Templates" });
    const marketing = within(table)
      .getByText("Programme announcement")
      .closest("tr") as HTMLElement;
    const utility = within(table).getByText("Proposal follow-up").closest("tr") as HTMLElement;

    expect(within(marketing).getByText("Marketing")).toBeInTheDocument();
    expect(within(marketing).getByText(/RM 0\.35/)).toBeInTheDocument();
    expect(within(utility).getByText("Utility")).toBeInTheDocument();
    expect(within(utility).getByText(/RM 0\.06/)).toBeInTheDocument();
  });

  it("states that the investment section is the one a model may not write", async () => {
    const user = userEvent.setup();
    renderScreen(<TemplatesScreen />);

    const table = await screen.findByRole("table", { name: "Templates" });
    await user.click(within(table).getByText("Standard proposal").closest("tr") as HTMLElement);

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Sections")).toBeInTheDocument();
    expect(within(drawer).getByText("Investment")).toBeInTheDocument();
    expect(within(drawer).getAllByText("human only").length).toBe(1);
    expect(
      within(drawer).getByText(/a model-composed price in a document a client signs/i),
    ).toBeInTheDocument();
  });
});

describe("Knowledge › Knowledge base", () => {
  it("counts what is answerable apart from what is merely in the corpus", async () => {
    renderScreen(<KnowledgeBaseScreen />);

    expect(await screen.findByRole("heading", { name: "Knowledge base" })).toBeInTheDocument();
    await screen.findByRole("table", { name: "Retrieval coverage by scope" });
    /* 614 chunks exist; 527 sit in an indexed source. The gap is the point. */
    expect(screen.getByText(/527 of 614 chunks answerable/)).toBeInTheDocument();
  });

  it("shows that only one source may be cited in client-facing generation", async () => {
    renderScreen(<KnowledgeBaseScreen />);

    const table = await screen.findByRole("table", { name: "Retrieval coverage by scope" });
    const clientFacing = within(table)
      .getByText("Client-facing generation")
      .closest("tr") as HTMLElement;

    expect(within(clientFacing).getByText("1 of 6")).toBeInTheDocument();
    expect(within(clientFacing).getByText("5 excluded")).toBeInTheDocument();
  });

  it("distinguishes a source that cannot answer at all from one that is degraded", async () => {
    renderScreen(<KnowledgeBaseScreen />);

    const table = await screen.findByRole("table", { name: "Sources that cannot answer fully" });

    const pending = within(table)
      .getByText("HRD Corp trainer guidelines")
      .closest("tr") as HTMLElement;
    expect(within(pending).getByText("Not retrievable")).toBeInTheDocument();

    const degraded = within(table)
      .getByText("eTRIS submission help centre")
      .closest("tr") as HTMLElement;
    expect(within(degraded).getByText("Keyword only")).toBeInTheDocument();
    expect(within(degraded).getByText(/answers from keyword matching/)).toBeInTheDocument();
  });

  it("says a changed source stays searchable and its new rules do not apply", async () => {
    renderScreen(<KnowledgeBaseScreen />);

    const banner = await screen.findByText(
      /Circular 09\/2026 has changed, and its new rules are not in force/,
    );
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/The document stays searchable/)).toBeInTheDocument();
  });

  it("points at the rules registry instead of listing the rules again", async () => {
    renderScreen(<KnowledgeBaseScreen />);

    expect(await screen.findByText("What has been read out of it")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "rules registry" });
    expect(link).toHaveAttribute("href", "/compliance/rules");
    expect(screen.queryByRole("table", { name: "Compliance rules" })).not.toBeInTheDocument();
  });
});
