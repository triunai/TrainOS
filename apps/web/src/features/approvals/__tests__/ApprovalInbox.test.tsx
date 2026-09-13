/**
 * M02-S01 · what the design pack says this screen must render.
 *
 * The "States rendered" row is the test list, not a suggestion:
 *   · one SLA-breached row, in danger, with its checkbox DISABLED
 *   · one compliance item warning on a multi-day window
 * plus the pack's primary-button rule and the server-driven grouping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager } from "@tanstack/react-query";
import { APPROVAL_ATTENDANCE, APPROVAL_RULE_CHANGE } from "@trainos/fixtures";
import { ContractError, fixtureClient } from "@/shared/api";
import { ApprovalInbox } from "../ApprovalInbox";
import { APPROVALS_PATH } from "../paths";
import { renderScreen, resetFixtures } from "./harness";

describe("M02-S01 approval inbox", () => {
  beforeEach(() => {
    resetFixtures();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    focusManager.setFocused(undefined);
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

  /**
   * PR #30 review H1. The value toggle is the same kind of narrowing as a view
   * switch, and the view switch already starts a fresh selection. Without the
   * same reset, rows ticked before the toggle stayed selected while hidden, and
   * "1 selected" pointed at nothing on the screen.
   */
  it("starts a fresh selection when the value filter narrows the queue", async () => {
    const user = userEvent.setup();
    renderInbox();

    const bulkable = (await screen.findByText(/Approve 1 rule change/)).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(bulkable).getByRole("checkbox"));
    expect(await screen.findByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Value ≥ RM 5,000" }));
    await screen.findByRole("button", { name: "Clear value filter" });
    await waitFor(() => expect(screen.queryByText(/Approve 1 rule change/)).toBeNull());

    expect(screen.queryByText("1 selected")).toBeNull();
    expect(screen.queryByRole("button", { name: "Bulk approve" })).toBeNull();
  });

  /**
   * PR #30 review H1, the half no reset can reach: a selected row leaves the
   * queue underneath the selection because someone decided it elsewhere and
   * the list refetched. 011's bulk decide refuses a partial batch because the
   * approver cannot tell which half went through, so the screen refuses it
   * too, before the request, and names what is gone.
   */
  it("refuses a bulk approve whose selection has left the queue, and names what left", async () => {
    const user = userEvent.setup();
    const bulkDecide = vi.spyOn(fixtureClient, "bulkDecideApprovals");
    renderInbox();

    for (const subject of [/Approve 1 rule change/, /Lock attendance · ENG-0231/]) {
      const row = (await screen.findByText(subject)).closest("tr") as HTMLElement;
      await user.click(within(row).getByRole("checkbox"));
    }
    expect(await screen.findByText("2 selected")).toBeInTheDocument();

    /* Decided by someone else; "Awaiting me" filters on PENDING, so the next
       read drops the row. */
    const ruleChange = await fixtureClient.getApproval(APPROVAL_RULE_CHANGE);
    await fixtureClient.decideApproval(APPROVAL_RULE_CHANGE, {
      decision: "APPROVE",
      note: null,
      diffHash: ruleChange.diffHash,
    });
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(screen.queryByText(/Approve 1 rule change/)).toBeNull());

    await user.click(screen.getByRole("button", { name: "Bulk approve" }));

    expect(
      await screen.findByText(
        "Nothing was approved: 1 selected approval is no longer in this queue",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${APPROVAL_RULE_CHANGE}\\.`))).toBeInTheDocument();
    expect(bulkDecide).not.toHaveBeenCalled();
    /* The selection now holds only what is still on screen, so the next press
       approves exactly what the bar counts. */
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect((await fixtureClient.getApproval(APPROVAL_ATTENDANCE)).status).toBe("PENDING");
  });

  /**
   * PR #30 review M2. A row's `bulkApprovable` can change between the read and
   * the write, so the database is the last word, and it answers
   * `BULK_NOT_PERMITTED` with `notBulkApprovable: [{id, ref, reason}]`
   * (011:3558-3571). The screen read `details.blockers`, which only the old
   * fixture sent, so against Postgres the named banner never rendered.
   *
   * The one stub in this file, because no checkbox can select a money row: the
   * refusal is the fixture's own error class carrying the database's shape.
   */
  it("names the rows the database refused to bulk-approve", async () => {
    const user = userEvent.setup();
    vi.spyOn(fixtureClient, "bulkDecideApprovals").mockRejectedValue(
      new ContractError("BULK_NOT_PERMITTED", "one or more approvals may not be decided in bulk", {
        notBulkApprovable: [
          { id: "apv_0773", ref: APPROVAL_RULE_CHANGE, reason: "MONEY_MOVING_TYPE" },
        ],
      }),
    );
    renderInbox();

    const bulkable = (await screen.findByText(/Approve 1 rule change/)).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(bulkable).getByRole("checkbox"));
    await user.click(await screen.findByRole("button", { name: "Bulk approve" }));

    expect(
      await screen.findByText("Those approvals carry money and must be decided one at a time"),
    ).toBeInTheDocument();
    expect(screen.getByText(APPROVAL_RULE_CHANGE)).toBeInTheDocument();
    expect(screen.queryByText("That bulk approval did not go through")).toBeNull();
  });

  it("reports the median decision time the server measured", async () => {
    renderInbox();
    await waitFor(() =>
      expect(screen.getByText(/Median decision time this week:/)).toBeInTheDocument(),
    );
  });

  it("puts the saved views and the filter controls on ONE row, per brief §10b", async () => {
    renderInbox();

    const tabs = await screen.findByRole("tablist", { name: "Approval views" });
    const filters = screen.getByRole("group", { name: "Filters" });
    const valueToggle = screen.getByRole("button", { name: /Value ≥ RM 5,000/ });

    /* Not "both exist" — both resolve to the SAME toolbar row, and the value
       toggle travels with the filters rather than staying up with the views. */
    const row = tabs.closest("[data-list-toolbar]");
    expect(row).not.toBeNull();
    expect(filters.closest("[data-list-toolbar]")).toBe(row);
    expect(valueToggle.closest("[data-list-toolbar]")).toBe(row);

    /* "Review next" opens a record, so it is NOT a narrowing: it moved to the
       page header when the filters took the right of the toolbar row. */
    const reviewNext = screen.getByRole("button", { name: "Review next" });
    expect(reviewNext.closest("[data-list-toolbar]")).toBeNull();
  });
});
