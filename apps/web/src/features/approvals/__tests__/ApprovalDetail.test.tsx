/**
 * M02-S02 · the approval detail.
 *
 * The proof screen's structure IS the specification: why you are here →
 * recommendation → evidence and risk → what changes if you approve. These
 * tests assert that narrative in order, and that each of the three decisions
 * reaches `decideApproval` and renders what came back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { APPROVAL_AURORA } from "@trainos/contract";
import { fixtureClient } from "@/shared/api";
import { ApprovalDetail } from "../ApprovalDetail";
import { APPROVAL_DETAIL_PATTERN, APPROVALS_PATH, approvalPath } from "../paths";
import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BreadcrumbProvider, useBreadcrumbTrail } from "@/shared/components/layout";
import { renderScreen, resetFixtures, testQueryClient } from "./harness";

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

    /* The back link and the position sit ABOVE the card now, on the page
       surface — a back link is a statement about where the page sits, not the
       queue's heading. The rail below starts with its first item and carries no
       header block. */
    const back = await screen.findByRole("button", { name: "← Approval inbox" });
    expect(back.closest("aside")).toBeNull();
    expect(screen.getByText(/of 7$/)).toBeInTheDocument();

    /* Seven pending approvals, and the rail reads the same grouped list the
       inbox does. */
    const aside = screen.getByText(/Discount below floor/).closest("aside") as HTMLElement;
    expect(aside).not.toBeNull();
    expect(within(aside).queryByText(/of 7$/)).toBeNull();
  });

  /* Tightening brief §15a, prototyped on this screen first. */
  it("puts the whole header on one blue card, with one chevron", async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Why this needs you");

    const header = document.querySelector("header") as HTMLElement;
    expect(header.className).toContain("bg-[image:var(--surface-accent-gradient)]");
    expect(header.className).toContain("rounded-panel");

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

  it("declares a trail that is the path, and stops at the list", async () => {
    /* The harness renders the screen without the shell, so the trail is read
       where it is DECLARED rather than where the topbar paints it. */
    function TrailProbe() {
      const trail = useBreadcrumbTrail();
      return (
        <div data-testid="trail">{trail.map((c) => `${c.label}|${c.href ?? ""}`).join(" › ")}</div>
      );
    }

    render(
      <QueryClientProvider client={testQueryClient()}>
        <MemoryRouter initialEntries={[approvalPath(APPROVAL_AURORA)]}>
          <BreadcrumbProvider>
            <TrailProbe />
            <Routes>
              <Route path={APPROVAL_DETAIL_PATTERN} element={<ApprovalDetail />} />
            </Routes>
          </BreadcrumbProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("Why this needs you");

    /* Home › Approvals, and nothing after it. The record's ref is NOT a crumb:
       RecordHeader owns identity and the ref is already in the card's mono
       line, so a third copy in the topbar is the duplication the rule exists to
       stop. Both crumbs carry an href, so both navigate. */
    expect(screen.getByTestId("trail")).toHaveTextContent(`Home|/ › Approvals|${APPROVALS_PATH}`);
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

/**
 * What the screen sends against a real database, where the route's REF is not
 * the id `core.decide_approval(p_approval_id uuid, …)` takes, and where an
 * approval payload may not carry the `diffHash` an APPROVE must echo back.
 */
describe("M02-S02 approval detail · deciding against the database", () => {
  beforeEach(() => {
    resetFixtures();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decides by the approval's id from the loaded detail, not the route ref", async () => {
    const user = userEvent.setup();
    const { id } = await fixtureClient.getApproval(APPROVAL_AURORA);
    expect(id).not.toBe(APPROVAL_AURORA);
    const decide = vi.spyOn(fixtureClient, "decideApproval");
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide.mock.calls[0]?.[0]).toBe(id);
  });

  it("withholds Approve and says why when the payload carries no diffHash", async () => {
    const user = userEvent.setup();
    const original = fixtureClient.getApproval.bind(fixtureClient);
    vi.spyOn(fixtureClient, "getApproval").mockImplementation(async (id: string) => {
      const detail = await original(id);
      return { ...detail, diffHash: undefined as unknown as string };
    });
    const decide = vi.spyOn(fixtureClient, "decideApproval");
    renderDetail();

    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    expect(screen.getByText("Approving is not available here yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();

    await user.keyboard("a");
    await user.click(approve);
    expect(decide).not.toHaveBeenCalled();
  });
});
