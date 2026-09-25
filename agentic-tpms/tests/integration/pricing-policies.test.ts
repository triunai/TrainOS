import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, db, rows } from "@/server/db/client";
import { activePolicy, dailyCapFor, listPolicies, seedCostPolicies, updatePolicyBands } from "@/server/pricing";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator } from "../helpers/factory";

beforeAll(async () => {
  await useTestDatabase();
  await makeOperator();
});
afterAll(releaseTestDatabase);

describe("Allowable Cost Matrix as versioned, audited policy data", () => {
  it("seeds ACM-2026.1 idempotently", async () => {
    expect(await seedCostPolicies(db())).toBe(3);
    expect(await seedCostPolicies(db())).toBe(0);
    const policies = await listPolicies();
    expect(policies.map((p) => `${p.deliveryMode}:${p.basis}`).sort()).toEqual([
      "IN_HOUSE:PER_GROUP_DAY",
      "PUBLIC_PHYSICAL:PER_PAX_DAY",
      "ROT_VIRTUAL:PER_GROUP_DAY",
    ]);
    expect(policies.every((p) => p.version === "ACM-2026.1" && p.effectiveFrom === "2026-01-01")).toBe(true);
  });

  it("resolves the active policy by mode and date", async () => {
    const p = await activePolicy("IN_HOUSE", "2026-06-01");
    expect(p.version).toBe("ACM-2026.1");
    expect(dailyCapFor(p, 22)).toBe(1_050_000);
    await expect(activePolicy("IN_HOUSE", "2025-12-31")).rejects.toMatchObject({ code: "NO_ACTIVE_COST_POLICY" });
    await expect(activePolicy("HYBRID", "2026-06-01")).rejects.toMatchObject({ code: "UNKNOWN_DELIVERY_MODE" });
  });

  it("lets an operator edit bands, audited with old and new values", async () => {
    const rot = (await listPolicies()).find((p) => p.deliveryMode === "ROT_VIRTUAL")!;
    const next = [
      { minPax: 1, maxPax: 10, dailyCap: 4200 },
      { minPax: 11, maxPax: 25, dailyCap: 6100 },
      { minPax: 26, maxPax: 60, dailyCap: 8000 },
    ];
    const updated = await updatePolicyBands(rot.id, next, ALEX);
    expect(updated.bands).toEqual(next);
    const [audit] = await rows<{ actor_type: string; actor_id: string; reason_code: string; metadata_diff: { bands: { old: unknown[]; new: unknown[] } } }>(
      db(),
      sql`select actor_type, actor_id, reason_code, metadata_diff from tpms.audit_ledger
           where entity_type = 'COST_POLICY' and entity_id = ${rot.id}::uuid order by seq desc limit 1`,
    );
    expect(audit).toMatchObject({ actor_type: "USER", actor_id: ALEX.id, reason_code: "COST_POLICY_UPDATED" });
    expect(audit.metadata_diff.bands.old).toEqual(rot.bands);
    expect(audit.metadata_diff.bands.new).toEqual(next);
    await updatePolicyBands(rot.id, rot.bands, ALEX);
  });

  it("refuses a gapped matrix and a non-operator editor", async () => {
    const inHouse = (await listPolicies()).find((p) => p.deliveryMode === "IN_HOUSE")!;
    await expect(
      updatePolicyBands(inHouse.id, [{ minPax: 1, maxPax: 10, dailyCap: 6000 }, { minPax: 12, maxPax: 60, dailyCap: 14000 }], ALEX),
    ).rejects.toMatchObject({ code: "INVALID_COST_BANDS" });
    await expect(updatePolicyBands(inHouse.id, inHouse.bands, SYSTEM_ACTOR)).rejects.toMatchObject({ code: "USER_REQUIRED" });
    const after = (await listPolicies()).find((p) => p.id === inHouse.id)!;
    expect(after.bands).toEqual(inHouse.bands);
  });
});
