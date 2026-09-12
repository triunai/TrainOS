import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Budget } from "@trainos/contract";
import { BudgetBar } from "@/shared/components/kit/BudgetBar";
import { AllowedHoursStrip } from "@/shared/components/kit/AllowedHoursStrip";

function budget(state: Budget["state"]): Pick<Budget, "spend" | "cap" | "state"> {
  return {
    spend: { amount: 87_00, currency: "MYR" },
    cap: { amount: 100_00, currency: "MYR" },
    state,
  };
}

describe("BudgetBar", () => {
  it("renders the spend-of-cap text and a progressbar", () => {
    render(<BudgetBar budget={budget("WITHIN")} label="Proposal Agent" />);
    expect(screen.getByText(/RM 87\.00 of RM 100\.00/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("colours the fill from `state`, not the ratio: WITHIN at 87% stays ink", () => {
    const { container } = render(<BudgetBar budget={budget("WITHIN")} label="Proposal Agent" />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.className).toContain("bg-ink");
    expect(fill?.className).not.toMatch(/warning|danger/);
  });

  it("renders the warning fill for NEAR at the same 87% ratio", () => {
    const { container } = render(<BudgetBar budget={budget("NEAR")} label="Proposal Agent" />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.className).toMatch(/warning/);
    expect(fill?.className).not.toContain("bg-ink");
  });

  it("renders the cap-reached status for a PAUSED budget", () => {
    render(<BudgetBar budget={budget("PAUSED")} label="Proposal Agent" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cap reached");
  });
});

describe("AllowedHoursStrip", () => {
  it("renders 24 hour cells", () => {
    const { container } = render(<AllowedHoursStrip peak={[[9, 12]]} />);
    expect(container.querySelectorAll("[title]")).toHaveLength(24);
  });

  it("marks hours 9, 10 and 11 as peak and hour 12 as allowed (end-exclusive)", () => {
    const { container } = render(<AllowedHoursStrip peak={[[9, 12]]} />);
    const cells = Array.from(container.querySelectorAll("[title]"));
    const titleFor = (hour: number) => cells[hour].getAttribute("title");

    expect(titleFor(9)).toMatch(/peak/);
    expect(titleFor(10)).toMatch(/peak/);
    expect(titleFor(11)).toMatch(/peak/);
    expect(titleFor(12)).toMatch(/allowed/);
    expect(titleFor(12)).not.toMatch(/peak/);
  });
});
