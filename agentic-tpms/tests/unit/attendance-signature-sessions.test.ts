import { describe, expect, it } from "vitest";
import { analyseSignaturePath, SIGNATURE_MAX_BYTES, validateSignaturePath } from "@/server/attendance/signature";
import { isSessionOpen, parseSession, sessionWindow, slotLabel, trainingDate } from "@/server/attendance/sessions";

describe("signature path analysis", () => {
  it("walks absolute, relative, implicit-lineto and closepath commands", () => {
    const a = analyseSignaturePath("M10 10 20 10 20 20 Z");
    expect(a.bbox).toMatchObject({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    expect(a.length).toBeCloseTo(10 + 10 + Math.hypot(10, 10), 5);
    const r = analyseSignaturePath("m 5 5 l 10 0 v 10 h -10 c 1 1 2 2 3 3");
    expect(r.bbox).toMatchObject({ minX: 5, maxX: 15, minY: 5, maxY: 18 });
    expect(analyseSignaturePath("M0,0L1e1,-2.5e0").bbox).toMatchObject({ maxX: 10, minY: -2.5 });
  });

  it("accepts a real signature and refuses dots, junk, truncation and oversize payloads", () => {
    expect(validateSignaturePath("M 10 40 C 30 5, 60 5, 80 40 S 130 75, 150 40 L 170 30").points).toBeGreaterThanOrEqual(6);
    for (const bad of ["", "   ", "M 5 5", "M 5 5 L 6 6", "<svg onload=x>", "L 5 5 6 6", "M 1 2 C 3 4", 42]) {
      expect(() => validateSignaturePath(bad)).toThrow(expect.objectContaining({ code: "SIGNATURE_INVALID" }));
    }
    const long = `M 0 0 ${"L 100 50 L 0 0 ".repeat(Math.ceil(SIGNATURE_MAX_BYTES / 14))}`;
    expect(() => validateSignaturePath(long)).toThrow(/too large/);
  });
});

describe("session windows (Malaysia time)", () => {
  const d = "2026-10-20";
  const t = (hhmm: string) => new Date(`${d}T${hhmm}:00+08:00`);

  it("opens AM 07:00-13:00 and PM 13:00-18:30, end-exclusive", () => {
    expect(isSessionOpen(d, "AM", t("06:59"))).toBe(false);
    expect(isSessionOpen(d, "AM", t("07:00"))).toBe(true);
    expect(isSessionOpen(d, "AM", t("12:59"))).toBe(true);
    expect(isSessionOpen(d, "AM", t("13:00"))).toBe(false);
    expect(isSessionOpen(d, "PM", t("13:00"))).toBe(true);
    expect(isSessionOpen(d, "PM", t("18:29"))).toBe(true);
    expect(isSessionOpen(d, "PM", t("18:30"))).toBe(false);
    // 23:30 UTC on the 19th is 07:30 on the 20th in Kuala Lumpur.
    expect(isSessionOpen(d, "AM", new Date("2026-10-19T23:30:00Z"))).toBe(true);
    expect(sessionWindow(d, "PM").closesAt.toISOString()).toBe("2026-10-20T10:30:00.000Z");
  });

  it("rejects an unknown session and labels slots", () => {
    expect(() => parseSession("EVENING")).toThrow(expect.objectContaining({ code: "INVALID_SESSION" }));
    expect(parseSession("PM")).toBe("PM");
    expect(trainingDate("2026-10-31", 2)).toBe("2026-11-01");
    expect(slotLabel(2, "AM")).toBe("D2-AM");
  });
});
