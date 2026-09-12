import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Money } from "@trainos/contract";
import { MoneyText, formatMoney } from "@/shared/components/kit/Money";

const AMOUNT: Money = { amount: 1850000, currency: "MYR" };

describe("Money", () => {
  it("formats sen into a grouped RM string with two decimals", () => {
    expect(formatMoney(AMOUNT)).toBe("RM 18,500.00");
  });

  it("drops decimals in compact mode", () => {
    expect(formatMoney(AMOUNT, true)).toBe("RM 18,500");
  });

  it("renders the formatted value with right-aligned mono classes", () => {
    render(<MoneyText value={AMOUNT} />);
    const el = screen.getByText("RM 18,500.00");
    expect(el.className).toContain("font-mono");
    expect(el.className).toContain("tabular-nums");
  });

  it("renders a dash instead of RM 0.00 when dashWhenZero is set on a zero amount", () => {
    render(<MoneyText value={{ amount: 0, currency: "MYR" }} dashWhenZero />);
    expect(screen.getByLabelText("none")).toHaveTextContent("—");
  });

  it("still renders RM 0.00 when dashWhenZero is not set", () => {
    render(<MoneyText value={{ amount: 0, currency: "MYR" }} />);
    expect(screen.getByText("RM 0.00")).toBeInTheDocument();
  });

  it("carries the exact amount in a title attribute when compact", () => {
    render(<MoneyText value={AMOUNT} compact />);
    expect(screen.getByText("RM 18,500")).toHaveAttribute("title", "RM 18,500.00");
  });
});
