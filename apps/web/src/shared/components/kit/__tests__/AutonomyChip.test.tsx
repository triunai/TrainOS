import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutonomyChip } from "@/shared/components/kit/AutonomyChip";
import { AUTONOMY_LADDER, autonomyCaption } from "@/shared/components/kit/adapters";

describe("AutonomyChip", () => {
  it("renders the OBSERVE rung as neutral, with no AI tint", () => {
    render(<AutonomyChip level="OBSERVE" />);
    const chip = screen.getByText("Observe");
    expect(chip.className).toContain("bg-surface");
    expect(chip.className).not.toContain("bg-ai-tint");
  });

  it("renders acting rungs with the AI tint", () => {
    render(<AutonomyChip level="SUGGEST" />);
    expect(screen.getByText("Suggest").className).toContain("bg-ai-tint");
  });

  it("gives only AUTONOMOUS the heavier 1.5px solid-accent border", () => {
    render(<AutonomyChip level="AUTONOMOUS" />);
    const chip = screen.getByText("Autonomous");
    expect(chip.className).toContain("border-[1.5px]");
    expect(chip.className).toContain("border-primary");
  });

  it("does not use the heavy border on ACT_WITH_APPROVAL", () => {
    render(<AutonomyChip level="ACT_WITH_APPROVAL" />);
    expect(screen.getByText("Act w/ approval").className).not.toContain("border-[1.5px]");
  });

  it("renders the caption only when withCaption is set", () => {
    render(<AutonomyChip level="SUGGEST" withCaption />);
    expect(screen.getByText("drafts, human sends")).toBeInTheDocument();
  });

  it("omits the caption text by default", () => {
    render(<AutonomyChip level="SUGGEST" />);
    expect(screen.queryByText("drafts, human sends")).not.toBeInTheDocument();
  });

  it("drops the 118px floor width when fluid is set", () => {
    render(<AutonomyChip level="OBSERVE" fluid />);
    expect(screen.getByText("Observe").className).not.toContain("min-w-[118px]");
  });

  it("exposes the ladder in rung order and matching captions", () => {
    expect(AUTONOMY_LADDER).toEqual(["OBSERVE", "SUGGEST", "ACT_WITH_APPROVAL", "AUTONOMOUS"]);
    expect(autonomyCaption("AUTONOMOUS")).toBe("acts, notifies after");
  });
});
