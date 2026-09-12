import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniBar } from "@/shared/components/kit/Bar";

describe("MiniBar", () => {
  it("renders a progressbar with the accessible name from `label`", () => {
    render(<MiniBar value={0.5} label="Health" />);
    const bar = screen.getByRole("progressbar", { name: "Health" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("clamps a value above 1 to a full bar", () => {
    render(<MiniBar value={1.4} label="Monthly spend" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("clamps a value below 0 to an empty bar", () => {
    render(<MiniBar value={-0.3} label="Completeness" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("defaults to the ink fill for the `within` state", () => {
    const { container } = render(<MiniBar value={0.5} label="Health" />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.className).toContain("bg-ink");
  });

  it("uses the danger fill only when state is explicitly `over`", () => {
    const { container } = render(<MiniBar value={0.9} label="Budget" state="over" />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.className).toContain("bg-danger");
  });

  it("announces a custom valueText when provided", () => {
    render(<MiniBar value={0.64} label="Monthly spend" valueText="RM 96 of RM 150" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "RM 96 of RM 150");
  });
});
