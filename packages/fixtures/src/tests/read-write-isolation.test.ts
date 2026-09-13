/**
 * The read/write response boundary.
 *
 * `FixtureClient` used to serve the in-memory store's own row objects: a
 * read handed back the live reference, and several write methods mutated —
 * or returned — whatever object the caller happened to be holding. React
 * Query (and anything else that caches a row across a write) saw the row
 * change out from under it, so a refetch after an action reported "no
 * change" even though the fixture had updated the record. The pipeline
 * feature worked around this by copying rows at its own boundary; every
 * other screen that re-reads after a write had the same exposure.
 *
 * `#read` and `#write` now clone at the boundary, and the handful of
 * methods that predate those wrappers (and manage their own response) got
 * the same treatment individually. These tests hold that boundary from both
 * directions: a read must not expose the store, and a write must not adopt
 * a caller-supplied object into the store or keep a live handle on
 * something an earlier read returned.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createFixtureClient, myr } from "../index";
import type { FixtureClient } from "../client/FixtureClient";

let api: FixtureClient;

beforeEach(() => {
  api = createFixtureClient({ latencyMs: 0 });
});

describe("reads never hand out the store's own object", () => {
  it("mutating a read result does not reach the store", async () => {
    const me = await api.getMe();
    const originalName = me.name;
    (me as { name: string }).name = "MUTATED";

    const stored = api.store.users.find((user) => user.id === api.actorId);
    expect(stored?.name).toBe(originalName);
  });

  it("mutating a read result does not change what the next read returns", async () => {
    const first = await api.getBudgets();
    const row = first.data[0];
    if (!row) throw new Error("fixture seed changed: no budgets");
    row.cap.amount = -1;

    const second = await api.getBudgets();
    expect(second.data[0]?.cap.amount).not.toBe(-1);
  });
});

describe("writes never adopt a caller's object or keep a live handle on an earlier read", () => {
  it("a write does not change an object an earlier read already returned", async () => {
    const before = await api.getBudgets();
    const row = before.data.find((budget) => budget.scope === "TIER" && budget.key === "MID");
    if (!row) throw new Error("fixture seed changed: TIER/MID budget missing");
    const originalAmount = row.cap.amount;

    await api.putBudget("TIER", "MID", { cap: myr(originalAmount - 100) });

    /* The object `before` handed back must still read the pre-write value. */
    expect(row.cap.amount).toBe(originalAmount);

    /* And a fresh read must see the write actually landed. */
    const after = await api.getBudgets();
    const updated = after.data.find((budget) => budget.scope === "TIER" && budget.key === "MID");
    expect(updated?.cap.amount).toBe(originalAmount - 100);
  });

  it("a write does not store the caller's payload object by reference", async () => {
    const payload = { cap: myr(5000) };
    await api.putBudget("TIER", "MID", payload);
    payload.cap.amount = 1;

    const after = await api.getBudgets();
    const updated = after.data.find((budget) => budget.scope === "TIER" && budget.key === "MID");
    expect(updated?.cap.amount).toBe(5000);
  });
});

describe("methods that predate the #read/#write boundary manage their own copy", () => {
  it("updateView: the returned view is independent of the stored one", async () => {
    const created = await api.createView({
      label: "Test view",
      object: "ENQUIRY",
      filters: [],
      columns: [],
    });
    const updated = await api.updateView(created.id, { label: "Renamed" });
    (updated as { label: string }).label = "MUTATED";

    const stored = api.store.savedViews.find((view) => view.id === created.id);
    expect(stored?.label).toBe("Renamed");
  });

  it("putAgentAutonomy: the returned agent is independent of the stored one", async () => {
    const [agent] = api.store.agents;
    const grant = agent?.autonomy[0];
    if (!agent || !grant) throw new Error("fixture seed changed: no agent with an autonomy grant");
    const otherLevel = grant.level === "OBSERVE" ? "SUGGEST" : "OBSERVE";

    const originalLevel = grant.level;
    api.signInAs("u_lim");
    const returned = await api.putAgentAutonomy(agent.id, { actionType: grant.actionType, level: otherLevel });
    const returnedGrant = returned.autonomy.find((candidate) => candidate.actionType === grant.actionType);
    if (!returnedGrant) throw new Error("grant missing from the returned agent");
    returnedGrant.level = originalLevel;

    const stored = api.store.agents.find((candidate) => candidate.id === agent.id);
    expect(stored?.autonomy.find((candidate) => candidate.actionType === grant.actionType)?.level).toBe(
      otherLevel,
    );
  });
});
