import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AppliedFilter } from "@trainos/contract";
import { FilterBar, DensityToggle, FilterSelect } from "@/shared/components/kit/FilterBar";
import { chipsFromFilters, type FilterChipModel } from "@/shared/components/kit/adapters";

describe("FilterBar", () => {
  it("a normal chip has a remove button naming the filter, and clicking it calls onRemove with the id", () => {
    const onRemove = vi.fn();
    const filters: FilterChipModel[] = [{ id: "stage:eq", label: "Stage", value: "Proposal sent" }];
    render(<FilterBar filters={filters} onRemove={onRemove} />);
    const removeButton = screen.getByRole("button", { name: "Remove filter Stage: Proposal sent" });
    fireEvent.click(removeButton);
    expect(onRemove).toHaveBeenCalledWith("stage:eq");
  });

  it("a locked chip has no remove button because it comes from the saved view", () => {
    const onRemove = vi.fn();
    const filters: FilterChipModel[] = [
      { id: "stage:eq", label: "Stage", value: "Proposal sent", locked: true },
    ];
    render(<FilterBar filters={filters} onRemove={onRemove} />);
    expect(screen.queryByRole("button", { name: /Remove filter/ })).not.toBeInTheDocument();
  });

  it("renders the 'N of M shown' counter when both numbers are given", () => {
    render(<FilterBar filters={[]} shown={4} total={10} />);
    expect(screen.getByText("4 of 10 shown")).toBeInTheDocument();
  });

  it("chipsFromFilters marks a VIEW-sourced filter as locked and a REQUEST-sourced filter as not locked", () => {
    const filters: AppliedFilter[] = [
      { field: "stage", op: "eq", value: "PROPOSAL_SENT", source: "VIEW" },
      { field: "owner", op: "eq", value: "u1", source: "REQUEST" },
    ];
    const chips = chipsFromFilters(filters, (filter) => ({
      label: filter.field,
      value: String(filter.value),
    }));
    expect(chips[0].locked).toBe(true);
    expect(chips[1].locked).toBe(false);
  });
});

describe("DensityToggle", () => {
  it("the active option has aria-pressed true, and clicking the other calls onChange", () => {
    const onChange = vi.fn();
    render(<DensityToggle value="comfortable" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "comfortable" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "compact" }));
    expect(onChange).toHaveBeenCalledWith("compact");
  });
});

/**
 * A native `<select>` is as wide as its WIDEST OPTION, and a facet whose
 * options are records rather than words sizes itself to the longest record in
 * the data. On the participants list the engagement facet's options are cohort
 * titles, so the control grew to roughly 500px inside a filter group with
 * 311px to spend, and because that group is right-aligned the surplus hung off
 * its left edge and painted over the segmented tabs (user screenshot 74.png).
 *
 * The cap is the fix, and it has to be a cap rather than a fixed width: the
 * department facet beside it is 140px and should stay 140px.
 */
describe("FilterSelect width", () => {
  const LONG = [
    { value: "ALL", label: "Any engagement" },
    {
      value: "ENG-0001",
      label: "Advanced Leadership and Executive Presence for Senior Managers, Cohort 3",
    },
  ];

  it("caps a select whose options are records, so one long option cannot size the row", () => {
    render(<FilterSelect label="Engagement" value="ALL" options={LONG} onChange={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Engagement" });

    expect(select.className).toContain("max-w-[240px]");
    /* A flex item's automatic minimum is its content, which is exactly what
       made the cap necessary — without this the max-width cannot bind. */
    expect(select.className).toContain("min-w-0");
    /* Capped and not truncated is a clipped word, not a narrower control. */
    expect(select.className).toContain("truncate");
  });

  it("keeps every option selectable, so the cap narrowed the control and not the choice", () => {
    render(<FilterSelect label="Engagement" value="ALL" options={LONG} onChange={vi.fn()} />);

    for (const option of LONG) {
      expect(screen.getByRole("option", { name: option.label })).toBeInTheDocument();
    }
  });
});
