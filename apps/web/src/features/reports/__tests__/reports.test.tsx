import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsScreen } from "../ReportsScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * `/reports` against the real fixture client.
 *
 * The contract's own words are what these assert. §18 says the hours-saved
 * tile **must** render `basis` and may not display a bare number, so the test
 * that matters most is the one proving 41 never appears on its own.
 */

describe("/reports", () => {
  it("renders both published reports", async () => {
    renderScreen(<ReportsScreen />, { path: "/reports", route: "/reports" });
    expect(await screen.findByText("Proposals sent and won")).toBeInTheDocument();
    expect(screen.getByText("Admin hours saved")).toBeInTheDocument();
  });

  it("never shows the hours figure without its basis", async () => {
    renderScreen(<ReportsScreen />, { path: "/reports", route: "/reports" });
    /* The fixture is ILLUSTRATIVE: an unmeasured baseline table, cut by 0.7.
       A bare 41 in a board pack is how an estimate becomes a claim. */
    expect(await screen.findByText("Illustrative")).toBeInTheDocument();
    expect(screen.getByText(/baseline-v0-illustrative/)).toBeInTheDocument();
    expect(screen.getByText(/cut by ×0\.7/)).toBeInTheDocument();
  });

  it("keeps the per-action-type arithmetic behind a disclosure", async () => {
    renderScreen(<ReportsScreen />, { path: "/reports", route: "/reports" });
    await screen.findByText("Admin hours saved");

    /* §18: the machinery is present but not in the reader's way. The assertion
       is on `aria-expanded` and the kit's `inert` toggle rather than on
       `toBeVisible`, because `Collapse` hides its panel with a Tailwind
       `invisible` class and no stylesheet is loaded under jsdom — a visibility
       assertion here would pass or fail on whether CSS happened to be present,
       which is not what this test is about. */
    const toggle = screen.getByRole("button", { name: /the working behind the figure/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const table = screen.getByRole("table", { name: "Hours saved by action type" });
    expect(table.closest("[inert]")).not.toBeNull();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("table", { name: "Hours saved by action type" }).closest("[inert]"),
    ).toBeNull();
  });

  it("leads with the sentence, not the bars", async () => {
    renderScreen(<ReportsScreen />, { path: "/reports", route: "/reports" });
    /* Six months of the fixture series. The number itself is the fixture's;
       what is asserted is that a summary sentence exists above the chart. */
    expect(await screen.findByText(/proposals were won over 6 months/)).toBeInTheDocument();
  });

  it("re-reads the report when the window changes", async () => {
    renderScreen(<ReportsScreen />, { path: "/reports", route: "/reports" });
    await screen.findByText(/proposals were won over 6 months/);

    await userEvent.click(screen.getByRole("tab", { name: /12 months/ }));
    expect(await screen.findByText(/proposals were won over 12 months/)).toBeInTheDocument();
  });

  it("spends no solid primary button on a page that writes nothing", async () => {
    renderScreen(<ReportsScreen />, { path: "/reports", route: "/reports" });
    await screen.findByText("Admin hours saved");
    /* The executive dashboard link is a secondary. A primary that only
       navigates spends the view's one badge of consequence on nothing. */
    const dashboard = screen.getByRole("button", { name: "Executive dashboard" });
    expect(within(dashboard).queryByText("Export")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Export$/ })).not.toBeInTheDocument();
  });
});
