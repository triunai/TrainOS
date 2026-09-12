import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KeyboardShortcut } from "@/shared/components/kit/KeyboardShortcut";

describe("KeyboardShortcut", () => {
  it("renders each key as a <kbd> in press order", () => {
    const { container } = render(<KeyboardShortcut keys={["⌘", "K"]} />);
    const kbds = container.querySelectorAll("kbd");
    expect(Array.from(kbds).map((el) => el.textContent)).toEqual(["⌘", "K"]);
  });

  it("renders a single key binding like esc", () => {
    render(<KeyboardShortcut keys={["esc"]} action="close" />);
    expect(screen.getByText("esc")).toBeInTheDocument();
    expect(screen.getByText("close")).toBeInTheDocument();
  });

  it("omits the action text when none is given", () => {
    const { container } = render(<KeyboardShortcut keys={["↵"]} />);
    // Only the outer wrapper and the keys group remain — no trailing action span.
    expect(container.querySelectorAll("kbd")).toHaveLength(1);
    expect(container.textContent).toBe("↵");
  });

  it("renders every key of a multi-key combo, e.g. ⌘↵", () => {
    render(<KeyboardShortcut keys={["⌘", "↵"]} action="open in drawer" />);
    expect(screen.getByText("⌘")).toBeInTheDocument();
    expect(screen.getByText("↵")).toBeInTheDocument();
    expect(screen.getByText("open in drawer")).toBeInTheDocument();
  });
});
