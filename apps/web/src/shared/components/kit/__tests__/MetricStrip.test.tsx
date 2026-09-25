import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Money, ReceivablesAging } from "@trainos/contract";
import { MetricStrip, AgingStrip } from "@/shared/components/kit/MetricStrip";

/**
 * React DOM registers a window `error` handler of its own for as long as a
 * tree is mounted. It belongs to the test environment, not to the component
 * under test, so it is filtered out here — anything else this spy catches is a
 * listener the component added and did not take back.
 */
function ownListeners(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter((call) => call[0] !== "error");
}

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

/**
 * The `accent` variant (tightening brief §15a) — the strip re-inked for the
 * blue record card. Not a card, and it owns no chevron: §15a allows exactly one
 * and it belongs to `RecordHeader`.
 */
describe("MetricStrip accent", () => {
  const cells = [
    { label: "Value", value: "RM 48,000" },
    { label: "Agent", value: "Proposal Agent" },
    { label: "Confidence", value: "82%" },
    { label: "Margin", value: "41%" },
    { label: "Risk", value: "Medium", sub: "single trainer" },
  ];

  it("leaves the default variant exactly as it was", () => {
    const { container } = render(<MetricStrip cells={cells} />);

    expect(container.firstElementChild?.className).toContain("border-t");
    expect(container.firstElementChild?.className).not.toContain("grid");
    expect(screen.getByText("Value").className).toContain("text-ink-muted");
  });

  it("spreads the cells evenly rather than clustering them left", () => {
    const { container } = render(<MetricStrip variant="accent" cells={cells} />);

    const grid = container.querySelector(".grid") as HTMLElement;
    /* `n` is data, so the template is an inline style rather than a class
       Tailwind never saw and never generated. */
    expect(grid.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
  });

  it("paints no card, no chevron and no per-cell slab", () => {
    const { container } = render(<MetricStrip variant="accent" cells={cells} />);

    /* Not a card: no section, no radius, no gradient of its own. The card is
       the header around it. */
    expect(container.querySelector("section")).toBeNull();
    expect(container.innerHTML).not.toContain("surface-accent-gradient");
    expect(container.innerHTML).not.toContain("rounded-panel");
    /* No chevron — §15a allows exactly one and RecordHeader owns it. */
    expect(screen.queryByRole("button")).toBeNull();

    /* §15a "no per-cell slabs": the cells are windows onto one gradient, so
       none of them paints a background. */
    const boxes = [...(container.querySelector(".grid")?.children ?? [])] as HTMLElement[];
    expect(boxes).toHaveLength(5);
    for (const box of boxes) {
      expect(box.className).not.toMatch(/\bbg-/);
    }

    /* Four hairlines for five cells — the first has none. */
    const ruled = boxes.filter((box) =>
      box.className.includes("border-[rgb(var(--on-accent)/0.15)]"),
    );
    expect(ruled).toHaveLength(4);
  });

  it("writes every level in full white, never a translucent muted step", () => {
    const { container } = render(<MetricStrip variant="accent" cells={cells} />);

    /* 70% white over the accent fill (#D53900 on this branch) fails AA at
       the 11px the captions use, so there is no muted step on this surface
       at all. */
    expect(container.querySelector(".text-ink-muted")).toBeNull();
    expect(screen.getByText("Value").className).toContain("text-[rgb(var(--on-accent))]");
    expect(screen.getByText("RM 48,000").className).toContain("text-[rgb(var(--on-accent))]");
    /* The sub-caption the artboard draws under RISK keeps the same white. */
    expect(screen.getByText("single trainer").className).toContain("text-[rgb(var(--on-accent))]");
  });
});
