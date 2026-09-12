import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExternalMinimalShell, LanguageToggle } from "@/shared/components/kit/ExternalMinimalShell";

describe("ExternalMinimalShell", () => {
  it("renders orgName, contact and children, and has no navigation landmark", () => {
    render(
      <ExternalMinimalShell orgName="Acme Sdn Bhd" contact="hello@acme.my">
        <p>Proposal body</p>
      </ExternalMinimalShell>,
    );
    expect(screen.getByText("Acme Sdn Bhd")).toBeInTheDocument();
    expect(screen.getByText("hello@acme.my")).toBeInTheDocument();
    expect(screen.getByText("Proposal body")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("LanguageToggle", () => {
  it("marks the active option aria-pressed=true and calls onChange on click", () => {
    const onChange = vi.fn();
    render(<LanguageToggle value="EN" onChange={onChange} />);
    const en = screen.getByRole("button", { name: "EN" });
    const bm = screen.getByRole("button", { name: "BM" });
    expect(en).toHaveAttribute("aria-pressed", "true");
    expect(bm).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bm);
    expect(onChange).toHaveBeenCalledWith("BM");
  });
});
