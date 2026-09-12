import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Money, ReceivablesAging } from "@trainos/contract";
import { MetricStrip, AgingStrip } from "@/shared/components/kit/MetricStrip";

function money(amount: number): Money {
  return { amount, currency: "MYR" };
}

describe("MetricStrip", () => {
  it("renders an actionable cell (with onDrill) as a button and fires onDrill on click", () => {
    const onDrill = vi.fn();
    render(<MetricStrip cells={[{ label: "Lifetime value", value: "42", onDrill }]} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(onDrill).toHaveBeenCalledTimes(1);
  });

  it("renders an informational cell (no onDrill) with no button", () => {
    render(<MetricStrip cells={[{ label: "Informational", value: "7" }]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("formats a Money value, e.g. 'RM 214,300'", () => {
    render(<MetricStrip cells={[{ label: "Revenue", value: money(21430000) }]} />);
    expect(screen.getByText("RM 214,300")).toBeInTheDocument();
  });

  it("renders a progressbar for a cell with `bar`", () => {
    render(<MetricStrip cells={[{ label: "Health", value: "80%", bar: 0.8 }]} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders the illustrative caption for a cell with `estimate`", () => {
    render(<MetricStrip cells={[{ label: "Admin hours saved", value: "12", estimate: true }]} />);
    expect(screen.getByText("illustrative · baseline not yet measured")).toBeInTheDocument();
  });

  it("AgingStrip maps a ReceivablesAging into cells", () => {
    const aging: ReceivablesAging = {
      current: money(100000),
      d1_30: money(50000),
      d31_60: money(20000),
      d60_plus: money(10000),
      dsoDays: 34,
    };
    render(<AgingStrip aging={aging} />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("1–30 days")).toBeInTheDocument();
    expect(screen.getByText("31–60 days")).toBeInTheDocument();
    expect(screen.getByText("60+ days")).toBeInTheDocument();
    expect(screen.getByText("DSO")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
  });
});
