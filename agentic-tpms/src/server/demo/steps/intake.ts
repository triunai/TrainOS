import { seedTierConfig } from "@/server/ai";
import { seedQuizBanks } from "@/server/assessments";
import { seedCommercialReferenceData } from "@/server/commercial/tasks";
import { db } from "@/server/db/client";
import { convertLeadToPackage, getLead, handleWhatsAppReply, ingestWebhook, resolveTriage } from "@/server/ingestion";
import { getCourseByCode } from "@/server/knowledge";
import { seedReference } from "@/server/seed/reference";
import { DEMO_ACTORS, type GoldenPathContext, type Recorder, type StepMap, run } from "../context";
import { webFormPayload } from "../scenarios";
import { tasksFor } from "../tasks";

/**
 * Stage 1 — demand: reference data, the web-form lead, L1 triage, the
 * operator's qualification and WhatsApp micro-TNA, and conversion to a
 * DRAFT package.
 */
/** Reference data, through each lane's own (idempotent) seed function. */
export async function ensureReferenceData(): Promise<Record<string, number>> {
  const reference = await seedReference(db());
  await seedTierConfig(db());
  // seedCommercialReferenceData = seedCostPolicies + seedKnowledge (courses, chunks, embeddings).
  const commercial = await seedCommercialReferenceData(db());
  const quiz = await seedQuizBanks(db());
  return {
    clients: reference.clients,
    trainers: reference.trainers,
    vendors: reference.vendors,
    costPolicies: commercial.policies,
    courses: commercial.courses,
    knowledgeChunks: commercial.chunks,
    embedded: commercial.embedded,
    quizBanksSeeded: quiz.seeded.length,
  };
}

export const INTAKE_STEPS = {
  async reference(_ctx: GoldenPathContext, rec: Recorder) {
    const counts = await ensureReferenceData();
    rec.note(
      `operators, ${counts.clients} demo clients, ${counts.trainers} trainers, ${counts.vendors} vendors, tier config, ` +
        `cost matrix (+${counts.costPolicies}), catalogue (+${counts.courses} courses, +${counts.knowledgeChunks} chunks, ${counts.embedded} embedded), ` +
        `quiz banks (+${counts.quizBanksSeeded})`,
    );
  },

  async "lead.ingest"(ctx: GoldenPathContext, rec: Recorder) {
    const [result] = await ingestWebhook("WEB_FORM", webFormPayload(ctx.scenario, ctx.nonce), { verified: true });
    rec.expect(result?.status === "INGESTED", `expected the web-form lead to be INGESTED, got ${JSON.stringify(result)}`);
    ctx.leadId = result.leadId;
    rec.id("lead", result.leadId);
    rec.id("rawPayload", result.rawPayloadId);
    rec.expect(result.triageTaskId, "ingestion did not queue lead.triage");
    rec.note(`WEB_FORM from ${ctx.scenario.company.formName} (${ctx.scenario.company.domain}); lead.triage queued in the same transaction`);
  },

  async "lead.triage"(ctx: GoldenPathContext, rec: Recorder) {
    const leadId = ctx.leadId as string;
    const t = rec.task(await run(rec, "lead.triage", { leadId }));
    const r = t.result as { route?: string; pLevy?: number; intent?: string; classifierModel?: string; decisionId?: string | null };
    rec.expect(r.route === ctx.scenario.expectRoute, `expected L1 to route ${ctx.scenario.expectRoute}, got ${r.route}`, { result: r });
    rec.note(`L1 ${r.classifierModel === "tpms-l1-logistic-v1" ? "deterministic template (no model key)" : r.classifierModel}: intent ${r.intent}, P(levy) ${r.pLevy} -> ${r.route}`);
    if (r.route === "TRIAGE_REVIEW") {
      rec.expect(r.decisionId, "a TRIAGE_REVIEW lead must raise a LEAD_TRIAGE decision");
      rec.id("decision", r.decisionId);
      rec.note("LEAD_TRIAGE decision raised for a human");
    }
  },

  async "lead.qualify"(ctx: GoldenPathContext, rec: Recorder) {
    const leadId = ctx.leadId as string;
    let lead = await getLead(leadId);
    if (lead.status === "TRIAGE_REVIEW") {
      const resolved = await resolveTriage(leadId, { route: "QUALIFY", note: ctx.scenario.triageNote }, DEMO_ACTORS.ops);
      lead = resolved.lead;
      rec.note(`operator ${DEMO_ACTORS.ops.id} resolved triage: QUALIFY ("${ctx.scenario.triageNote}")`);
    }
    rec.expect(lead.status === "LEAD_QUALIFIED_TNA", `expected LEAD_QUALIFIED_TNA, got ${lead.status}`);
    const queued = await tasksFor("lead.whatsapp_micro_tna", { leadId });
    rec.expect(queued.length === 1, "a qualified lead with a mobile number must get the WhatsApp micro-TNA queued");
    const sent = rec.task(await run(rec, "lead.whatsapp_micro_tna", { leadId }));
    rec.expect(sent.result.status === "LOGGED" || sent.result.status === "SENT", `micro-TNA not sent: ${JSON.stringify(sent.result)}`);
    rec.note(`micro-TNA ${String(sent.result.status)}${sent.result.status === "LOGGED" ? " (no WhatsApp token: recorded, not sent)" : ""}`);
    const reply = await handleWhatsAppReply(lead.picPhoneE164, ctx.scenario.whatsappReply, { messageId: `wamid.demo.${ctx.nonce}` });
    rec.expect(reply?.answer.levyActive === true, `the PIC's reply should confirm an active levy, got ${JSON.stringify(reply)}`);
    rec.note(`PIC replied "${ctx.scenario.whatsappReply}" -> levy active, cohort ${reply.answer.cohortSize ?? "?"}, timeline ${reply.answer.timeline ?? "?"}`);
  },

  async "lead.convert"(ctx: GoldenPathContext, rec: Recorder) {
    const s = ctx.scenario;
    const course = s.courseCode ? await getCourseByCode(s.courseCode) : undefined;
    rec.expect(!s.courseCode || course, `catalogue course ${s.courseCode} is not seeded`);
    const converted = await convertLeadToPackage(
      ctx.leadId as string,
      {
        title: s.title,
        deliveryMode: s.deliveryMode,
        startDate: ctx.startDate,
        endDate: ctx.endDate,
        pax: s.pax,
        minParticipants: s.minParticipants,
        ...(course ? { courseId: course.id } : {}),
      },
      DEMO_ACTORS.ops,
    );
    ctx.packageId = converted.package.id;
    ctx.packageCode = converted.package.packageCode;
    ctx.clientId = converted.client.id;
    ctx.clientName = converted.client.companyName;
    rec.expect(converted.package.operationalStage === "DRAFT" && converted.package.financialStage === "ESTIMATE", "a new package starts DRAFT / ESTIMATE");
    rec.expect(converted.client.levyRegistered, "the micro-TNA 'yes' should mark the client levy-registered");
    rec.expect(converted.proposalTaskId, "conversion did not queue commercial.draft_proposal");
    rec.id("package", converted.package.id);
    rec.id("code", converted.package.packageCode);
    rec.id("client", converted.client.id);
    rec.note(`${converted.clientCreated ? "new client" : "existing client"} ${converted.client.companyName}; ${ctx.startDate}..${ctx.endDate}, ${s.pax} pax, min ${s.minParticipants}${course ? `, course pinned ${s.courseCode}` : ""}`);
  },
} satisfies StepMap;
