import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { type Executor, db, schema } from "@/server/db/client";
import type { Lead } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { type OutboundMessage, outboundMessages } from "@/server/messaging/schema";
import type { IntakeMeta, LeadStatus } from "./types";

/** Read models for the Leads inbox. */
export async function getLead(id: string, executor: Executor = db()): Promise<Lead> {
  const [lead] = await executor.select().from(schema.leadRecords).where(eq(schema.leadRecords.id, id));
  if (!lead) throw new DomainError("LEAD_NOT_FOUND", `Lead ${id} not found`);
  return lead;
}

/** The row, locked for the rest of the caller's transaction. */
export async function lockLead(executor: Executor, id: string): Promise<Lead> {
  await executor.execute(sql`select id from tpms.lead_records where id = ${id}::uuid for update`);
  return getLead(id, executor);
}

export function intakeOf(lead: Pick<Lead, "tnaProfile" | "channelSource">): IntakeMeta {
  const raw = (lead.tnaProfile?.intake ?? {}) as Partial<IntakeMeta>;
  return {
    verified: raw.verified ?? false,
    channel: (raw.channel ?? lead.channelSource) as IntakeMeta["channel"],
    platformIds: raw.platformIds ?? {},
    owner: raw.owner ?? null,
    isTest: raw.isTest ?? false,
    needsEnrichment: raw.needsEnrichment ?? false,
  };
}

export async function listLeads(opts: { status?: LeadStatus | LeadStatus[]; channel?: string; limit?: number } = {}): Promise<Lead[]> {
  const where: SQL[] = [];
  if (opts.status) {
    where.push(Array.isArray(opts.status) ? inArray(schema.leadRecords.status, opts.status) : eq(schema.leadRecords.status, opts.status));
  }
  if (opts.channel) where.push(eq(schema.leadRecords.channelSource, opts.channel));
  return db()
    .select()
    .from(schema.leadRecords)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.leadRecords.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
}

export async function leadStatusCounts(): Promise<Record<string, number>> {
  const result = await db().execute(sql`select status, count(*)::int as n from tpms.lead_records group by status`);
  return Object.fromEntries((result.rows as Array<{ status: string; n: number }>).map((r) => [r.status, r.n]));
}

export interface LeadDetail {
  lead: Lead;
  intake: IntakeMeta;
  /** The latest L1 run's primitives and route, when triage has run. */
  triage: Record<string, unknown> | null;
  duplicates: Lead[];
  messages: OutboundMessage[];
}

export async function getLeadDetail(id: string): Promise<LeadDetail> {
  const lead = await getLead(id);
  const [run] = await db()
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.leadId, id), eq(schema.agentRuns.agent, "ingestion.l1_classifier")))
    .orderBy(desc(schema.agentRuns.startedAt))
    .limit(1);
  const duplicates = await db().select().from(schema.leadRecords).where(eq(schema.leadRecords.duplicateOf, id)).orderBy(desc(schema.leadRecords.createdAt));
  const messages = await db().select().from(outboundMessages).where(eq(outboundMessages.leadId, id)).orderBy(desc(outboundMessages.createdAt));
  return { lead, intake: intakeOf(lead), triage: run ? { ...run.output, provenance: run.provenance, status: run.status } : null, duplicates, messages };
}
