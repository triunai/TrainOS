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

  it("ArrowLeft wraps backwards, and Home/End jump to the ends", () => {
    const onSelect = vi.fn();
    render(<PillTabGroup tabs={tabs} activeId="a" onSelect={onSelect} />);
    const first = screen.getByRole("tab", { name: /All/ });

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledWith("c");

    onSelect.mockClear();
    fireEvent.keyDown(first, { key: "End" });
    expect(onSelect).toHaveBeenCalledWith("c");

    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Escalated/ }), { key: "Home" });
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  /* A roving tabindex that does not move focus strands the keyboard: the tab it
     left behind is no longer reachable by Tab, and the one it selected never
     received focus. */
  it("arrow keys move DOM focus onto the segment they select", () => {
    render(<PillTabGroup tabs={tabs} activeId="a" onSelect={vi.fn()} />);
    const first = screen.getByRole("tab", { name: /All/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Mine/ })).toHaveFocus();
  });

  it("clicking a segment selects it", () => {
    const onSelect = vi.fn();
    render(<PillTabGroup tabs={tabs} activeId="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: /Escalated/ }));
    expect(onSelect).toHaveBeenCalledWith("c");
  });

  /* The track is a segmented control, not a row of pills: the add affordance is
     a button rather than a fourth tab, so the tablist's children stay tabs. */
  it("renders the trailing + segment only when onAdd is given, and it is not a tab", () => {
    const { rerender } = render(<PillTabGroup tabs={tabs} activeId="a" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Add a view" })).not.toBeInTheDocument();

    const onAdd = vi.fn();
    rerender(<PillTabGroup tabs={tabs} activeId="a" onSelect={vi.fn()} onAdd={onAdd} />);
    const add = screen.getByRole("button", { name: "Add a view" });
    expect(add).not.toHaveAttribute("role", "tab");
    expect(screen.getAllByRole("tab")).toHaveLength(tabs.length);

    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  /* Brief §10/§10a: a BOUNDED control. The track carries the hairline and the
     panel radius, and the selected segment is a filled surface inset within it
     — never the pill radius, which belongs to status and tag chips. */
  it("draws one bounded track, and the selected segment is filled inside it", () => {
    const { container } = render(<PillTabGroup tabs={tabs} activeId="b" onSelect={vi.fn()} />);
    const track = container.firstElementChild as HTMLElement;

    expect(track.className).toContain("border-border");
    expect(track.className).toContain("rounded-[var(--radius-panel)]");
    expect(track.className).not.toContain("rounded-pill");

    const selected = screen.getByRole("tab", { name: /Mine/ });
    expect(selected.className).toContain("rounded-[var(--radius-control)]");
    expect(selected.className).toContain("bg-ai-tint-2");
    expect(selected.className).toContain("border-primary-border");
  });

  /* Brief rule 1: numbers are tabular, not mono. Mono is for refs and versions. */
  it("renders counts in tabular numerals rather than the mono face", () => {
    render(<PillTabGroup tabs={tabs} activeId="a" onSelect={vi.fn()} />);
    const count = screen.getByText("12");
    expect(count.className).toContain("tabular-nums");
    expect(count.className).not.toContain("font-mono");
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
