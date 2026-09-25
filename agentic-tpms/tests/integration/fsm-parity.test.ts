import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/server/db/client";
import { TRANSITIONS } from "@/server/fsm/transitions";
import { GUARDED_REASONS } from "@/server/fsm/guards";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

describe("FSM parity (R14: the seam is a table duplicated verbatim on both sides)", () => {
  it("the TypeScript transition table equals the database table row for row", async () => {
    const dbRows = await db().select().from(schema.fsmTransitions);
    const key = (m: string, f: string, t: string, r: string) => `${m}|${f}|${t}|${r}`;
    const fromDb = new Map(dbRows.map((r) => [key(r.machine, r.fromStage, r.toStage, r.reasonCode), [...r.allowedActorTypes].sort().join(",")]));
    const fromTs = new Map(TRANSITIONS.map((t) => [key(t.machine, t.from, t.to, t.reason), [...t.actors].sort().join(",")]));
    expect(fromTs.size).toBe(TRANSITIONS.length);
    expect([...fromTs.entries()].sort()).toEqual([...fromDb.entries()].sort());
  });

  it("every transition reason has a Level 0 guard", () => {
    const reasons = new Set(TRANSITIONS.map((t) => t.reason));
    for (const reason of reasons) expect(GUARDED_REASONS).toContain(reason);
  });

  it("no transition may be driven by an AGENT", () => {
    for (const t of TRANSITIONS) expect(t.actors).not.toContain("AGENT");
  });
});
