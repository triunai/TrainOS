import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusChip } from "@/shared/components/kit/StatusChip";
import { PROPOSAL_TONE, APPROVAL_TONE, TIER_STATUS_TONE } from "@/shared/components/kit/statusTone";
import { humanise } from "@/shared/components/kit/format";

describe("StatusChip", () => {
  it("renders the label text", () => {
    render(<StatusChip>Draft</StatusChip>);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("defaults to the neutral tone, which spends no colour", () => {
    render(<StatusChip>Draft</StatusChip>);
    const chip = screen.getByText("Draft");
    expect(chip.className).toContain("bg-surface");
    expect(chip.className).not.toMatch(/success|warning|danger|info/);
  });

  it("applies the danger tone's fill/text/border triple", () => {
    render(<StatusChip tone="danger">Lost</StatusChip>);
    const chip = screen.getByText("Lost");
    expect(chip.className).toContain("bg-danger-fill");
    expect(chip.className).toContain("text-danger");
  });

  it("renders the pill shape by default and the square shape when asked", () => {
    const { rerender } = render(<StatusChip>Draft</StatusChip>);
    expect(screen.getByText("Draft").className).toContain("rounded-pill");

    rerender(<StatusChip shape="square">Sync · Error</StatusChip>);
    expect(screen.getByText("Sync · Error").className).toContain("rounded-[6px]");
  });

  it("announces itself as a status region only when `live` is set", () => {
    render(<StatusChip live>Accepted</StatusChip>);
    expect(screen.getByRole("status")).toHaveTextContent("Accepted");
  });

  it("does not carry a status role by default", () => {
    render(<StatusChip>Accepted</StatusChip>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("statusTone maps", () => {
  it("puts SENT proposals and DRAFT proposals at neutral, not a false positive green", () => {
    expect(PROPOSAL_TONE.SENT).toBe("neutral");
    expect(PROPOSAL_TONE.ACCEPTED).toBe("success");
  });

  it("marks a pending approval as warning and a rejected one as danger", () => {
    expect(APPROVAL_TONE.PENDING).toBe("warning");
    expect(APPROVAL_TONE.REJECTED).toBe("danger");
  });

  it("colours tier health but not the tier key itself", () => {
    expect(TIER_STATUS_TONE.HEALTHY).toBe("success");
    expect(TIER_STATUS_TONE.PAUSED_BY_CAP).toBe("danger");
  });

  it("humanises an UPPER_SNAKE enum value to Sentence case", () => {
    expect(humanise("AWAITING_APPROVAL")).toBe("Awaiting approval");
  });
});
