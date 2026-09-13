/**
 * M02-S02 · the approval detail.
 *
 * The proof screen's structure IS the specification: why you are here →
 * recommendation → evidence and risk → what changes if you approve. These
 * tests assert that narrative in order, and that each of the three decisions
 * reaches `decideApproval` and renders what came back.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { APPROVAL_AURORA } from "@trainos/contract";
import { fixtureClient } from "@trainos/fixtures";
import { ApprovalDetail } from "../ApprovalDetail";
import { APPROVAL_DETAIL_PATTERN, approvalPath } from "../paths";
import { renderScreen, resetFixtures } from "./harness";

const renderDetail = (ref: string = APPROVAL_AURORA) =>
  renderScreen(<ApprovalDetail />, {
    path: approvalPath(ref),
    pattern: APPROVAL_DETAIL_PATTERN,
  });

describe("M02-S02 approval detail", () => {
  beforeEach(() => {
    resetFixtures();
  });

  it("answers the four questions in the pack's order", async () => {
    renderDetail();

    expect(await screen.findByText("Why this needs you")).toBeInTheDocument();

    /* The reason names the threshold and the policy that fired, so the
       approver is not left to infer why the gate caught this one. */
    expect(screen.getByText(/above the RM 15,000 threshold in policy APV-01/)).toBeInTheDocument();

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");

    const order = (needle: string) => headings.findIndex((text) => text.startsWith(needle));

    expect(order("Why this needs you")).toBeLessThan(order("Recommendation"));
    expect(order("Recommendation")).toBeLessThan(order("Evidence"));
    expect(order("Evidence")).toBeLessThan(order("Risk"));
  });

  it("carries the recommendation with its AI provenance and the jury verdict", async () => {
    renderDetail();

    expect(await screen.findByText("Send as drafted")).toBeInTheDocument();

    /* The ✦ chip carries the agent and its confidence — provenance travels
       with the recommendation rather than being asserted beside it. */
    expect(screen.getAllByText(/Proposal Agent/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/82%/).length).toBeGreaterThan(0);

    /* DECISIONS §2: a jury is an object, never a boolean, and the dissent is
       surfaced rather than buried. */
    expect(screen.getByText("Jury 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("GPT-5.6 Terra")).toBeInTheDocument();
    expect(screen.getByText(/Prefers waiting for Daniel Wong/)).toBeInTheDocument();
  });

  it("numbers the evidence and names the deviations and the risk", async () => {
    renderDetail();

    expect(await screen.findByText("Evidence · 5")).toBeInTheDocument();
    expect(screen.getByText(/Competency gaps confirmed by Nurul Hassan/)).toBeInTheDocument();
    expect(screen.getByText(/Margin 41%, above 35% floor/)).toBeInTheDocument();

    expect(screen.getByText("Differs from normal")).toBeInTheDocument();
    expect(screen.getByText("Client requested November specifically.")).toBeInTheDocument();

    expect(screen.getByText(/Single trainer dependency/)).toBeInTheDocument();
  });

  it("lists what changes BEFORE the approver clicks", async () => {
    renderDetail();

    /* The consequence block is the one bordered element on the screen because
       it answers the approver's real question. Five changes, named. */
    expect(await screen.findByText("If you approve, this happens · 5 changes")).toBeInTheDocument();
    expect(screen.getByText(/status DRAFT → SENT/)).toBeInTheDocument();
    expect(screen.getByText(/Draft lock released/)).toBeInTheDocument();
  });

  it("approves through decideApproval and renders the effects that came back", async () => {
    const user = userEvent.setup();
    renderDetail();

    const approve = await screen.findByRole("button", { name: "Approve" });

    /* One solid primary. Reject is a danger button and Request changes is
       secondary, so neither may carry the fill. On the blue record card the
       fill is WHITE rather than blue — solid still means "a human triggered
       this", the surface underneath just changed — so the assertion looks for
       either treatment and still insists there is exactly one. */
    const solid = screen
      .getAllByRole("button")
      .filter(
        (button) =>
          button.className.includes("bg-primary") ||
          button.className.includes("bg-[rgb(var(--on-accent))]"),
      );
    expect(solid).toHaveLength(1);

    await user.click(approve);

    /* §7 requires `effects[]` to match the `diff[]` the screen rendered, so the
       response variant is shown as its own block rather than a bare toast. */
    expect(await screen.findByText("What happened · 5")).toBeInTheDocument();
    expect(screen.getByText(/Approved by/)).toBeInTheDocument();

    /* The write reached the store, not just the screen. */
    const after = await fixtureClient.getApproval(APPROVAL_AURORA);
    expect(after.status).toBe("APPROVED");
  });

  it("refuses to reject without a note, then sends the note it collected", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Reject" }));

    /* §7: `note` is required for REJECT and REQUEST_CHANGES. The screen asks
       for it rather than letting the server 422 the user. */
    const note = await screen.findByLabelText(/Reject — say why/);
    expect(screen.getByText("A note is required.")).toBeInTheDocument();

    await user.type(note, "Margin is below what we agreed for a first engagement.");
    await user.click(screen.getByRole("button", { name: /Submit reject/i }));

    await waitFor(async () => {
      const after = await fixtureClient.getApproval(APPROVAL_AURORA);
      expect(after.status).toBe("REJECTED");
    });
  });

  it("keeps the queue rail in step with the inbox", async () => {
    renderDetail();

    const rail = await screen.findByText("← Approval inbox");
    const aside = rail.closest("aside") as HTMLElement;

    /* Seven pending approvals, and this one is positioned within them — the
       rail reads the same grouped list the inbox does. */
    expect(within(aside).getByText(/of 7$/)).toBeInTheDocument();
    expect(within(aside).getByText(/Discount below floor/)).toBeInTheDocument();
  });

  /* Tightening brief §15a, prototyped on this screen first. */
  it("puts the whole header on one blue card, with one chevron", async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Why this needs you");

    const header = document.querySelector("header") as HTMLElement;
    expect(header.className).toContain("bg-[image:var(--surface-accent-gradient)]");
    expect(header.className).toContain("rounded-[var(--radius-panel)]");

    /* Title, chip, meta line and the metric strip are all ON the card. */
    expect(header.contains(screen.getByRole("heading", { level: 1 }))).toBe(true);
    expect(header.contains(screen.getByText(/APV-2026-0771 · PRO-2026-0184/))).toBe(true);
    /* By its template, not by `.grid` — `Collapse` is a grid too, and it wraps
       this one. */
    const summary = header.querySelector('[style*="grid-template-columns"]') as HTMLElement;
    expect(summary.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    expect(within(summary).getByText("Value")).toBeInTheDocument();
    expect(within(summary).getByText("Risk")).toBeInTheDocument();

    /* Exactly one chevron on the screen, and it belongs to the card. */
    const chevrons = screen
      .getAllByRole("button")
      .filter((button) => /^(Show|Hide) /.test(button.textContent ?? ""));
    expect(chevrons).toHaveLength(1);
    expect(header.contains(chevrons[0])).toBe(true);

    /* On the card the three actions escalate by weight, not hue: no status
       colour survives onto the blue. */
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(reject.className).not.toContain("text-danger");
    expect(reject.className).toContain("text-[rgb(var(--on-accent))]");

    /* The case is NOT in the card — it stays in the decision column. */
    expect(header.contains(screen.getByText("Why this needs you"))).toBe(false);

    /* Collapsing keeps the title row and the meta line and drops the strip. */
    await user.click(chevrons[0]);
    expect(header.querySelector("[data-open]")?.getAttribute("data-open")).toBe("false");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Send proposal · Aurora Manufacturing Sdn Bhd",
    );
    expect(screen.getByText(/APV-2026-0771 · PRO-2026-0184/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("explains a missing approval instead of rendering an empty record", async () => {
    renderDetail("APV-does-not-exist");

    expect(await screen.findByText("That approval could not be opened")).toBeInTheDocument();

    /* A NOT_FOUND is the server answering. CLAUDE.md R2: a refusal is never
       retried, so no retry button may appear on one. */
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to the inbox" })).toBeInTheDocument();
  });
});
