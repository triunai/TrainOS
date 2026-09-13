import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthShell } from "@/shared/components/kit/AuthShell";

describe("AuthShell", () => {
  it("draws the TrainOS identity once, the title as the h1, and no navigation", () => {
    render(
      <AuthShell title="Sign in to TrainOS" description="Use your work Google account.">
        <button type="button">Continue</button>
      </AuthShell>,
    );
    expect(screen.getAllByText("TrainOS")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to TrainOS" })).toBeVisible();
    expect(screen.getByText("Use your work Google account.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renders the note as plain text, never as a control", () => {
    render(<AuthShell title="Sign in" note="Email sign-in — coming soon" />);
    const note = screen.getByText("Email sign-in — coming soon");
    expect(note.tagName).toBe("P");
    expect(note.closest("button, a, [role='button']")).toBeNull();
  });

  it("omits the divider line when there is no note", () => {
    const { container } = render(<AuthShell title="Sign in" />);
    expect(container.querySelector("p.border-t")).toBeNull();
  });
});
