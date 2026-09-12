import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PrimaryButton,
  SecondaryButton,
  GhostButton,
  DangerButton,
  IconButton,
} from "@/shared/components/kit/Button";
import { resetPrimaries } from "@/shared/components/kit/useSinglePrimary";

describe("Button family", () => {
  beforeEach(() => {
    resetPrimaries();
  });

  it("renders a PrimaryButton with a solid fill class", () => {
    render(<PrimaryButton>Save</PrimaryButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("bg-primary");
  });

  it("renders a SecondaryButton without the primary fill", () => {
    render(<SecondaryButton>Cancel</SecondaryButton>);
    const button = screen.getByRole("button", { name: "Cancel" });
    expect(button.className).not.toContain("bg-primary");
  });

  it("renders a GhostButton with a transparent border", () => {
    render(<GhostButton>Clear filters</GhostButton>);
    const button = screen.getByRole("button", { name: "Clear filters" });
    expect(button.className).toContain("border-transparent");
  });

  it("renders a DangerButton with a danger text colour, not a resting fill", () => {
    render(<DangerButton>Delete</DangerButton>);
    const button = screen.getByRole("button", { name: "Delete" });
    const tokens = button.className.split(/\s+/);
    expect(tokens).toContain("text-danger");
    // Resting state is the plain white/bordered card, not a solid danger fill —
    // the tint only shows up behind a `hover:` prefix.
    expect(tokens).toContain("bg-card");
    expect(tokens).not.toContain("bg-danger");
  });

  it("gives an IconButton its accessible name from `label`, not visible text", () => {
    render(<IconButton label="Close drawer" icon={<span>x</span>} />);
    const button = screen.getByRole("button", { name: "Close drawer" });
    expect(button).toHaveAttribute("title", "Close drawer");
  });

  it("fires onClick like a normal button", () => {
    const onClick = vi.fn();
    render(<PrimaryButton onClick={onClick}>Go</PrimaryButton>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<SecondaryButton>Reset</SecondaryButton>);
    expect(screen.getByRole("button", { name: "Reset" })).toHaveAttribute("type", "button");
  });
});
