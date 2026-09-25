import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rows } from "@/server/db/client";
import { verifyChain } from "@/server/audit/ledger";
import { transition } from "@/server/fsm/service";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt } from "../helpers/lifecycle";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

describe("dual FSM happy path through the core", () => {
  it("reaches SETTLED_CLOSED with every move audited and the chain intact", async () => {
    const { pkg } = await buildPackageAt("SETTLED_CLOSED");
    expect(pkg.operationalStage).toBe("DELIVERY_COMPLETED");
    expect(pkg.financialStage).toBe("SETTLED_CLOSED");

    const moves = await rows<{ machine: string; from_stage: string; to_stage: string; actor_type: string; reason_code: string }>(
      db(),
      sql`select machine, from_stage, to_stage, actor_type, reason_code from tpms.audit_ledger
           where entity_id = ${pkg.id}::uuid and machine is not null order by seq`,
    );
    expect(moves.map((m) => `${m.machine[0]}:${m.to_stage}`)).toEqual([
      "O:QUOTED", "O:GRANT_PENDING", "F:GRANT_RESERVED", "O:GRANT_APPROVED", "O:OPERATIONS_LOCKED",
      "O:READY_FOR_EVENT", "O:DELIVERY_IN_PROGRESS", "O:DELIVERY_COMPLETED", "F:CLAIM_NOT_READY",
      "F:CLAIM_READY", "F:CLAIM_SUBMITTED", "F:APPROVED", "F:REMITTED", "F:SETTLED_CLOSED",
    ]);
    const settle = moves[moves.length - 1];
    expect(settle).toMatchObject({ actor_type: "USER", reason_code: "AP_DISBURSEMENT_CONFIRMED" });
    const quoted = moves[0];
    expect(quoted).toMatchObject({ actor_type: "USER", reason_code: "COMMERCIAL_TERMS_APPROVED" });
    expect((await verifyChain()).ok).toBe(true);
  });

  it("schedules the T-14 viability check when the grant is approved", async () => {
    const { pkg } = await buildPackageAt("GRANT_APPROVED");
    const [task] = await rows<{ task_type: string; claim_due: Date }>(
      db(),
      sql`select task_type, claim_due from tpms.task_queue where payload->>'packageId' = ${pkg.id} and task_type = 'viability.t14_check'`,
    );
    expect(task.task_type).toBe("viability.t14_check");
    const expected = new Date(`${pkg.startDate}T00:00:00+08:00`).getTime() - 14 * 86_400_000;
    expect(new Date(task.claim_due).getTime()).toBe(expected);
  });

  it("refuses to lock operations while the trainer's TTT is unverified", async () => {
    const { pkg, engagementId } = await buildPackageAt("OPERATIONS_LOCKED");
    expect(engagementId).toBeDefined();
    // A fresh package at GRANT_APPROVED with a hold that is still tentative:
    const fresh = await buildPackageAt("GRANT_APPROVED");
    const error = await transition({
      packageId: fresh.pkg.id, machine: "OPERATIONAL", to: "OPERATIONS_LOCKED", reason: "OPERATIONS_READINESS_LOCKED", actor: ALEX,
    }).catch((e) => e);
    expect(error.code).toBe("GUARD_FAILED");
    expect(error.details.failures.map((f: { code: string }) => f.code)).toEqual(
      expect.arrayContaining(["TRAINER_NOT_CONFIRMED", "VENUE_NOT_LOCKED"]),
    );
    expect(pkg.operationalStage).toBe("OPERATIONS_LOCKED");
  });

  it("refuses delivery completion with unrecorded attendance slots", async () => {
    const { pkg } = await buildPackageAt("DELIVERY_IN_PROGRESS");
    const error = await transition({
      packageId: pkg.id, machine: "OPERATIONAL", to: "DELIVERY_COMPLETED", reason: "DELIVERY_VERIFIED_SUCCESS", actor: ALEX,
    }).catch((e) => e);
    expect(error.code).toBe("GUARD_FAILED");
    expect(error.details.failures.map((f: { code: string }) => f.code)).toEqual(
      expect.arrayContaining(["ATTENDANCE_INCOMPLETE", "T3_MISSING", "PHOTOS_MISSING"]),
    );
  });
});
