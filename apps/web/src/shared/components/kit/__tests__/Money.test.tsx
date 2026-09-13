import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Money } from "@trainos/contract";
import { MoneyText } from "@/shared/components/kit/Money";
import { formatMoney } from "@/shared/components/kit/format";

const AMOUNT: Money = { amount: 1850000, currency: "MYR" };

describe("Money", () => {
  it("formats sen into a grouped RM string with two decimals", () => {
    expect(formatMoney(AMOUNT)).toBe("RM 18,500.00");
  });

  it("drops decimals in compact mode", () => {
    expect(formatMoney(AMOUNT, true)).toBe("RM 18,500");
  });

  it("aligns with tabular figures in the UI font, not with a monospace face", () => {
    /* Tightening brief §1: a number is not a machine value. Money was
       `font-mono` so a column of amounts would line up, and `tabular-nums` on
       the UI font lines it up the same way without spending the app's second
       typeface on every price on every screen. `MoneyText` is read by the
       table, the metric strip, the run rows and the budget bars, so this one
       class was most of the mono on a list screen.

       Asserted both ways: the alignment must still be there, and the mono must
       not come back with it. */
    render(<MoneyText value={AMOUNT} />);
    const el = screen.getByText("RM 18,500.00");
    expect(el.className).toContain("tabular-nums");
    expect(el.className).not.toContain("font-mono");
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
