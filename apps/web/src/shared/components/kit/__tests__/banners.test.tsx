import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DiffLine } from "@trainos/contract";
import { ExceptionBanner } from "@/shared/components/kit/ExceptionBanner";
import { DiffBlock } from "@/shared/components/kit/DiffBlock";

describe("ExceptionBanner", () => {
  it.each(["WARN", "DANGER", "ALERT"] as const)(
    "renders role=alert for %s, with the title, subtitle and action",
    (severity) => {
      render(
        <ExceptionBanner
          severity={severity}
          title="SLA at risk"
          subtitle="Due in 2 hours"
          action={<button>Fix now</button>}
        />,
      );
      const banner = screen.getByRole("alert");
      expect(banner).toHaveTextContent("SLA at risk");
      expect(banner).toHaveTextContent("Due in 2 hours");
      expect(screen.getByRole("button", { name: "Fix now" })).toBeInTheDocument();
    },
  );

  it("renders role=status for INFO", () => {
    render(<ExceptionBanner severity="INFO" title="Heads up" />);
    expect(screen.getByRole("status")).toHaveTextContent("Heads up");
  });
});

describe("DiffBlock", () => {
  const LINES: DiffLine[] = [
    { op: "ADD", entity: "Invoice", description: "Create invoice INV-0042" },
    { op: "REMOVE", entity: "Discount", description: "Remove pending discount" },
    { op: "UPDATE", entity: "Opportunity", description: "Move stage to Won" },
  ];

  it("renders one list item per DiffLine with its description", () => {
    render(<DiffBlock lines={LINES} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.getByText("Create invoice INV-0042")).toBeInTheDocument();
  });

  it("hides each op glyph from assistive tech and exposes the op word via accessible text", () => {
    render(<DiffBlock lines={LINES} />);
    const items = screen.getAllByRole("listitem");

    const glyph = items[0].querySelector('[aria-hidden="true"]');
    expect(glyph).toHaveTextContent("+");
    expect(items[0]).toHaveTextContent("add");
    expect(items[1]).toHaveTextContent("remove");
    expect(items[2]).toHaveTextContent("update");
  });
});
