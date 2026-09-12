import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContentCard, Fab } from "@/shared/components/kit/ContentCard";

describe("ContentCard", () => {
  it("renders title, eyebrow, actions and children", () => {
    render(
      <ContentCard title="Sessions" eyebrow="SESSIONS" actions={<button type="button">Add</button>}>
        <p>Session list body</p>
      </ContentCard>,
    );
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByText("SESSIONS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByText("Session list body")).toBeInTheDocument();
  });

  it("Fab has an accessible name and calls onClick", () => {
    const onClick = vi.fn();
    render(<Fab onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Ask TrainOS" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
