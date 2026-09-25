import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "@/server/audit/ledger";
import { listCertificates, verifyCertificate } from "@/server/certificates";
import { db, rows, schema } from "@/server/db/client";
import { GOLDEN_STEPS, GOLDEN_TRANSITIONS, cohortFor, ledgerMoves, runGoldenPath, type GoldenPathResult } from "@/server/demo/goldenPath";
import { GOLDEN_SCENARIO } from "@/server/demo/scenarios";
import { taskTotals } from "@/server/demo/tasks";
import { listVouchers } from "@/server/finance";
import { listRetention } from "@/server/retention";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";

/**
 * The golden path end to end on a fresh database: one web-form lead to
 * SETTLED_CLOSED through the domain services and the worker's handlers.
 *
 * Track B (paper Form T3 + OCR) needs the extraction service. The test starts
 * it on port 8868 from services/paddleocr/.venv when that venv exists (or
 * reuses a healthy dev instance already there); without it the golden path
 * falls back to digital T3s, and every assertion below holds either way.
 */
let result: GoldenPathResult;
let stopService: (() => Promise<void>) | null = null;

beforeAll(async () => {
  await useTestDatabase();
  process.env.TPMS_TEST_OCR_PORT ??= "8868";
  const service = await import("../helpers/extraction-service");
  service.pointAtTestService(); // never the shared dev ports, even when the venv is missing
  if (service.hasServiceVenv) {
    try {
      await service.startExtractionService();
      stopService = service.stopExtractionService;
    } catch (error) {
      console.warn(`[golden-path] extraction service did not start; Track B falls back to digital T3: ${String(error).slice(0, 300)}`);
    }
  } else {
    console.warn(`[golden-path] ${service.MISSING_VENV_MESSAGE}; Track B falls back to digital T3`);
  }
  // TPMS_GOLDEN_OCR=off exercises the digital-T3 fallback even when the service is available.
  result = await runGoldenPath({ nonce: `test-${Date.now().toString(36)}`, ocr: process.env.TPMS_GOLDEN_OCR === "off" ? "off" : "auto" });
}, 300_000);

afterAll(async () => {
  await stopService?.();
  await releaseTestDatabase();
});

const packageId = () => result.packageId as string;

describe("golden path: lead in, SETTLED_CLOSED out", () => {
  it("runs every step and leaves both machines at their final stages", () => {
    expect(result.steps.map((s) => s.step)).toEqual([...GOLDEN_STEPS]);
    expect(result.final).toEqual({ operational: "DELIVERY_COMPLETED", financial: "SETTLED_CLOSED" });
    expect(result.packageCode).toMatch(/^PKG-\d{4}-\d{4}$/);
    expect(result.operationsUrl).toBe(`http://localhost:3100/operations/${result.packageCode}`);
  });

  it("records every stage transition in the ledger, in order, by a USER or the SYSTEM — never an agent", async () => {
    const moves = await ledgerMoves(packageId());
    expect(moves.map((m) => [m.machine, m.from, m.to, m.reason])).toEqual(GOLDEN_TRANSITIONS);
    const systemMoves = moves.filter((m) => m.actor.startsWith("SYSTEM:")).map((m) => m.reason);
    expect(systemMoves).toEqual(["T14_VIABILITY_PASSED", "TRAINING_COMPLETED", "CLAIM_EVIDENCE_VERIFIED"]);
    expect(moves.every((m) => m.actor.startsWith("USER:") || m.actor.startsWith("SYSTEM:"))).toBe(true);
    // What the operator was shown when they decided travels in the audit row.
    const started = moves.find((m) => m.reason === "DELIVERY_STARTED");
    expect(started?.warnings.map((w) => w.code)).toContain("STARTED_EARLY");
    const completed = moves.find((m) => m.reason === "DELIVERY_VERIFIED_SUCCESS");
    expect(completed?.warnings.map((w) => w.code)).toContain("SOME_BELOW_80");
  });

  it("keeps the SHA-256 audit chain intact", async () => {
    const verdict = await verifyChain();
    expect(verdict.ok).toBe(true);
    expect(verdict.rows).toBeGreaterThan(100);
    const [broken] = await rows<{ n: number }>(db(), sql`select count(*)::int as n from tpms.audit_verify_chain() where not ok`);
    expect(broken.n).toBe(0);
  });

  it("leaves no dead-lettered, exhausted or retrying task, and nothing due behind it", async () => {
    const mine = await taskTotals(packageId());
    expect(mine.deadLettered).toEqual([]);
    expect(mine.retrying).toEqual([]);
    expect(mine.byStatus.FAILED ?? 0).toBe(0);
    // Only the genuinely future work stays queued: the T+90 and T+300 retention runs.
    expect(mine.future).toEqual({ "retention.run": 2 });
    expect(mine.byStatus.QUEUED).toBe(2);
    const all = await taskTotals();
    expect(all.deadLettered).toEqual([]);
    expect(all.retrying).toEqual([]);
  });

  it("declares every fast-forward, and fast-forwards nothing else", () => {
    const ff = result.steps.filter((s) => s.fastForwards.length > 0).map((s) => [s.step, s.fastForwards.length]);
    expect(ff).toEqual([
      ["t14", 1],
      ["retention.t14", 1],
      ["sweep", 1],
    ]);
    expect(result.steps.find((s) => s.step === "t14")?.fastForwards[0]).toMatch(/^⏩ fast-forward: viability\.t14_check was due /);
    expect(result.steps.find((s) => s.step === "sweep")?.notes.join(" ")).toMatch(/STAGE_DELIVERY_COMPLETED/);
  });

  it("issues certificates that verify VALID, and none to the participant below 80%", async () => {
    const certs = await listCertificates({ packageId: packageId() });
    expect(certs).toHaveLength(GOLDEN_SCENARIO.roster - 1);
    for (const c of certs) {
      const verdict = await verifyCertificate(c.serial);
      expect(verdict.status).toBe("VALID");
    }
    expect(result.certificates.map((c) => c.url).sort()).toEqual(certs.map((c) => `http://localhost:3100/verify/${c.serial}`).sort());
    const absentee = cohortFor(GOLDEN_SCENARIO)[GOLDEN_SCENARIO.absentee!.index];
    const [p] = await db()
      .select()
      .from(schema.packageParticipants)
      .where(and(eq(schema.packageParticipants.packageId, packageId()), eq(schema.packageParticipants.fullName, absentee.fullName)));
    expect(Number(p.attendanceRate)).toBe(75);
    expect(p.hrdClaimEligible).toBe(false);
    expect(p.certSerialNumber).toBeNull();
  });

  it("claims exactly the claimable amount and pays every voucher with a bank reference and receipt", async () => {
    const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId()));
    const [invoice] = await db().select().from(schema.taxInvoices).where(eq(schema.taxInvoices.packageId, packageId()));
    // Per-group (in-house): the approved grant in full once anyone is eligible.
    expect(invoice.total).toBe(pkg.grantApprovedAmount);
    expect(pkg.hrdcApprovedAmount).toBe(invoice.total);
    expect(pkg.remittanceAmount).toBe(invoice.total);
    const vouchers = await listVouchers({ packageId: packageId() });
    expect(vouchers.map((v) => v.payeeType).sort()).toEqual(["TRAINER", "VENUE"]);
    for (const v of vouchers) {
      expect(v.status).toBe("PAID");
      expect(v.bankReference).toMatch(/^MBB-IBG-/);
      expect(v.receiptVaultId).toBeTruthy();
    }
    const trainer = vouchers.find((v) => v.payeeType === "TRAINER")!;
    expect(trainer.adjustments).toEqual([expect.objectContaining({ kind: "MILEAGE", amount: 50.4 })]);
    expect(trainer.finalAmount).toBe((Number(trainer.agreedAmount) + 50.4).toFixed(2));
  });

  it("schedules the three retention cadences and sends the T+14 pack after approval", async () => {
    const schedules = await listRetention({ packageId: packageId() });
    expect(schedules.map((s) => [s.cadenceType, s.status]).sort()).toEqual([
      ["EXECUTIVE_PACK_T14", "DISPATCHED"],
      ["LEVY_YEAR_END_T300", "PENDING"],
      ["SYLLABUS_LADDER_T90", "PENDING"],
    ]);
  });

  it("verifies the Day 1 register by OCR when the extraction service is up, and by digital T3 otherwise", async () => {
    const t3 = await db()
      .select()
      .from(schema.complianceVault)
      .where(and(eq(schema.complianceVault.packageId, packageId()), eq(schema.complianceVault.documentType, "FORM_T3")));
    expect(t3.every((d) => d.verificationStatus === "VERIFIED")).toBe(true);
    const sources = t3.map((d) => d.extractedMetadata.source).sort();
    if (result.ocr.available) {
      expect(sources).toEqual(["TRACK_A", "TRACK_B_SCAN"]);
      const [decision] = await db()
        .select()
        .from(schema.decisions)
        .where(and(eq(schema.decisions.gate, "ATTENDANCE_EXCEPTION"), eq(schema.decisions.packageId, packageId())));
      expect(decision).toMatchObject({ status: "RESOLVED", resolvedBy: "usr_siti_ops" });
    } else {
      expect(sources).toEqual(["TRACK_A", "TRACK_A"]);
    }
    const photos = await db()
      .select()
      .from(schema.complianceVault)
      .where(and(eq(schema.complianceVault.packageId, packageId()), eq(schema.complianceVault.documentType, "PHOTO_EVIDENCE")));
    expect(photos.map((p) => [p.verificationStatus, p.verifiedBy])).toEqual([
      ["VERIFIED", "evidence.photo_exif"],
      ["VERIFIED", "evidence.photo_exif"],
    ]);
  });

  it("never stores a participant's NRIC in clear, in any table", async () => {
    const people = cohortFor(GOLDEN_SCENARIO);
    const patterns = people.flatMap((p) => [`%${p.nric}%`, `%${p.nric.replace(/-/g, "")}%`]);
    const tables = await rows<{ table_name: string }>(
      db(),
      sql`select table_name from information_schema.tables where table_schema = 'tpms' and table_type = 'BASE TABLE' order by 1`,
    );
    expect(tables.length).toBeGreaterThan(30);
    const leaks: string[] = [];
    for (const { table_name } of tables) {
      const [hit] = await rows<{ n: number }>(
        db(),
        sql`select count(*)::int as n from ${sql.raw(`tpms.${table_name}`)} t where t::text like any (${`{${patterns.join(",")}}`}::text[])`,
      );
      if (hit.n > 0) leaks.push(`${table_name} (${hit.n})`);
    }
    expect(leaks).toEqual([]);

    // The places most likely to leak, sampled directly: vault metadata and audit payloads.
    const vault = await rows<{ meta: string }>(db(), sql`select extracted_metadata::text || file_name || coalesce(verification_notes, '') as meta from tpms.compliance_vault`);
    const audit = await rows<{ meta: string }>(db(), sql`select metadata_diff::text || reason_details as meta from tpms.audit_ledger`);
    for (const p of people) {
      const digits = p.nric.replace(/-/g, "");
      expect(vault.some((v) => v.meta.includes(digits) || v.meta.includes(p.nric))).toBe(false);
      expect(audit.some((a) => a.meta.includes(digits) || a.meta.includes(p.nric))).toBe(false);
    }
    const masked = await db().select({ m: schema.packageParticipants.nricMasked }).from(schema.packageParticipants).where(eq(schema.packageParticipants.packageId, packageId()));
    expect(masked.map((r) => r.m).every((m) => /^\*{6}-\*\*-\d{4}$/.test(m))).toBe(true);
  });
});
