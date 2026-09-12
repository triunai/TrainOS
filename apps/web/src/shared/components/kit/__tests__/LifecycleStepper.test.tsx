import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LifecycleState, LifecycleStep, PipelineStage } from "@trainos/contract";
import { LifecycleStepper } from "@/shared/components/kit/LifecycleStepper";

const ALL_STATES: LifecycleState[] = ["DONE", "CURRENT", "PENDING", "BLOCKED", "SKIPPED", "FAILED"];

function stepsWithAllStates(): LifecycleStep[] {
  return ALL_STATES.map((state, index) => ({
    key: `stage-${index}`,
    label: `Stage ${index}`,
    state,
  }));
}

describe("LifecycleStepper", () => {
  it("renders all six LifecycleState values without error in variant 'header'", () => {
    const { container } = render(
      <LifecycleStepper steps={stepsWithAllStates()} variant="header" />,
    );
    expect(container.querySelectorAll("li").length).toBe(ALL_STATES.length);
  });

  it("variant 'table' renders a focusable element with an accessible name listing every stage and state", () => {
    render(<LifecycleStepper steps={stepsWithAllStates()} variant="table" />);
    const cell = screen.getByRole("img", {
      name: /Stage 0: done · Stage 1: current · Stage 2: pending · Stage 3: blocked · Stage 4: skipped · Stage 5: failed/,
    });
    expect(cell).toHaveAttribute("tabIndex", "0");
  });

  it("variant 'inline' renders an ordered list with the current step marked aria-current='step'", () => {
    const steps: LifecycleStep[] = [
      { key: "a", label: "Alpha", state: "DONE" },
      { key: "b", label: "Beta", state: "CURRENT" },
      { key: "c", label: "Gamma", state: "PENDING" },
    ];
    const { container } = render(<LifecycleStepper steps={steps} variant="inline" />);
    const list = container.querySelector("ol");
    expect(list).toBeTruthy();
    const current = screen.getByText("Beta").closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
  });

  it("renders steps in the order given and contains no hardcoded stage-name list, proven by two different label sets", () => {
    const setOne: LifecycleStep[] = [
      { key: "k1", label: "Quotation sent", state: "DONE" },
      { key: "k2", label: "Contract signed", state: "CURRENT" },
    ];
    const setTwo: LifecycleStep[] = [
      { key: "k1", label: "Zebra crossing", state: "PENDING" },
      { key: "k2", label: "Aardvark review", state: "BLOCKED" },
    ];

    const { unmount } = render(<LifecycleStepper steps={setOne} variant="inline" />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["Quotation sent", "Contract signed"]);
    unmount();

    render(<LifecycleStepper steps={setTwo} variant="inline" />);
    const itemsTwo = screen.getAllByRole("listitem");
    expect(itemsTwo.map((item) => item.textContent)).toEqual(["Zebra crossing", "Aardvark review"]);
  });

  it("falls back to the matching PipelineStage label, then to its key, when a step has no label", () => {
    const stages: PipelineStage[] = [{ key: "signed", label: "Signed", order: 1 }];
    const steps: LifecycleStep[] = [
      { key: "signed", state: "DONE" },
      { key: "unmapped-key", state: "PENDING" },
    ];
    render(<LifecycleStepper steps={steps} stages={stages} variant="inline" />);
    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByText("unmapped-key")).toBeInTheDocument();
  });
});
