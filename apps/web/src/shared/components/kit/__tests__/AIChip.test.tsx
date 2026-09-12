import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Provenance } from "@trainos/contract";
import { AIChip, variantOf } from "@/shared/components/kit/AIChip";

const SUGGESTED_PROVENANCE: Provenance = {
  origin: "AI_SUGGESTED",
  agentId: "agent-1",
  confidence: 0.82,
};

describe("AIChip / variantOf", () => {
  it("resolves undefined provenance to human", () => {
    expect(variantOf(undefined)).toBe("human");
  });

  it("resolves HUMAN origin to human even when present", () => {
    expect(variantOf({ origin: "HUMAN" })).toBe("human");
  });

  it("resolves SYSTEM origin to system", () => {
    expect(variantOf({ origin: "SYSTEM" })).toBe("system");
  });

  it("resolves a low-confidence AI value below the threshold", () => {
    expect(variantOf({ origin: "AI_SUGGESTED", confidence: 0.3 })).toBe("low-confidence");
  });

  it("resolves AI_EXECUTED with high confidence to executed", () => {
    expect(variantOf({ origin: "AI_EXECUTED", confidence: 0.9 })).toBe("executed");
  });
});

describe("AIChip render", () => {
  it("renders nothing for the human variant — no visible badge", () => {
    const { container } = render(<AIChip variant="human" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("carries the AI tint but never a solid primary fill", () => {
    const { container } = render(<AIChip variant="suggested" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.className).toContain("bg-ai-tint");
    expect(chip.className).not.toContain("bg-primary");
  });

  it("renders the low-confidence variant with the amber dot, the glyph, and a text label", () => {
    const { container } = render(<AIChip variant="low-confidence" />);
    expect(screen.getByText("✦")).toBeInTheDocument();
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    // The glyph and the dot are two separate aria-hidden marks on the chip;
    // the dot is the second one and carries the amber warning-accent fill.
    const hiddenMarks = container.querySelectorAll('span[aria-hidden="true"]');
    expect(hiddenMarks).toHaveLength(2);
    expect(hiddenMarks[1].className).toContain("rounded-pill");
  });

  it("shows the confidence percentage when provenance carries one", () => {
    render(<AIChip provenance={SUGGESTED_PROVENANCE} />);
    expect(screen.getByText("· 82%")).toBeInTheDocument();
  });

  /* Section 05 requires provenance to be reachable FROM the badge, and a
     hover-only panel is not reachable by keyboard or by touch. Both routes in
     are therefore asserted: activating the trigger, which is what Enter, Space
     and a tap all do, and hovering it. */
  it("opens the provenance popover when the trigger is activated", () => {
    render(<AIChip provenance={SUGGESTED_PROVENANCE} />);
    const trigger = screen.getByRole("button", { name: /AI suggested/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/agent-1/)).toBeInTheDocument();
  });

  it("opens the provenance popover on hover", () => {
    render(<AIChip provenance={SUGGESTED_PROVENANCE} />);
    const trigger = screen.getByRole("button", { name: /AI suggested/ });

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/agent-1/)).toBeInTheDocument();
  });

  it("suppresses the popover entirely when withoutPopover is set", () => {
    render(<AIChip provenance={SUGGESTED_PROVENANCE} withoutPopover />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
