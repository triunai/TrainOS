import { describe, expect, it } from "vitest";
import {
  AGENT_STATUSES,
  HOURS_SAVED_BASES,
  MESSAGE_CATEGORIES,
  SEVERITIES,
} from "@trainos/contract";
import { AGENT_TONE, HOURS_SAVED_TONE, MESSAGE_CATEGORY_TONE, SEVERITY_TONE } from "../statusTone";

/**
 * R14 · the tone maps that replaced ten two-branch ternaries.
 *
 * `Record<Union, StatusTone>` already makes a missing key a compile error, so
 * what this file adds is the half TypeScript cannot see: that the map is keyed
 * off the CONTRACT'S OWN value list rather than off a union somebody retyped.
 * A hand-written union that has drifted from the enum still satisfies the
 * `Record`, and the screen then paints a value the server sends as though it
 * did not exist — which is precisely the failure the ternaries had.
 *
 * The tone VALUES are asserted only where the choice is the point of the fix:
 * a DANGER severity must not come out the same as an unflagged constraint, and
 * an ILLUSTRATIVE hours-saved figure must not come out the same as a measured
 * one. Asserting every cell would be restating the map.
 *
 * The fifth map, `PARTICIPANT_ATTENDANCE_TONE`, is asserted in the engagements
 * feature instead: its union is derived by `statusOf` rather than sent by the
 * server, and `src/shared` may not import `src/features`.
 */

describe("R14 · tone maps are keyed off the contract's own value lists", () => {
  it("covers every AgentStatus", () => {
    expect(Object.keys(AGENT_TONE).sort()).toEqual([...AGENT_STATUSES].sort());
  });

  it("covers every Severity", () => {
    expect(Object.keys(SEVERITY_TONE).sort()).toEqual([...SEVERITIES].sort());
  });

  it("covers every MessageCategory", () => {
    expect(Object.keys(MESSAGE_CATEGORY_TONE).sort()).toEqual([...MESSAGE_CATEGORIES].sort());
  });

  it("covers every HoursSavedBasis", () => {
    expect(Object.keys(HOURS_SAVED_TONE).sort()).toEqual([...HOURS_SAVED_BASES].sort());
  });
});

describe("R14 · the branches the old ternaries swallowed", () => {
  it("does not paint a DANGER severity the same as an unflagged constraint", () => {
    expect(SEVERITY_TONE.DANGER).toBe("danger");
    expect(SEVERITY_TONE.ALERT).toBe("danger");
    expect(SEVERITY_TONE.INFO).toBe("neutral");
  });

  it("keeps the WhatsApp category that costs six times the others as the coloured one", () => {
    expect(MESSAGE_CATEGORY_TONE.MARKETING).toBe("warning");
    expect(MESSAGE_CATEGORY_TONE.UTILITY).toBe("neutral");
    expect(MESSAGE_CATEGORY_TONE.SERVICE).toBe("neutral");
  });

  it("marks an illustrative hours-saved figure as a caveat rather than a fact", () => {
    expect(HOURS_SAVED_TONE.MEASURED).toBe("success");
    expect(HOURS_SAVED_TONE.ILLUSTRATIVE).toBe("warning");
  });

  it("colours a paused agent and leaves a retired one alone", () => {
    expect(AGENT_TONE.PAUSED).toBe("warning");
    expect(AGENT_TONE.ACTIVE).toBe("neutral");
    expect(AGENT_TONE.RETIRED).toBe("neutral");
  });
});
