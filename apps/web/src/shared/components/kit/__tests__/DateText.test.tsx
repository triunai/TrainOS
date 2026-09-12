import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DateText, formatDate, formatTime } from "@/shared/components/kit/DateText";

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
});
