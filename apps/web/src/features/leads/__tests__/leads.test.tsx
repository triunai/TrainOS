import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeadsQueuePage } from "../LeadsQueuePage";
import { renderScreen } from "@/test/renderScreen";

/**
 * Sales › Leads, asserted against the fixture client rather than against props
 * a test invented. The load, error and empty branches are the states the
 * design-pack inventory requires of every collection screen.
 */

describe("Sales › Leads", () => {
  it("names every stage from pipeline configuration, empty stages included", async () => {
    renderScreen(<LeadsQueuePage />, { path: "/sales/leads", route: "/sales/leads" });

    const tabs = await screen.findByRole("tablist", { name: "Pipeline stages" });

    /* The labels are the config's, not the enum's: "Proposal sent", not
       PROPOSAL_SENT. `New` and `TNA sent` hold nothing and are still drawn —
       the stage with no deals in it is the one worth seeing. */
    for (const label of [
      "New",
      "Qualifying",
      "TNA sent",
      "Proposal sent",
      "Negotiation",
      "Won",
      "Lost",
    ]) {
      expect(within(tabs).getByRole("tab", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it("resolves the organisation behind each lead's reference", async () => {
    renderScreen(<LeadsQueuePage />, { path: "/sales/leads", route: "/sales/leads" });

    const queue = await screen.findByRole("region", { name: "Lead queue" });

    /* `ORG-0121` is a machine value; the queue shows the client. */
    expect(await within(queue).findByText("Kenanga Retail Group Berhad")).toBeInTheDocument();
    expect(within(queue).getByText("Perdana Utilities Berhad")).toBeInTheDocument();
    expect(within(queue).getByText("OPP-0498")).toBeInTheDocument();
  });

  it("calls out the one lead whose close date has passed", async () => {
    renderScreen(<LeadsQueuePage />, { path: "/sales/leads", route: "/sales/leads" });

    const queue = await screen.findByRole("region", { name: "Lead queue" });
    /* Sutera closed LOST on 30 Jun 2026 and its date is behind every clock this
       code will ever run on, so the exception chip is deterministic. */
    expect(await within(queue).findAllByText("Close date passed")).not.toHaveLength(0);
  });

  it("filters the queue to one stage and says how many are shown", async () => {
    renderScreen(<LeadsQueuePage />, { path: "/sales/leads", route: "/sales/leads" });

    await screen.findByRole("tablist", { name: "Pipeline stages" });
    await userEvent.click(screen.getByRole("tab", { name: /^New/ }));

    /* Nothing is at NEW in the seed, so this is the real empty state and not a
       spinner that never resolves. */
    expect(await screen.findByText("No leads at this stage")).toBeInTheDocument();
    expect(screen.getByText(/0 of 5 shown/)).toBeInTheDocument();
  });

  it("renders the deal, the client and the people as typography, not badges", async () => {
    renderScreen(<LeadsQueuePage />, { path: "/sales/leads", route: "/sales/leads" });

    const preview = await screen.findByRole("region", { name: "Lead preview" });

    expect(await within(preview).findByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(within(preview).getByText("The deal")).toBeInTheDocument();
    expect(within(preview).getByText("The client")).toBeInTheDocument();
    expect(within(preview).getByText("Who to talk to")).toBeInTheDocument();

    /* One solid primary on the view, and it is a navigation — no governed
       action is reachable from a queue. */
    expect(within(preview).getByRole("button", { name: "Open organisation" })).toBeEnabled();
  });
});
