import { describe, expect, it } from "vitest";
import { formatDate, formatRange } from "@/lib/dates";

describe("formatDate", () => {
  it("uses fixed month words, so server (Node ICU) and browser (Chromium ICU) render the same text", () => {
    // Node's full ICU writes "Sept" for en-GB; a hydration mismatch follows if that leaks.
    expect(formatDate("2026-09-26")).toBe("26 Sep 2026");
    expect(formatDate("2026-09-26")).not.toContain("Sept");
  });

  it("renders instants in Malaysia time, including the day rollover", () => {
    expect(formatDate(new Date("2026-09-25T17:05:00Z"), true)).toBe("26 Sep 2026, 01:05");
    expect(formatDate("2026-01-05T00:30:00Z", true)).toBe("05 Jan 2026, 08:30");
  });

  it("treats a bare YYYY-MM-DD as a Malaysian calendar date and handles empties", () => {
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatRange("2026-10-20", "2026-10-21")).toBe("20 Oct 2026 – 21 Oct 2026");
  });
});
