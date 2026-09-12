import { describe, expect, it } from "vitest";
import { formatDateRange } from "@/shared/components/kit/format";

describe("formatDateRange", () => {
  /* The contract returns ranges as one slash-joined string. Collapsing the
     shared parts is the point: "12 Nov 2026 – 13 Nov 2026" makes a reader
     compare two dates to find the one digit that differs. */
  it("collapses a range inside one month to the days", () => {
    expect(formatDateRange("2026-11-12/2026-11-13")).toBe("12–13 Nov 2026");
  });

  /* Days stay zero-padded on every branch, matching formatDate. */
  it("keeps both months when the range crosses one, stating the year once", () => {
    expect(formatDateRange("2026-11-30/2026-12-01")).toBe("30 Nov – 01 Dec 2026");
  });

  it("states both years when the range crosses a year boundary", () => {
    expect(formatDateRange("2026-12-30/2027-01-02")).toBe("30 Dec 2026 – 02 Jan 2027");
  });

  it("renders a single day once when both ends are the same date", () => {
    expect(formatDateRange("2026-11-12/2026-11-12")).toBe("12 Nov 2026");
  });

  it("falls through to a single date when handed one", () => {
    expect(formatDateRange("2026-11-12")).toBe("12 Nov 2026");
  });

  it("returns a dash for nothing", () => {
    expect(formatDateRange(undefined)).toBe("—");
    expect(formatDateRange(null)).toBe("—");
  });
});
