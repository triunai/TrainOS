/**
 * Ruled R18 · `POST /v1/actions` `type: OPPORTUNITY_STAGE_CHANGE`.
 *
 * §12 catalogues seven opportunity stages and §5 serves the pipeline that
 * orders them, so the contract describes a board a deal moves across — and
 * then named only `OPPORTUNITY_CONVERT`, which CREATES an opportunity from an
 * enquiry. There was no type for moving one that already exists, and R1 sends
 * every write through `POST /v1/actions`, so the pipeline board's drag could
 * not be governed at all.
 *
 * A separate file rather than a block in `actions.test.ts`: several agents
 * work this tree at once and a new file cannot collide with theirs.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ActionRequest, OpportunityStage } from "@trainos/contract";
import { USER_AMIRAH } from "@trainos/contract";
import { createFixtureClient } from "../index";
import type { FixtureClient } from "../client/FixtureClient";
import { MINIMUM_CONFIDENCE } from "../client/policy";

const OPP = "OPP-0498";

/* A fresh client per test. `createFixtureClient` hands back a live store and
   every case here MOVES a deal, so sharing one would make each test depend on
   the order the last one left the board in. */
let api: FixtureClient;

beforeEach(() => {
  api = createFixtureClient({ latencyMs: 0 });
});

const AMIRAH = { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" } as const;

const move = (stage: OpportunityStage, fromStage?: OpportunityStage): ActionRequest => ({
  type: "OPPORTUNITY_STAGE_CHANGE",
  targetRef: OPP,
  requestedBy: AMIRAH,
  payload: fromStage ? { stage, fromStage } : { stage },
});

describe("moving a deal between stages", () => {
  it("moves the deal and names the move in its effects", async () => {
    const before = await api.getOpportunity(OPP);
    const response = await api.performAction(move("PROPOSAL_SENT", before.stage));

    /* `ActionResponse` is a discriminated union — `result` lives on the
       EXECUTED variant only, which is the §3 shape the screens switch on. */
    expect(response.status).toBe("EXECUTED");
    if (response.status !== "EXECUTED") return;

    expect((await api.getOpportunity(OPP)).stage).toBe("PROPOSAL_SENT");
    expect(response.result.effects?.[0]).toMatchObject({
      op: "UPDATE",
      entity: "Opportunity",
      ref: OPP,
    });
  });

  /* Two people dragging the same card would otherwise both succeed and the
     later write would silently win — on a screen whose gesture is a drag and
     where nobody reads a confirmation.

     `stale` is computed rather than written down: the fixture store hands back
     its live objects, so a test that assumed OPP-0498's seeded stage would
     depend on whichever case ran before it. */
  it("refuses a move from a stage the deal has already left", async () => {
    await api.performAction(move("PROPOSAL_SENT"));
    const stale: OpportunityStage = "QUALIFYING";
    expect((await api.getOpportunity(OPP)).stage).not.toBe(stale);

    await expect(api.performAction(move("NEGOTIATION", stale))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { reason: "STAGE_MOVED" },
    });
  });

  it("leaves the deal where it was when it refuses the move", async () => {
    await api.performAction(move("PROPOSAL_SENT"));

    await expect(api.performAction(move("WON", "QUALIFYING"))).rejects.toBeDefined();
    expect((await api.getOpportunity(OPP)).stage).toBe("PROPOSAL_SENT");
  });

  it("accepts a move that sends no fromStage, because the check is opt-in", async () => {
    expect((await api.performAction(move("NEGOTIATION"))).status).toBe("EXECUTED");
  });

  it("refuses a move that names no target stage", async () => {
    await expect(
      api.performAction({ type: "OPPORTUNITY_STAGE_CHANGE", targetRef: OPP, requestedBy: AMIRAH, payload: {} }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("refuses a deal that does not exist", async () => {
    await expect(
      api.performAction({
        type: "OPPORTUNITY_STAGE_CHANGE",
        targetRef: "OPP-9999",
        requestedBy: AMIRAH,
        payload: { stage: "WON" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /* WON and LOST are terminal (ruling R16), so this is a write that ENDS
     deals. An agent mis-reading a client's email should not close a pipeline
     on its own read, which is why the bar is above a convert's. */
  it("asks an agent for more confidence than a convert does", () => {
    expect(MINIMUM_CONFIDENCE.OPPORTUNITY_STAGE_CHANGE).toBeGreaterThan(
      MINIMUM_CONFIDENCE.OPPORTUNITY_CONVERT as number,
    );
  });
});
