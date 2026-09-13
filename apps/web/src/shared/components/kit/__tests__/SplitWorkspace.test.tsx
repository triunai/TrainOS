import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SplitWorkspace } from "@/shared/components/kit/SplitWorkspace";

function renderWorkspace(detailHeader?: React.ReactNode) {
  return render(
    <SplitWorkspace
      listLabel="Enquiry queue"
      list={
        <ul>
          <li>A row</li>
        </ul>
      }
      detailLabel="Enquiry preview"
      {...(detailHeader === undefined ? {} : { detailHeader })}
      detail={<p>The record</p>}
    />,
  );
}

describe("SplitWorkspace", () => {
  /* Brief §16b. The premise the withdrawn SPLIT_HEADER_HEIGHT encoded was that
     the two panes share one header row. These four assertions are the ruling
     that replaced it, and each one would pass silently if only eyeballed. */

  it("gives the list pane no header block of its own", () => {
    renderWorkspace(<h2>Quotation request</h2>);

    const list = screen.getByRole("region", { name: "Enquiry queue" });

    /* The list pane carries exactly what the screen handed it. A header block
       appearing here is the shape the ruling deleted, and the count that used
       to live in it is the tab group's job. */
    expect(within(list).queryByRole("heading")).toBeNull();
    expect(within(list).queryByRole("group", { name: "Filters" })).toBeNull();
    expect(within(list).queryByText(/\d+ of \d+ shown/)).toBeNull();
  });

  it("sticks the detail header to the top of the detail pane's own scroll", () => {
    renderWorkspace(<h2>Quotation request</h2>);

    const detail = screen.getByRole("region", { name: "Enquiry preview" });
    const header = within(detail)
      .getByRole("heading", { name: "Quotation request" })
      .closest("[data-split-detail-header]");

    expect(header).not.toBeNull();
    expect(header).toHaveClass("sticky");
    expect(header).toHaveClass("top-0");

    /* Sticky is positioned against the nearest scrolling ancestor, so the
       scroll has to be on the pane itself — not on a body element inside it,
       and not on the grid. Put it anywhere else and the header scrolls away. */
    expect(header?.closest("[data-split-detail]")).toBe(detail);
    expect(detail).toHaveClass("overflow-y-auto");
  });

  it("scrolls each pane independently", () => {
    const { container } = renderWorkspace(<h2>Quotation request</h2>);

    expect(screen.getByRole("region", { name: "Enquiry queue" })).toHaveClass("overflow-y-auto");
    expect(screen.getByRole("region", { name: "Enquiry preview" })).toHaveClass("overflow-y-auto");

    /* The grid is not a third scroller, and `min-h-0` is what lets the panes
       shrink to their track instead of growing the page. */
    const grid = container.querySelector("[data-split-workspace]");
    expect(grid).toHaveClass("min-h-0");
    expect(grid?.className).not.toContain("overflow");
    expect(grid).toHaveClass("grid-cols-[minmax(360px,40%)_1fr]");

    /* The row track is stated, not inherited. Without it the single implicit
       row is `auto` — sized by content, and only reaching the bottom of the
       workspace because `align-content: normal` stretches it, which needs the
       grid to have taken a definite height from a `flex-1` two levels up. The
       leads/contacts lane saw the pane rule stop at the last list item on a
       short list. `minmax(0, 1fr)` says the same thing outright. */
    expect(grid).toHaveClass("grid-rows-[minmax(0,1fr)]");
  });

  it("draws no hairline under a detail pane with nothing selected", () => {
    const { container } = renderWorkspace();

    expect(container.querySelector("[data-split-detail-header]")).toBeNull();
    expect(screen.getByText("The record")).toBeInTheDocument();
  });
});
