import { describe, expect, it } from "vitest";
import { SEVERITIES } from "@trainos/contract";
import { SEVERITY_TONE, severityTone } from "../tone";

/**
 * The severity map the claim packet's deadline chip reads.
 *
 * It replaced `data.deadlineSeverity === "INFO" ? "neutral" : "warning"`, a
 * two-branch ternary over a four-member vocabulary this feature does not own.
 * The first test below is the defect that ternary had: DANGER came out
 * "warning", so a claim window the server was calling urgent rendered as merely
 * worth a look. R14 — the receiving side must not fold an unrecognised value
 * toward whichever branch is the `else`.
 */

describe("severityTone", () => {
  it("does NOT collapse DANGER and ALERT into a warning", () => {
    /* The whole reason the map exists. The ternary it replaced returned
       "warning" for both of these. */
    expect(severityTone("DANGER")).toBe("danger");
    expect(severityTone("ALERT")).toBe("danger");
  });

  it("keeps INFO neutral and WARN a warning", () => {
    expect(severityTone("INFO")).toBe("neutral");
    expect(severityTone("WARN")).toBe("warning");
  });

  it("answers for EVERY severity the contract publishes", () => {
    /* Reads the contract's own list rather than a copy of it, so a new member
       fails here rather than falling through to neutral on a real screen. */
    for (const severity of SEVERITIES) {
      expect(severityTone(severity)).toBeDefined();
      expect(SEVERITY_TONE[severity]).toBeDefined();
    }
  });

  it("is neutral for a value the contract does not publish, never undefined", () => {
    /* Several contract fields carry a severity as a bare `string`, so a value
       the types promise cannot arrive still can. A chip must not be
       undefined-toned, and it must not invent an urgency either. */
    expect(severityTone("NOVEL")).toBe("neutral");
    expect(severityTone("")).toBe("neutral");
  });
});
