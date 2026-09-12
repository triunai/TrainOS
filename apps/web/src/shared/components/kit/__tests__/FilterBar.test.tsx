import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AppliedFilter } from "@trainos/contract";
import { FilterBar, DensityToggle } from "@/shared/components/kit/FilterBar";
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
