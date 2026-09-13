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
    expect(track.className).toContain("rounded-panel");
    expect(track.className).not.toContain("rounded-pill");

    const selected = screen.getByRole("tab", { name: /Mine/ });
    expect(selected.className).toContain("rounded-control");
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

/**
 * §10a as amended on 13 Sep: segments size to their content over a 64px floor.
 *
 * WHAT THIS CAN AND CANNOT CHECK. The suite runs in jsdom, which has no layout
 * engine — every `getBoundingClientRect()` here returns zero — so no test in
 * this file can measure that an eight-segment track comes in under 760px. The
 * real measurement is a browser one: the engagements track's eight realistic
 * statuses measure 776px at 1440 with this geometry, against 973px under the
 * withdrawn 120px floor. 776 is over the 760 the ruling estimated, and the
 * honest number is the measured one — engagements is still 8px short of
 * holding one row, and participants, whose labels are longer, 38px short.
 *
 * What IS checkable here is the geometry contract that produces that number,
 * and the specific regression: the floor coming back. A returning `min-w-[120px]`
 * is what put 973px on the page, so it fails here rather than in somebody's
 * screenshot three screens later.
 */
describe("PillTabGroup segment width (§10a, amended)", () => {
  const EIGHT: PillTab[] = [
    { id: "all", label: "All", count: 9 },
    { id: "proposed", label: "Proposed", count: 0 },
    { id: "confirmed", label: "Confirmed", count: 1 },
    { id: "scheduled", label: "Scheduled", count: 1 },
    { id: "delivery", label: "In delivery", count: 0 },
    { id: "delivered", label: "Delivered", count: 4 },
    { id: "closed", label: "Closed", count: 1 },
    { id: "cancelled", label: "Cancelled", count: 2 },
  ];

  it("floors a segment at 64px and never at the withdrawn 120px", () => {
    render(
      <PillTabGroup tabs={EIGHT} activeId="all" onSelect={vi.fn()} label="Engagement status" />,
    );

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("min-w-[64px]");
      /* The floor that cost the engagements list its layout. */
      expect(tab.className).not.toContain("min-w-[120px]");
    }
  });

  it("keeps §10a's 12px horizontal padding, which the content width is measured over", () => {
    render(
      <PillTabGroup tabs={EIGHT} activeId="all" onSelect={vi.fn()} label="Engagement status" />,
    );

    /* px-3 is 12px. The floor means nothing without the padding it sits over:
       drop to px-1 and eight segments fit while looking cramped, raise to px-6
       and the 973px problem returns by another route. */
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("px-3");
    }
  });

  it("renders every segment's label and count, so narrowing did not truncate them", () => {
    render(
      <PillTabGroup tabs={EIGHT} activeId="all" onSelect={vi.fn()} label="Engagement status" />,
    );

    /* A width fix that clipped "In delivery" to "In del…" would pass the two
       assertions above. The labels are what the track is sized FOR. */
    for (const tab of EIGHT) {
      expect(screen.getByRole("tab", { name: new RegExp(tab.label) })).toBeInTheDocument();
    }
  });
});
