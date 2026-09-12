import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunStateCard } from "@trainos/contract";
import { StateCardPanel } from "@/shared/components/kit/StateCardPanel";

const STATE_CARD: RunStateCard = {
  goal: "Close out the Aurora Manufacturing engagement",
  plan: [
    { n: 1, label: "Confirm attendance", status: "DONE" },
    { n: 2, label: "Raise invoice", status: "PENDING" },
  ],
  decisions: ["Used the standard 12% discount band"],
  constraints: ["Must not exceed the RM 20,000 floor"],
  recordPointers: ["ENG-0311"],
  openQuestions: ["Has the client confirmed the PO number?"],
  budgets: {
    tokens: { used: 4000, limit: 10000 },
    cost: { used: { amount: 1200, currency: "MYR" }, limit: { amount: 5000, currency: "MYR" } },
  },
};

describe("StateCardPanel", () => {
  it("renders the goal, every plan step with its number and label, decisions, constraints, record pointers and open questions", () => {
    render(<StateCardPanel stateCard={STATE_CARD} />);
    expect(screen.getByText(STATE_CARD.goal)).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Confirm attendance")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Raise invoice")).toBeInTheDocument();
    expect(screen.getByText("Used the standard 12% discount band")).toBeInTheDocument();
    expect(screen.getByText("Must not exceed the RM 20,000 floor")).toBeInTheDocument();
    expect(screen.getByText("ENG-0311")).toBeInTheDocument();
    expect(screen.getByText("Has the client confirmed the PO number?")).toBeInTheDocument();
  });

  it("renders both budget bars as progressbars", () => {
    render(<StateCardPanel stateCard={STATE_CARD} />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("omits empty sections — a state card with no decisions does not render 'Decisions'", () => {
    render(<StateCardPanel stateCard={{ ...STATE_CARD, decisions: [] }} />);
    expect(screen.queryByText("Decisions")).not.toBeInTheDocument();
  });
});
