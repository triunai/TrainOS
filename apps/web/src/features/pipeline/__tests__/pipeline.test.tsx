import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { PipelineBoardPage } from "../PipelineBoardPage";
import { renderScreen } from "@/test/renderScreen";

/**
 * Sales › Pipeline. The one rule this screen exists to obey is CLAUDE.md's:
 * stage names and order render from pipeline configuration, never hardcoded.
 * Every assertion below therefore reads the configuration the fixture serves.
 */

describe("Sales › Pipeline", () => {
  it("draws one column per configured stage, in the configured order", async () => {
    renderScreen(<PipelineBoardPage />, { path: "/sales/pipeline", route: "/sales/pipeline" });

    const board = await screen.findByRole("list", { name: "Pipeline stages" });
    const headings = within(board).getAllByRole("heading", { level: 2 });

    /* Order comes from `stage.order`, not from the array the server happened to
       send and not from a list in the screen. */
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "New",
      "Qualifying",
      "TNA sent",
      "Proposal sent",
      "Negotiation",
      "Won",
      "Lost",
    ]);
  });

  it("keeps the stage that is holding nothing", async () => {
    renderScreen(<PipelineBoardPage />, { path: "/sales/pipeline", route: "/sales/pipeline" });

    const board = await screen.findByRole("list", { name: "Pipeline stages" });
    /* `New` and `TNA sent` hold no deals in the seed. The empty stage is the one
       a sales manager most wants to see. */
    expect(within(board).getAllByText("Nothing at this stage")).toHaveLength(2);
  });

  it("puts each deal in its stage's column, named by its client", async () => {
    renderScreen(<PipelineBoardPage />, { path: "/sales/pipeline", route: "/sales/pipeline" });

    const board = await screen.findByRole("list", { name: "Pipeline stages" });
    const columns = within(board).getAllByRole("listitem");

    const qualifying = columns[1];
    expect(qualifying).toBeDefined();
    expect(within(qualifying as HTMLElement).getByText("Kenanga Retail Group Berhad"));
    expect(within(qualifying as HTMLElement).getByText("OPP-0498"));
  });

  it("says how much is on the board, and how much at each column", async () => {
    renderScreen(<PipelineBoardPage />, { path: "/sales/pipeline", route: "/sales/pipeline" });

    /* RM 164,800 across the five seeded deals, and RM 67,200 of it at
       Qualifying. Both are folds over the same money, so they cannot disagree.
       "across the board" rather than "in play": configuration marks no stage
       terminal, so the total includes the won and the lost. */
    expect(await screen.findByText(/RM 164,800 across the board/)).toBeInTheDocument();

    /* Two of them at Qualifying, and that is correct: the column total and the
       single card in it are the same money read twice, so they agree by
       construction rather than by a second computation. */
    const board = screen.getByRole("list", { name: "Pipeline stages" });
    expect(within(board).getAllByText("RM 67,200")).toHaveLength(2);
  });

  it("spends no status colour on a card, because the column is the stage", async () => {
    renderScreen(<PipelineBoardPage />, { path: "/sales/pipeline", route: "/sales/pipeline" });

    const board = await screen.findByRole("list", { name: "Pipeline stages" });
    /* A chip repeating the column's own name would be accent spent on a fact
       the layout already states — and the blue budget is 5–15%. */
    expect(within(board).queryByText("Qualifying", { selector: "span.rounded-pill" })).toBeNull();
  });
});
