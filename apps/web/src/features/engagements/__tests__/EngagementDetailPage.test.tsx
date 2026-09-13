import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ENGAGEMENT_AURORA } from "@trainos/contract";
import { currentPrimaries } from "@/shared/components/kit";
import { EngagementDetailPage, ENGAGEMENT_DETAIL_PATTERN } from "@/features/engagements";
import { renderAt, resetFixtures } from "./harness";

/**
 * M09-S02. The assertions track the design pack's "states rendered" row: the
 * claim blocked with two missing documents, the partial-attendance
 * participants, and the deadline warning banner.
 */
describe("EngagementDetailPage · M09-S02", () => {
  beforeEach(resetFixtures);

  const open = (role?: "SALES" | "OPS") =>
    render(
      renderAt(
        `/training/engagements/${ENGAGEMENT_AURORA}`,
        ENGAGEMENT_DETAIL_PATTERN,
        <EngagementDetailPage />,
        role,
      ),
    );

  it("renders the record identity once, with the server's blocked lifecycle step", async () => {
    open();

    const headings = await screen.findAllByRole("heading", { name: "Leading Through Change" });
    expect(headings).toHaveLength(1);
    expect(screen.getAllByText(new RegExp(ENGAGEMENT_AURORA)).length).toBeGreaterThan(0);

    /* The path is DECLARED here and rendered by the top bar; a trail inside
       the content card would duplicate what the breadcrumb owns.
       It ends at the LIST. This used to assert "… › ENG-0231", which pinned the
       duplication the test's own name forbids: RecordHeader carries recordRef,
       so the ref in the trail was the record identifying itself a second time.
       CLAUDE.md: RecordHeader owns the identity, the breadcrumb owns the path. */
    expect(await screen.findByTestId("breadcrumb-trail")).toHaveTextContent(
      "Home › Training › Engagements",
    );
    expect(screen.getByTestId("breadcrumb-trail")).not.toHaveTextContent(ENGAGEMENT_AURORA);
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).not.toBeInTheDocument();

    /* BLOCKED comes from the server's LifecycleStep[], never from a count. */
    expect(screen.getByText("Claim blocked")).toBeInTheDocument();
    expect((await screen.findAllByText(/2 documents missing/)).length).toBeGreaterThan(0);
  });

  it("renders every compliance check with its computed working and its citation", async () => {
    open();

    expect(await screen.findByText("Rule checks")).toBeInTheDocument();
    expect(screen.getByText("4 pass · 1 warn · 1 fail")).toBeInTheDocument();
    expect(screen.getByText("Required documents complete")).toBeInTheDocument();
    expect(screen.getByText("3 of 5 documents present")).toBeInTheDocument();
    expect(screen.getByText("Meal cost ceiling")).toBeInTheDocument();
    expect(
      screen.getByText("grant approved 09 Oct → earliest start 23 Oct → training 12 Nov"),
    ).toBeInTheDocument();
  });

  it("lists the delivery sessions and the participants who are not complete", async () => {
    open();

    const sessions = await screen.findByRole("table", { name: "Delivery sessions" });
    expect(within(sessions).getByText("Day 1 · Escalation & conflict")).toBeInTheDocument();
    expect(within(sessions).getByText("29 / 30")).toBeInTheDocument();

    const roster = await screen.findByRole("table", { name: "Registered participants" });
    expect(within(roster).getByText("Nur Aisyah")).toBeInTheDocument();
    /* Aisyah misses both days; PAR-1195 misses only day 2 — one absent, one partial. */
    expect(within(roster).getAllByText("Partial").length).toBeGreaterThan(0);
    expect(within(roster).getAllByText("Absent").length).toBeGreaterThan(0);
  });

  it("shows the finance panel to a principal who may see pricing", async () => {
    open("SALES");
    expect(await screen.findByText("Trainer payable")).toBeInTheDocument();
    expect(screen.getByText("Margin realised")).toBeInTheDocument();
  });

  it("withholds the finance panel from OPS, who has no quotation:read", async () => {
    open("OPS");
    expect(await screen.findByText("Checklist")).toBeInTheDocument();
    /* The OPS projection DROPS the block rather than zeroing it. */
    expect(screen.queryByText("Trainer payable")).not.toBeInTheDocument();
    expect(screen.queryByText("Margin realised")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Finance/ })).not.toBeInTheDocument();
  });

  it("has exactly one solid primary, and close out renders the server's blockers", async () => {
    const user = userEvent.setup();
    open();

    const closeOut = await screen.findByRole("button", { name: "Close out" });
    expect(currentPrimaries()).toEqual(["Close out"]);

    await user.click(closeOut);

    const refusal = await screen.findByText(/cannot be closed out yet/);
    expect(refusal).toBeInTheDocument();
    expect(screen.getByText(/Evaluation summary missing/i)).toBeInTheDocument();
    expect(screen.getByText(/Certificates issued missing/i)).toBeInTheDocument();
  });
});
