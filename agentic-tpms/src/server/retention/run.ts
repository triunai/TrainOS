import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { formatRange } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { finishAgentRun, runTier, startAgentRun, type Provenance } from "../ai";
import { type Tx, db, rows, schema, withTx } from "../db/client";
import type { Client, TrainingPackage } from "../db/schema";
import { raiseDecision } from "../decisions/service";
import { DomainError } from "../domain/errors";
import { PDF_MIME } from "../documents/pdf";
import { env } from "../env";
import { assertUuid, errorMessage, runStatus, storeOnce } from "../finance/common";
import { loadOutcomeData, renderExecutivePack } from "./execPack";
import { recommendNextCourse } from "./ladder";
import { assertCadence, CADENCE_SHORT, type Cadence } from "./schedule";

/**
 * `retention.run` — draft one cadence's client-facing proposal (tier L4).
 *
 * Every cadence ends the same way: a subject + body on the schedule row
 * (status DRAFTED) and a RETENTION_PROPOSAL decision. Nothing is sent here —
 * a named operator approves (and may edit) the draft first (`approveRetention`).
 * The model writes prose only; every fact in the prompt comes from SQL, and
 * the deterministic template is what runs whenever no model is available.
 */
export const RETENTION_AGENT: Record<Cadence, string> = {
  EXECUTIVE_PACK_T14: "retention.exec_pack_writer",
  SYLLABUS_LADDER_T90: "retention.ladder_writer",
  LEVY_YEAR_END_T300: "retention.levy_alert_writer",
};

export const CADENCE_LABEL: Record<Cadence, string> = {
  EXECUTIVE_PACK_T14: "Executive delivery pack (T+14)",
  SYLLABUS_LADDER_T90: "Syllabus ladder proposal (T+90)",
  LEVY_YEAR_END_T300: "Levy utilisation alert (T+300)",
};

type Schedule = typeof schema.renewalSchedules.$inferSelect;

type DraftContext = { tx: Tx; pkg: TrainingPackage; client: Client; schedule: Schedule; agent: string };

type CadenceDraft = {
  subject: string;
  body: string;
  provenance: Provenance;
  vaultId?: string;
  recommendedCourseId?: string | null;
  facts: Record<string, unknown>;
};

const Email = z.object({ subject: z.string().min(5).max(200), body: z.string().min(40).max(6000) });

const SYSTEM_PROMPT =
  "You write short, warm, professional emails in British English for a Malaysian HRD Corp registered training provider to a client's HR decision maker. " +
  "Use only the facts given; never invent numbers, dates, prices or course names. No hype, no emojis. Sign off with the provider's name.";

async function writeEmail(ctx: DraftContext, facts: Record<string, unknown>, template: () => { subject: string; body: string }) {
  return runTier({
    tier: "L4",
    agent: ctx.agent,
    packageId: ctx.pkg.id,
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(facts),
    json: { schema: Email },
    maxTokens: 900,
    template,
  });
}

function greeting(client: Client): string {
  return `Dear ${client.primaryPicName.trim() || "Sir/Madam"},`;
}

function signOff(): string {
  return `Kind regards,\n${env().TPMS_PROVIDER_NAME}`;
}

async function trainerName(tx: Tx, packageId: string): Promise<string | null> {
  const [row] = await tx
    .select({ name: schema.trainers.fullName })
    .from(schema.trainerEngagements)
    .innerJoin(schema.trainers, eq(schema.trainers.id, schema.trainerEngagements.trainerId))
    .where(and(eq(schema.trainerEngagements.packageId, packageId), ne(schema.trainerEngagements.status, "RELEASED")))
    .limit(1);
  return row?.name ?? null;
}

// ---------------------------------------------------------------- T+14

async function draftExecutivePack(ctx: DraftContext): Promise<CadenceDraft> {
  const { tx, pkg, client } = ctx;
  const data = await loadOutcomeData(tx, pkg.id);
  const trainer = await trainerName(tx, pkg.id);
  const pdf = await renderExecutivePack(pkg, client, trainer, data);
  const doc = await storeOnce(tx, {
    packageId: pkg.id,
    documentType: "EXEC_PACK",
    fileName: `ExecutivePack_${pkg.packageCode}.pdf`,
    mimeType: PDF_MIME,
    bytes: pdf,
    uploadedBy: ctx.agent,
    extractedMetadata: { scheduleId: ctx.schedule.id, cadence: "EXECUTIVE_PACK_T14" },
  });
  const k = data.kirkpatrick;
  const facts = {
    provider: env().TPMS_PROVIDER_NAME,
    recipient: client.primaryPicName,
    company: client.companyName,
    programme: pkg.title,
    dates: formatRange(pkg.startDate, pkg.endDate),
    participants: data.active,
    completedAt80pct: data.eligible,
    averageAttendancePct: data.averageAttendance,
    kirkpatrick: k.pairs > 0 ? { pre: k.preAverage, post: k.postAverage, deltaPoints: k.delta, participantsWithBothScores: k.pairs } : null,
    certificatesIssued: data.certificates.length,
    attachment: "Executive delivery pack (PDF)",
  };
  const template = () => {
    const lines = [
      `- ${data.active} participant(s) attended; ${data.eligible} completed at 80% attendance or more${data.averageAttendance ? ` (average attendance ${data.averageAttendance}%)` : ""}.`,
      k.pairs > 0
        ? `- Kirkpatrick Level 2: the cohort's average score moved from ${k.preAverage} to ${k.postAverage} (${Number(k.delta) >= 0 ? "+" : ""}${k.delta} points) across ${k.pairs} participant(s).`
        : null,
      data.certificates.length
        ? `- ${data.certificates.length} certificate(s) issued; each can be verified online from the link in the pack.`
        : "- Certificates are being issued; verification links will follow.",
    ].filter(Boolean);
    return {
      subject: `${pkg.title}: outcomes and certificates for ${client.companyName}`,
      body: [
        greeting(client),
        "",
        `Thank you for choosing ${env().TPMS_PROVIDER_NAME} for ${pkg.title} (${formatRange(pkg.startDate, pkg.endDate)}). The executive delivery pack is attached.`,
        "",
        "In summary:",
        ...lines,
        "",
        "We would welcome twenty minutes with you to review the results and agree the next development step for the team.",
        "",
        signOff(),
      ].join("\n"),
    };
  };
  const { output, provenance } = await writeEmail(ctx, facts, template);
  return { ...output, provenance, vaultId: doc.id, facts };
}

// ---------------------------------------------------------------- T+90

async function draftLadder(ctx: DraftContext): Promise<CadenceDraft> {
  const { tx, pkg, client } = ctx;
  const rec = await recommendNextCourse(tx, pkg);
  const facts = {
    provider: env().TPMS_PROVIDER_NAME,
    recipient: client.primaryPicName,
    company: client.companyName,
    completedProgramme: pkg.title,
    completedOn: pkg.endDate,
    recommendation: rec
      ? { course: rec.title, code: rec.courseCode, level: rec.level, days: rec.durationDays, focusArea: rec.hrdFocusArea, basis: rec.basis }
      : null,
    funding: "Claimable under HRD Corp SBL-Khas, subject to grant approval",
  };
  const template = () =>
    rec
      ? {
          subject: `Next step after ${pkg.title}: ${rec.title}`,
          body: [
            greeting(client),
            "",
            `It has been three months since your team completed ${pkg.title}. A natural next step is ${rec.title} (${rec.courseCode}), a ${rec.durationDays}-day level ${rec.level} programme in ${rec.hrdFocusArea} that builds directly on what the team covered.`,
            "",
            "Like the last programme, it can be claimed under HRD Corp SBL-Khas, subject to grant approval, and we prepare the grant paperwork for you.",
            "",
            "Would a short call next week suit you to look at dates and headcount?",
            "",
            signOff(),
          ].join("\n"),
        }
      : {
          subject: `Building on ${pkg.title}`,
          body: [
            greeting(client),
            "",
            `It has been three months since your team completed ${pkg.title}. We would like to hear how the team is applying it and suggest a follow-on programme matched to what you need next.`,
            "",
            "Programmes can be claimed under HRD Corp SBL-Khas, subject to grant approval. Would a short call next week suit you?",
            "",
            signOff(),
          ].join("\n"),
        };
  const { output, provenance } = await writeEmail(ctx, facts, template);
  return { ...output, provenance, recommendedCourseId: rec?.courseId ?? null, facts: { ...facts, recommendationDetail: rec } };
}

// ---------------------------------------------------------------- T+300

const MONTH = (m: number) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, m - 1, 1)));

async function draftLevyAlert(ctx: DraftContext): Promise<CadenceDraft> {
  const { tx, pkg, client, schedule } = ctx;
  const [activity] = await rows<{ programmes: number; grant_value: string | null }>(
    tx,
    sql`select count(*)::int as programmes, sum(coalesce(hrdc_approved_amount, grant_approved_amount))::text as grant_value
          from tpms.training_packages
         where client_id = ${client.id}::uuid and operational_stage = 'DELIVERY_COMPLETED'
           and end_date > ${schedule.scheduledFor}::date - 365`,
  );
  const fyMonth = client.fiscalYearEndMonth ? MONTH(client.fiscalYearEndMonth) : null;
  const facts = {
    provider: env().TPMS_PROVIDER_NAME,
    recipient: client.primaryPicName,
    company: client.companyName,
    lastProgramme: pkg.title,
    programmesInLast12Months: activity?.programmes ?? 0,
    grantValueInLast12Months: activity?.grant_value ?? null,
    levyBalanceEstimate: client.levyBalanceEstimate,
    fiscalYearEndMonth: fyMonth,
  };
  const template = () => ({
    subject: `HRD Corp levy: planning your remaining training${fyMonth ? ` before ${fyMonth}` : ""}`,
    body: [
      greeting(client),
      "",
      `Since ${pkg.title}, ${client.companyName} has completed ${activity?.programmes ?? 0} HRD Corp-funded programme(s) with us in the last twelve months${activity?.grant_value ? `, worth ${formatRM(activity.grant_value)} in grants` : ""}.`,
      client.levyBalanceEstimate
        ? `Our records suggest roughly ${formatRM(client.levyBalanceEstimate)} of levy may still be available to you; please check the exact balance in e-TRiS.`
        : "It is a good moment to check your remaining levy balance in e-TRiS.",
      fyMonth
        ? `With your financial year closing in ${fyMonth}, there is still time to plan and file one more SBL-Khas grant so the levy is put to work for the team.`
        : "There is still time to plan and file one more SBL-Khas grant so the levy is put to work for the team.",
      "",
      "We can put together a short proposal and prepare the grant paperwork. Would that be useful?",
      "",
      signOff(),
    ].join("\n"),
  });
  const { output, provenance } = await writeEmail(ctx, facts, template);
  return { ...output, provenance, facts };
}

const DRAFTERS: Record<Cadence, (ctx: DraftContext) => Promise<CadenceDraft>> = {
  EXECUTIVE_PACK_T14: draftExecutivePack,
  SYLLABUS_LADDER_T90: draftLadder,
  LEVY_YEAR_END_T300: draftLevyAlert,
};

export type RetentionRunResult = {
  scheduleId: string;
  cadenceType?: Cadence;
  skipped?: string;
  status?: string;
  subject?: string;
  vaultId?: string | null;
  recommendedCourseId?: string | null;
  decisionId?: string;
};

export function retentionSubjectRef(packageCode: string, cadence: Cadence): string {
  return `${packageCode}:${CADENCE_SHORT[cadence]}`;
}

/** Body of the `retention.run` task. Idempotent: only a PENDING schedule is drafted. */
export async function runRetention(scheduleId: string, opts: { taskId?: string | null } = {}): Promise<RetentionRunResult> {
  assertUuid(scheduleId, "scheduleId");
  const [schedule] = await db().select().from(schema.renewalSchedules).where(eq(schema.renewalSchedules.id, scheduleId));
  if (!schedule) throw new DomainError("SCHEDULE_NOT_FOUND", `Retention schedule ${scheduleId} not found`);
  if (schedule.status !== "PENDING") return { scheduleId, skipped: `status is ${schedule.status}` };
  const cadence = assertCadence(schedule.cadenceType);
  const agent = RETENTION_AGENT[cadence];
  const runId = await startAgentRun(db(), {
    agent,
    tier: "L4",
    packageId: schedule.sourcePackageId,
    taskId: opts.taskId ?? null,
    inputSummary: `${CADENCE_LABEL[cadence]} for package ${schedule.sourcePackageId}`,
  });
  try {
    type Drafted = { result: RetentionRunResult; provenance?: Provenance };
    const { result, provenance } = await withTx({ type: "AGENT", id: agent }, { reasonCode: "RETENTION_DRAFTED" }, async (tx): Promise<Drafted> => {
      const locked = await tx.execute(sql`select status from tpms.renewal_schedules where id = ${scheduleId}::uuid for update`);
      const status = (locked.rows[0] as { status: string } | undefined)?.status;
      if (status !== "PENDING") return { result: { scheduleId, cadenceType: cadence, skipped: `status is ${status}` } };
      const [pkg] = await tx.select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, schedule.sourcePackageId));
      const [client] = await tx.select().from(schema.corporateClients).where(eq(schema.corporateClients.id, schedule.clientId));
      const draft = await DRAFTERS[cadence]({ tx, pkg, client, schedule, agent });

      await tx
        .update(schema.renewalSchedules)
        .set({
          status: "DRAFTED",
          draftSubject: draft.subject.slice(0, 255),
          draftBody: draft.body,
          vaultId: draft.vaultId ?? schedule.vaultId,
          recommendedCourseId: draft.recommendedCourseId ?? schedule.recommendedCourseId,
          provenance: { ...schedule.provenance, draft: draft.provenance, facts: draft.facts, agent },
        })
        .where(eq(schema.renewalSchedules.id, scheduleId));

      const decision = await raiseDecision(tx, {
        gate: "RETENTION_PROPOSAL",
        packageId: pkg.id,
        subjectRef: retentionSubjectRef(pkg.packageCode, cadence),
        title: `${CADENCE_LABEL[cadence]} · ${client.companyName}`,
        summary: `To ${client.primaryPicName} <${client.primaryPicEmail}>: "${draft.subject}". ${draft.body.replace(/\s+/g, " ").slice(0, 280)}`,
        payload: {
          scheduleId,
          cadenceType: cadence,
          to: client.primaryPicEmail,
          subject: draft.subject,
          body: draft.body,
          vaultId: draft.vaultId ?? null,
          recommendedCourseId: draft.recommendedCourseId ?? null,
          provenance: draft.provenance,
        },
        options: [
          { id: "APPROVE", label: "Approve and send", description: "Send the draft (edits allowed) to the client's PIC" },
          { id: "SKIP", label: "Skip", description: "Do not contact the client for this cadence" },
        ],
        raisedBy: agent,
        raisedByTier: "L4",
        slaHours: 72,
      });
      return {
        result: {
          scheduleId,
          cadenceType: cadence,
          status: "DRAFTED",
          subject: draft.subject,
          vaultId: draft.vaultId ?? null,
          recommendedCourseId: draft.recommendedCourseId ?? null,
          decisionId: decision.id,
        },
        provenance: draft.provenance,
      };
    });
    await finishAgentRun(db(), runId, {
      status: runStatus(provenance?.mode),
      output: result,
      provenance: provenance ?? { tier: "L4", agent, mode: "RULE" },
      costMyr: provenance?.costMyr ?? 0,
    });
    return result;
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: errorMessage(error) });
    throw error;
  }
}
