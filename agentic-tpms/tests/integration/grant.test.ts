import JSZip from "jszip";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, db, rows, schema } from "@/server/db/client";
import { sha256Hex } from "@/server/lib/crypto";
import { readDocument, storeDocument } from "@/server/storage/vault";
import { claimDue } from "@/server/queue/queue";
import { handlers } from "@/server/commercial/tasks";
import {
  compileDossier,
  confirmGrant,
  extractApprovalLetter,
  fileUpfrontClaim,
  flagApprovalLetter,
  recordApprovalLetter,
  type GrantLetterExtraction,
} from "@/server/grant";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { driveToGrantPending, makeDraftPackage, reload, seedCommercialWorld, type CommercialWorld } from "../helpers/commercial-fixtures";

let world: CommercialWorld;

beforeAll(async () => {
  await useTestDatabase();
  world = await seedCommercialWorld();
});
afterAll(releaseTestDatabase);

const letterBytes = (label: string) => new TextEncoder().encode(`%PDF-1.4\n% e-TRiS approval ${label}\n%%EOF\n`);

async function unzip(vaultId: string) {
  const read = await readDocument(vaultId);
  if (!read) throw new Error("dossier missing");
  return JSZip.loadAsync(read.bytes);
}

describe("Stage 3: e-TRiS dossier", () => {
  it("compiles outline, quotation, trainer profile and a checklist with a SHA-256 manifest", async () => {
    const { pkg } = await driveToGrantPending();
    const result = await compileDossier(pkg.id);
    expect(result.reused).toBe(false);
    expect(result.missing).toEqual(["TTT_CERT"]);

    const zip = await unzip(result.vaultId);
    expect(Object.keys(zip.files).sort()).toEqual([
      "01-cover-checklist.pdf",
      "02-form-hrd-ld.pdf",
      "03-quotation.pdf",
      "04-trainer-cv.pdf",
      "manifest.json",
    ]);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as { files: Array<{ file: string; sha256: string; source: string; vaultId: string | null }> };
    for (const entry of manifest.files) {
      const bytes = await zip.file(entry.file)!.async("uint8array");
      expect(sha256Hex(bytes), entry.file).toBe(entry.sha256);
    }
    // The quotation and outline in the pack are the very bytes the vault holds from Gate 1.
    const quotation = manifest.files.find((f) => f.file === "03-quotation.pdf")!;
    expect(quotation.source).toBe("VAULT");
    const vaulted = await readDocument(quotation.vaultId!);
    expect(sha256Hex(vaulted!.bytes)).toBe(quotation.sha256);
    expect(manifest.files.find((f) => f.file === "04-trainer-cv.pdf")!.source).toBe("GENERATED");

    const [doc] = await db()
      .select()
      .from(schema.complianceVault)
      .where(and(eq(schema.complianceVault.packageId, pkg.id), eq(schema.complianceVault.documentType, "ETRIS_DOSSIER")));
    expect(doc).toMatchObject({ mimeType: "application/zip", fileHashSha256: result.sha256 });

    const again = await compileDossier(pkg.id);
    expect(again).toMatchObject({ reused: true, vaultId: result.vaultId, sha256: result.sha256 });
  });

  it("includes the trainer's own CV and TTT certificate when the vault has them", async () => {
    const { pkg, draft } = await driveToGrantPending();
    const trainerId = draft.trainerId!;
    await storeDocument(db(), { trainerId, documentType: "TRAINER_CV", fileName: "cv.pdf", mimeType: "application/pdf", bytes: letterBytes("cv"), uploadedBy: ALEX.id });
    await storeDocument(db(), { trainerId, documentType: "TTT_CERT", fileName: "ttt.png", mimeType: "image/png", bytes: letterBytes("ttt"), uploadedBy: ALEX.id });
    const result = await compileDossier(pkg.id);
    expect(result.missing).toEqual([]);
    expect(result.files.map((f) => `${f.file}:${f.source}`)).toEqual(
      expect.arrayContaining(["04-trainer-cv.pdf:VAULT", "05-ttt-certificate.png:VAULT"]),
    );
  });

  it("runs from the queue task the FSM enqueued on acceptance", async () => {
    const { pkg } = await driveToGrantPending();
    const leased = await claimDue("lane-b-grant", 50, 60, ["grant.compile_dossier"]);
    const task = leased.find((t) => t.payload.packageId === pkg.id)!;
    const out = await handlers["grant.compile_dossier"]!(task, { workerId: "lane-b-grant", heartbeat: async () => undefined });
    expect(out.files).toEqual(expect.arrayContaining(["01-cover-checklist.pdf", "02-form-hrd-ld.pdf", "03-quotation.pdf"]));
    const [run] = await rows<{ agent: string; tier: string; status: string }>(
      db(),
      sql`select agent, tier, status from tpms.agent_runs where task_id = ${task.id}::uuid`,
    );
    expect(run).toEqual({ agent: "grant.dossier_compiler", tier: "L0", status: "SUCCEEDED" });
  });

  it("refuses a package with no approved quotation", async () => {
    const pkg = await makeDraftPackage();
    await expect(compileDossier(pkg.id)).rejects.toMatchObject({ code: "NO_APPROVED_QUOTATION" });
  });
});

describe("Stage 3: approval letter → verification decision → grant approved", () => {
  const extraction = (over: Partial<GrantLetterExtraction> = {}): GrantLetterExtraction => ({
    grantId: "SBLK/2026/0012345",
    approvedPax: 20,
    approvedAmount: "16000.00",
    startDate: null,
    endDate: null,
    employerName: "Kenanga Retail Group Sdn Bhd",
    confidence: 0.91,
    rawText: "PEMBANGUNAN SUMBER MANUSIA BERHAD ... approved",
    engine: "stub-ocr",
    ...over,
  });

  it("records the letter as PENDING evidence and queues extraction; only while the grant is pending", async () => {
    const draftOnly = await makeDraftPackage();
    await expect(recordApprovalLetter(draftOnly.id, letterBytes("x"), "application/pdf", "letter.pdf", ALEX)).rejects.toMatchObject({
      code: "PACKAGE_NOT_GRANT_PENDING",
    });
    const { pkg } = await driveToGrantPending();
    await expect(recordApprovalLetter(pkg.id, letterBytes("x"), "text/html", "letter.html", ALEX)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    const { document, taskId } = await recordApprovalLetter(pkg.id, letterBytes("a"), "application/pdf", "etris-approval.pdf", ALEX);
    expect(document).toMatchObject({ documentType: "ETRIS_APPROVAL", verificationStatus: "PENDING", uploadedBy: ALEX.id });
    expect(taskId).not.toBeNull();
    const [task] = await rows<{ task_type: string; payload: { vaultId: string } }>(db(), sql`select task_type, payload from tpms.task_queue where id = ${taskId}::uuid`);
    expect(task).toMatchObject({ task_type: "grant.extract_letter", payload: { vaultId: document.id } });
  });

  it("raises GRANT_VERIFICATION with the extracted values and cross-checks against the quotation", async () => {
    const { pkg } = await driveToGrantPending();
    const { document } = await recordApprovalLetter(pkg.id, letterBytes("b"), "application/pdf", "etris-approval.pdf", ALEX);
    const result = await extractApprovalLetter(document.id, { extractor: async () => extraction({ approvedPax: 25 }) });
    expect(result.available).toBe(true);

    const [decision] = await rows<{ gate: string; status: string; raised_by: string; raised_by_tier: string; payload: { extracted: Record<string, unknown>; checks: Array<{ field: string; ok: boolean }> } }>(
      db(),
      sql`select gate, status, raised_by, raised_by_tier, payload from tpms.decisions where id = ${result.decisionId}::uuid`,
    );
    expect(decision).toMatchObject({ gate: "GRANT_VERIFICATION", status: "PENDING", raised_by: "grant.letter_extractor", raised_by_tier: "L2" });
    expect(decision.payload.extracted).toMatchObject({ grantId: "SBLK/2026/0012345", approvedAmount: "16000.00", approvedPax: 25 });
    expect(decision.payload.checks.find((c) => c.field === "approvedPax")?.ok).toBe(false);
    expect(decision.payload.checks.find((c) => c.field === "employerName")?.ok).toBe(true);

    const read = await readDocument(document.id);
    expect(read!.doc.verificationStatus).toBe("PENDING");
    expect((read!.doc.extractedMetadata as { extraction: { engine: string } }).extraction.engine).toBe("stub-ocr");
    expect((await reload(pkg.id)).etrisGrantId).toBeNull();
  });

  it("falls back to manual entry when extraction is unavailable, instead of failing the task", async () => {
    const { pkg } = await driveToGrantPending();
    const { document, taskId } = await recordApprovalLetter(pkg.id, letterBytes("c"), "application/pdf", "etris-approval.pdf", ALEX);
    const down = await extractApprovalLetter(document.id, {
      extractor: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8866");
      },
    });
    expect(down).toMatchObject({ available: false, extraction: null });
    expect(down.reason).toMatch(/^EXTRACTION_FAILED: connect ECONNREFUSED/);
    const [decision] = await rows<{ summary: string; payload: { extracted: Record<string, unknown>; available: boolean } }>(
      db(),
      sql`select summary, payload from tpms.decisions where id = ${down.decisionId}::uuid`,
    );
    expect(decision.payload.available).toBe(false);
    expect(Object.values(decision.payload.extracted).every((v) => v === null)).toBe(true);
    expect(decision.summary).toMatch(/enter the grant reference/);

    const junk = await extractApprovalLetter(document.id, { extractor: async () => ({ grantId: 42 }) });
    expect(junk.reason).toMatch(/^EXTRACTION_SHAPE_REJECTED/);

    // The real task path (whatever the extraction module does in this build) always ends in a decision.
    const [task] = await rows<{ id: string }>(db(), sql`select id from tpms.task_queue where id = ${taskId}::uuid`);
    const leased = await claimDue("lane-b-letter", 50, 60, ["grant.extract_letter"]);
    const mine = leased.find((t) => t.id === task.id)!;
    const out = await handlers["grant.extract_letter"]!(mine, { workerId: "lane-b-letter", heartbeat: async () => undefined });
    expect(out.decisionId).toBeTruthy();
  });

  it("confirms the grant: letter VERIFIED, GRANT_APPROVED, decision resolved, operator corrections kept", async () => {
    const { pkg } = await driveToGrantPending();
    const { document } = await recordApprovalLetter(pkg.id, letterBytes("d"), "application/pdf", "etris-approval.pdf", ALEX);
    await extractApprovalLetter(document.id, { extractor: async () => extraction({ approvedAmount: "15500.00" }) });

    await expect(confirmGrant(pkg.id, { grantId: "SBLK/2026/0012345", approvedAmount: "16000", approvedPax: 20 }, SYSTEM_ACTOR)).rejects.toMatchObject({
      code: "TRANSITION_ACTOR_REJECTED",
    });
    await expect(confirmGrant(pkg.id, { grantId: "SBLK/2026/0012345", approvedAmount: "16000.01", approvedPax: 20 }, ALEX)).rejects.toMatchObject({
      code: "GUARD_FAILED",
    });
    await expect(confirmGrant(pkg.id, { grantId: "x", approvedAmount: "abc", approvedPax: 0 }, ALEX)).rejects.toMatchObject({ code: "INVALID_GRANT_DETAILS" });

    const { outcome, letter } = await confirmGrant(pkg.id, { grantId: "sblk/2026/0012345", approvedAmount: "RM 16,000.00", approvedPax: 20 }, ALEX);
    expect(outcome.pkg).toMatchObject({
      operationalStage: "GRANT_APPROVED",
      etrisGrantId: "SBLK/2026/0012345",
      grantApprovedAmount: "16000.00",
      grantApprovedPax: 20,
    });
    expect(letter.verificationStatus).toBe("VERIFIED");
    expect(letter.verifiedBy).toBe(ALEX.id);
    expect((letter.extractedMetadata as { overrides: Record<string, unknown> }).overrides).toEqual({
      approvedAmount: { extracted: "15500.00", confirmed: "16000.00" },
    });

    const [move] = await rows<{ actor_type: string; reason_code: string; metadata_diff: { context: { overrides: Record<string, unknown> } } }>(
      db(),
      sql`select actor_type, reason_code, metadata_diff from tpms.audit_ledger
           where entity_id = ${pkg.id}::uuid and machine = 'OPERATIONAL' and to_stage = 'GRANT_APPROVED'`,
    );
    expect(move).toMatchObject({ actor_type: "USER", reason_code: "GRANT_CONFIRMED_LOCKED" });
    expect(move.metadata_diff.context.overrides).toHaveProperty("approvedAmount");
    const [decision] = await rows<{ status: string; chosen_option: string }>(
      db(),
      sql`select status, chosen_option from tpms.decisions where subject_ref = ${pkg.packageCode} and gate = 'GRANT_VERIFICATION'`,
    );
    expect(decision).toEqual({ status: "APPROVED", chosen_option: "CONFIRM" });
    const [t14] = await rows<{ n: number }>(
      db(),
      sql`select count(*)::int as n from tpms.task_queue where task_type = 'viability.t14_check' and payload->>'packageId' = ${pkg.id}`,
    );
    expect(t14.n).toBe(1);
  });

  it("moves the tentative holds when the approved dates differ", async () => {
    const { pkg } = await driveToGrantPending();
    await recordApprovalLetter(pkg.id, letterBytes("e"), "application/pdf", "etris-approval.pdf", ALEX);
    const start = "2027-03-01";
    await confirmGrant(pkg.id, { grantId: "SBLK/2027/0000777", approvedAmount: "16000", approvedPax: 20, startDate: start, endDate: "2027-03-02" }, ALEX);
    const [hold] = await db().select().from(schema.trainerEngagements).where(eq(schema.trainerEngagements.packageId, pkg.id));
    expect(hold.holdExpiryDate).toBe(start);
    const [venue] = await db().select().from(schema.vendorCommitments).where(eq(schema.vendorCommitments.packageId, pkg.id));
    expect(venue).toMatchObject({ cancellationDeadline: "2027-02-15", postponementDeadline: "2027-02-22", vendorId: world.venues.sunway });
  });

  it("flags a wrong letter and closes the decision as rejected", async () => {
    const { pkg } = await driveToGrantPending();
    const { document } = await recordApprovalLetter(pkg.id, letterBytes("f"), "application/pdf", "etris-approval.pdf", ALEX);
    await extractApprovalLetter(document.id, { extractor: async () => extraction() });
    const flagged = await flagApprovalLetter(pkg.id, document.id, "Letter is for a different programme", ALEX);
    expect(flagged.verificationStatus).toBe("FLAGGED");
    await expect(confirmGrant(pkg.id, { grantId: "SBLK/2026/0012345", approvedAmount: "16000", approvedPax: 20 }, ALEX)).rejects.toMatchObject({
      code: "APPROVAL_LETTER_MISSING",
    });
  });
});

describe("Stage 3: the optional 30% upfront claim", () => {
  it("files exactly 30% of the approved grant", async () => {
    const { pkg } = await driveToGrantPending();
    await expect(fileUpfrontClaim(pkg.id, ALEX)).rejects.toMatchObject({ code: "GRANT_NOT_APPROVED" });
    await recordApprovalLetter(pkg.id, letterBytes("g"), "application/pdf", "etris-approval.pdf", ALEX);
    await confirmGrant(pkg.id, { grantId: "SBLK/2026/0099887", approvedAmount: "15333.33", approvedPax: 18 }, ALEX);
    await expect(fileUpfrontClaim(pkg.id, SYSTEM_ACTOR)).rejects.toMatchObject({ code: "TRANSITION_ACTOR_REJECTED" });

    const outcome = await fileUpfrontClaim(pkg.id, ALEX);
    expect(outcome.pkg).toMatchObject({
      financialStage: "UPFRONT_CLAIM_SUBMITTED",
      upfrontAmount: "4600.00", // 30% of 15,333.33 = 4,599.999 → 4,600.00
      upfront30pctClaimed: true,
    });
    const [move] = await rows<{ actor_type: string; reason_code: string }>(
      db(),
      sql`select actor_type, reason_code from tpms.audit_ledger where entity_id = ${pkg.id}::uuid and machine = 'FINANCIAL' and to_stage = 'UPFRONT_CLAIM_SUBMITTED'`,
    );
    expect(move).toEqual({ actor_type: "USER", reason_code: "UPFRONT_CLAIM_FILED" });
  });
});

describe("lane-B worker handlers", () => {
  it("registers every task type this lane owns", () => {
    expect(Object.keys(handlers).sort()).toEqual([
      "commercial.dispatch_quotation",
      "commercial.draft_proposal",
      "grant.compile_dossier",
      "grant.extract_letter",
      "knowledge.embed",
    ]);
  });
});
