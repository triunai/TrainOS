import { sql } from "drizzle-orm";
import { type Actor, type Tx, db, withTx } from "@/server/db/client";
import type { Lead } from "@/server/db/schema";
import { recordAudit } from "@/server/audit/ledger";
import { raiseDecision, resolvePendingFor } from "@/server/decisions/service";
import { DomainError } from "@/server/domain/errors";
import { finishAgentRun, runTier, startAgentRun } from "@/server/ai";
import { enqueue } from "@/server/queue/queue";
import {
  type ClassifierInput,
  type L1Output,
  MODEL_ID,
  QUALIFY_THRESHOLD,
  REVIEW_THRESHOLD,
  type Route,
  classifyDeterministic,
  l1OutputSchema,
  routeFor,
} from "./classifier";
import { applyEnrichment, fetchMetaLeadFields } from "./enrich";
import { findOpenLead } from "./ingest";
import { isWhatsAppCapable } from "./phone";
import { getLead, intakeOf, lockLead } from "./queries";

/**
 * `lead.triage`: enrich (Meta), re-check duplicates, classify at L1, route.
 *
 * The model (or its deterministic template) only produces the primitives;
 * the route is the L0 rule `routeFor` applied to them, stamped by the system
 * router rather than the agent. A lead already routed is left alone, so a
 * retried task is harmless.
 */
export const L1_AGENT = "ingestion.l1_classifier";
export const ROUTER_ACTOR: Actor = { type: "SYSTEM", id: "sys_lead_router" };

export interface TriageResult {
  leadId: string;
  skipped?: string;
  route?: Route | "DUPLICATE";
  reason?: string;
  pLevy?: number;
  intent?: string;
  urgency?: number;
  abstained?: boolean;
  classifierModel?: string;
  latencyMs?: number;
  microTnaTaskId?: string | null;
  decisionId?: string | null;
}

const SYSTEM_PROMPT = [
  "You are the L1 intake classifier for a Malaysian HRD Corp (SBL-Khas) training provider.",
  "Classify one inbound lead. Return typed decision primitives only:",
  `- intent: {kind:"Choice", name:"intent", value: TRAINING_ENQUIRY|VENDOR_PITCH|JOB_SEEKER|SPAM|OTHER, confidence 0..1}`,
  `- pLevy: {kind:"Score", name:"p_levy", value 0..1, features:{}} — the probability the employer is an HRD Corp levy payer.`,
  "  Evidence for: corporate email domain, Sdn Bhd/Berhad/PLC, 10+ staff, mentions of HRDC/HRD Corp/levy/claimable/SBL/grant.",
  "  Evidence against: free-mail address, an individual buying for themselves, any public-sector body (exempt from the levy).",
  `- urgency: {kind:"Score", name:"urgency", value 1..5}`,
  `- abstain: {kind:"Noul", reason, missing[]} when there is too little evidence to decide, else null.`,
].join("\n");

export function classifierInputOf(lead: Lead): ClassifierInput {
  return {
    companyName: lead.companyName,
    companyDomain: lead.companyDomain,
    picEmail: lead.picEmail,
    picPhoneE164: lead.picPhoneE164,
    ssm: lead.ssmRegistrationNumber,
    topic: lead.trainingTopic,
    message: lead.message,
    estimatedPax: lead.estimatedPax,
    channel: lead.channelSource,
  };
}

/** A model's numbers are clamped and rounded to what the columns hold; the route is recomputed from them. */
function sanitise(output: L1Output): L1Output {
  return {
    ...output,
    intent: { ...output.intent, confidence: Math.round(Math.min(1, Math.max(0, output.intent.confidence)) * 100) / 100 },
    pLevy: { ...output.pLevy, value: Math.round(Math.min(1, Math.max(0, output.pLevy.value)) * 1000) / 1000 },
    urgency: { ...output.urgency, value: Math.min(5, Math.max(1, Math.round(output.urgency.value))) },
  };
}

export async function triageLead(leadId: string, opts: { taskId?: string | null } = {}): Promise<TriageResult> {
  let lead = await getLead(leadId);
  if (lead.status !== "LEAD_INGESTED") return { leadId, skipped: `ALREADY_${lead.status}` };

  // 1. Meta enrichment, then the duplicate check the webhook path could not do without fields.
  const fetched = await fetchMetaLeadFields(lead);
  if (fetched) {
    const duplicate = await withTx(ROUTER_ACTOR, { reasonCode: "LEAD_ENRICHED" }, async (tx) => {
      const locked = await lockLead(tx, leadId);
      if (locked.status !== "LEAD_INGESTED") return null;
      await applyEnrichment(tx, locked, fetched);
      await recordAudit(tx, {
        entityType: "LEAD",
        entityId: leadId,
        reasonCode: "LEAD_ENRICHED",
        details: "Meta Lead Ads fields fetched from the Graph API",
        metadata: { source: "META_GRAPH", company_domain: fetched.companyDomain },
      });
      const original = await findOpenLead(tx, fetched, locked.createdAt ?? new Date(), leadId);
      if (!original) return null;
      await tx.execute(sql`update tpms.lead_records set status = 'DUPLICATE', duplicate_of = ${original.id}::uuid where id = ${leadId}::uuid`);
      await tx.execute(sql`update tpms.raw_lead_payloads set status = 'DUPLICATE' where id = ${locked.rawPayloadId}::uuid`);
      await recordAudit(tx, {
        entityType: "LEAD",
        entityId: leadId,
        reasonCode: "LEAD_MARKED_DUPLICATE",
        details: `Duplicate of ${original.id} by ${original.matchedBy.toLowerCase()}`,
        metadata: { duplicate_of: original.id, matched_by: original.matchedBy },
      });
      return original;
    });
    if (duplicate) return { leadId, route: "DUPLICATE", reason: `DEDUPE_${duplicate.matchedBy}` };
    lead = await getLead(leadId);
  }

  // 2. Classify.
  const input = classifierInputOf(lead);
  const runId = await startAgentRun(db(), {
    agent: L1_AGENT,
    tier: "L1",
    leadId,
    taskId: opts.taskId ?? null,
    inputSummary: `${lead.channelSource} lead · ${lead.companyName} · ${lead.companyDomain ?? "no corporate domain"}`,
  });
  try {
    const started = performance.now();
    const { output: raw, provenance } = await runTier(
      {
        tier: "L1",
        agent: L1_AGENT,
        leadId,
        system: SYSTEM_PROMPT,
        prompt: JSON.stringify({
          company: input.companyName,
          companyDomain: input.companyDomain,
          emailDomain: input.picEmail.split("@")[1] ?? null,
          ssm: input.ssm,
          topic: input.topic,
          message: (input.message ?? "").slice(0, 2000),
          estimatedPax: input.estimatedPax,
          channel: input.channel,
        }),
        json: { schema: l1OutputSchema },
        maxTokens: 400,
        template: () => classifyDeterministic(input),
      },
      { runId },
    );
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const output = sanitise(raw);
    const intake = intakeOf(lead);
    const { route, reason } = routeFor(output, { isTest: intake.isTest });
    const classifierModel = (provenance.mode === "LLM" ? `${provenance.provider}/${provenance.model}` : MODEL_ID).slice(0, 100);

    const outcome = await withTx(ROUTER_ACTOR, { reasonCode: "LEAD_ROUTED" }, (tx) =>
      applyRoute(tx, leadId, output, { route, reason, classifierModel, latencyMs, runId }),
    );
    await finishAgentRun(db(), runId, {
      status: provenance.mode === "LLM" ? "SUCCEEDED" : "FALLBACK",
      output: { ...output, route, reason, latencyMs, applied: !outcome.skipped },
      provenance,
      costMyr: provenance.costMyr,
    });
    if (outcome.skipped) return { leadId, skipped: outcome.skipped };
    return {
      leadId,
      route,
      reason,
      pLevy: output.pLevy.value,
      intent: output.intent.value,
      urgency: output.urgency.value,
      abstained: output.abstain !== null,
      classifierModel,
      latencyMs,
      microTnaTaskId: outcome.microTnaTaskId,
      decisionId: outcome.decisionId,
    };
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function applyRoute(
  tx: Tx,
  leadId: string,
  output: L1Output,
  ctx: { route: Route; reason: string; classifierModel: string; latencyMs: number; runId: string },
): Promise<{ skipped?: string; microTnaTaskId: string | null; decisionId: string | null }> {
  const lead = await lockLead(tx, leadId);
  if (lead.status !== "LEAD_INGESTED") return { skipped: `ALREADY_${lead.status}`, microTnaTaskId: null, decisionId: null };

  await tx.execute(sql`update tpms.lead_records
       set triage_intent = ${output.intent.value},
           p_levy_liable = ${output.pLevy.value.toFixed(3)}::numeric,
           urgency_score = ${output.urgency.value},
           classifier_model = ${ctx.classifierModel},
           classifier_latency_ms = ${ctx.latencyMs},
           status = ${ctx.route},
           qualified_at = case when ${ctx.route} = 'LEAD_QUALIFIED_TNA' then now() else qualified_at end,
           account_type = case when ${ctx.route} = 'PRIVATE_CASH' then 'PRIVATE_CASH' else account_type end
     where id = ${leadId}::uuid`);
  if (lead.rawPayloadId) {
    await tx.execute(sql`update tpms.raw_lead_payloads set status = 'PROCESSED' where id = ${lead.rawPayloadId}::uuid and status = 'INGESTED'`);
  }
  await recordAudit(tx, {
    entityType: "LEAD",
    entityId: leadId,
    reasonCode: "LEAD_ROUTED",
    details: `${ctx.route} (${ctx.reason})`,
    metadata: {
      route: ctx.route,
      reason: ctx.reason,
      primitives: [output.intent, output.pLevy, output.urgency, ...(output.abstain ? [output.abstain] : [])],
      thresholds: { qualify: QUALIFY_THRESHOLD, review: REVIEW_THRESHOLD },
      classifier_model: ctx.classifierModel,
      latency_ms: ctx.latencyMs,
      agent_run_id: ctx.runId,
    },
  });

  let decisionId: string | null = null;
  if (ctx.route === "TRIAGE_REVIEW") {
    const decision = await raiseDecision(tx, {
      gate: "LEAD_TRIAGE",
      subjectRef: leadId,
      title: `Triage ${lead.companyName}`,
      summary: output.abstain
        ? `The classifier abstained: ${output.abstain.reason}. Missing: ${output.abstain.missing.join(", ")}.`
        : `P(levy) ${output.pLevy.value.toFixed(2)} is between ${REVIEW_THRESHOLD} and ${QUALIFY_THRESHOLD}; intent ${output.intent.value} (${output.intent.confidence.toFixed(2)}), urgency ${output.urgency.value}/5.`,
      payload: { leadId, primitives: output, reason: ctx.reason, agentRunId: ctx.runId },
      options: TRIAGE_OPTIONS,
      raisedBy: L1_AGENT,
      raisedByTier: "L1",
      slaHours: 24,
    });
    decisionId = decision.id;
  }

  let microTnaTaskId: string | null = null;
  if (ctx.route === "LEAD_QUALIFIED_TNA" && isWhatsAppCapable(lead.picPhoneE164)) {
    microTnaTaskId = await enqueue(tx, { type: "lead.whatsapp_micro_tna", payload: { leadId }, idempotencyKey: `micro_tna:${leadId}` });
  }
  return { microTnaTaskId, decisionId };
}

export const TRIAGE_OPTIONS = [
  { id: "QUALIFY", label: "Qualify (SBL-Khas)", description: "Levy payer: send the WhatsApp micro-TNA and prepare a proposal" },
  { id: "PRIVATE_CASH", label: "Private / cash", description: "Not claimable: handle as a cash engagement" },
  { id: "ARCHIVE", label: "Archive", description: "Not a training enquiry, or not worth pursuing" },
];

// ---------------------------------------------------------------- operator resolution

export type TriageRoute = "QUALIFY" | "PRIVATE_CASH" | "ARCHIVE";
const ROUTE_STATUS: Record<TriageRoute, "LEAD_QUALIFIED_TNA" | "PRIVATE_CASH" | "ARCHIVED"> = {
  QUALIFY: "LEAD_QUALIFIED_TNA",
  PRIVATE_CASH: "PRIVATE_CASH",
  ARCHIVE: "ARCHIVED",
};

/**
 * The operator's call on a lead (from the Leads inbox or the LEAD_TRIAGE
 * decision). Humans dispose: only a USER actor may resolve. Any lead that has
 * not become a package can be re-routed, including one the classifier routed
 * itself — the operator is always allowed to overrule it.
 */
export async function resolveTriage(
  leadId: string,
  input: { route: TriageRoute; note?: string },
  actor: Actor,
): Promise<{ lead: Lead; microTnaTaskId: string | null }> {
  if (actor.type !== "USER") throw new DomainError("TRIAGE_REQUIRES_HUMAN", "Only an operator can resolve lead triage");
  const status = ROUTE_STATUS[input.route];
  if (!status) throw new DomainError("UNKNOWN_TRIAGE_ROUTE", `Unknown triage route: ${String(input.route)}`);

  return withTx(actor, { reasonCode: "LEAD_TRIAGE_RESOLVED", reasonDetails: input.note }, async (tx) => {
    const lead = await lockLead(tx, leadId);
    if (lead.status === "CONVERTED") {
      throw new DomainError("LEAD_ALREADY_CONVERTED", "This lead is already a training package", { packageId: lead.convertedPackageId });
    }
    await tx.execute(sql`update tpms.lead_records
         set status = ${status},
             duplicate_of = null,
             qualified_at = case when ${status} = 'LEAD_QUALIFIED_TNA' then coalesce(qualified_at, now()) else qualified_at end,
             account_type = case when ${status} = 'PRIVATE_CASH' then 'PRIVATE_CASH'
                                 when ${status} = 'LEAD_QUALIFIED_TNA' then 'SBL_KHAS_LEVY'
                                 else account_type end
       where id = ${leadId}::uuid`);
    await resolvePendingFor(tx, "LEAD_TRIAGE", leadId, { status: "RESOLVED", by: actor.id, chosenOption: input.route, note: input.note });
    await recordAudit(tx, {
      entityType: "LEAD",
      entityId: leadId,
      reasonCode: "LEAD_TRIAGE_RESOLVED",
      details: `${lead.status} -> ${status}${input.note ? `: ${input.note}` : ""}`,
      metadata: { from: lead.status, to: status, route: input.route, was_duplicate_of: lead.duplicateOf },
    });
    let microTnaTaskId: string | null = null;
    if (status === "LEAD_QUALIFIED_TNA" && isWhatsAppCapable(lead.picPhoneE164)) {
      microTnaTaskId = await enqueue(tx, { type: "lead.whatsapp_micro_tna", payload: { leadId }, idempotencyKey: `micro_tna:${leadId}` });
    }
    return { lead: await getLead(leadId, tx), microTnaTaskId };
  });
}
