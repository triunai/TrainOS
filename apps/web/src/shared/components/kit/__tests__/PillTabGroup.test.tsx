import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SavedView } from "@trainos/contract";
import { PillTabGroup } from "@/shared/components/kit/PillTabGroup";
import { tabsFromViews, type PillTab } from "@/shared/components/kit/adapters";

const tabs: PillTab[] = [
  { id: "a", label: "All", count: 12 },
  { id: "b", label: "Mine", count: 3 },
  { id: "c", label: "Escalated", count: 0 },
];

describe("PillTabGroup", () => {
  it("renders role=tablist with the given label, and counts render", () => {
    render(<PillTabGroup tabs={tabs} activeId="a" onSelect={vi.fn()} label="Views" />);
    expect(screen.getByRole("tablist", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("the active tab has aria-selected true and tabIndex 0, others -1", () => {
    render(<PillTabGroup tabs={tabs} activeId="a" onSelect={vi.fn()} />);
    const active = screen.getByRole("tab", { name: /All/ });
    const inactive = screen.getByRole("tab", { name: /Mine/ });
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveAttribute("tabIndex", "0");
    expect(inactive).toHaveAttribute("aria-selected", "false");
    expect(inactive).toHaveAttribute("tabIndex", "-1");
  });

  it("ArrowRight moves selection to the next tab, and wraps from the last to the first", () => {
    const onSelect = vi.fn();
    render(<PillTabGroup tabs={tabs} activeId="a" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /All/ }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("b");

    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Escalated/ }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("tabsFromViews maps SavedView[] onto tabs with id/label/count", () => {
    const views: SavedView[] = [
      {
        id: "v1",
        label: "All leads",
        object: "LEAD",
        count: 7,
        isDefault: true,
        filters: [],
        columns: [],
      },
    ];
    expect(tabsFromViews(views)).toEqual([{ id: "v1", label: "All leads", count: 7 }]);
  });
});
