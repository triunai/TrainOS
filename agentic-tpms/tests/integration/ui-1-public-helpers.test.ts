import { describe, expect, it } from "vitest";
import { blockedFor, MAX_PER_DEVICE, MAX_PER_PERSON, recordFailure, WINDOW_MS } from "@/app/(public)/c/_lib/rateLimit";
import { calendarDay, clockMY, dayMY, dayTimeMY } from "@/lib/dates";
import { explain } from "@/components/attendance/publicCopy";
import { exceptionReason } from "@/components/attendance/labels";
import { toSvgPath } from "@/components/attendance/signaturePath";
import { validateSignaturePath } from "@/server/attendance";

/**
 * UI lane 1: the helpers the public pages lean on. No database — these pin
 * the seams between the browser and the domain: the signature pad's path
 * against the domain's validator, the refusal copy, the per-process rate
 * limit and the hydration-safe Malaysia-time labels.
 */
describe("signature pad path", () => {
  const loop = (n: number, amp = 30) => Array.from({ length: n }, (_, i) => [20 + i * 4, 90 - Math.sin(i / 4) * amp] as [number, number]);

  it("produces a path the domain validator accepts for a real signature", () => {
    const path = toSvgPath([loop(60), [[30, 130], [120, 128], [200, 131]]]);
    expect(path).toMatch(/^M [\d.]+ [\d.]+ L /);
    expect(path.split("M").length - 1).toBe(2);
    const analysis = validateSignaturePath(path);
    expect(analysis.points).toBeGreaterThan(20);
  });

  it("thins jitter so a long signature stays small, and keeps each stroke's end", () => {
    const jitter = Array.from({ length: 400 }, (_, i) => [50 + (i % 2) * 0.3, 60 + (i % 3) * 0.2] as [number, number]);
    const path = toSvgPath([[...jitter, [180, 100]]]);
    expect(path).toBe("M 50 60 L 180 100");
  });

  it("leaves a tap for the domain to refuse as not a signature", () => {
    expect(() => validateSignaturePath(toSvgPath([[[100, 90], [101, 90.5]]]))).toThrow(/full signature/);
  });
});

describe("refusal copy", () => {
  it("explains a closed session with its window in Malaysia time", () => {
    const e = explain("SESSION_CLOSED", { opensAt: "2026-09-26T05:00:00.000Z", closesAt: "2026-09-26T10:30:00.000Z" });
    expect(e.title).toBe("Sign-in is closed for this session");
    expect(e.body).toContain("Sat 26 Sep, 13:00 to 18:30 (Malaysia time)");
  });

  it("has plain-language copy for every code the public pages can meet, and a generic one otherwise", () => {
    for (const code of ["LINK_EXPIRED", "LINK_REVOKED", "LINK_NOT_YET_VALID", "LINK_INVALID", "SESSION_CLOSED", "SIGNATURE_INVALID", "INVALID_DAY", "INVALID_SESSION", "IDENTITY_MISMATCH"]) {
      const e = explain(code);
      expect(e.title, code).not.toMatch(/something went wrong/i);
      expect(`${e.title} ${e.body}`, code).not.toMatch(/[A-Z]{3,}_[A-Z]+/);
    }
    expect(explain("SOMETHING_NEW").title).toBe("Something went wrong on our side");
    expect(explain("LINK_EXPIRED", undefined, "room").body).toMatch(/refreshes every 20 minutes/);
  });

  it("names an unknown exception reason as unrecognised instead of borrowing a known label", () => {
    expect(exceptionReason("UNSIGNED")).toMatchObject({ label: "Blank on the sheet", known: true });
    expect(exceptionReason("SUPERSEDED_BY_OVERRIDE")).toMatchObject({ label: "Unrecognised: SUPERSEDED_BY_OVERRIDE", known: false });
  });
});

describe("identity rate limit (per process)", () => {
  it("blocks one name after five failures from a device, but not the rest of the room", () => {
    const t0 = 1_000_000;
    const token = `qr-${Math.random()}`;
    for (let i = 0; i < MAX_PER_PERSON; i += 1) {
      expect(blockedFor(token, "203.0.113.7", "p1", t0 + i)).toBeNull();
      recordFailure(token, "203.0.113.7", "p1", t0 + i);
    }
    expect(blockedFor(token, "203.0.113.7", "p1", t0 + 10)).toBeGreaterThan(WINDOW_MS - 20);
    expect(blockedFor(token, "203.0.113.7", "p2", t0 + 10)).toBeNull(); // someone else on the venue Wi-Fi
    expect(blockedFor(token, "198.51.100.1", "p1", t0 + 10)).toBeNull(); // another network
    expect(blockedFor(token, "203.0.113.7", "p1", t0 + WINDOW_MS + 5)).toBeNull(); // the window slides
  });

  it("caps a device sweeping the roster", () => {
    const t0 = 5_000_000;
    const token = `qr-${Math.random()}`;
    for (let i = 0; i < MAX_PER_DEVICE; i += 1) recordFailure(token, "203.0.113.9", `p${i}`, t0 + i);
    expect(blockedFor(token, "203.0.113.9", "someone-new", t0 + 100)).not.toBeNull();
  });
});

describe("Malaysia-time labels", () => {
  it("render identical words everywhere (no ICU month names)", () => {
    expect(clockMY("2026-09-25T16:05:00.000Z")).toBe("00:05");
    expect(dayMY("2026-09-25T16:05:00.000Z")).toBe("Sat 26 Sep");
    expect(dayTimeMY("2026-09-26T02:31:00.000Z")).toBe("Sat 26 Sep, 10:31");
    expect(calendarDay("2026-12-01")).toBe("Tue 1 Dec");
  });
});
