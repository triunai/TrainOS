import { eq } from "drizzle-orm";
import { todayMY } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { issueParticipantLinks, verifyToken } from "@/server/attendance";
import { confirmTrainer, signVenueBeo } from "@/server/commercial";
import { db, schema } from "@/server/db/client";
import { env } from "@/server/env";
import { uploadEvidence } from "@/server/evidence/upload";
import { lockOperations, startDelivery } from "@/server/operations/viability";
import { loadSnapshot } from "@/server/packages/snapshot";
import { addParticipant } from "@/server/participants/service";
import {
  DEMO_ACTORS,
  type GoldenPathContext,
  type Recorder,
  type StepMap,
  cohortFor,
  packageRow,
  pendingDecision,
  run,
  sitQuiz,
} from "../context";
import { executedTrainerAgreementPdf, venueBeoPdf } from "../documents";
import { formatMyt, tasksFor } from "../tasks";

/**
 * Stage 4 — operations: trainer confirmed, venue BEO signed, the executed
 * agreement filed, the lock; the roster; the T-14 viability check; magic
 * links and the PRE quiz; and the start of delivery.
 */
export const OPERATIONS_STEPS = {
  async "logistics.lock"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    rec.expect(ctx.engagementId && ctx.commitmentId !== undefined, "Gate 1 left no trainer hold");
    const engagement = await confirmTrainer(ctx.engagementId as string, DEMO_ACTORS.ops);
    rec.expect(engagement.status === "CONFIRMED", "trainer not confirmed");
    const [trainer] = await db().select().from(schema.trainers).where(eq(schema.trainers.id, engagement.trainerId));
    rec.note(`trainer ${trainer.fullName} CONFIRMED (TTT ${trainer.tttCertNumber}, expires ${trainer.tttCertExpiryDate})`);
    const pkg = await packageRow(packageId);
    if (ctx.commitmentId) {
      const [hold] = await db()
        .select({ c: schema.vendorCommitments, v: schema.vendors })
        .from(schema.vendorCommitments)
        .innerJoin(schema.vendors, eq(schema.vendors.id, schema.vendorCommitments.vendorId))
        .where(eq(schema.vendorCommitments.id, ctx.commitmentId));
      const reference = `BEO-${ctx.refNumber()}-${ctx.startDate.slice(5, 7)}`;
      const bytes = await venueBeoPdf({
        venueName: hold.v.name,
        reference,
        packageCode: pkg.packageCode,
        clientName: ctx.clientName as string,
        programmeTitle: pkg.title,
        startDate: ctx.startDate,
        endDate: ctx.endDate,
        pax: ctx.scenario.pax,
        ddrPerPax: hold.v.ddrPerPax ?? "0",
        total: hold.c.cost,
      });
      const { commitment, document } = await signVenueBeo(ctx.commitmentId, { bytes, fileName: `${reference} signed.pdf`, referenceNumber: reference }, DEMO_ACTORS.ops);
      rec.expect(commitment.status === "BEO_SIGNED", "venue commitment not BEO_SIGNED");
      rec.id("beo", document.id);
      rec.note(`${hold.v.name} BEO ${reference} signed (${formatRM(hold.c.cost)})`);
    }
    const agreement = await uploadEvidence(
      packageId,
      {
        documentType: "TRAINER_AGREEMENT",
        fileName: `TA-${pkg.packageCode}-executed.pdf`,
        mimeType: "application/pdf",
        bytes: await executedTrainerAgreementPdf({
          packageCode: pkg.packageCode,
          trainerName: trainer.fullName,
          tttCertNumber: trainer.tttCertNumber,
          programmeTitle: pkg.title,
          startDate: ctx.startDate,
          endDate: ctx.endDate,
          dayRate: engagement.dayRate,
          signedOn: todayMY(),
        }),
      },
      DEMO_ACTORS.ops,
    );
    rec.id("agreement", agreement.id);
    const outcome = await lockOperations(packageId, DEMO_ACTORS.ops);
    rec.expect(outcome.pkg.operationalStage === "OPERATIONS_LOCKED", "lockOperations did not reach OPERATIONS_LOCKED");
  },

  async roster(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const people = cohortFor(ctx.scenario);
    ctx.roster = [];
    for (const [index, person] of people.entries()) {
      const participantId = await addParticipant(packageId, { fullName: person.fullName, nric: person.nric, workEmail: person.workEmail, phone: person.phone, confirmed: true }, DEMO_ACTORS.ops);
      ctx.roster.push({ ...person, participantId, index });
    }
    const snapshot = await loadSnapshot(db(), packageId);
    rec.expect(snapshot.participants.active === people.length, `expected ${people.length} active participants, found ${snapshot.participants.active}`);
    rec.note(`${people.length} participants registered (MyKad hashed + encrypted + masked), minimum viable cohort ${ctx.scenario.minParticipants}`);
  },

  async t14(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const t = rec.task(await run(rec, "viability.t14_check", { packageId }, true));
    const r = t.result as { viable?: boolean; advanced?: boolean; halted?: boolean; participants?: number };
    const pkg = await packageRow(packageId);
    if (ctx.scenario.roster >= ctx.scenario.minParticipants) {
      rec.expect(r.viable && r.advanced && pkg.operationalStage === "READY_FOR_EVENT", `a viable cohort should advance to READY_FOR_EVENT, got ${JSON.stringify(r)} / ${pkg.operationalStage}`);
      rec.note(`${r.participants} registered >= ${ctx.scenario.minParticipants}: SYSTEM moved the package to READY_FOR_EVENT; magic links + delivery.start queued`);
    } else {
      rec.expect(r.halted && pkg.operationalStage === "OPERATIONS_LOCKED" && pkg.vendorAutoconfirmHalted, `a cohort below minimum should halt vendors at OPERATIONS_LOCKED, got ${JSON.stringify(r)}`);
      const decision = await pendingDecision("GATE2_VIABILITY", pkg.packageCode);
      rec.expect(decision, "Gate 2 viability decision was not raised");
      rec.id("gate2", decision.id);
      rec.note(`${r.participants} registered < minimum ${ctx.scenario.minParticipants}: vendor auto-confirmations HALTED, Gate 2 decision pending (postpone / pivot to ROT / cancel / proceed)`);
    }
  },

  async links(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const t = rec.task(await run(rec, "delivery.issue_magic_links", { packageId }));
    rec.expect(t.result.participants === ctx.roster.length, `links issued for ${String(t.result.participants)} of ${ctx.roster.length}`);
    rec.note(`${String(t.result.participants)} participants x (CHECKIN, QUIZ_PRE, QUIZ_POST); ${String(t.result.emailed)} emails ${env().SMTP_URL ? "sent" : "LOGGED (no SMTP)"}`);
    // Re-issuing is idempotent: the same claims re-sign to the identical tokens that were emailed.
    const links = await issueParticipantLinks(packageId);
    rec.expect(links.every((l) => l.checkin?.reused && l.quizPre?.reused && l.quizPost?.reused), "re-issuing links should return the emailed tokens, not new ones");
    for (const l of links) ctx.links.set(l.participantId, l);
    let preTotal = 0;
    for (const p of ctx.roster) {
      const link = ctx.links.get(p.participantId);
      rec.expect(link?.quizPre, `no PRE quiz link for ${p.fullName}`);
      const claims = await verifyToken(link.quizPre.token, "QUIZ_PRE");
      rec.expect(claims.participantId === p.participantId, "the PRE link resolves to someone else");
      const sat = await sitQuiz(packageId, p.participantId, "PRE", 3 + (p.index % 4));
      preTotal += sat.score;
    }
    rec.note(`every participant took the PRE quiz through their QUIZ_PRE link: mean ${(preTotal / ctx.roster.length).toFixed(1)}%`);
  },

  async "delivery.start"(ctx: GoldenPathContext, rec: Recorder) {
    const packageId = ctx.pkgId(rec.step);
    const [system] = await tasksFor("delivery.start", { packageId });
    rec.expect(system, "READY_FOR_EVENT should have queued the SYSTEM delivery.start task");
    if (system.claimDue.getTime() <= Date.now()) {
      const t = rec.task(await run(rec, "delivery.start", { packageId }));
      rec.expect(t.result.started === true, `the SYSTEM delivery.start task did not start delivery: ${JSON.stringify(t.result)}`);
      rec.note("day 1 has begun: the SYSTEM delivery.start task (07:00 MYT) started delivery");
    } else {
      const outcome = await startDelivery(packageId, DEMO_ACTORS.ops);
      rec.expect(outcome.pkg.operationalStage === "DELIVERY_IN_PROGRESS", "startDelivery did not reach DELIVERY_IN_PROGRESS");
      const early = todayMY() < ctx.startDate;
      rec.expect(!early || outcome.warnings.some((w) => w.code === "STARTED_EARLY"), "a USER start before day 1 should carry the STARTED_EARLY warning");
      rec.note(
        `started by ${DEMO_ACTORS.ops.id} ${early ? "ahead of day 1" : "before 07:00 on day 1"}; SYSTEM delivery.start stays queued for ${formatMyt(system.claimDue)} ` +
          "and skips a package no longer READY_FOR_EVENT",
      );
    }
  },
} satisfies StepMap;
