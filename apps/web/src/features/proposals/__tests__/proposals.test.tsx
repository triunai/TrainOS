import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { APPROVAL_AURORA, PROPOSAL_AURORA, QUOTATION_AURORA } from "@trainos/contract";
import { ProposalBuilderPage } from "../ProposalBuilderPage";
import { CostingWorksheetPage } from "../CostingWorksheetPage";
import { needsReview, originLabel } from "../sections";
import { currentPrimaries } from "@/shared/components/kit";
import { renderScreen } from "./render-harness";

const BUILDER_ROUTE = "/sales/proposals/:proposalRef";
const builderPath = `/sales/proposals/${PROPOSAL_AURORA}`;

const COSTING_ROUTE = "/finance/quotations/:quotationRef";
const costingPath = `/finance/quotations/${QUOTATION_AURORA}`;

describe("M07-S02 · proposal builder", () => {
  it("cites the sources behind an AI-written section", async () => {
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });

    await screen.findByRole("heading", { name: "1 · Understanding your needs" });
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText(/TNA-0042/)).toBeInTheDocument();
  });

  it("renders every section with its own provenance", async () => {
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });

    expect(
      await screen.findByRole("heading", { name: new RegExp(PROPOSAL_AURORA) }),
    ).toBeInTheDocument();
    /* RecordHeader owns the record's identity, and the identity is the
       reference AND the client it is for. */
    expect(
      await screen.findByRole("heading", {
        name: `${PROPOSAL_AURORA} · Aurora Manufacturing Sdn Bhd`,
      }),
    ).toBeInTheDocument();

    const rail = screen.getByRole("navigation", { name: "Proposal sections" });
    expect(within(rail).getByText("Understanding your needs")).toBeInTheDocument();
    expect(within(rail).getByText("HRDC claim guidance")).toBeInTheDocument();
    /* Section 3 was edited by a human after the agent drafted it. */
    expect(within(rail).getByText(/AI-assisted · edited/)).toBeInTheDocument();
    expect(within(rail).getByText(/AI low confidence/)).toBeInTheDocument();
  });

  it("warns about the low-confidence section without blocking the send", async () => {
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });

    expect(
      await screen.findByText(/Section 5 needs review before this is sent/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open section 5" })).toBeInTheDocument();
    /* Warn, never hard-block: the primary stays live. */
    expect(screen.getAllByRole("button", { name: "Send for approval" })[0]).toBeEnabled();
  });

  it("moves to the flagged section from the warning", async () => {
    const user = userEvent.setup();
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });

    await screen.findByRole("heading", { name: "1 · Understanding your needs" });
    await user.click(screen.getByRole("button", { name: "Open section 5" }));

    expect(
      await screen.findByRole("heading", { name: "5 · HRDC claim guidance" }),
    ).toBeInTheDocument();
  });

  it("regenerates a section and clears its review flag", async () => {
    const user = userEvent.setup();
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });

    await user.click(await screen.findByRole("button", { name: "Open section 5" }));
    await user.click(await screen.findByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(screen.queryByText(/needs review before this is sent/)).not.toBeInTheDocument();
    });
  });

  it("edits a section through putProposalSection", async () => {
    const user = userEvent.setup();
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });

    await user.click(await screen.findByRole("button", { name: "Edit before use" }));
    const editor = screen.getByLabelText("Body of section 1");
    await user.clear(editor);
    await user.type(editor, "Rewritten by Amirah.");
    await user.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => {
      expect(screen.getAllByText(/Rewritten by Amirah\./).length).toBeGreaterThan(0);
    });
  });

  it("queues the send for approval and carries the low-confidence flag to the approver", async () => {
    const user = userEvent.setup();
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });

    await screen.findByRole("heading", { name: new RegExp(PROPOSAL_AURORA) });
    const sendButtons = screen.getAllByRole("button", { name: "Send for approval" });
    await user.click(sendButtons[0] as HTMLElement);

    /* The standing pending approval is the same request, so the ref is
       APV-2026-0771 rather than a duplicate queued behind it. */
    expect(await screen.findByText(new RegExp(APPROVAL_AURORA))).toBeInTheDocument();
    expect(
      await screen.findByText(/Section 5 is flagged low confidence and travels with this request/),
    ).toBeInTheDocument();
  });

  it("adds a human-authored section, which carries no provenance", async () => {
    const user = userEvent.setup();
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });

    const rail = await screen.findByRole("navigation", { name: "Proposal sections" });
    await user.type(screen.getByLabelText("New section"), "Terms and conditions");
    await user.click(screen.getByRole("button", { name: "Add section" }));

    expect(await within(rail).findByText("Terms and conditions")).toBeInTheDocument();
    /* Absent provenance means a person wrote it. */
    expect(
      await screen.findByRole("heading", { name: /Terms and conditions/ }),
    ).toBeInTheDocument();
  });

  it("renders the error state for a proposal that does not exist", async () => {
    renderScreen(<ProposalBuilderPage />, {
      path: "/sales/proposals/PRO-2026-9999",
      route: BUILDER_ROUTE,
    });

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Could not load this proposal")).toBeInTheDocument();
  });
});

describe("M07-S03 · costing worksheet", () => {
  it("renders the lines, both floors, the binding basis and the placeholder rate card", async () => {
    renderScreen(<CostingWorksheetPage />, { path: costingPath, route: COSTING_ROUTE });

    expect(
      await screen.findByRole("heading", { name: `${QUOTATION_AURORA} · costing` }),
    ).toBeInTheDocument();

    expect(screen.getByText("rate card v0 · placeholder", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Absolute floor · programme tier")).toBeInTheDocument();
    expect(screen.getByText(/Margin floor · cost ÷/)).toBeInTheDocument();
    expect(screen.getByText("Binding floor")).toBeInTheDocument();
    /* The Aurora quotation's margin floor sits above the tier floor. */
    expect(screen.getAllByText("Margin floor binds").length).toBeGreaterThan(0);

    expect(screen.getByText("Trainer fee")).toBeInTheDocument();
    /* The client-site venue line stays visible with an explicit zero. */
    expect(screen.getByText("Client site · Aurora HQ Shah Alam")).toBeInTheDocument();
    expect(screen.getAllByText("Direct cost").length).toBeGreaterThan(0);
  });

  it("shows the below-floor error beside the healthy list price", async () => {
    const user = userEvent.setup();
    renderScreen(<CostingWorksheetPage />, { path: costingPath, route: COSTING_ROUTE });

    const proposed = await screen.findByLabelText("Proposed price");
    /* One change event, not keystrokes: the field reformats to two decimals on
       every change, so typing a digit at a time would fight its own output. */
    fireEvent.change(proposed, { target: { value: "12400" } });

    expect(await screen.findByText(/Below the RM 17,538.46/)).toBeInTheDocument();
    expect(screen.getByText(/APV-02/)).toBeInTheDocument();
    /* The healthy price is still on screen, unchanged, beside the error. */
    expect(screen.getByLabelText("List price")).toHaveValue("18500.00");
  });

  it("refuses a below-floor apply with FLOOR_PRICE_BREACH and names the policy", async () => {
    const user = userEvent.setup();
    renderScreen(<CostingWorksheetPage />, { path: costingPath, route: COSTING_ROUTE });

    const proposed = await screen.findByLabelText("Proposed price");
    fireEvent.change(proposed, { target: { value: "12400" } });
    await user.click(screen.getByRole("button", { name: "Apply to proposal" }));

    const banner = await screen.findByText(/floor binds here/);
    expect(banner).toBeInTheDocument();
    expect(screen.getAllByText(/APV-02/).length).toBeGreaterThan(0);
  });

  it("applies the list price through QUOTATION_APPLY", async () => {
    const user = userEvent.setup();
    renderScreen(<CostingWorksheetPage />, { path: costingPath, route: COSTING_ROUTE });

    await screen.findByRole("heading", { name: `${QUOTATION_AURORA} · costing` });
    await user.click(screen.getByRole("button", { name: "Apply to proposal" }));

    await waitFor(() => {
      expect(
        screen.getAllByText(new RegExp(`Applied to ${PROPOSAL_AURORA}`)).length,
      ).toBeGreaterThan(1);
    });
  });

  it("explains the refusal when the reader holds no pricing permission", async () => {
    renderScreen(<CostingWorksheetPage />, {
      path: costingPath,
      route: COSTING_ROUTE,
      role: "OPS",
    });

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Pricing is not yours to see")).toBeInTheDocument();
  });
});

describe("the one-solid-primary rule", () => {
  it("claims a single primary on the builder, even though the header and the editor both offer it", async () => {
    renderScreen(<ProposalBuilderPage />, { path: builderPath, route: BUILDER_ROUTE });
    await screen.findByRole("heading", { name: new RegExp(PROPOSAL_AURORA) });

    /* Two buttons, one action, one label — the header carries the view's solid
       primary and the editor offers the same action where the decision is made,
       as a SecondaryButton. Compared as an ARRAY, not a Set: wrapping it in a
       Set deduplicated, so the assertion passed with one primary, two or twenty
       sharing a label and could not fail on the defect the line above it
       describes. */
    expect(screen.getAllByRole("button", { name: "Send for approval" })).toHaveLength(2);
    expect(currentPrimaries()).toEqual(["Send for approval"]);
  });

  it("claims a single primary on the costing worksheet", async () => {
    renderScreen(<CostingWorksheetPage />, { path: costingPath, route: COSTING_ROUTE });
    await screen.findByRole("heading", { name: `${QUOTATION_AURORA} · costing` });

    expect(currentPrimaries()).toEqual(["Apply to proposal"]);
  });
});

describe("section provenance helpers", () => {
  it("flags a section below the confidence floor", () => {
    expect(
      needsReview({ n: 5, title: "x", provenance: { origin: "AI_GENERATED", confidence: 0.41 } }),
    ).toBe(true);
    expect(
      needsReview({ n: 1, title: "x", provenance: { origin: "AI_GENERATED", confidence: 0.88 } }),
    ).toBe(false);
  });

  it("names a human edit over the generation that preceded it", () => {
    expect(
      originLabel({
        n: 3,
        title: "x",
        provenance: {
          origin: "AI_SUGGESTED",
          confidence: 0.9,
          editedBy: { id: "u_amirah", name: "Amirah Yusof", at: "2026-09-11T09:31:10+08:00" },
        },
      }),
    ).toBe("AI-assisted · edited");
    expect(originLabel({ n: 6, title: "x" })).toBe("Template");
  });
});
