import { sql } from "drizzle-orm";
import { todayMY } from "@/lib/dates";
import { formatRM, fromSen, toSen } from "@/lib/money";
import { approveClaimPack, recordHrdcApproval, recordQuery, recordRemittance, resubmitAfterQuery, verifyEvidence } from "@/server/claims";
import { renderKirkpatrickReportPdf } from "@/server/assessments";
import { db, rows } from "@/server/db/client";
import { uploadEvidence } from "@/server/evidence/upload";
import { adjustVoucher, listVouchers, markVoucherPaid, settlePackage } from "@/server/finance";
import { claimableSen } from "@/server/fsm/guards";
import { loadSnapshot } from "@/server/packages/snapshot";
import { approveRetention, listRetention } from "@/server/retention";
import { allHandlers } from "../../../../worker/handlers";
import { DEMO_ACTORS, type GoldenPathContext, type Recorder, type StepMap, packageRow, pendingDecision, run } from "../context";
import { bankReceiptPdf, formJd14Pdf, remittanceAdvicePdf } from "../documents";
import { runAllQueued, taskTotals, tasksFor } from "../tasks";

/**
 * Stages 6-7 — claims, AP and retention: JD/14 and collation to CLAIM_READY,
 * Gate 3 approval, the HRD Corp query round, approval and remittance,
 * pay-when-paid vouchers and settlement, the T+14 retention cadence, and a
 * final sweep proving nothing is left due or dead-lettered.
 */
export const CLAIMS_STEPS = {
  async "claim.evidence"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const pkg = await packageRow(packageId);
    const report = await renderKirkpatrickReportPdf(packageId, { actor: DEMO_ACTORS.ops });
    rec.id("kirkpatrick", report.vaultId);
    const jd14 = await uploadEvidence(
      packageId,
      {
        documentType: "FORM_JD14",
        fileName: `JD14-${pkg.etrisGrantId}.pdf`,
        mimeType: "application/pdf",
        bytes: await formJd14Pdf({
          employerName: ctx.clientName as string,
          grantId: pkg.etrisGrantId as string,
          programmeTitle: pkg.title,
          startDate: ctx.startDate,
          endDate: ctx.endDate,
          participants: ctx.roster.length,
          signatory: ctx.scenario.company.picName,
        }),
      },
      DEMO_ACTORS.finance,
    );
    rec.id("jd14", jd14.id);
    await verifyEvidence(jd14.id, { status: "VERIFIED", notes: "Managerial signature and company stamp checked", checks: { managerialSignature: true, companyStamp: true } }, DEMO_ACTORS.finance);
    rec.note("Form JD/14 uploaded and VERIFIED (managerial signature + company stamp); Kirkpatrick L2 report filed");
    const collated = await runAllQueued("claims.collate", { packageId }, { step: rec.step, handlers: allHandlers });
    for (const c of collated) rec.task(c);
    const ready = collated.map((c) => c.result as { ready?: boolean; invoice?: { invoiceNumber: string; total: string }; claimPack?: { vaultId: string; fileName: string } }).find((r) => r.ready);
    rec.expect(ready?.invoice && ready.claimPack, `collation never reached CLAIM_READY: ${JSON.stringify(collated.at(-1)?.result)}`);
    const after = await packageRow(packageId);
    rec.expect(after.financialStage === "CLAIM_READY", `expected CLAIM_READY, got ${after.financialStage}`);
    rec.expect(await pendingDecision("GATE3_CLAIM_REVIEW", after.packageCode), "Gate 3 claim review was not raised");
    const snapshot = await loadSnapshot(db(), packageId);
    const claimable = fromSen(claimableSen(snapshot));
    rec.expect(toSen(ready.invoice.total) === toSen(claimable), `invoice ${ready.invoice.total} != claimable ${claimable}`);
    rec.id("invoice", ready.invoice.invoiceNumber);
    rec.id("claimPack", ready.claimPack.vaultId);
    const perPax = after.deliveryMode === "PUBLIC_PHYSICAL";
    rec.note(
      `claimable ${formatRM(claimable)}: ${perPax ? "per-pax, pro-rated to eligible participants" : "per-group programme, the approved grant in full once >= 1 participant is eligible"} ` +
        `(${snapshot.participants.eligible} of ${snapshot.participants.active} eligible); tax invoice ${ready.invoice.invoiceNumber} = ${formatRM(ready.invoice.total)}; claim pack ${ready.claimPack.fileName}`,
    );
  },

  async "claim.submit"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    ctx.claimSubmissionRef = `CLM-${ctx.startDate.slice(0, 4)}-${ctx.refNumber()}${ctx.scenario.days}1`;
    const outcome = await approveClaimPack(packageId, { submissionRef: ctx.claimSubmissionRef, note: `Uploaded to e-TRiS as ${ctx.claimSubmissionRef}` }, DEMO_ACTORS.finance);
    rec.expect(outcome.pkg.financialStage === "CLAIM_SUBMITTED", "expected CLAIM_SUBMITTED");
    rec.id("claimRef", ctx.claimSubmissionRef);
  },

  async "claim.query"(ctx: GoldenPathContext, rec: Recorder) {
    const outcome = await recordQuery(ctx.pkgId(rec.step), ctx.scenario.claim.query, DEMO_ACTORS.finance);
    rec.expect(outcome.pkg.financialStage === "QUERIED", "expected QUERIED");
    rec.note(ctx.scenario.claim.query);
  },

  async "claim.resubmit"(ctx: GoldenPathContext, rec: Recorder) {
    const outcome = await resubmitAfterQuery(ctx.pkgId(rec.step), ctx.scenario.claim.response, DEMO_ACTORS.finance);
    rec.expect(outcome.pkg.financialStage === "CLAIM_SUBMITTED", "expected CLAIM_SUBMITTED after the query response");
    rec.note(ctx.scenario.claim.response);
  },

  async "claim.approve"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const snapshot = await loadSnapshot(db(), packageId);
    const amount = snapshot.invoice?.total as string;
    const outcome = await recordHrdcApproval(packageId, amount, DEMO_ACTORS.finance);
    rec.expect(outcome.pkg.financialStage === "APPROVED" && toSen(outcome.pkg.hrdcApprovedAmount) === toSen(amount), "expected APPROVED at the claimable amount");
    rec.note(`HRD Corp approved ${formatRM(amount)}`);
  },

  async "claim.remit"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const pkg = await packageRow(packageId);
    const amount = fromSen(toSen(pkg.hrdcApprovedAmount) - toSen(pkg.upfrontAmount));
    const reference = `HRDC-RMT-${ctx.startDate.slice(0, 4)}-${ctx.refNumber()}${ctx.scenario.pax}`;
    const { outcome, advice } = await recordRemittance(
      packageId,
      {
        amount,
        reference,
        adviceBytes: await remittanceAdvicePdf({ employerName: ctx.clientName as string, grantId: pkg.etrisGrantId as string, claimRef: pkg.claimSubmissionRef as string, reference, amount, paidOn: todayMY() }),
        mime: "application/pdf",
        fileName: `${reference}.pdf`,
      },
      DEMO_ACTORS.finance,
    );
    rec.expect(outcome.pkg.financialStage === "REMITTED", "expected REMITTED");
    rec.id("remittanceAdvice", advice.id);
    rec.note(`${formatRM(amount)} remitted (${reference}); pay-when-paid opens here`);
    const t = rec.task(await run(rec, "finance.draft_payment_vouchers", { packageId }));
    const created = (t.result.created as Array<{ pvNumber: string; payeeType: string; payeeName: string; amount: string }>) ?? [];
    rec.expect(created.length > 0, `no payment vouchers drafted: ${JSON.stringify(t.result)}`);
    rec.note(`PVs drafted (agent): ${created.map((c) => `${c.pvNumber} ${c.payeeType} ${c.payeeName} ${formatRM(c.amount)}`).join("; ")}`);
  },

  async "ap.settle"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const vouchers = await listVouchers({ packageId });
    rec.expect(vouchers.length > 0, "no vouchers to pay");
    let n = 0;
    for (const pv of vouchers) {
      n += 1;
      const adjustments = pv.payeeType === "TRAINER" && ctx.scenario.mileage ? [{ kind: "MILEAGE", label: ctx.scenario.mileage.label, amount: ctx.scenario.mileage.amount }] : [];
      const approved = await adjustVoucher(pv.id, adjustments, DEMO_ACTORS.finance);
      const bankReference = `MBB-IBG-${todayMY().replace(/-/g, "")}-${ctx.refNumber()}${n}`;
      const paid = await markVoucherPaid(
        pv.id,
        {
          bankReference,
          receiptBytes: await bankReceiptPdf({ bankReference, payee: pv.payeeName, amount: approved.finalAmount, pvNumber: pv.pvNumber, paidOn: todayMY() }),
          mime: "application/pdf",
          fileName: `${bankReference}.pdf`,
        },
        DEMO_ACTORS.finance,
      );
      rec.expect(paid.status === "PAID" && paid.bankReference && paid.receiptVaultId, `${pv.pvNumber} not PAID with evidence`);
      rec.note(
        `${pv.pvNumber} ${pv.payeeType} ${formatRM(pv.agreedAmount)}${adjustments.length ? ` + ${adjustments[0].label} ${formatRM(adjustments[0].amount)}` : ""} = ${formatRM(approved.finalAmount)} PAID (${bankReference})`,
      );
    }
    const { outcome, ledger } = await settlePackage(packageId, DEMO_ACTORS.finance);
    rec.expect(outcome.pkg.financialStage === "SETTLED_CLOSED", "expected SETTLED_CLOSED");
    rec.note(`settled: gross margin ${formatRM(ledger.grossMargin)}, net retained ${formatRM(ledger.netRetainedProfit)}`);
  },

  async "retention.t14"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const schedules = await listRetention({ packageId });
    const t14 = schedules.find((s) => s.cadenceType === "EXECUTIVE_PACK_T14");
    rec.expect(t14, "no T+14 retention schedule");
    const t = rec.task(await run(rec, "retention.run", { scheduleId: t14.id }, true));
    rec.expect(t.result.status === "DRAFTED", `retention.run did not draft: ${JSON.stringify(t.result)}`);
    rec.note(`L4 drafted "${String(t.result.subject)}"${t.result.vaultId ? " with the executive delivery pack attached" : ""}`);
    const sent = await approveRetention(t14.id, DEMO_ACTORS.director);
    rec.expect(sent.status === "DISPATCHED", "retention proposal not dispatched");
    rec.id("retention", t14.id);
    rec.note(`approved by ${DEMO_ACTORS.director.id} and sent to ${sent.to} (${sent.dispatch.status}); T90 and T300 stay queued for their dates`);
  },

  async sweep(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const [stale] = await tasksFor("delivery.start", { packageId });
    if (stale) {
      const t = rec.task(await run(rec, "delivery.start", { packageId }, true));
      rec.expect(typeof t.result.skipped === "string" && String(t.result.skipped).startsWith("STAGE_"), `the stale delivery.start should skip, got ${JSON.stringify(t.result)}`);
      rec.note(`stale SYSTEM delivery.start -> ${String(t.result.skipped)}, COMPLETED (a package that moved on is skipped, never dead-lettered)`);
    }
    const due = (await rows<{ id: string; task_type: string }>(
      db(),
      sql`select id, task_type from tpms.task_queue where status = 'QUEUED' and claim_due <= now() and payload->>'packageId' = ${packageId}`,
    ));
    rec.expect(due.length === 0, `due tasks left behind: ${due.map((d) => d.task_type).join(", ")}`);
    const totals = await taskTotals(packageId);
    rec.expect(totals.deadLettered.length === 0, `dead-lettered tasks: ${JSON.stringify(totals.deadLettered)}`);
    rec.expect(totals.retrying.length === 0, `tasks waiting on a retry: ${JSON.stringify(totals.retrying)}`);
    rec.note(`package tasks: ${Object.entries(totals.byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}; future: ${Object.entries(totals.future).map(([k, v]) => `${k} x${v}`).join(", ") || "none"}`);
  },
} satisfies StepMap;
