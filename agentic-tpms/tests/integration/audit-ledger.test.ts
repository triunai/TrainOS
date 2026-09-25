import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rows } from "@/server/db/client";
import { verifyChain } from "@/server/audit/ledger";
import { transition } from "@/server/fsm/service";
import { DomainError } from "@/server/domain/errors";
import { expectRefusal, releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator, makePackage } from "../helpers/factory";

beforeAll(async () => {
  await useTestDatabase();
  await makeOperator();
});
afterAll(releaseTestDatabase);

describe("append-only SHA-256 audit ledger", () => {
  it("records package creation with the actor from the transaction context", async () => {
    const pkg = await makePackage();
    const entries = await rows<{ actor_id: string; reason_code: string; to_stage: string }>(
      db(),
      sql`select actor_id, reason_code, to_stage from tpms.audit_ledger where entity_id = ${pkg.id}::uuid order by seq`,
    );
    expect(entries).toEqual([{ actor_id: ALEX.id, reason_code: "PACKAGE_CREATED", to_stage: "DRAFT" }]);
  });

  it("refuses a raw UPDATE of a package without actor and reason context", async () => {
    const pkg = await makePackage();
    await expectRefusal(
      db().execute(sql`update tpms.training_packages set title = 'x' where id = ${pkg.id}::uuid`),
      /PACKAGE_UPDATE_WITHOUT_CONTEXT/,
    );
  });

  it("refuses UPDATE, DELETE and TRUNCATE on the ledger itself", async () => {
    await expectRefusal(db().execute(sql`update tpms.audit_ledger set actor_id = 'mallory'`), /AUDIT_APPEND_ONLY/);
    await expectRefusal(db().execute(sql`delete from tpms.audit_ledger`), /AUDIT_APPEND_ONLY/);
    await expectRefusal(db().execute(sql`truncate tpms.audit_ledger`), /AUDIT_APPEND_ONLY/);
  });

  it("an illegal transition is refused by the service and never reaches the ledger", async () => {
    const pkg = await makePackage();
    const before = await verifyChain();
    await expect(
      transition({ packageId: pkg.id, machine: "OPERATIONAL", to: "GRANT_APPROVED", reason: "GRANT_CONFIRMED_LOCKED", actor: ALEX }),
    ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
    const after = await verifyChain();
    expect(after.rows).toBe(before.rows);
  });

  it("the chain verifies, and detects a row tampered by someone who bypassed the triggers", async () => {
    await makePackage();
    const clean = await verifyChain();
    expect(clean.ok).toBe(true);
    expect(clean.rows).toBeGreaterThan(2);

    // An owner can disable triggers. The hash chain is what still catches it.
    await db().execute(sql`alter table tpms.audit_ledger disable trigger trg_audit_no_update`);
    try {
      await db().execute(sql`update tpms.audit_ledger set actor_id = 'mallory' where seq = 2`);
    } finally {
      await db().execute(sql`alter table tpms.audit_ledger enable trigger trg_audit_no_update`);
    }
    const tampered = await verifyChain();
    expect(tampered.ok).toBe(false);
    expect(tampered.firstBrokenSeq).toBe(2);
  });

  it("maps guard refusals to DomainError, not a crash", async () => {
    const pkg = await makePackage();
    const error = await transition({
      packageId: pkg.id, machine: "OPERATIONAL", to: "QUOTED", reason: "COMMERCIAL_TERMS_APPROVED", actor: ALEX,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("GUARD_FAILED");
    expect(error.details.failures.map((f: { code: string }) => f.code)).toContain("QUOTATION_NOT_APPROVED");
  });

  it("an AGENT can never move a stage, even with a valid reason", async () => {
    const pkg = await makePackage();
    await expect(
      transition({ packageId: pkg.id, machine: "OPERATIONAL", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actor: { type: "AGENT", id: "agent_l3" } }),
    ).rejects.toMatchObject({ code: "TRANSITION_ACTOR_REJECTED" });
  });

  it("cancelling couples the financial machine to VOIDED in the same transaction", async () => {
    const pkg = await makePackage();
    const outcome = await transition({ packageId: pkg.id, machine: "OPERATIONAL", to: "CANCELLED", reason: "PACKAGE_CANCELLED", actor: ALEX });
    expect(outcome.pkg.operationalStage).toBe("CANCELLED");
    expect(outcome.pkg.financialStage).toBe("VOIDED");
    const entries = await rows<{ machine: string; to_stage: string }>(
      db(),
      sql`select machine, to_stage from tpms.audit_ledger where entity_id = ${pkg.id}::uuid and machine is not null order by seq`,
    );
    expect(entries).toEqual([
      { machine: "OPERATIONAL", to_stage: "CANCELLED" },
      { machine: "FINANCIAL", to_stage: "VOIDED" },
    ]);
  });
});
