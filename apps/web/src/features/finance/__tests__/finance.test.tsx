import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionsQueueScreen } from "../CollectionsQueueScreen";
import { currentPrimaries } from "@/shared/components/kit";
import { InvoiceDetailScreen } from "../InvoiceDetailScreen";
import { DEFAULT_INVOICE_REF } from "../paths";
import { renderScreen } from "@/test/renderScreen";

/**
 * The states the design-pack inventory says each screen must render, asserted
 * against the fixture client rather than against props a test invented.
 */

describe("M13-S02 · invoice detail", () => {
  it("adds the lines up in front of the reader and puts SST on the net", async () => {
    renderScreen(<InvoiceDetailScreen invoiceRef={DEFAULT_INVOICE_REF} />, { role: "FINANCE" });

    /* §15a: the h1 names the record, the mono identity line carries the ref.
       This used to assert the reference AS the heading, which is the shape the
       ruling withdrew. */
    expect(await screen.findByRole("heading", { name: "Invoice" })).toBeInTheDocument();
    /* `recordRef` is the first item of the joined mono meta line, not its own node. */
    expect(screen.getByText(new RegExp(`^${DEFAULT_INVOICE_REF} · `))).toBeInTheDocument();

    /* The subtotal is the sum of the lines, said out loud. */
    expect(screen.getByText("Subtotal · sum of 1 line")).toBeInTheDocument();
    expect(screen.getByText(/SST on net/)).toBeInTheDocument();
    expect(
      screen.getByText(/The total is the sum of the lines plus SST on the net/),
    ).toBeInTheDocument();

    /* The per-pax figure is a caption, never a line: RM 616.67 × 30 is not RM 18,500. */
    expect(screen.getByText(/does not multiply back to the package price/)).toBeInTheDocument();
  });

  it("keeps the failed sync attempt beside the validated state", async () => {
    renderScreen(<InvoiceDetailScreen invoiceRef={DEFAULT_INVOICE_REF} />, { role: "FINANCE" });

    await screen.findByText("Accounting sync log");

    /* The failure is retained, with what the provider said and what fixed it. */
    expect(screen.getByText(/CUSTOMER_NOT_MAPPED/)).toBeInTheDocument();
    expect(screen.getByText(/did not match a customer/)).toBeInTheDocument();
    expect(screen.getByText(/Resolved by Mapped ORG-0114/)).toBeInTheDocument();

    /* And the state it ended in. */
    expect(screen.getByText("MyInvois validation returned UIN")).toBeInTheDocument();
    expect(screen.getAllByText("MyInvois validated").length).toBeGreaterThan(0);
  });

  it("shows the UIN exactly as MyInvois masked it", async () => {
    renderScreen(<InvoiceDetailScreen invoiceRef={DEFAULT_INVOICE_REF} />, { role: "FINANCE" });

    const uins = await screen.findAllByText("MY-2026-XXXXXXXX-0311");
    expect(uins.length).toBeGreaterThan(0);
    expect(screen.getByText(/issued and masked by MyInvois/)).toBeInTheDocument();
  });

  it("has no payments yet, and one primary that records one", async () => {
    renderScreen(<InvoiceDetailScreen invoiceRef={DEFAULT_INVOICE_REF} />, { role: "FINANCE" });

    expect(await screen.findByText("No payments recorded")).toBeInTheDocument();

    const primary = screen.getByRole("button", { name: "Record payment" });
    expect(primary).toBeEnabled();
    expect(screen.getByRole("button", { name: "Re-push to accounting" })).toBeInTheDocument();

    await userEvent.click(primary);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(/recording a payment against one is not/)).toBeInTheDocument();
  });
});

describe("M13-S05 · collections queue", () => {
  it("renders the ageing buckets from the receivables ledger", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    expect(await screen.findByRole("heading", { name: "Collections" })).toBeInTheDocument();
    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(screen.getByText("31–60 days")).toBeInTheDocument();
    expect(screen.getByText("DSO")).toBeInTheDocument();
  });

  it("shows the 48-day item as escalated past the agent's autonomy", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    await screen.findByRole("heading", { name: "Collections" });
    await userEvent.click(screen.getByRole("tab", { name: /Escalated/ }));

    expect(await screen.findByText("INV-2026-0279")).toBeInTheDocument();
    await userEvent.click(screen.getByText("INV-2026-0279"));

    expect(await screen.findByText("The agent has stopped here")).toBeInTheDocument();
    expect(screen.getByText(/Reminder 3 is always human/)).toBeInTheDocument();
  });

  it("shows the 78-day item as a trading hold the MD owns", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    await screen.findByRole("heading", { name: "Collections" });
    await userEvent.click(screen.getByRole("tab", { name: /Escalated/ }));
    await userEvent.click(await screen.findByText("INV-2026-0244"));

    expect(await screen.findByText("The ladder proposes a trading hold")).toBeInTheDocument();
    expect(screen.getByText(/past the day-75 rung/)).toBeInTheDocument();
    expect(screen.getByText(/needs the MD, not Finance/)).toBeInTheDocument();
  });

  it("renders the escalation ladder from the collection rules, not from code", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    await screen.findByText("Escalation ladder");
    expect(await screen.findByText("7 days overdue")).toBeInTheDocument();
    expect(screen.getByText("75 days overdue")).toBeInTheDocument();
    expect(screen.getByText(/requires MD approval/)).toBeInTheDocument();
  });

  it("shows the drafted reminder with its cost and consent", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    /* The 34-day row is the one with a draft ready, and it is selected by default. */
    expect(await screen.findByText(/Dear Puan Nurul/)).toBeInTheDocument();
    expect(screen.getByLabelText("Message cost")).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Message cost")).getByText(/tpl_collections_reminder2_v2/),
    ).toBeInTheDocument();
    expect(screen.getByText(/consent on record/)).toBeInTheDocument();
  });

  it("queues the send for approval rather than sending it", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    const primary = await screen.findByRole("button", { name: "Approve & send" });
    await waitFor(() => expect(primary).toBeEnabled());

    await userEvent.click(primary);

    /* Policy FIN-03 has no conditions: nothing leaves without a human. */
    await waitFor(() => {
      expect(screen.getByText(/Collections reminder · INV-2026-0288/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Policy FIN-03 routes every reminder to a human/)).toBeInTheDocument();
  });

  /* ---- §10b conformance --------------------------------------------- *
   *
   * This screen is the composition §10b names as the reference for every other
   * list screen, and it was the one screen not following it: a hand-rolled
   * `h1`, the tab group alone on its own row, no filters and no count. Judging
   * other screens against it propagated the defect, so these assertions pin the
   * shape rather than leaving it to the next eyeball.
   */

  it("puts the identity in the kit's RecordHeader, not a hand-rolled heading", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    const heading = await screen.findByRole("heading", { name: "Collections" });
    /* RecordHeader draws the title inside the header element it owns. A bare
       `h1` in the page body is exactly what this replaced. */
    expect(heading.closest("header")).not.toBeNull();
  });

  it("carries exactly one solid primary", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    await screen.findByRole("heading", { name: "Collections" });
    expect(currentPrimaries()).toEqual(["Approve & send"]);
  });

  it("puts the tabs and the narrowing on ONE row, with the count on it", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    await screen.findByRole("heading", { name: "Collections" });

    const toolbar = document.querySelector("[data-list-toolbar]");
    expect(toolbar).not.toBeNull();
    /* Both halves inside the one toolbar: the switcher that says WHICH SUBSET
       and the filters that say which slice of it. */
    expect(within(toolbar as HTMLElement).getByRole("tablist")).toBeInTheDocument();
    expect(within(toolbar as HTMLElement).getByLabelText("Filters")).toBeInTheDocument();
    expect(within(toolbar as HTMLElement).getByText(/of \d+ shown/)).toBeInTheDocument();
  });

  it("names the breadcrumb after the PATH, not after the default tab", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    await screen.findByRole("heading", { name: "Collections" });
    expect(screen.getByTestId("breadcrumb-trail")).toHaveAttribute(
      "data-trail",
      "Finance › Collections",
    );
  });

  it("says the SEARCH is empty rather than claiming the bucket is clear", async () => {
    renderScreen(<CollectionsQueueScreen />, { role: "FINANCE" });

    await screen.findByRole("heading", { name: "Collections" });
    await userEvent.type(screen.getByLabelText("Search receivables"), "no such client");

    expect(await screen.findByText("No receivable matches this search")).toBeInTheDocument();
  });
});
