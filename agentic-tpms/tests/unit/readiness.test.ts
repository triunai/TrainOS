import { describe, expect, it } from "vitest";
import { readinessLights, type ReadinessFacts } from "@/server/packages/readiness";
import { claimableSen } from "@/server/fsm/guards";
import { checkTransition } from "@/server/fsm/transitions";
import type { PackageSnapshot } from "@/server/packages/snapshot";

const base: ReadinessFacts = {
  operationalStage: "OPERATIONS_LOCKED",
  deliveryMode: "IN_HOUSE",
  venueByClient: false,
  startDate: "2026-11-20",
  etrisGrantId: "ETRIS-1",
  grantApprovedAmount: "16000.00",
  trainerStatus: "CONFIRMED",
  trainerTttVerified: true,
  trainerHoldExpiry: "2026-11-20",
  trainerName: "Farah",
  venueStatus: "BEO_SIGNED",
  venuePostponementDeadline: "2026-11-13",
  venueName: "Sunway",
};
const light = (f: Partial<ReadinessFacts>, key: string) => readinessLights({ ...base, ...f }, "2026-10-01").find((l) => l.key === key)?.light;

describe("tri-factor readiness lights", () => {
  it("all green when trainer confirmed+TTT, BEO signed, grant approved", () => {
    expect(readinessLights(base, "2026-10-01").map((l) => l.light)).toEqual(["green", "green", "green"]);
  });
  it("a confirmed trainer without TTT is red, a tentative hold is amber, an expired hold is red", () => {
    expect(light({ trainerTttVerified: false }, "trainer")).toBe("red");
    expect(light({ trainerStatus: "TENTATIVE_HOLD" }, "trainer")).toBe("amber");
    expect(light({ trainerStatus: "TENTATIVE_HOLD", trainerHoldExpiry: "2026-09-01" }, "trainer")).toBe("red");
  });
  it("ROT and client premises need no venue", () => {
    expect(light({ deliveryMode: "ROT_VIRTUAL", venueStatus: null }, "venue")).toBe("green");
    expect(light({ venueByClient: true, venueStatus: null }, "venue")).toBe("green");
  });
  it("a provisional venue past its free window is red", () => {
    expect(light({ venueStatus: "PROVISIONAL", venuePostponementDeadline: "2026-09-15" }, "venue")).toBe("red");
  });
  it("a pending grant inside 21 days is red", () => {
    expect(light({ operationalStage: "GRANT_PENDING", etrisGrantId: null, grantApprovedAmount: null, startDate: "2026-10-10" }, "grant")).toBe("red");
    expect(light({ operationalStage: "GRANT_PENDING", etrisGrantId: null, grantApprovedAmount: null }, "grant")).toBe("amber");
  });
  it("nothing is lit before quotation", () => {
    expect(readinessLights({ ...base, operationalStage: "DRAFT", trainerStatus: null, venueStatus: null, etrisGrantId: null, grantApprovedAmount: null }, "2026-10-01").map((l) => l.light)).toEqual(["off", "off", "off"]);
  });
});

function snap(mode: string, grant: string, approvedPax: number, eligible: number, active: number): PackageSnapshot {
  return {
    pkg: { deliveryMode: mode, grantApprovedAmount: grant, grantApprovedPax: approvedPax } as PackageSnapshot["pkg"],
    participants: { total: active, active, confirmed: active, eligible, withdrawn: 0 },
  } as PackageSnapshot;
}

describe("claimable amount", () => {
  it("per-group programmes claim the full approved grant once anyone is eligible", () => {
    expect(claimableSen(snap("IN_HOUSE", "16000.00", 20, 12, 20))).toBe(1_600_000);
    expect(claimableSen(snap("IN_HOUSE", "16000.00", 20, 0, 20))).toBe(0);
  });
  it("per-pax public programmes are pro-rated to eligible participants, capped at approved pax", () => {
    expect(claimableSen(snap("PUBLIC_PHYSICAL", "13000.00", 5, 4, 5))).toBe(1_040_000);
    expect(claimableSen(snap("PUBLIC_PHYSICAL", "13000.00", 5, 7, 7))).toBe(1_300_000);
  });
});

describe("transition table semantics (R14)", () => {
  it("rejects an unknown edge, a wrong reason and a wrong actor with distinct codes", () => {
    expect(checkTransition("OPERATIONAL", "DRAFT", "REMITTED", "X", "USER")).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
    expect(checkTransition("OPERATIONAL", "DRAFT", "QUOTED", "WHATEVER", "USER")).toMatchObject({ ok: false, code: "TRANSITION_REASON_REJECTED" });
    expect(checkTransition("OPERATIONAL", "DRAFT", "QUOTED", "COMMERCIAL_TERMS_APPROVED", "SYSTEM")).toMatchObject({ ok: false, code: "TRANSITION_ACTOR_REJECTED" });
    expect(checkTransition("FINANCIAL", "REMITTED", "SETTLED_CLOSED", "AP_DISBURSEMENT_CONFIRMED", "USER")).toMatchObject({ ok: true });
  });
});
