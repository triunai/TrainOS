import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ProvenanceJury } from "@trainos/contract";
import { TierChip } from "@/shared/components/kit/TierChip";
import { JuryChip } from "@/shared/components/kit/JuryChip";
import { CitationChip } from "@/shared/components/kit/CitationChip";
import { RefChip } from "@/shared/components/kit/RefChip";
import { tierLabel } from "@/shared/components/kit/format";

describe("TierChip", () => {
  it("renders the tier label", () => {
    render(<TierChip tier="FAST" />);
    expect(screen.getByText("FAST")).toBeInTheDocument();
  });

  it("is neutral by design — no success/warning/danger/primary colour class", () => {
    render(<TierChip tier="STRONG_1" />);
    const chip = screen.getByText("STRONG-1").closest("span");
    expect(chip?.className).not.toMatch(/success|warning|danger|primary/);
  });

  it("renders the trailing model name and formats underscored keys with a hyphen/space", () => {
    render(<TierChip tier="DEEP_THINK" model="Claude Sonnet 5" />);
    expect(screen.getByText("Claude Sonnet 5")).toBeInTheDocument();
    expect(tierLabel("DEEP_THINK")).toBe("DEEP THINK");
    expect(tierLabel("STRONG_1")).toBe("STRONG-1");
  });
});

describe("JuryChip", () => {
  const JURY: ProvenanceJury = {
    quorum: 2,
    of: 3,
    agreed: ["claude-sonnet-5", "gpt-5.6"],
    dissented: [{ model: "gemini-3", note: "flagged a pricing mismatch" }],
  };

  it("renders 'No jury' with no AI tint when no jury ran", () => {
    render(<JuryChip />);
    const chip = screen.getByText("No jury");
    expect(chip.className).toContain("bg-surface");
    expect(chip.className).not.toContain("bg-ai-tint");
  });

  it("renders the quorum in the AI tint when a jury ran", () => {
    render(<JuryChip jury={JURY} />);
    const chip = screen.getByText(/Jury 2 of 3/);
    expect(chip.className).toContain("bg-ai-tint");
  });

  it("surfaces dissent in the title rather than hiding it", () => {
    render(<JuryChip jury={JURY} />);
    expect(screen.getByText(/Jury 2 of 3/)).toHaveAttribute(
      "title",
      "gemini-3: flagged a pricing mismatch",
    );
  });

  it("falls back to the agreed list as the title when nobody dissented", () => {
    render(<JuryChip jury={{ ...JURY, dissented: [] }} />);
    expect(screen.getByText(/Jury 2 of 3/)).toHaveAttribute(
      "title",
      "Agreed: claude-sonnet-5, gpt-5.6",
    );
  });
});

describe("CitationChip", () => {
  it("renders the rule variant as an accessible button with a rule reference label", () => {
    const onOpen = vi.fn();
    render(
      <CitationChip variant="rule" onOpen={onOpen} label="HRD Corp rule HRD-014">
        § HRD-014
      </CitationChip>,
    );
    const button = screen.getByRole("button", { name: "HRD Corp rule HRD-014" });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders the inline variant as a superscript numbered citation", () => {
    render(
      <CitationChip variant="inline" onOpen={() => {}}>
        1
      </CitationChip>,
    );
    const button = screen.getByRole("button", { name: "Source 1" });
    expect(button.closest("sup")).toBeInTheDocument();
  });

  it("defaults to the rule variant", () => {
    render(<CitationChip>§ HRD-014</CitationChip>);
    expect(screen.getByText("§ HRD-014").closest("sup")).not.toBeInTheDocument();
  });
});

describe("RefChip", () => {
  it("renders a business reference value", () => {
    render(<RefChip refValue="ORG-0114" />);
    expect(screen.getByText("ORG-0114")).toBeInTheDocument();
  });

  it("renders the three-letter type tag instead when `type` is given", () => {
    render(<RefChip type="ORGANISATION" />);
    expect(screen.getByText("ORG")).toBeInTheDocument();
  });

  it("shows the ref value in a title when both type and refValue are given", () => {
    render(<RefChip type="ORGANISATION" refValue="ORG-0114" />);
    expect(screen.getByText("ORG")).toHaveAttribute("title", "ORG-0114");
  });

  it("renders nothing when neither refValue nor type is given", () => {
    const { container } = render(<RefChip />);
    expect(container).toBeEmptyDOMElement();
  });
});
