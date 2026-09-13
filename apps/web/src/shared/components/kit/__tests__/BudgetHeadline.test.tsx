/**
 * BudgetHeadline — M01-S01's "Agent spend · November".
 *
 * The same two numbers `BudgetBar` carries, ordered the other way round: here
 * the spend IS the section, so it is the headline and the cap is the aside.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Money } from "@trainos/contract";
import { BudgetHeadline } from "@/shared/components/kit/BudgetBar";

const spend: Money = { amount: 8420, currency: "MYR" };
const cap: Money = { amount: 25000, currency: "MYR" };

describe("BudgetHeadline", () => {
  it("leads with the spend and keeps the cap as the aside", () => {
    render(<BudgetHeadline used={spend} limit={cap} label="Agent spend against budget" />);

    const headline = screen.getByText(/84\.20$/);
    expect(headline.className).toContain("text-[22px]");
    expect(screen.getByText(/of RM 250\.00 budget/)).toBeInTheDocument();
  });

  it("measures the bar against the cap and announces both figures", () => {
    render(<BudgetHeadline used={spend} limit={cap} label="Agent spend against budget" />);

    const bar = screen.getByRole("progressbar", { name: "Agent spend against budget" });
    expect(bar).toHaveAttribute("aria-valuenow", "34");
    /* The announced text is the two amounts, not the percentage — "34 percent"
       is a proportion of a cap the reader was never told. */
    expect(bar).toHaveAttribute("aria-valuetext", "RM 84.20 of RM 250.00");
  });

  it("stays ink until the SERVER says the cap is near", () => {
    const { container, rerender } = render(
      <BudgetHeadline used={spend} limit={cap} label="Agent spend" />,
    );
    expect(container.querySelector('[role="progressbar"] > div')?.className).toContain("bg-ink");

    /* A high ratio is not itself amber. §10: budget bars stay ink until they
       near or hit a cap, and whether they have is the server's call. */
    rerender(
      <BudgetHeadline used={{ amount: 24000, currency: "MYR" }} limit={cap} label="Agent spend" />,
    );
    expect(container.querySelector('[role="progressbar"] > div')?.className).toContain("bg-ink");

    rerender(<BudgetHeadline used={spend} limit={cap} label="Agent spend" state="NEAR" />);
    expect(container.querySelector('[role="progressbar"] > div')?.className).toContain("warning");
  });

  it("renders an empty bar rather than NaN when there is no cap", () => {
    render(
      <BudgetHeadline used={spend} limit={{ amount: 0, currency: "MYR" }} label="Agent spend" />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
