import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComplianceCheck } from "@trainos/contract";
import { RuleCheckRow } from "@/shared/components/kit/RuleCheckRow";
import { EscalationLadder, type LadderRung } from "@/shared/components/kit/EscalationLadder";

function check(state: ComplianceCheck["state"]): ComplianceCheck {
  return {
    key: "eligibility",
    state,
    label: "Training start date is eligible",
    computed: { grantApprovedAt: "2026-10-28" },
    display: "grant approved 28 Oct → earliest start 11 Nov",
    ruleId: "HRD-014",
    provenance: { origin: "SYSTEM", method: "DETERMINISTIC" },
  };
}

describe("RuleCheckRow", () => {
  it.each(["PASS", "WARN", "FAIL"] as const)(
    "renders the %s verdict chip, the label, the display sentence and a citation chip naming the rule",
    (state) => {
      render(<RuleCheckRow check={check(state)} />);
      const verdict = state.charAt(0) + state.slice(1).toLowerCase();
      expect(screen.getByText(verdict)).toBeInTheDocument();
      expect(screen.getByText("Training start date is eligible")).toBeInTheDocument();
      expect(screen.getByText("grant approved 28 Oct → earliest start 11 Nov")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Rule HRD-014" })).toBeInTheDocument();
    },
  );

  it("renders 'Computed · no model' for a DETERMINISTIC check", () => {
    render(<RuleCheckRow check={check("PASS")} />);
    expect(screen.getByText("Computed · no model")).toBeInTheDocument();
  });

  it("renders the model name and confidence for a model-backed check", () => {
    render(
      <RuleCheckRow
        check={{
          ...check("WARN"),
          provenance: { origin: "AI_SUGGESTED", model: "Claude Sonnet 5", confidence: 0.82 },
        }}
      />,
    );
    expect(screen.getByText(/Claude Sonnet 5/)).toBeInTheDocument();
    expect(screen.getByText(/82%/)).toBeInTheDocument();
  });
});

describe("EscalationLadder", () => {
  const RUNGS: LadderRung[] = [
    { when: "Day 7", action: "Reminder 1", autonomy: "AUTONOMOUS" },
    { when: "Day 30", action: "Reminder 2", autonomy: "ACT_WITH_APPROVAL" },
    { when: "Day 60", action: "Human call" },
    { when: "Day 75", action: "Trading hold", note: "requires MD approval" },
  ];

  it("renders one list item per rung", () => {
    render(<EscalationLadder rungs={RUNGS} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("marks the first rung with no autonomy as the handover, with 'A human takes over'", () => {
    render(<EscalationLadder rungs={RUNGS} />);
    const items = screen.getAllByRole("listitem");
    expect(items[2]).toHaveTextContent("A human takes over");
    expect(items[2]).toHaveTextContent("Human call");
    expect(items[0]).not.toHaveTextContent("A human takes over");
  });
});
