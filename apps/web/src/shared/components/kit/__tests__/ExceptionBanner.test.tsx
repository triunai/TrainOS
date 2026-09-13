import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExceptionBanner } from "@/shared/components/kit/ExceptionBanner";

describe("ExceptionBanner", () => {
  it("is an alert when it is a warning and a status when it is information", () => {
    const { rerender } = render(<ExceptionBanner severity="WARN" title="A source changed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("A source changed");

    rerender(<ExceptionBanner severity="INFO" title="No change" />);
    expect(screen.getByRole("status")).toHaveTextContent("No change");
  });

  it("draws no disclosure when there is nothing behind the banner", () => {
    render(<ExceptionBanner severity="WARN" title="A source changed" subtitle="One sentence." />);
    expect(screen.queryByRole("button", { name: "Why?" })).not.toBeInTheDocument();
  });

  it("keeps the mechanics behind Why?, closed until asked", () => {
    render(
      <ExceptionBanner
        severity="WARN"
        title="Circular 09/2026 has changed"
        subtitle="Existing answers remain available."
        why="It is quarantined from rule extraction until the changes are reviewed."
      />,
    );

    const why = screen.getByRole("button", { name: "Why?" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    /* `Collapse` takes the closed region out of the accessibility tree, so the
       prose is present in the DOM and unreachable rather than rendered. */
    expect(screen.getByText(/quarantined from rule extraction/)).toBeInTheDocument();

    fireEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(why.getAttribute("aria-controls") ?? "")).toHaveTextContent(
      /quarantined from rule extraction/,
    );
  });
});
