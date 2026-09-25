import { and, eq, ne } from "drizzle-orm";
import { addDays, startOfDayMY, todayMY } from "@/lib/dates";
import { formatRM, fromSen, toSen } from "@/lib/money";
import { approveAndDispatch, clientAccepted, saveQuotationRevision } from "@/server/commercial";
import { db, schema } from "@/server/db/client";
import { confirmGrant, recordApprovalLetter } from "@/server/grant";
import { EDITABLE_CELLS } from "@/server/pricing";
import { verifyTrainerTtt } from "@/server/resources/service";
import { DEMO_ACTORS, type GoldenPathContext, type Recorder, type StepMap, packageRow, pendingDecision, run } from "../context";
import { etrisApprovalLetterPdf, tttCertificatePdf } from "../documents";
import { formatMyt, tasksFor } from "../tasks";

/**
 * Stages 2-3 — proposal, Gate 1 and the grant: the sourcing agent's draft,
 * the operator's one-cell edit and approval, client acceptance with the
 * e-TRiS dossier, the approval letter read by L2, and grant confirmation.
 */
export const COMMERCIAL_STEPS = {
  async "proposal.draft"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const t = rec.task(await run(rec, "commercial.draft_proposal", { packageId }));
    const r = t.result as { quotationId: string; courseId: string; trainerId: string | null; venueId: string | null; quotedAmount: string; allowableCap: string; marginPct: string; warnings: string[] };
    ctx.quotationId = r.quotationId;
    rec.id("quotation", r.quotationId);
    rec.expect(r.trainerId, `the sourcing agent proposed no trainer (warnings: ${r.warnings.join(", ")}); a TTT-verified trainer for this course is already held on ${ctx.startDate}..${ctx.endDate} — run on a fresh database or move the dates`);
    const needsVenue = ctx.scenario.deliveryMode !== "ROT_VIRTUAL";
    rec.expect(!needsVenue || r.venueId, "no venue proposed for a physical programme");
    const [q] = await db().select().from(schema.quotations).where(eq(schema.quotations.id, r.quotationId));
    rec.expect(q.status === "AWAITING_APPROVAL" && q.generatedBy === "AGENT", `expected an AGENT quotation AWAITING_APPROVAL, got ${q.status}/${q.generatedBy}`);
    rec.expect(await pendingDecision("GATE1_COMMERCIAL", ctx.packageCode as string), "Gate 1 decision was not raised");
    const prov = q.provenance as { course?: { method: string; courseCode: string; score: number | null }; trainer?: { name?: string }; venue?: { name?: string }; pricing?: { engines?: unknown }; outline?: { mode?: string } };
    rec.note(
      `course ${prov.course?.courseCode} by ${prov.course?.method === "SEARCH" ? `pgvector search (score ${prov.course?.score?.toFixed(3)})` : "package"}; ` +
        `trainer ${prov.trainer?.name}; venue ${prov.venue?.name ?? "none"}`,
    );
    rec.note(`priced ${formatRM(r.quotedAmount)} (cap ${formatRM(r.allowableCap)}, margin ${r.marginPct}%) by the headless Univer engine, cross-checked by the TS model`);
    rec.note(`outline: ${prov.outline?.mode === "TEMPLATE" ? "L3 template fallback (no model key)" : prov.outline?.mode}; agent warnings: ${r.warnings.join(", ") || "none"}`);
  },

  async "gate1.approve"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    let approveId = ctx.quotationId as string;
    const edit = ctx.scenario.gate1Edit;
    if (edit) {
      const [draft] = await db().select().from(schema.quotations).where(eq(schema.quotations.id, approveId));
      // Stored inputs are ringgit strings keyed by the cost field each canvas cell edits.
      const base = (draft.inputs as Record<string, unknown>)[EDITABLE_CELLS[edit.cell]];
      rec.expect(typeof base === "string", `quotation inputs carry no ${edit.cell}`, { inputs: draft.inputs });
      const value = fromSen(toSen(base) + toSen(edit.delta));
      const revised = await saveQuotationRevision(packageId, { [edit.cell]: value }, DEMO_ACTORS.director);
      rec.expect(revised.generatedBy === "USER", "the revision should be an operator version");
      rec.note(`operator edited ${edit.cell} ${base} -> ${value} on the sheet (${edit.why}); saved as v${revised.version}`);
      approveId = revised.id;
    } else {
      rec.note("operator approved the agent's draft as priced (no edit)");
    }
    const approval = await approveAndDispatch(packageId, approveId, DEMO_ACTORS.director);
    rec.expect(approval.outcome.to === "QUOTED", "approveAndDispatch did not reach QUOTED");
    ctx.quotationId = approveId;
    ctx.engagementId = approval.engagementId;
    ctx.commitmentId = approval.commitmentId;
    rec.id("quotation", approveId);
    rec.id("engagement", approval.engagementId);
    rec.id("venueHold", approval.commitmentId);
    const diff = Object.entries(approval.lineItemsDiff).map(([code, change]) => `${code} ${change.old?.amount ?? "-"} -> ${change.new?.amount ?? "-"}`);
    rec.expect(!edit || diff.length > 0, "the audit row should carry the line-item diff between the agent's draft and the approved sheet");
    rec.note(diff.length ? `line-item diff in the audit row: ${diff.join("; ")}` : "no line-item changes against the agent's draft");
    const dispatched = rec.task(await run(rec, "commercial.dispatch_quotation", { packageId }));
    rec.note(`quotation + Form HRD-L&D emailed to the PIC: ${String(dispatched.result.status)}${dispatched.result.status === "LOGGED" ? " (no SMTP: logged)" : ""}`);
  },

  async "client.accept"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const outcome = await clientAccepted(packageId, DEMO_ACTORS.director);
    rec.expect(outcome.pkg.operationalStage === "GRANT_PENDING" && outcome.pkg.financialStage === "GRANT_RESERVED", "expected GRANT_PENDING + GRANT_RESERVED");
    // The e-TRiS dossier carries the trainer's TTT certificate; ops files it once per trainer.
    if (ctx.engagementId) {
      const [engagement] = await db().select().from(schema.trainerEngagements).where(eq(schema.trainerEngagements.id, ctx.engagementId));
      const [trainer] = await db().select().from(schema.trainers).where(eq(schema.trainers.id, engagement.trainerId));
      const [filed] = await db()
        .select({ id: schema.complianceVault.id })
        .from(schema.complianceVault)
        .where(and(eq(schema.complianceVault.trainerId, trainer.id), eq(schema.complianceVault.documentType, "TTT_CERT"), ne(schema.complianceVault.verificationStatus, "FLAGGED")));
      if (!filed) {
        const certNumber = trainer.tttCertNumber ?? `TTT-${trainer.id.slice(0, 8)}`;
        const bytes = await tttCertificatePdf({ trainerName: trainer.fullName, certNumber, expiry: trainer.tttCertExpiryDate });
        await verifyTrainerTtt(trainer.id, { bytes, mimeType: "application/pdf", fileName: `${certNumber.replace(/\//g, "-")}.pdf` }, trainer.tttCertExpiryDate, DEMO_ACTORS.ops);
        rec.note(`${trainer.fullName}'s HRD Corp TTT certificate ${certNumber} filed and verified by ${DEMO_ACTORS.ops.id}`);
      }
    }
    const dossier = rec.task(await run(rec, "grant.compile_dossier", { packageId }));
    rec.id("dossier", dossier.result.vaultId as string);
    const missing = (dossier.result.missing as string[]) ?? [];
    rec.note(`e-TRiS dossier compiled (${(dossier.result.files as string[]).length} files${missing.length ? `; missing: ${missing.join(", ")}` : ""})`);
  },

  async "grant.letter"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const pkg = await packageRow(packageId);
    ctx.grantId = `ETRIS-${ctx.startDate.slice(0, 4)}-${ctx.refNumber()}${ctx.scenario.pax}`.slice(0, 64);
    const bytes = await etrisApprovalLetterPdf({
      employerName: ctx.clientName as string,
      mycoid: ctx.scenario.company.mycoid,
      grantId: ctx.grantId,
      ourRef: `HRDC/SBL-KHAS/${ctx.startDate.slice(0, 4)}/${ctx.refNumber()}`,
      letterDate: todayMY(),
      programmeTitle: pkg.title,
      startDate: ctx.startDate,
      endDate: ctx.endDate,
      trainees: ctx.scenario.pax,
      approvedAmount: pkg.quotedAmount,
    });
    const { document, taskId } = await recordApprovalLetter(packageId, bytes, "application/pdf", `eTRiS-approval-${ctx.grantId}.pdf`, DEMO_ACTORS.ops);
    rec.expect(taskId, "recording the letter did not queue grant.extract_letter");
    rec.id("letter", document.id);
    const t = rec.task(await run(rec, "grant.extract_letter", { packageId, vaultId: document.id }));
    const r = t.result as { available: boolean; reason?: string; extraction: { grantId: string | null; approvedAmount: string | null; approvedPax: number | null; engine: string; confidence: number } | null };
    if (r.available && r.extraction) {
      rec.expect(r.extraction.grantId === ctx.grantId, `L2 read grant id ${r.extraction.grantId}, the letter says ${ctx.grantId}`);
      rec.note(`L2 extraction by ${r.extraction.engine} (${Math.round(r.extraction.confidence * 100)}%): ${r.extraction.grantId}, ${formatRM(r.extraction.approvedAmount)}, ${r.extraction.approvedPax} pax`);
    } else {
      rec.note(`L2 extraction unavailable (${(r.reason ?? "").slice(0, 90)}): the GRANT_VERIFICATION decision asks for manual entry`);
    }
    rec.expect(await pendingDecision("GRANT_VERIFICATION", ctx.packageCode as string), "no GRANT_VERIFICATION decision was raised");
  },

  async "grant.confirm"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const pkg = await packageRow(packageId);
    const { outcome, letter } = await confirmGrant(packageId, { grantId: ctx.grantId as string, approvedAmount: pkg.quotedAmount, approvedPax: ctx.scenario.pax }, DEMO_ACTORS.director);
    rec.expect(outcome.pkg.operationalStage === "GRANT_APPROVED", "confirmGrant did not reach GRANT_APPROVED");
    rec.expect(letter.verificationStatus === "VERIFIED", "the approval letter should be VERIFIED by the confirming operator");
    const [t14] = await tasksFor("viability.t14_check", { packageId });
    rec.expect(t14, "GRANT_APPROVED must schedule the T-14 viability check");
    rec.expect(t14.claimDue.getTime() === startOfDayMY(addDays(ctx.startDate, -14)).getTime(), `T-14 check scheduled for ${formatMyt(t14.claimDue)}, expected start - 14`);
    rec.note(`grant ${ctx.grantId} ${formatRM(pkg.quotedAmount)} for ${ctx.scenario.pax} pax; viability.t14_check due ${formatMyt(t14.claimDue)}`);
  },
} satisfies StepMap;
