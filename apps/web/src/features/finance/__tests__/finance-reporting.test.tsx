import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommissionsScreen } from "../CommissionsScreen";
import { ProfitabilityScreen } from "../ProfitabilityScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * The two finance reporting screens, against the real fixture client.
 *
 * Neither has an artboard, so there is no "states rendered" list to work from.
 * What these assert instead is the handful of claims the screens make that
 * would be invisible if they were wrong: that a rate is read from configuration
 * rather than assumed, that a withheld figure is not rendered as a zero, and
 * that money nobody has collected is not counted as money in hand.
 */

describe("Finance › Commissions", () => {
  it("leads with what is payable, what is accrued and what is at risk", async () => {
    renderScreen(<CommissionsScreen />);

    expect(await screen.findByRole("heading", { name: "Commissions" })).toBeInTheDocument();
    /* The header's summary is computed from the rows, so it is only true once
       they have arrived. */
    await screen.findByRole("table", { name: "Commission accruals" });
    /* Payable is the two collected deals: RM 1,480.00 + RM 448.00. */
    expect(screen.getByText(/RM 1,928\.00 payable/)).toBeInTheDocument();
    /* Accrued is the two invoiced-but-uncollected ones, and is a different
       number from payable on purpose. */
    expect(screen.getByText(/RM 2,806\.40 accrued/)).toBeInTheDocument();
    expect(screen.getByText(/1 at risk/)).toBeInTheDocument();
  });

  it("shows the manager's rate as the rate card's 2%, and says where it came from", async () => {
    renderScreen(<CommissionsScreen />);

    const table = await screen.findByRole("table", { name: "Commission accruals" });
    const row = within(table).getByText("Kenanga Retail Group Berhad").closest("tr") as HTMLElement;

    expect(within(row).getByText("2.0%")).toBeInTheDocument();
    expect(within(row).getByText("rate card")).toBeInTheDocument();
    expect(within(row).getByText("Sales manager")).toBeInTheDocument();
  });

  it("names the account whose accrual sits behind a trading hold", async () => {
    renderScreen(<CommissionsScreen />);

    const banner = await screen.findByText(/of commission sits behind an invoice past the/);
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/Sutera Hospitality Group · INV-2026-0244/)).toBeInTheDocument();
  });

  it("opens the derivation rather than printing it on the page", async () => {
    const user = userEvent.setup();
    renderScreen(<CommissionsScreen />);

    const table = await screen.findByRole("table", { name: "Commission accruals" });
    const row = within(table)
      .getAllByText("Aurora Manufacturing Sdn Bhd")[0]
      ?.closest("tr") as HTMLElement;
    await user.click(row);

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("How it was calculated")).toBeInTheDocument();
    expect(within(drawer).getByText("Sell price")).toBeInTheDocument();
    expect(within(drawer).getByText("v0-placeholder")).toBeInTheDocument();
    expect(within(drawer).getByText("When it becomes payable")).toBeInTheDocument();
    expect(within(drawer).getByText("On collection")).toBeInTheDocument();
  });

  it("says why the page is blank for a principal who may not read a quotation", async () => {
    renderScreen(<CommissionsScreen />, { role: "OPS" });

    expect(await screen.findByText("Commission accruals could not be loaded")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Commission accruals" })).not.toBeInTheDocument();
  });

  it("offers an empty state rather than an empty table when nothing matches", async () => {
    const user = userEvent.setup();
    renderScreen(<CommissionsScreen />);

    await screen.findByRole("table", { name: "Commission accruals" });
    await user.type(
      screen.getByRole("searchbox", { name: "Search commissions" }),
      "an account that does not exist",
    );
    expect(await screen.findByText("Nothing in this bucket")).toBeInTheDocument();
  });
});

describe("Finance › Profitability", () => {
  it("blends the margin over realised engagements only", async () => {
    renderScreen(<ProfitabilityScreen />);

    expect(await screen.findByRole("heading", { name: "Profitability" })).toBeInTheDocument();
    await screen.findByRole("table", { name: "Engagement profitability" });
    /* Five delivered or closed engagements; the two cancelled ones carry an
       honest zero and are excluded, or the blended figure would report a
       business that lost money it never spent. */
    expect(screen.getByText(/5 realised engagements/)).toBeInTheDocument();
    expect(screen.getByText(/blended margin/)).toBeInTheDocument();
  });

  it("states the floor beside each margin and reports none breached", async () => {
    renderScreen(<ProfitabilityScreen />);

    const table = await screen.findByRole("table", { name: "Engagement profitability" });
    expect(within(table).getAllByText("floor 35.0%").length).toBeGreaterThan(0);
    expect(screen.getByText(/none below floor/)).toBeInTheDocument();
    expect(screen.queryByText(/delivered below the margin floor/)).not.toBeInTheDocument();
  });

  it("keeps a cancelled engagement out of the realised tab and off the chart", async () => {
    const user = userEvent.setup();
    renderScreen(<ProfitabilityScreen />);

    const table = await screen.findByRole("table", { name: "Engagement profitability" });
    expect(within(table).queryByText(/Conflict to Collaboration — Sutera/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Cancelled/ }));
    expect(
      within(screen.getByRole("table", { name: "Engagement profitability" })).getByText(
        /Conflict to Collaboration — Sutera/,
      ),
    ).toBeInTheDocument();
  });

  it("compares revenue against direct cost with the kit's paired bars", async () => {
    renderScreen(<ProfitabilityScreen />);

    expect(await screen.findByText("Revenue against direct cost")).toBeInTheDocument();
    const chart = screen.getByRole("figure", {
      name: "Revenue against direct cost by programme",
    });
    /* Both series are named in the legend, so the reader is told which column
       is which rather than left to infer it from the height. */
    expect(within(chart).getAllByText("Revenue").length).toBeGreaterThan(0);
    expect(within(chart).getAllByText("Direct cost").length).toBeGreaterThan(0);
  });

  it("renders a withheld margin as withheld, never as zero", async () => {
    renderScreen(<ProfitabilityScreen />, { role: "OPS" });

    expect(await screen.findByText(/engagements are showing no margin/)).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Engagement profitability" });
    expect(within(table).getAllByText("not shown").length).toBeGreaterThan(0);
    /* The failure this guards against: a missing finance block rendered as a
       real zero, which reads as a delivery that made nothing. */
    expect(within(table).queryByText("0.0%")).not.toBeInTheDocument();
  });
});
