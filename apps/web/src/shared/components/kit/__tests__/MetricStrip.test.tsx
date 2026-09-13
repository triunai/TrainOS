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
 * The `accentCard` variant (tightening brief §15) — the gradient band that
 * spans a RecordHeader and is itself a dropdown.
 */
describe("MetricStrip accentCard", () => {
  const cells = [
    { label: "Value", value: "RM 48,000" },
    { label: "Agent", value: "Proposal Agent" },
    { label: "Confidence", value: "82%" },
    { label: "Margin", value: "41%" },
    { label: "Risk", value: "Medium" },
  ];

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("leaves the default variant exactly as it was", () => {
    const { container } = render(<MetricStrip cells={cells} />);

    /* No card, no gradient, no chevron — and the top rule the strip has always
       drawn under a RecordHeader is still there. */
    expect(container.querySelector("section")).toBeNull();
    expect(container.firstElementChild?.className).toContain("border-t");
    expect(container.firstElementChild?.className).not.toContain("surface-accent-gradient");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("spreads the cells evenly across the full width on the gradient token", () => {
    const { container } = render(<MetricStrip variant="accentCard" cells={cells} />);

    const card = container.querySelector("section") as HTMLElement;
    expect(card.className).toContain("bg-[image:var(--surface-accent-gradient)]");
    expect(card.className).toContain("rounded-[var(--radius-panel)]");
    /* No border: the tint is the boundary. */
    expect(card.className).not.toMatch(/(^|\s)border(\s|$)/);

    const grid = card.querySelector(".grid") as HTMLElement;
    /* Five equal columns, not a left-clustered flex row. `n` is data, so the
       template is an inline style rather than a class Tailwind never saw. */
    expect(grid.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
  });

  it("is a dropdown: the metrics stay visible, the children collapse", () => {
    const { container } = render(
      <MetricStrip variant="accentCard" cells={cells} expandable expandLabel="the full case">
        <p>Why this needs you</p>
      </MetricStrip>,
    );

    /* Default expanded. */
    const chevron = screen.getByRole("button", { name: "Hide the full case" });
    expect(chevron).toHaveAttribute("aria-expanded", "true");

    const region = container.querySelector("[data-open]") as HTMLElement;
    expect(region.dataset.open).toBe("true");

    fireEvent.click(chevron);

    expect(region.dataset.open).toBe("false");
    /* The summary row survives the close — that is the whole point. */
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the full case" })).toBeInTheDocument();
  });

  it("draws no chevron when it has nothing to disclose", () => {
    render(<MetricStrip variant="accentCard" cells={cells} expandable />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("remembers the open choice under its storage key", () => {
    const first = render(
      <MetricStrip variant="accentCard" cells={cells} expandable storageKey="approval">
        <p>case</p>
      </MetricStrip>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Hide/ }));
    first.unmount();

    render(
      <MetricStrip variant="accentCard" cells={cells} expandable storageKey="approval">
        <p>case</p>
      </MetricStrip>,
    );
    expect(screen.getByRole("button", { name: /Show/ })).toBeInTheDocument();
  });

  it("leaves no listener or timer behind on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const timeoutSpy = vi.spyOn(window, "setTimeout");

    const { unmount } = render(
      <MetricStrip variant="accentCard" cells={cells} expandable>
        <p>case</p>
      </MetricStrip>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Hide/ }));
    unmount();

    expect(ownListeners(addSpy)).toEqual([]);
    expect(timeoutSpy).not.toHaveBeenCalled();

    addSpy.mockRestore();
    timeoutSpy.mockRestore();
  });
});
