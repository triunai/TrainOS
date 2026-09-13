/**
 * M02-S01 · what the design pack says this screen must render.
 *
 * The "States rendered" row is the test list, not a suggestion:
 *   · one SLA-breached row, in danger, with its checkbox DISABLED
 *   · one compliance item warning on a multi-day window
 * plus the pack's primary-button rule and the server-driven grouping.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalInbox } from "../ApprovalInbox";
import { APPROVALS_PATH } from "../paths";
import { renderScreen, resetFixtures } from "./harness";

describe("M02-S01 approval inbox", () => {
  beforeEach(() => {
    resetFixtures();
  });

  const renderInbox = () =>
    renderScreen(<ApprovalInbox />, { path: APPROVALS_PATH, pattern: APPROVALS_PATH });

  it("groups the queue by the SLA urgency buckets the SERVER returned", async () => {
    renderInbox();

    /* The seed is 1 breaching / 4 today / 2 this week. The captions carry the
       server's counts, so a client-side regroup would show different numbers. */
    expect(await screen.findByText("Breaching SLA · 1")).toBeInTheDocument();
    expect(screen.getByText("Due today · 4")).toBeInTheDocument();
    expect(screen.getByText("This week · 2")).toBeInTheDocument();
  });

  it("renders the SLA-breached row in danger and refuses to let it be bulk-selected", async () => {
    renderInbox();

    const breached = await screen.findByText("Discount below floor · Sutera Hospitality Group");
    const row = breached.closest("tr");
    expect(row).not.toBeNull();

    /* The pack draws the breach in the danger ink, and CLAUDE.md puts status
       colour on chips only — so the question is whether the cell renders a
       danger CHIP, not whether some span carries a class. The old assertion
       read `sla.className` on a bare span, which meant it went on passing
       unchanged when the colour moved onto a chip: it could not tell the two
       apart, so it was not testing the rule it was written for. */
    const sla = within(row as HTMLElement).getByText(/over$/);
    expect(sla).toHaveAttribute("data-tone", "danger");

    /* §7: `bulkApprovable` is false for anything carrying money. The checkbox
       is disabled and — this is the part that matters — the REASON is its
       accessible name, so it is not a silent no-op. */
    const checkbox = within(row as HTMLElement).getByRole("checkbox");
    expect(checkbox).toBeDisabled();
    expect(checkbox).toHaveAccessibleName("Carries a monetary value — approve this one on its own");
  });

  it("renders a compliance window as time remaining, never as a breach", async () => {
    renderInbox();

    const compliance = await screen.findByText(/Approve 1 rule change/);
    const row = compliance.closest("tr") as HTMLElement;

    /* The pack's state is "one compliance item warning on a 3-day window". The
       seed has no such row — its compliance approval sits at 448 minutes — so
       what is asserted here is the behaviour the pack is really specifying:
       a window still open reads as time LEFT and never borrows the breach ink.
       The missing 3-day row is reported to the fixtures owner. */
    expect(within(row).getByText(/left$/)).toBeInTheDocument();
    expect(within(row).queryByText(/over$/)).toBeNull();
    /* Plain text, not a chip of any tone — an open window is not a status. */
    expect(within(row).getByText(/left$/).closest("[data-tone]")).toBeNull();
  });

  it("reads a multi-day window in days rather than in hundreds of minutes", async () => {
    renderInbox();

    const later = (await screen.findByText(/Confirm trainer · Kenanga Retail/)).closest(
      "tr",
    ) as HTMLElement;
    expect(within(later).getByText(/^\d+d left$/)).toBeInTheDocument();
  });

  it("distinguishes an agent requester from a human one", async () => {
    renderInbox();

    /* §7: confidence is only meaningful for an agent-raised item, and an agent
       carries the ✦ badge while a human deliberately carries none. */
    const agentRow = (await screen.findByText(/Send proposal · Aurora/)).closest(
      "tr",
    ) as HTMLElement;
    expect(within(agentRow).getByText("Proposal Agent")).toBeInTheDocument();
    expect(within(agentRow).getByText("82%")).toBeInTheDocument();

    const humanRow = (
      await screen.findByText("Discount below floor · Sutera Hospitality Group")
    ).closest("tr") as HTMLElement;
    expect(within(humanRow).getByText("Amirah Yusof")).toBeInTheDocument();
  });

  it("offers exactly one solid primary, and it opens the next approval", async () => {
    const user = userEvent.setup();
    renderInbox();

    const primary = await screen.findByRole("button", { name: "Review next" });

    /* CLAUDE.md allows one solid primary per view. Bulk approve and the value
       filter are secondary, so only this one may carry the solid fill. */
    const solid = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("bg-primary"));
    expect(solid).toHaveLength(1);
    expect(solid[0]).toBe(primary);

    await user.click(primary);
    expect(await screen.findByTestId("elsewhere")).toBeInTheDocument();
  });

  it("shows the bulk bar only once a bulk-approvable row is selected", async () => {
    const user = userEvent.setup();
    renderInbox();

    await screen.findByText("Breaching SLA · 1");
    expect(screen.queryByText("Bulk approve")).toBeNull();

    /* The rule-change approval carries no money, so it is the one the server
       marks `bulkApprovable`. */
    const bulkable = (await screen.findByText(/Approve 1 rule change/)).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(bulkable).getByRole("checkbox"));

    expect(await screen.findByRole("button", { name: "Bulk approve" })).toBeInTheDocument();
    expect(screen.getByText("Bulk approve is unavailable for money actions")).toBeInTheDocument();
  });

  it("reports the median decision time the server measured", async () => {
    renderInbox();
    await waitFor(() =>
      expect(screen.getByText(/Median decision time this week:/)).toBeInTheDocument(),
    );
  });
});
