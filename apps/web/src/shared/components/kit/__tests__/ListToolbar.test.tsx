import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListToolbar } from "@/shared/components/kit/ListToolbar";
import { PillTabGroup } from "@/shared/components/kit/PillTabGroup";
import { FilterBar } from "@/shared/components/kit/FilterBar";
import { PrimaryButton } from "@/shared/components/kit/Button";

function renderToolbar(actions?: React.ReactNode) {
  return render(
    <ListToolbar
      tabs={
        <PillTabGroup
          label="Views"
          activeId="a"
          onSelect={vi.fn()}
          tabs={[
            { id: "a", label: "All", count: 6 },
            { id: "b", label: "Mine", count: 2 },
          ]}
        />
      }
      filters={<FilterBar filters={[]} shown={1} total={6} />}
      {...(actions === undefined ? {} : { actions })}
    />,
  );
}

describe("ListToolbar", () => {
  it("puts the tab group and the filter controls inside one row container", () => {
    renderToolbar();

    const tablist = screen.getByRole("tablist", { name: "Views" });
    const filters = screen.getByRole("group", { name: "Filters" });

    const row = tablist.closest("[data-list-toolbar]");
    expect(row).not.toBeNull();
    expect(filters.closest("[data-list-toolbar]")).toBe(row);
  });

  it("keeps the counter in the row, so the row states the result of both halves", () => {
    renderToolbar();

    const counter = screen.getByText("1 of 6 shown");
    expect(counter.closest("[data-list-toolbar]")).not.toBeNull();
  });

  it("stays on one row from 1100px and wraps below it", () => {
    const { container } = renderToolbar();
    const row = container.querySelector("[data-list-toolbar]");

    expect(row).toHaveClass("flex-wrap");
    expect(row).toHaveClass("min-[1100px]:flex-nowrap");
  });

  it("strips the FilterBar's own row padding, which this row already owns", () => {
    const { container } = renderToolbar();
    const right = container.querySelector("[data-list-toolbar] > div:nth-of-type(2)");

    expect(right?.className).toContain("[&_[aria-label='Filters']]:px-0");
  });

  it("renders actions after the filters when a screen has any", () => {
    renderToolbar(<PrimaryButton onClick={vi.fn()}>Review next</PrimaryButton>);

    const button = screen.getByRole("button", { name: "Review next" });
    const filters = screen.getByRole("group", { name: "Filters" });
    expect(button.closest("[data-list-toolbar]")).toBe(filters.closest("[data-list-toolbar]"));
    expect(filters.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders without a filter slot, for a list whose tabs are its only narrowing", () => {
    render(
      <ListToolbar
        tabs={
          <PillTabGroup
            label="Views"
            activeId="a"
            onSelect={vi.fn()}
            tabs={[{ id: "a", label: "All" }]}
          />
        }
      />,
    );

    expect(screen.getByRole("tablist", { name: "Views" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filters" })).toBeNull();
  });
});
