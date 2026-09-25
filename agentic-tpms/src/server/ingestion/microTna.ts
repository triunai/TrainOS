import { sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, db, one, withTx } from "@/server/db/client";
import type { Lead } from "@/server/db/schema";
import { recordAudit } from "@/server/audit/ledger";
import { finishAgentRun, runTier, startAgentRun } from "@/server/ai";
import { sendWhatsAppText } from "@/server/messaging/whatsapp";
import { isWhatsAppCapable, normaliseMalaysianPhone } from "./phone";
import { getLead, lockLead } from "./queries";
import { extractPax } from "./text";

/**
 * The WhatsApp micro-TNA: one question that decides whether a qualified lead
 * is an SBL-Khas (levy-funded) engagement or a cash one, asked while the lead
 * is warm. The reply is parsed deterministically (English and Malay) into
 * `tna_profile`; a "no" moves the lead to PRIVATE_CASH.
 */
export const MICRO_TNA_AGENT = "ingestion.micro_tna_writer";
const TNA_ACTOR: Actor = { type: "SYSTEM", id: "sys_micro_tna" };

/** The approved wording. A model may rephrase; it may not drop the eligibility question. */
export function microTnaTemplate(lead: Pick<Lead, "picFullName" | "trainingTopic" | "companyName">): string {
  const name = lead.picFullName.trim() || "there";
  const topic = lead.trainingTopic?.trim() || "training";
  const company = lead.companyName && lead.companyName !== "Unknown company" ? lead.companyName : "your company";
  return (
    `Hi ${name}, received your inquiry regarding ${topic} for ${company}. ` +
    `To confirm eligibility for 100% SBL-Khas grant coverage (zero upfront cash outlay): ` +
    `Is ${company} an active HRD Corp levy contributor?`
  );
}

const draftSchema = z.object({ message: z.string().min(20).max(700) });

export interface MicroTnaResult {
  leadId: string;
  skipped?: string;
  status?: "SENT" | "LOGGED";
  messageId?: string;
  body?: string;
}

export async function sendMicroTna(leadId: string, opts: { taskId?: string | null } = {}): Promise<MicroTnaResult> {
  const lead = await getLead(leadId);
  if (!isWhatsAppCapable(lead.picPhoneE164)) return { leadId, skipped: "NO_MOBILE_NUMBER" };
  if ((lead.tnaProfile as { microTna?: unknown }).microTna) return { leadId, skipped: "ALREADY_SENT" };
  if (lead.status !== "LEAD_QUALIFIED_TNA") return { leadId, skipped: `LEAD_${lead.status}` };

  const template = microTnaTemplate(lead);
  const runId = await startAgentRun(db(), {
    agent: MICRO_TNA_AGENT,
    tier: "L3",
    leadId,
    taskId: opts.taskId ?? null,
    inputSummary: `Micro-TNA for ${lead.companyName}`,
  });
  try {
    const { output, provenance } = await runTier(
      {
        tier: "L3",
        agent: MICRO_TNA_AGENT,
        leadId,
        system:
          "You write one short WhatsApp message for a Malaysian HRD Corp training provider. Keep the meaning of the reference " +
          "message exactly: acknowledge the enquiry, then ask whether the company is an active HRD Corp levy contributor. " +
          'No emojis, no links, under 60 words. Return {"message": string}.',
        prompt: JSON.stringify({ reference: template, name: lead.picFullName, topic: lead.trainingTopic, company: lead.companyName }),
        json: { schema: draftSchema },
        maxTokens: 300,
        template: () => ({ message: template }),
      },
      { runId },
    );
    // L0 check on a model's wording: the eligibility question must survive.
    const body = /hrd\s*corp/i.test(output.message) && output.message.trim().endsWith("?") ? output.message.trim() : template;
    const sent = await sendWhatsAppText({ toE164: lead.picPhoneE164, body, leadId, kind: "MICRO_TNA" });

    await withTx(TNA_ACTOR, { reasonCode: "LEAD_MICRO_TNA_SENT" }, async (tx) => {
      await tx.execute(sql`update tpms.lead_records
           set tna_profile = jsonb_set(tna_profile, '{microTna}', ${JSON.stringify({
             sentAt: new Date().toISOString(),
             messageId: sent.id,
             deliveryStatus: sent.status,
             agentRunId: runId,
           })}::jsonb)
         where id = ${leadId}::uuid`);
      await recordAudit(tx, {
        entityType: "LEAD",
        entityId: leadId,
        reasonCode: "LEAD_MICRO_TNA_SENT",
        details: `WhatsApp micro-TNA ${sent.status.toLowerCase()}`,
        metadata: { outbound_message_id: sent.id, status: sent.status, mode: provenance.mode },
      });
    });
    await finishAgentRun(db(), runId, {
      status: provenance.mode === "LLM" ? "SUCCEEDED" : "FALLBACK",
      output: { message: body, delivery: sent.status },
      provenance,
      costMyr: provenance.costMyr,
    });
    return { leadId, status: sent.status, messageId: sent.id, body };
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// ---------------------------------------------------------------- reply parsing

export interface TnaAnswer {
  levyActive: boolean | null;
  cohortSize: number | null;
  timeline: string | null;
}

const UNSURE = /\b(not sure|unsure|tak pasti|tidak pasti|tak tahu|tidak tahu|don'?t know|dunno|need to check|will check|nak check|akan semak)\b/i;
const YES = /\b(yes|ya|yup|yep|yeah|betul|ada|sure|confirm(?:ed)?|active|aktif|of course|correct|we are|we do|registered|berdaftar)\b/i;
const NO = /\b(no|nope|tidak|tak|bukan|belum|not (?:a |an )?(?:active|contributor|registered|levy)|none|non[- ]?levy|we are not|we're not|not yet)\b/i;

const MONTHS =
  // "may" is left out on purpose: "yes, may be 20 pax" is not a timeline. "in May" is matched below.
  "january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|" +
  "januari|februari|mac|mei|julai|ogos|oktober|disember";
const TIMELINE = new RegExp(
  `\\b(\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS}|may)(?:\\s+\\d{4})?|(?:early|mid|end|late|awal|pertengahan|hujung|akhir)[- ](?:of )?(?:${MONTHS}|may)|(?:in|by|before) may|` +
    `(?:${MONTHS})(?:\\s+\\d{4})?|q[1-4](?:\\s+\\d{4})?|next (?:week|month|quarter|year)|this (?:week|month|quarter)|` +
    `bulan depan|minggu depan|tahun depan|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|asap|segera)\\b`,
  "i",
);

/** Earliest signal wins: "yes, not sure about the balance" is a yes; "not sure" alone is unknown. */
export function parseTnaReply(text: string): TnaAnswer {
  const positions: Array<[number, boolean | null]> = [];
  const unsure = UNSURE.exec(text);
  if (unsure) positions.push([unsure.index, null]);
  const no = NO.exec(text);
  if (no && !(unsure && no.index >= unsure.index && no.index < unsure.index + unsure[0].length)) positions.push([no.index, false]);
  const yes = YES.exec(text);
  if (yes) positions.push([yes.index, true]);
  positions.sort((a, b) => a[0] - b[0]);
  const bareCount = /^\s*(\d{1,4})\s*(?:pax|orang|people)?\s*[.!]?\s*$/i.exec(text);
  return {
    levyActive: positions.length ? positions[0][1] : null,
    cohortSize: extractPax(text) ?? (bareCount ? Number(bareCount[1]) : null),
    timeline: TIMELINE.exec(text)?.[1] ?? null,
  };
}

export interface ReplyOutcome {
  leadId: string;
  answer: TnaAnswer;
  status: string;
  replayed?: boolean;
}

/**
 * An inbound WhatsApp message from a number we sent a micro-TNA to. Returns
 * null when no such lead exists, so the caller can ingest it as a new
 * WHATSAPP_INBOUND lead instead. A message id already applied is ignored,
 * because the Cloud API redelivers webhooks it did not see acknowledged.
 */
export async function handleWhatsAppReply(fromE164: string, text: string, opts: { messageId?: string } = {}): Promise<ReplyOutcome | null> {
  const phone = normaliseMalaysianPhone(fromE164);
  if (!phone) return null;
  const match = await one<{ id: string }>(
    db(),
    sql`select id from tpms.lead_records
         where pic_phone_e164 = ${phone}
           and tna_profile ? 'microTna'
           and status in ('LEAD_QUALIFIED_TNA', 'TRIAGE_REVIEW', 'PRIVATE_CASH')
         order by created_at desc
         limit 1`,
  );
  if (!match) return null;

  const answer = parseTnaReply(text);
  return withTx(TNA_ACTOR, { reasonCode: "LEAD_TNA_REPLY" }, async (tx) => {
    const lead = await lockLead(tx, match.id);
    const profile = lead.tnaProfile as Record<string, unknown>;
    const seen = Array.isArray(profile.replyMessageIds) ? (profile.replyMessageIds as string[]) : [];
    if (opts.messageId && seen.includes(opts.messageId)) {
      return { leadId: lead.id, answer, status: lead.status, replayed: true };
    }
    const previous = (profile.answers ?? {}) as Partial<TnaAnswer>;
    const merged: TnaAnswer = {
      // A later "not sure" never erases an earlier clear answer.
      levyActive: answer.levyActive ?? previous.levyActive ?? null,
      cohortSize: answer.cohortSize ?? previous.cohortSize ?? null,
      timeline: answer.timeline ?? previous.timeline ?? null,
    };
    const toPrivateCash = answer.levyActive === false && lead.status !== "PRIVATE_CASH";
    // Only a move this parser made is undone by a later "yes"; a classifier
    // or operator decision to treat the lead as cash is not ours to reverse.
    const backToQualified = answer.levyActive === true && lead.status === "PRIVATE_CASH" && profile.privateCashBy === "MICRO_TNA";
    const nextStatus = toPrivateCash ? "PRIVATE_CASH" : backToQualified ? "LEAD_QUALIFIED_TNA" : lead.status;
    const patch = {
      privateCashBy: toPrivateCash ? "MICRO_TNA" : backToQualified ? null : (profile.privateCashBy ?? null),
      levyActive: merged.levyActive,
      cohortSize: merged.cohortSize,
      timeline: merged.timeline,
      answers: merged,
      lastReply: text.slice(0, 1000),
      repliedAt: new Date().toISOString(),
      replyMessageIds: opts.messageId ? [...seen, opts.messageId].slice(-20) : seen,
    };
    await tx.execute(sql`update tpms.lead_records
         set tna_profile = tna_profile || ${JSON.stringify(patch)}::jsonb,
             estimated_pax = coalesce(${merged.cohortSize}::int, estimated_pax),
             status = ${nextStatus},
             account_type = case when ${toPrivateCash} then 'PRIVATE_CASH'
                                 when ${backToQualified} then 'SBL_KHAS_LEVY'
                                 else account_type end
       where id = ${lead.id}::uuid`);
    await recordAudit(tx, {
      entityType: "LEAD",
      entityId: lead.id,
      reasonCode: "LEAD_TNA_REPLY",
      details: `Micro-TNA reply: levy ${merged.levyActive === null ? "unknown" : merged.levyActive ? "active" : "not active"}`,
      metadata: { answer, merged, from: lead.status, to: nextStatus },
    });
    return { leadId: lead.id, answer: merged, status: nextStatus };
  });
}
