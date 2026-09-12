import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RequiredDocument } from "@trainos/contract";
import {
  ChecklistRow,
  CompletenessBar,
  DocumentChecklistRow,
} from "@/shared/components/kit/Checklist";

describe("ChecklistRow", () => {
  it("the box's accessible name is 'done' when done and 'not done' otherwise", () => {
    const { rerender } = render(<ChecklistRow label="Signed contract" done />);
    expect(screen.getByRole("img", { name: "done" })).toBeInTheDocument();

    rerender(<ChecklistRow label="Signed contract" done={false} />);
    expect(screen.getByRole("img", { name: "not done" })).toBeInTheDocument();
  });
});

describe("CompletenessBar", () => {
  it("renders a progressbar with the right percent", () => {
    render(<CompletenessBar value={0.42} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});

describe("DocumentChecklistRow", () => {
  const present: RequiredDocument = {
    type: "ATTENDANCE_SHEET",
    label: "Attendance sheet",
    status: "PRESENT",
  };
  const missing: RequiredDocument = {
    type: "TAX_INVOICE",
    label: "Tax invoice",
    status: "MISSING",
  };

  it("shows 'Present' and the View action for a present document", () => {
    const onView = vi.fn();
    render(<DocumentChecklistRow document={present} onView={onView} />);
    expect(screen.getByText("Present")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(onView).toHaveBeenCalled();
  });

  it("shows 'Missing' and the Attach action for a missing document", () => {
    const onAttach = vi.fn();
    render(<DocumentChecklistRow document={missing} onAttach={onAttach} />);
    expect(screen.getByText("Missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(onAttach).toHaveBeenCalled();
  });
});
