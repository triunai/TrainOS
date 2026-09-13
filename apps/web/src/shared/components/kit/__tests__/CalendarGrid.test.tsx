import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarGrid, CalendarList } from "@/shared/components/kit/CalendarGrid";
import {
  addDays,
  calendarDays,
  dayKeyOf,
  daysCovered,
  periodLabel,
  shiftPeriod,
  startOfWeek,
} from "@/shared/components/kit/calendar";

const ENTRIES = [
  { id: "a", day: "2026-11-12", title: "Leading Through Change", meta: "Aurora HQ" },
  { id: "b", day: "2026-11-13", title: "Leading Through Change", meta: "Aurora HQ" },
];

describe("the calendar's date arithmetic", () => {
  /* Every one of these is UTC. The suite runs in whatever zone the machine is
     in, so a helper that leaked to the local clock would fail here on a CI box
     west of Greenwich and pass on the author's laptop. */
  it("takes the server's day from a timestamp rather than converting it", () => {
    expect(dayKeyOf("2026-11-14T10:32:00+08:00")).toBe("2026-11-14");
    expect(dayKeyOf("2026-11-12")).toBe("2026-11-12");
    expect(dayKeyOf(null)).toBeNull();
    expect(dayKeyOf("not a date")).toBeNull();
  });

  it("starts the week on Monday, including from a Sunday", () => {
    expect(startOfWeek("2026-11-12")).toBe("2026-11-09");
    /* 15 Nov 2026 is a Sunday: it ends that week, it does not start the next. */
    expect(startOfWeek("2026-11-15")).toBe("2026-11-09");
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09");
  });

  it("steps a month without overflowing a short one", () => {
    /* The bug this pins: Date.UTC(2026, 1, 31) silently becomes 3 March, so
       stepping forward from 31 January would skip February entirely. */
    expect(shiftPeriod("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(shiftPeriod("2026-11-14", "month", -1)).toBe("2026-10-01");
    expect(shiftPeriod("2026-12-15", "month", 1)).toBe("2027-01-01");
  });

  it("steps a week by seven days and crosses a year boundary", () => {
    expect(shiftPeriod("2026-12-28", "week", 1)).toBe("2027-01-04");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("always draws six rows, so the page below does not move between months", () => {
    expect(calendarDays("2026-11-01", "month")).toHaveLength(42);
    expect(calendarDays("2026-02-01", "month")).toHaveLength(42);
    expect(calendarDays("2026-11-12", "week")).toHaveLength(7);
  });

  it("labels the period the way the pack writes dates", () => {
    expect(periodLabel("2026-11-01", "month")).toBe("November 2026");
    expect(periodLabel("2026-11-12", "week")).toBe("09 – 15 Nov 2026");
    expect(periodLabel("2026-11-30", "week")).toBe("30 Nov – 06 Dec 2026");
  });

  it("expands only the days the engagement actually lists", () => {
    /* Two days either side of a public holiday is two entries, not three. */
    expect(daysCovered(["2026-11-12", "2026-11-16"])).toEqual(["2026-11-12", "2026-11-16"]);
    expect(daysCovered([])).toEqual([]);
  });
});

describe("CalendarGrid", () => {
  it("puts an entry in its own day cell and names the period", () => {
    render(<CalendarGrid label="Deliveries" anchor="2026-11-01" view="month" entries={ENTRIES} />);

    const grid = screen.getByRole("region", { name: "Deliveries · November 2026" });
    expect(within(grid).getAllByText("Leading Through Change")).toHaveLength(2);
    expect(within(grid).getByText("Mon")).toBeInTheDocument();
  });

  it("marks today without filling the cell", () => {
    render(
      <CalendarGrid
        label="Deliveries"
        anchor="2026-11-01"
        view="month"
        today="2026-11-14"
        entries={ENTRIES}
      />,
    );

    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("hands the whole entry back on select and reports the selected one", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        label="Deliveries"
        anchor="2026-11-01"
        view="month"
        entries={ENTRIES}
        selectedId="a"
        onSelect={onSelect}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");

    await user.click(buttons[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(ENTRIES[1]);
  });

  it("renders no focusable control when there is nothing to select", () => {
    render(<CalendarGrid label="Deliveries" anchor="2026-11-01" view="month" entries={ENTRIES} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the empty state rather than forty-two blank cells", () => {
    render(
      <CalendarGrid
        label="Deliveries"
        anchor="2027-06-01"
        view="month"
        entries={ENTRIES}
        empty={<p>Nothing is scheduled in June 2027</p>}
      />,
    );

    expect(screen.getByText("Nothing is scheduled in June 2027")).toBeInTheDocument();
  });
});

describe("CalendarList", () => {
  it("orders by day and formats it the caller's way", () => {
    render(
      <CalendarList
        label="Deliveries"
        entries={[ENTRIES[1] as (typeof ENTRIES)[number], ENTRIES[0] as (typeof ENTRIES)[number]]}
        formatDay={(day) => day.slice(8)}
      />,
    );

    const days = screen.getAllByText(/^1[23]$/).map((node) => node.textContent);
    expect(days).toEqual(["12", "13"]);
  });

  it("falls back to the kit empty state when there is nothing to list", () => {
    render(<CalendarList label="Deliveries" entries={[]} formatDay={(day) => day} />);
    expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
  });
});
