import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListToolbar } from "@/shared/components/kit/ListToolbar";
import { PillTabGroup } from "@/shared/components/kit/PillTabGroup";
import { FilterBar, FilterSearch } from "@/shared/components/kit/FilterBar";
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

  it("wraps on content rather than pinning one row at a breakpoint", () => {
    const { container } = renderToolbar();
    const row = container.querySelector("[data-list-toolbar]");

    expect(row).toHaveClass("flex-wrap");

    /* `min-[1100px]:flex-nowrap` is what this used to assert, and it was the
       bug: a pinned row cannot wrap, so on the engagements list — eight status
       segments — the filter group was squeezed to 155px and its search box
       spilled leftward across the last two tabs. A breakpoint cannot know how
       many segments a track carries. Neither half may pin the row. */
    expect(row?.className).not.toContain("flex-nowrap");
    const right = container.querySelector("[data-list-toolbar] > div:nth-of-type(2)");
    expect(right?.className).not.toContain("flex-nowrap");
  });

  /* jsdom has no layout engine, so the wrap itself is a browser measurement.
     The BASIS is what decides it, and that is assertable here. Measured at
     1440x900 in both themes, against the page's real toolbar content box:

       screen         segments  track   box     headroom at 300
       proposals      7         617px   1144px  +211
       engagements    8         776px   1133px  +41
       participants   8         806px   1133px  +11

     Participants is the binding case: three-digit counts widen its segments,
     and its scroller takes a 13px gutter, so it has 1133px rather than 1144.
     360 missed it by 49px and 320 still missed by 9; 300 is what closed it. */
  it("sizes the filter group's basis so the widest real track still holds one row", () => {
    const { container } = renderToolbar();
    const right = container.querySelector("[data-list-toolbar] > div:nth-of-type(2)");

    expect(right?.className).toContain("basis-[300px]");
    expect(right?.className).not.toContain("basis-[360px]");
    /* `grow` is what spends the headroom, so the count still reaches the right
       edge on a screen with a narrow track. Without it 300 would be the width. */
    expect(right?.className).toContain("grow");
  });

  /* The basis is only safe because the group's contents can live inside it.
     `FilterSearch` prefers 184px and may shrink to 160, which is what lets a
     300px group carry the search, the selects and the counter on one line
     instead of collapsing the input to its intrinsic minimum. Drop this floor
     and 300 goes back to squeezing — the 155px bug this row was written for. */
  it("lets the search shrink to 160px inside the group rather than to nothing", () => {
    render(
      <ListToolbar
        tabs={
          <PillTabGroup
            label="Views"
            activeId="a"
            onSelect={vi.fn()}
            tabs={[{ id: "a", label: "All", count: 6 }]}
          />
        }
        filters={
          <FilterBar filters={[]} shown={1} total={6}>
            <FilterSearch label="Search" value="" onChange={vi.fn()} />
          </FilterBar>
        }
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Search" });
    expect(search.className).toContain("w-[184px]");
    expect(search.className).toContain("min-w-[160px]");
    /* Without `max-w-full` a fixed width cannot yield at all, which is how the
       input came to sit on top of the tabs in the first place. */
    expect(search.className).toContain("max-w-full");
  });

  /* THE OVERLAP BUG, from the user's participants screenshot (74.png): the
     search box and both selects painted straight across the segmented tabs.

     jsdom cannot lay this out, so the assertion is on the property that makes
     the overlap unrepresentable rather than on pixels. `min-w-0` lets a flex
     item be laid out NARROWER THAN ITS CONTENTS; the item still counts as
     fitting, so the line never breaks, and `justify-end` then hangs the surplus
     off the group's LEFT edge, over the tabs. `min-w-min` floors the group at
     its own min-content instead, so a group that cannot fit beside the track
     has no way to pretend it fits and wraps to its own row.

     Measured at 1440 and 1280, both themes, after this change: no control on
     any of the three screens starts before the track ends, and nothing spills
     past the toolbar's right edge either. */
  it("floors the filter group at its content, so a row that cannot fit wraps instead of overlapping", () => {
    const { container } = renderToolbar();
    const right = container.querySelector("[data-list-toolbar] > div:nth-of-type(2)");

    expect(right?.className).toContain("min-w-min");
    expect(right?.className).not.toContain("min-w-0");
    /* The wrap needs somewhere to go: both the row and the group must stay
       wrappable, or the floor turns an overlap into a horizontal overflow. */
    expect(container.querySelector("[data-list-toolbar]")).toHaveClass("flex-wrap");
    expect(right?.className).toContain("flex-wrap");
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

/**
 * The call-site guard.
 *
 * Six screens wrapped the toolbar in a `border-b` div, which put a hairline
 * immediately above the one `DataTable`'s header already draws — two rules a
 * row apart with nothing between them, which is the count brief §10b exists to
 * remove, arriving from a different pair of elements. It was reported as
 * inherent to the toolbar; it was six wrappers against seventeen clean call
 * sites, so it is a divergence, and CLAUDE.md calls a second variant of one
 * pattern a defect rather than a style.
 *
 * A render test cannot see this: every one of those screens rendered a correct
 * ListToolbar. The defect lived in the element AROUND it, so the assertion has
 * to read the call sites. This is the cheap version of that — a scan, not a
 * parser — and it checks the WRAPPER only.
 *
 * Not the toolbar's own `className`, deliberately. A border there is the
 * screen's call and two screens make it correctly: `EnquiryInboxPage` and
 * `FollowUpQueuePage` are master/detail, so a `SplitWorkspace` follows the
 * toolbar rather than a `DataTable`, and their rule is the ONLY one on the page
 * — it marks where the page's chrome stops and the two panes start. Banning it
 * outright would have flagged both, which is how this scan was first written
 * and why it is not written that way now. The wrapper has no such legitimate
 * use: it is a second box drawn around a component that already has a row.
 */
/**
 * `import.meta.url` is project-relative under Vitest's transform, so it
 * resolves to `/src/features` and scandir fails. Anchoring on `process.cwd()`
 * instead, and trying the monorepo root as well, means the scan runs whether it
 * was started from `apps/web` or from the root script.
 */
const FEATURES = (() => {
  const candidates = [
    join(process.cwd(), "src/features"),
    join(process.cwd(), "apps/web/src/features"),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error(`features/ not found from ${process.cwd()}`);
  return found;
})();

function tsxFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__screenshots__" ? [] : tsxFilesIn(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** A line that OPENS an element and paints a border, ignoring one it also closes. */
const opensABorderedBox = (line: string) =>
  /<(?:div|section|header|aside)\b[^>]*className="[^"]*\bborder/.test(line) && !line.includes("</");

const isCommentary = (line: string) =>
  /^\s*(?:\{?\/\*|\*|\/\/)/.test(line) || /\*\/\}?\s*$/.test(line);

describe("every ListToolbar call site", () => {
  it("sits in no bordered box, because the table header already draws that rule", () => {
    const offenders: string[] = [];

    for (const file of tsxFilesIn(FEATURES)) {
      const lines = readFileSync(file, "utf8").split("\n");

      lines.forEach((line, index) => {
        if (!line.includes("<ListToolbar")) return;
        const where = `${relative(FEATURES, file)}:`;

        /* The wrapper. Commentary between the two is common and is skipped, so
           a bordered div does not hide behind an explanatory comment. */
        for (let back = index - 1; back >= 0 && back >= index - 6; back -= 1) {
          const previous = lines[back] ?? "";
          if (!previous.trim() || isCommentary(previous)) continue;
          if (opensABorderedBox(previous)) offenders.push(`${where}${back + 1} bordered wrapper`);
          break;
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("would catch the wrapper it was written for, so it cannot pass vacuously", () => {
    /* The exact line removed from all six screens. A scan that no longer fires
       on it is a scan that has stopped working, and nothing else in this file
       would say so. */
    expect(opensABorderedBox('      <div className="border-b border-border px-5 py-3">')).toBe(
      true,
    );
    expect(opensABorderedBox('      <div className="border-b border-border px-5 pb-3">')).toBe(
      true,
    );

    /* And does not fire on the gutter-only wrapper that replaced it, nor on a
       bordered element that opens and closes on the one line. */
    expect(opensABorderedBox('      <div className="px-5 py-3">')).toBe(false);
    expect(opensABorderedBox('      <div className="border-b px-5">text</div>')).toBe(false);
  });

  it("finds the call sites it claims to be scanning", () => {
    /* Without this, the scan above passes just as happily when the glob breaks
       and it reads nothing at all. */
    const withToolbar = tsxFilesIn(FEATURES).filter((file) =>
      readFileSync(file, "utf8").includes("<ListToolbar"),
    );

    expect(withToolbar.length).toBeGreaterThanOrEqual(17);
  });
});
