import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CrossSellPage } from "../CrossSellPage";
import { MarketingPage } from "../MarketingPage";
import { RenewalsPage } from "../RenewalsPage";
import { renderScreen } from "@/test/renderScreen";

/**
 * The three Relationships screens. Each is a list + toolbar + table over data
 * the contract already publishes; every assertion reads the fixture client.
 */

describe("Relationships › Renewals", () => {
  it("splits the book on delivery, not on a word in the file", async () => {
    renderScreen(<RenewalsPage />, {
      path: "/relationships/renewals",
      route: "/relationships/renewals",
    });

    const tabs = await screen.findByRole("tablist", { name: "Renewal views" });
    expect(within(tabs).getByRole("tab", { name: /^Due for renewal/ })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: /^Still in flight/ })).toBeInTheDocument();
  });

  it("draws the server's lifecycle rather than computing one", async () => {
    renderScreen(<RenewalsPage />, {
      path: "/relationships/renewals",
      route: "/relationships/renewals",
      role: "OPS",
    });

    await userEvent.click(await screen.findByRole("tab", { name: /^All/ }));

    /* The stepper's accessible name is `describeSteps`, built from the steps
       the server sent. A screen that invented a chain could not produce it. */
    const table = await screen.findByRole("table");
    const steppers = within(table).getAllByRole("img");
    expect(steppers.length).toBeGreaterThan(0);
    expect(steppers[0]?.getAttribute("aria-label")).toMatch(/: (done|current|pending|blocked)/);
  });

  it("tints only the rows an agent has something to say about, and labels them", async () => {
    renderScreen(<RenewalsPage />, {
      path: "/relationships/renewals",
      route: "/relationships/renewals",
    });

    await userEvent.click(await screen.findByRole("tab", { name: /^All/ }));
    const table = await screen.findByRole("table");

    /* Wait for the per-organisation fan-out to land before counting: a count
       taken mid-flight would pass or fail on timing rather than on the rule.
       Scoped to the table, because the header carries a "Cross-sell" link and
       a document-wide count would include it. */
    await within(table).findAllByText("Cross-sell");

    const rows = within(table).getAllByRole("row").slice(1);
    const marked = table.querySelectorAll("tbody tr[data-suggested]");
    const labelled = within(table).getAllByText("Cross-sell");
    const plain = within(table).getAllByText("Nothing suggested");

    /* Aurora is the one organisation carrying a cross-sell suggestion, so the
       tint is an exception across the table and not its background. */
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(rows.length);

    /* Colour is not a label: every marked row carries the words, every other
       row says so in typography, and the two account for the whole table. */
    expect(labelled).toHaveLength(marked.length);
    expect(labelled.length + plain.length).toBe(rows.length);
  });
});

describe("Relationships › Cross-sell", () => {
  it("lists the whole book and says which organisations the agent spoke about", async () => {
    renderScreen(<CrossSellPage />, {
      path: "/relationships/cross-sell",
      route: "/relationships/cross-sell",
    });

    expect(await screen.findByText(/6 organisations/)).toBeInTheDocument();
    expect(screen.getByText(/1 suggestions on record/)).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Aurora Manufacturing Sdn Bhd")).toBeInTheDocument();
    expect(within(table).getAllByText("Nothing suggested")).toHaveLength(5);
  });

  it("renders the agent's own sentence and its citations, not a composed one", async () => {
    renderScreen(<CrossSellPage />, {
      path: "/relationships/cross-sell",
      route: "/relationships/cross-sell",
    });

    /* Verbatim from the fixture's `rationale`. */
    expect(await screen.findByText(/RM 61,000 unused levy expiring 31 Dec/)).toBeInTheDocument();
    /* Twice on purpose: the table cell names it and the panel explains it. */
    expect(screen.getAllByText("Conflict to Collaboration")).toHaveLength(2);

    /* The two sources behind it are reachable as citations. */
    expect(screen.getByLabelText(/^Source 1:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Source 2:/)).toBeInTheDocument();
  });

  it("says plainly when an agent had nothing to say, rather than showing a gap", async () => {
    renderScreen(<CrossSellPage />, {
      path: "/relationships/cross-sell",
      route: "/relationships/cross-sell",
    });

    const table = await screen.findByRole("table");
    await userEvent.click(within(table).getByText("Sutera Hospitality Group"));

    expect(
      await screen.findByText("The agent has nothing to say about this client"),
    ).toBeInTheDocument();
  });

  it("offers the suggestion's own actions and queues no approval", async () => {
    renderScreen(<CrossSellPage />, {
      path: "/relationships/cross-sell",
      route: "/relationships/cross-sell",
    });

    expect(await screen.findByRole("button", { name: "Create opportunity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});

describe("Relationships › Marketing", () => {
  it("lists only the templates that actually send something", async () => {
    renderScreen(<MarketingPage />, {
      path: "/relationships/marketing",
      route: "/relationships/marketing",
    });

    const table = await screen.findByRole("table");

    expect(within(table).getByText("Programme announcement")).toBeInTheDocument();
    /* A proposal template has no audience; putting it here would sit a reach of
       zero beside rows that mean it. */
    expect(within(table).queryByText("Standard proposal")).not.toBeInTheDocument();
    expect(within(table).queryByText("Tax invoice")).not.toBeInTheDocument();
  });

  it("counts reach from consent, per channel", async () => {
    renderScreen(<MarketingPage />, {
      path: "/relationships/marketing",
      route: "/relationships/marketing",
    });

    /* Five of the six contacts hold email consent; three hold WhatsApp. Ravi
       carries a PDPA flag and is excluded from both. */
    expect(await screen.findByText(/5 reachable by email/)).toBeInTheDocument();
    expect(screen.getByText(/3 by WhatsApp/)).toBeInTheDocument();
  });

  it("multiplies the rate by the reach and says the number is an estimate", async () => {
    renderScreen(<MarketingPage />, {
      path: "/relationships/marketing",
      route: "/relationships/marketing",
    });

    await screen.findByRole("table");
    expect(screen.getByText(/It is an estimate made here, not a quotation/)).toBeInTheDocument();
  });

  it("names the people the reach numbers exclude", async () => {
    renderScreen(<MarketingPage />, {
      path: "/relationships/marketing",
      route: "/relationships/marketing",
    });

    expect(await screen.findByText("Who this excludes")).toBeInTheDocument();
    expect(screen.getByText("Ravi Subramaniam")).toBeInTheDocument();
    expect(screen.getByText("PDPA · No consent")).toBeInTheDocument();
  });
});
