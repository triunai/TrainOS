import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DiffLine, Provenance } from "@trainos/contract";
import { ProposedActionCard } from "@/shared/components/kit/ProposedActionCard";

const DIFF: DiffLine[] = [
  { op: "ADD", entity: "Proposal", description: "Send proposal to Aurora Manufacturing" },
];

// AIChip renders no badge at all when `provenance` is absent (absent provenance
// means human-authored, contract §1) — a proposed action is by definition
// AI-authored, so a provenance envelope is required for the agent-name chip
// to render.
const PROVENANCE: Provenance = { origin: "AI_SUGGESTED", confidence: 0.82 };

describe("ProposedActionCard", () => {
  it("renders the agent name, title, autonomy chip, metric cells and the diff", () => {
    render(
      <ProposedActionCard
        agentName="Proposal Agent"
        title="Send proposal to Aurora Manufacturing"
        autonomy="ACT_WITH_APPROVAL"
        provenance={PROVENANCE}
        metrics={[
          { label: "Value", value: "RM 18,500" },
          { label: "Confidence", value: "82%" },
          { label: "Channel", value: "Email" },
        ]}
        diff={DIFF}
      />,
    );

    expect(screen.getByText("Proposal Agent")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Send proposal to Aurora Manufacturing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Act w/ approval")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Confidence")).toBeInTheDocument();
    expect(screen.getByText("Channel")).toBeInTheDocument();
    expect(screen.getAllByText("Send proposal to Aurora Manufacturing")).toHaveLength(2);
  });

  it("gives the header an AI tint, never a solid fill", () => {
    const { container } = render(
      <ProposedActionCard
        agentName="Proposal Agent"
        title="Send proposal"
        autonomy="SUGGEST"
        diff={DIFF}
      />,
    );
    const header = container.querySelector("header");
    expect(header?.className).toContain("bg-ai-tint");
    expect(header?.className).not.toContain("bg-primary ");
  });
});
