import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb } from "@/shared/components/kit/Breadcrumb";

describe("Breadcrumb", () => {
  const items = [
    { label: "Organisations", href: "/orgs" },
    { label: "Acme Sdn Bhd", href: "/orgs/acme" },
    { label: "Invoice #114" },
  ];

  it("has an accessible name of 'Breadcrumb' on the nav", () => {
    render(<Breadcrumb items={items} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  it("marks the last crumb aria-current='page' and renders it as a non-link", () => {
    render(<Breadcrumb items={items} />);
    const last = screen.getByText("Invoice #114");
    expect(last).toHaveAttribute("aria-current", "page");
    expect(last.tagName).not.toBe("A");
  });

  it("renders earlier crumbs as links", () => {
    render(<Breadcrumb items={items} />);
    const first = screen.getByRole("link", { name: "Organisations" });
    const second = screen.getByRole("link", { name: "Acme Sdn Bhd" });
    expect(first).toHaveAttribute("href", "/orgs");
    expect(second).toHaveAttribute("href", "/orgs/acme");
  });
});
