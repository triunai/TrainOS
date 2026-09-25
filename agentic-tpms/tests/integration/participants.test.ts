import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rows } from "@/server/db/client";
import { addParticipant, importParticipantsCsv, listRoster, setRegistrationStatus } from "@/server/participants/service";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { buildPackageAt } from "../helpers/lifecycle";

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);

describe("participant roster (PDPA)", () => {
  it("stores NRIC only as hash + ciphertext + mask, never in clear", async () => {
    const { pkg } = await buildPackageAt("GRANT_APPROVED");
    const id = await addParticipant(pkg.id, { fullName: "Ahmad Faizal", nric: "900512-14-5561", workEmail: "ahmad@kenanga.my" }, ALEX);
    const [row] = await rows<{ nric_masked: string; clear: string; hash: string }>(
      db(),
      sql`select nric_masked, encode(nric_encrypted, 'escape') as clear, nric_passport_hash as hash from tpms.package_participants where id = ${id}::uuid`,
    );
    expect(row.nric_masked).toBe("******-**-5561");
    expect(row.clear).not.toContain("900512145561");
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    const audit = await rows<{ metadata_diff: unknown; reason_details: string }>(db(), sql`select metadata_diff, reason_details from tpms.audit_ledger where entity_id = ${id}::uuid`);
    expect(JSON.stringify(audit)).not.toContain("900512");
  });

  it("refuses an invalid MyKad date and a duplicate person", async () => {
    const { pkg } = await buildPackageAt("GRANT_APPROVED");
    await expect(addParticipant(pkg.id, { fullName: "Bad Date", nric: "901332-14-5561" }, ALEX)).rejects.toMatchObject({ code: "NRIC_INVALID" });
    await addParticipant(pkg.id, { fullName: "Once", nric: "880101-10-1234" }, ALEX);
    await expect(addParticipant(pkg.id, { fullName: "Twice", nric: "880101101234" }, ALEX)).rejects.toMatchObject({ code: "PARTICIPANT_DUPLICATE" });
  });

  it("imports a CSV row by row, keeping good rows when one is bad", async () => {
    const { pkg } = await buildPackageAt("GRANT_APPROVED");
    const csv = 'name,nric,email\n"Lee, Chong Wei",920101-14-1111,lee@x.my\nNo Id,,\nSiti Nur,A12345678,siti@x.my\n';
    const results = await importParticipantsCsv(pkg.id, csv, ALEX);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    const roster = await listRoster(pkg.id);
    expect(roster.map((r) => r.fullName).sort()).toEqual(["Lee, Chong Wei", "Siti Nur"]);
    expect(roster.find((r) => r.fullName === "Siti Nur")?.nricMasked).toBe("*****5678");
  });

  it("freezes the roster once delivery is complete", async () => {
    const f = await buildPackageAt("DELIVERY_COMPLETED");
    await expect(addParticipant(f.pkg.id, { fullName: "Late Comer", nric: "950101-14-2222" }, ALEX)).rejects.toMatchObject({ code: "ROSTER_FROZEN" });
    await expect(setRegistrationStatus(f.participantIds[0], "WITHDRAWN", ALEX)).rejects.toMatchObject({ code: "ROSTER_FROZEN" });
  });
});
