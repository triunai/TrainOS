import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { SYSTEM_ACTOR, db, rows, schema } from "@/server/db/client";
import { updatePackageFields } from "@/server/fsm/service";
import { claimDue } from "@/server/queue/queue";
import { readDocument } from "@/server/storage/vault";
import { verifyChain } from "@/server/audit/ledger";
import {
  approveAndDispatch,
  clientAccepted,
  confirmTrainer,
  dispatchQuotation,
  draftProposal,
  getCommercialView,
  requestProposalDraft,
  requestRevision,
  saveQuotationRevision,
  signVenueBeo,
} from "@/server/commercial";
import { handlers } from "@/server/commercial/tasks";
import { listPolicies, recomputeFromCells, updatePolicyBands } from "@/server/pricing";
import { expectRefusal, releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX } from "../helpers/factory";
import { makeDraftPackage, reload, seedCommercialWorld, type CommercialWorld } from "../helpers/commercial-fixtures";

let world: CommercialWorld;

beforeAll(async () => {
  await useTestDatabase();
  world = await seedCommercialWorld();
});
afterAll(releaseTestDatabase);

const quotationsOf = (packageId: string) =>
  db().select().from(schema.quotations).where(eq(schema.quotations.packageId, packageId)).orderBy(schema.quotations.version);

const pendingDecisions = (packageCode: string) =>
  rows<{ id: string; gate: string; status: string; raised_by: string; raised_by_tier: string; payload: Record<string, unknown> }>(
    db(),
    sql`select id, gate, status, raised_by, raised_by_tier, payload from tpms.decisions where subject_ref = ${packageCode} and status = 'PENDING'`,
  );

describe("Stage 2: the sourcing agent drafts, never decides", () => {
  it("drafts an AWAITING_APPROVAL quotation and raises Gate 1 while the package stays DRAFT", async () => {
    const pkg = await makeDraftPackage();
    const result = await draftProposal(pkg.id);

    expect(result.version).toBe(1);
    expect(result.quotedAmount).toBe("16000.00"); // IN_HOUSE 11–20 pax band, RM 8,000 × 2 days
    expect(result.allowableCap).toBe("16000.00");
    expect(result.trainerId).toBe(world.trainers.farah); // cheapest VERIFIED leadership trainer (Lim is unverified)
    expect(result.venueId).toBe(world.venues.sunway); // cheapest venue that seats 20
    expect(result.warnings).toContain("COURSE_FROM_SEARCH");

    const [q] = await quotationsOf(pkg.id);
    expect(q).toMatchObject({ status: "AWAITING_APPROVAL", generatedBy: "AGENT", quotedAmount: "16000.00", costPolicyVersion: "ACM-2026.1" });
    // trainer 3000×2 + venue 95×20×2 + materials 50×20 + other 300 = 11,100 → margin 4,900 (30.63%)
    expect(q.totalDirectCost).toBe("11100.00");
    expect(q.grossMargin).toBe("4900.00");
    expect(q.marginPct).toBe("30.63");
    expect((q.lineItems as Array<{ code: string }>).map((l) => l.code)).toEqual(["TRAINER", "VENUE", "MATERIALS", "OTHER", "COURSE_FEE"]);
    expect(q.sheetSnapshot).toMatchObject({ id: "tpms-quotation", sheetOrder: ["quote"] });
    expect((q.courseOutline as { days: unknown[]; courseCode: string }).days).toHaveLength(2);
    expect((q.courseOutline as { courseCode: string }).courseCode).toBe("LEAD-201");
    expect(q.provenance).toMatchObject({ agent: "commercial.sourcing_agent", tier: "L3" });

    const after = await reload(pkg.id);
    expect(after.operationalStage).toBe("DRAFT");
    expect(after.quotedAmount).toBe("0.00");
    expect(after.courseId).toBeNull();

    const decisions = await pendingDecisions(pkg.packageCode);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ gate: "GATE1_COMMERCIAL", raised_by: "commercial.sourcing_agent", raised_by_tier: "L3" });
    expect(decisions[0].payload.quotationId).toBe(q.id);

    const [run] = await rows<{ agent: string; tier: string; status: string; package_id: string }>(
      db(),
      sql`select agent, tier, status, package_id from tpms.agent_runs where id = ${result.runId}::uuid`,
    );
    // No API keys exist: the outline ran in TEMPLATE mode, which the run records honestly.
    expect(run).toMatchObject({ agent: "commercial.sourcing_agent", tier: "L3", status: "FALLBACK", package_id: pkg.id });

    const [audit] = await rows<{ actor_type: string; actor_id: string }>(
      db(),
      sql`select actor_type, actor_id from tpms.audit_ledger where entity_type = 'QUOTATION' and entity_id = ${q.id}::uuid and reason_code = 'QUOTATION_DRAFTED'`,
    );
    expect(audit).toEqual({ actor_type: "AGENT", actor_id: "commercial.sourcing_agent" });
  });

  it("supersedes the open version on a re-draft and keeps one pending decision", async () => {
    const pkg = await makeDraftPackage();
    await draftProposal(pkg.id);
    const second = await draftProposal(pkg.id);
    expect(second.version).toBe(2);
    const qs = await quotationsOf(pkg.id);
    expect(qs.map((q) => q.status)).toEqual(["SUPERSEDED", "AWAITING_APPROVAL"]);
    expect(await pendingDecisions(pkg.packageCode)).toHaveLength(1);
  });

  it("runs as a queued task, idempotently per task", async () => {
    const pkg = await makeDraftPackage();
    await db().insert(schema.taskQueue).values({ taskType: "commercial.draft_proposal", payload: { packageId: pkg.id }, idempotencyKey: `t-${pkg.id}` });
    const [task] = await claimDue("lane-b-test", 1, 60, ["commercial.draft_proposal"]);
    const ctx = { workerId: "lane-b-test", heartbeat: async () => undefined };
    const first = await handlers["commercial.draft_proposal"]!(task, ctx);
    const retry = await handlers["commercial.draft_proposal"]!(task, ctx);
    expect(retry).toMatchObject({ quotationId: first.quotationId, reused: true });
    expect(await quotationsOf(pkg.id)).toHaveLength(1);
    await expect(handlers["commercial.draft_proposal"]!({ ...task, payload: { packageId: "nope" } }, ctx)).rejects.toMatchObject({ code: "INVALID_TASK_PAYLOAD" });
  });

  it("exposes one read model for the desk and queues drafts idempotently", async () => {
    const pkg = await makeDraftPackage();
    const queued = await requestProposalDraft(pkg.id, ALEX);
    expect(queued.taskId).not.toBeNull();
    expect((await requestProposalDraft(pkg.id, ALEX)).taskId).toBeNull();
    await draftProposal(pkg.id);
    const view = await getCommercialView(pkg.id);
    expect(view.versions).toHaveLength(1);
    expect(view.latest?.sheetSnapshot).toBeTruthy();
    expect(view.canvas.cellAddresses.QuotedFeeOverride).toBe("B12");
    expect(Object.keys(view.canvas.editableCells)).toEqual(["TrainerDailyRate", "VenueDDRPerPax", "MaterialsCostPerPax", "OtherCosts", "QuotedFeeOverride"]);
    expect(view.pendingDecision?.gate).toBe("GATE1_COMMERCIAL");
    expect(view.engagement).toBeNull();
  });

  it("prices ROT without a venue and on the ROT matrix", async () => {
    const pkg = await makeDraftPackage({ mode: "ROT_VIRTUAL", pax: 20 });
    const result = await draftProposal(pkg.id);
    expect(result.venueId).toBeNull();
    expect(result.allowableCap).toBe("12000.00"); // ROT 11–25 pax: RM 6,000 × 2 days
    const [q] = await quotationsOf(pkg.id);
    expect((q.lineItems as Array<{ code: string; amount: string }>).find((l) => l.code === "VENUE")?.amount).toBe("0.00");
  });

  it("refuses a cohort the matrix cannot price and records the failed run", async () => {
    const pkg = await makeDraftPackage({ pax: 61 });
    await expect(draftProposal(pkg.id)).rejects.toMatchObject({ code: "PAX_OUTSIDE_MATRIX" });
    const [run] = await rows<{ status: string; error: string }>(
      db(),
      sql`select status, error from tpms.agent_runs where package_id = ${pkg.id}::uuid order by started_at desc limit 1`,
    );
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(/outside the IN_HOUSE bands/);
  });

  it("never proposes a trainer already held on overlapping dates", async () => {
    const a = await makeDraftPackage({ startInDays: 200 });
    const b = await makeDraftPackage({ startInDays: 201 });
    const draftA = await draftProposal(a.id);
    expect(draftA.trainerId).toBe(world.trainers.farah);
    await approveAndDispatch(a.id, draftA.quotationId, ALEX);
    const draftB = await draftProposal(b.id);
    expect(draftB.trainerId).toBe(world.trainers.kumar); // Farah is held on day 201; Lim is unverified
  });

  it("uses the package's own course when one is set, and a trainer whose specialty matches it", async () => {
    const pkg = await makeDraftPackage({ courseCode: "OSH-201", title: "HIRARC for Line Leaders", tna: {} });
    const result = await draftProposal(pkg.id);
    expect(result.trainerId).toBe(world.trainers.hafiz);
    expect(result.warnings).not.toContain("COURSE_FROM_SEARCH");
  });
});

describe("Gate 1: revisions are recomputed on the server; the cap cannot be exceeded", () => {
  it("recomputes canvas edits with both engines and never trusts client formulas", async () => {
    const pkg = await makeDraftPackage();
    await draftProposal(pkg.id);
    const preview = await recomputeFromCells(pkg.id, { TrainerDailyRate: "3,200.00", QuotedFeeOverride: 15000 }, ALEX);
    expect(preview.result.quotedFee).toBe(1_500_000);
    expect(preview.result.lineItems.find((l) => l.code === "TRAINER")?.amount).toBe(640_000);
    expect((preview.snapshot as { sheets: unknown }).sheets).toBeDefined();
    await expect(recomputeFromCells(pkg.id, { PaxCount: 40 }, ALEX)).rejects.toMatchObject({ code: "UNKNOWN_CELL" });
    await expect(recomputeFromCells(pkg.id, { TrainerDailyRate: "-5" }, ALEX)).rejects.toMatchObject({ code: "INVALID_CELL_VALUE" });
    await expect(recomputeFromCells(pkg.id, { TrainerDailyRate: 1 }, SYSTEM_ACTOR)).rejects.toMatchObject({ code: "USER_REQUIRED" });
  });

  it("clamps an above-cap override and the database refuses any quote above its cap", async () => {
    const pkg = await makeDraftPackage();
    await draftProposal(pkg.id);
    const revised = await saveQuotationRevision(pkg.id, { QuotedFeeOverride: "99999" }, ALEX);
    expect(revised.quotedAmount).toBe("16000.00");
    expect((revised.computed as { warnings: string[] }).warnings).toContain("OVERRIDE_CLAMPED_TO_CAP");

    await expectRefusal(
      db().insert(schema.quotations).values({
        packageId: pkg.id, version: 99, status: "DRAFT", inputs: {}, lineItems: [], computed: {}, allowableCap: "16000.00",
        quotedAmount: "16000.01", totalDirectCost: "0", grossMargin: "0", marginPct: "0", costPolicyVersion: "ACM-2026.1", generatedBy: "USER",
      }),
      /quote_within_cap/,
    );
    await expect(
      updatePackageFields(pkg.id, { allowableCostCap: "16000.00", quotedAmount: "16000.01" }, ALEX, "TEST_CAP_BREACH"),
    ).rejects.toMatchObject({ code: "CONSTRAINT_VIOLATION", details: { constraint: "pkg_quote_within_cap" } });
  });
});

describe("Gate 1: approve and dispatch", () => {
  it("refuses a SYSTEM actor with the FSM's own code and changes nothing", async () => {
    const pkg = await makeDraftPackage();
    const draft = await draftProposal(pkg.id);
    await expect(approveAndDispatch(pkg.id, draft.quotationId, SYSTEM_ACTOR)).rejects.toMatchObject({ code: "TRANSITION_ACTOR_REJECTED" });
    await expect(approveAndDispatch(pkg.id, draft.quotationId, { type: "AGENT", id: "commercial.sourcing_agent" })).rejects.toMatchObject({
      code: "TRANSITION_ACTOR_REJECTED",
    });
    const [q] = await quotationsOf(pkg.id);
    expect(q.status).toBe("AWAITING_APPROVAL");
    expect((await reload(pkg.id)).operationalStage).toBe("DRAFT");
  });

  it("approves in one transaction: QUOTED with the diff in the audit row, PDFs vaulted, holds placed, decision resolved", async () => {
    const pkg = await makeDraftPackage();
    await draftProposal(pkg.id);
    const revised = await saveQuotationRevision(pkg.id, { TrainerDailyRate: "3200", QuotedFeeOverride: "15000" }, ALEX);
    expect(revised.generatedBy).toBe("USER");

    const result = await approveAndDispatch(pkg.id, revised.id, ALEX);
    const after = await reload(pkg.id);
    expect(after).toMatchObject({
      operationalStage: "QUOTED",
      financialStage: "ESTIMATE",
      quotedAmount: "15000.00",
      allowableCostCap: "16000.00",
      trainerDayRate: "3200.00",
      costPolicyVersion: "ACM-2026.1",
    });
    expect(after.courseId).not.toBeNull();

    const [move] = await rows<{ actor_type: string; actor_id: string; reason_code: string; metadata_diff: { context: { line_items_diff: Record<string, { old: { amount: string }; new: { amount: string }; fields: string[] }> } } }>(
      db(),
      sql`select actor_type, actor_id, reason_code, metadata_diff from tpms.audit_ledger
           where entity_id = ${pkg.id}::uuid and machine = 'OPERATIONAL' and to_stage = 'QUOTED'`,
    );
    expect(move).toMatchObject({ actor_type: "USER", actor_id: ALEX.id, reason_code: "COMMERCIAL_TERMS_APPROVED" });
    const diff = move.metadata_diff.context.line_items_diff;
    expect(diff.TRAINER).toMatchObject({ old: { amount: "6000.00" }, new: { amount: "6400.00" } });
    expect(diff.TRAINER.fields).toEqual(expect.arrayContaining(["unitCost", "amount"]));
    expect(diff.COURSE_FEE).toMatchObject({ old: { amount: "16000.00" }, new: { amount: "15000.00" } });
    expect(diff.VENUE).toBeUndefined();
    expect(result.lineItemsDiff).toEqual(diff);

    const vault = await db().select().from(schema.complianceVault).where(eq(schema.complianceVault.packageId, pkg.id));
    expect(vault.map((v) => v.documentType).sort()).toEqual(["FORM_HRD_LD", "QUOTATION", "TRAINER_AGREEMENT"]);
    const pdf = await readDocument(result.documents.quotation.id);
    expect(pdf?.intact).toBe(true);
    expect(Buffer.from(pdf!.bytes.subarray(0, 5)).toString()).toBe("%PDF-");

    const [engagement] = await db().select().from(schema.trainerEngagements).where(eq(schema.trainerEngagements.packageId, pkg.id));
    expect(engagement).toMatchObject({ status: "TENTATIVE_HOLD", trainerId: world.trainers.farah, dayRate: "3200.00", holdExpiryDate: pkg.startDate });
    const [venue] = await db().select().from(schema.vendorCommitments).where(eq(schema.vendorCommitments.packageId, pkg.id));
    expect(venue).toMatchObject({
      status: "PROVISIONAL",
      vendorId: world.venues.sunway,
      cost: "3800.00",
      cancellationDeadline: addDays(pkg.startDate!, -14),
      postponementDeadline: addDays(pkg.startDate!, -7),
    });

    const qs = await quotationsOf(pkg.id);
    expect(qs.map((q) => q.status)).toEqual(["SUPERSEDED", "APPROVED"]);
    expect(qs[1]).toMatchObject({ approvedBy: ALEX.id });
    expect(await pendingDecisions(pkg.packageCode)).toHaveLength(0);
    const [resolved] = await rows<{ status: string; resolved_by: string; chosen_option: string }>(
      db(),
      sql`select status, resolved_by, chosen_option from tpms.decisions where subject_ref = ${pkg.packageCode} and gate = 'GATE1_COMMERCIAL'`,
    );
    expect(resolved).toEqual({ status: "APPROVED", resolved_by: ALEX.id, chosen_option: "APPROVE" });

    const [dispatchTask] = await rows<{ task_type: string }>(
      db(),
      sql`select task_type from tpms.task_queue where task_type = 'commercial.dispatch_quotation' and payload->>'packageId' = ${pkg.id}`,
    );
    expect(dispatchTask).toBeDefined();
    expect((await verifyChain()).ok).toBe(true);
  });

  it("refuses a stale quotation (headcount changed) and a quotation priced under a superseded matrix", async () => {
    const pkg = await makeDraftPackage();
    const draft = await draftProposal(pkg.id);
    await updatePackageFields(pkg.id, { paxEstimate: 24 }, ALEX, "HEADCOUNT_UPDATED");
    await expect(approveAndDispatch(pkg.id, draft.quotationId, ALEX)).rejects.toMatchObject({ code: "QUOTATION_STALE" });

    const pkg2 = await makeDraftPackage();
    const draft2 = await draftProposal(pkg2.id);
    const inHouse = (await listPolicies()).find((p) => p.deliveryMode === "IN_HOUSE")!;
    const original = inHouse.bands;
    await updatePolicyBands(inHouse.id, original.map((b) => (b.minPax === 11 ? { ...b, dailyCap: 8500 } : b)), ALEX);
    try {
      await expect(approveAndDispatch(pkg2.id, draft2.quotationId, ALEX)).rejects.toMatchObject({ code: "COST_POLICY_CHANGED" });
    } finally {
      await updatePolicyBands(inHouse.id, original, ALEX);
    }
    // Only the latest version is approvable.
    const redraft = await draftProposal(pkg2.id);
    await expect(approveAndDispatch(pkg2.id, draft2.quotationId, ALEX)).rejects.toMatchObject({ code: "QUOTATION_NOT_APPROVABLE" });
    expect((await approveAndDispatch(pkg2.id, redraft.quotationId, ALEX)).outcome.to).toBe("QUOTED");
  });

  it("dispatches the approved PDFs once, even when the task is retried", async () => {
    const pkg = await makeDraftPackage();
    const draft = await draftProposal(pkg.id);
    await approveAndDispatch(pkg.id, draft.quotationId, ALEX);
    const sent: Array<{ to: string; attachments?: Array<{ filename: string; content: Uint8Array }> }> = [];
    const sender = async (m: { to: string; attachments?: Array<{ filename: string; content: Uint8Array }> }) => {
      sent.push(m);
      return { status: "SENT" as const, id: "msg-1" };
    };
    const first = await dispatchQuotation(pkg.id, { sender });
    expect(first).toMatchObject({ status: "SENT", mailId: "msg-1", to: "nurul@example.my" });
    expect(sent[0].attachments?.map((a) => a.filename)).toEqual([expect.stringMatching(/^QT-.*\.pdf$/), expect.stringMatching(/^LD-.*\.pdf$/)]);
    const retry = await dispatchQuotation(pkg.id, { sender });
    expect(retry).toMatchObject({ status: "SKIPPED", reason: "ALREADY_DISPATCHED" });
    expect(sent).toHaveLength(1);
  });

  it("dispatches through the worker handler even when no mailer is configured", async () => {
    const pkg = await makeDraftPackage();
    const draft = await draftProposal(pkg.id);
    await approveAndDispatch(pkg.id, draft.quotationId, ALEX);
    const [task] = await claimDue("lane-b-dispatch", 10, 60, ["commercial.dispatch_quotation"]);
    const result = await handlers["commercial.dispatch_quotation"]!(
      { ...task, payload: { packageId: pkg.id } },
      { workerId: "lane-b-dispatch", heartbeat: async () => undefined },
    );
    expect(["SENT", "LOGGED"]).toContain(result.status);
  });
});

describe("after QUOTED: revision, acceptance, Stage-4 holds", () => {
  it("sends a quotation back for revision and re-drafts from the queue", async () => {
    const pkg = await makeDraftPackage();
    const draft = await draftProposal(pkg.id);
    const first = await approveAndDispatch(pkg.id, draft.quotationId, ALEX);
    await expect(requestRevision(pkg.id, "  ", ALEX)).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    const back = await requestRevision(pkg.id, "Client wants 18 pax and a lower fee", ALEX);
    expect(back.pkg.operationalStage).toBe("DRAFT");
    const [task] = await rows<{ payload: { revisionNote: string } }>(
      db(),
      sql`select payload from tpms.task_queue where task_type = 'commercial.draft_proposal' and payload->>'packageId' = ${pkg.id}`,
    );
    expect(task.payload.revisionNote).toBe("Client wants 18 pax and a lower fee");

    const again = await draftProposal(pkg.id, { revisionNote: task.payload.revisionNote });
    const second = await approveAndDispatch(pkg.id, again.quotationId, ALEX);
    // Same trainer and venue proposed again: the existing holds are refreshed, not duplicated.
    expect(second.engagementId).toBe(first.engagementId);
    expect(second.commitmentId).toBe(first.commitmentId);
  });

  it("client acceptance reserves the grant and queues the e-TRiS dossier", async () => {
    const pkg = await makeDraftPackage();
    const draft = await draftProposal(pkg.id);
    await approveAndDispatch(pkg.id, draft.quotationId, ALEX);
    const outcome = await clientAccepted(pkg.id, ALEX);
    expect(outcome.pkg).toMatchObject({ operationalStage: "GRANT_PENDING", financialStage: "GRANT_RESERVED" });
    const [task] = await rows<{ n: number }>(
      db(),
      sql`select count(*)::int as n from tpms.task_queue where task_type = 'grant.compile_dossier' and payload->>'packageId' = ${pkg.id}`,
    );
    expect(task.n).toBe(1);
  });

  it("confirms a TTT-verified trainer and refuses an unverified one", async () => {
    const pkg = await makeDraftPackage();
    const draft = await draftProposal(pkg.id);
    const { engagementId } = await approveAndDispatch(pkg.id, draft.quotationId, ALEX);
    await expect(confirmTrainer(engagementId!, { type: "AGENT", id: "x" })).rejects.toMatchObject({ code: "AGENT_CANNOT_COMMIT" });
    const confirmed = await confirmTrainer(engagementId!, ALEX);
    expect(confirmed).toMatchObject({ status: "CONFIRMED", tttCertVerified: true });
    await expect(confirmTrainer(engagementId!, ALEX)).rejects.toMatchObject({ code: "ENGAGEMENT_NOT_TENTATIVE" });

    const other = await makeDraftPackage();
    const [hold] = await db()
      .insert(schema.trainerEngagements)
      .values({ packageId: other.id, trainerId: world.trainers.lim, dayRate: "2000.00", holdExpiryDate: other.startDate! })
      .returning();
    await expect(confirmTrainer(hold.id, ALEX)).rejects.toMatchObject({ code: "TTT_UNVERIFIED" });
  });

  it("signs the venue BEO into the vault", async () => {
    const pkg = await makeDraftPackage();
    const draft = await draftProposal(pkg.id);
    const { commitmentId } = await approveAndDispatch(pkg.id, draft.quotationId, ALEX);
    const bytes = new TextEncoder().encode("%PDF-1.4\n% signed BEO\n%%EOF\n");
    await expect(signVenueBeo(commitmentId!, { bytes, mimeType: "text/plain" }, ALEX)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    const { commitment, document } = await signVenueBeo(commitmentId!, { bytes, fileName: "beo signed.pdf", referenceNumber: "BEO-7781" }, ALEX);
    expect(commitment).toMatchObject({ status: "BEO_SIGNED", referenceNumber: "BEO-7781" });
    expect(document).toMatchObject({ documentType: "BEO", verificationStatus: "VERIFIED", packageId: pkg.id });
    await expect(signVenueBeo(commitmentId!, { bytes }, ALEX)).rejects.toMatchObject({ code: "COMMITMENT_NOT_PROVISIONAL" });
    const [row] = await db()
      .select()
      .from(schema.vendorCommitments)
      .where(and(eq(schema.vendorCommitments.id, commitmentId!), eq(schema.vendorCommitments.status, "BEO_SIGNED")));
    expect(row).toBeDefined();
  });
});
