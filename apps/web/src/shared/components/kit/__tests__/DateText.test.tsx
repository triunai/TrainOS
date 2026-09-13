import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DateText } from "@/shared/components/kit/DateText";
import { formatDate, formatRelativeDate, formatTime } from "@/shared/components/kit/format";

describe("DateText", () => {
  it("formats a DateOnly as dd MMM yyyy", () => {
    expect(formatDate("2026-11-12")).toBe("12 Nov 2026");
  });

  it("does not shift a DateOnly by timezone (no UTC-midnight reinterpretation)", () => {
    // If DateOnly were ever run through `new Date(...)`, UTC midnight could
    // render as the previous day west of Greenwich. The date-only path must
    // split the string instead, so the day never moves.
    expect(formatDate("2026-01-01")).toBe("01 Jan 2026");
  });

  it("returns an em dash for null/undefined/empty input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  it("returns an empty time string for a DateOnly (nothing to show)", () => {
    expect(formatTime("2026-11-12")).toBe("");
  });

  it("renders as a <time> element with a matching dateTime attribute", () => {
    const { container } = render(<DateText value="2026-11-12" />);
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-11-12");
    expect(time).toHaveTextContent("12 Nov 2026");
  });

  it("appends an HH:mm time when withTime is set on a full Timestamp", () => {
    const { container } = render(<DateText value="2026-11-12T09:30:00+08:00" withTime />);
    const time = container.querySelector("time");
    expect(time?.textContent).toMatch(/^12 Nov 2026 · \d{2}:\d{2}$/);
  });

  it("ignores withTime for a DateOnly, which has no time component", () => {
    const { container } = render(<DateText value="2026-11-12" withTime />);
    expect(container.querySelector("time")).toHaveTextContent("12 Nov 2026");
  });

  /* The anchor is passed in every case below. A relative date tested against
     the wall clock is a test that changes its answer overnight. */
  const NOW = "2026-11-14T10:32:00+08:00";

  it("says how long ago, in the unit that fits", () => {
    expect(formatRelativeDate("2026-11-14T10:31:40+08:00", NOW)).toBe("just now");
    expect(formatRelativeDate("2026-11-14T10:02:00+08:00", NOW)).toBe("30 minutes ago");
    expect(formatRelativeDate("2026-11-14T02:00:00+08:00", NOW)).toBe("8 hours ago");
    expect(formatRelativeDate("2026-11-13T09:00:00+08:00", NOW)).toBe("yesterday");
    expect(formatRelativeDate("2026-11-10T02:00:00+08:00", NOW)).toBe("4 days ago");
    expect(formatRelativeDate("2026-11-07T02:00:00+08:00", NOW)).toBe("last week");
  });

  it("falls back to the calendar date past a month, where 'ago' stops helping", () => {
    expect(formatRelativeDate("2026-06-18T08:00:00+08:00", NOW)).toBe("18 Jun 2026");
  });

  it("falls back to the calendar date for a value ahead of the anchor", () => {
    // "in 2 months" is not an answer to "when was this last checked".
    expect(formatRelativeDate("2027-01-04T08:00:00+08:00", NOW)).toBe("04 Jan 2027");
  });

  it("keeps the exact date reachable on the title when rendering relatively", () => {
    const { container } = render(
      <DateText value="2026-11-10T02:00:00+08:00" relative now={NOW} withTime />,
    );
    const time = container.querySelector("time");
    expect(time).toHaveTextContent("4 days ago");
    expect(time?.getAttribute("title")).toMatch(/^10 Nov 2026 · \d{2}:\d{2}$/);
  });
});
