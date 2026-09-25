import { sql, type SQL } from "drizzle-orm";
import { db, rows } from "@/server/db/client";
import { L1_AGENT } from "./triage";
import { type LeadChannel, type LeadStatus, assertLeadStatus } from "./types";

/**
 * Read model for the Leads inbox (UI-2): one row per lead with the facts the
 * table shows, the converted package's code, and the provenance of the
 * latest L1 run — so the inbox can say honestly whether a model or the
 * deterministic template classified each lead, and with what confidence.
 */
export interface L1Verdict {
  runId: string;
  runStatus: string;
  /** LLM, TEMPLATE, RULE or EXTRACTION, exactly as the router recorded it. */
  mode: string | null;
  provider: string | null;
  model: string | null;
  fallbackReason: string | null;
  tier: string;
  intent: string | null;
  intentConfidence: number | null;
  pLevy: number | null;
  urgency: number | null;
  route: string | null;
  reason: string | null;
  abstain: { reason: string; missing: string[] } | null;
  latencyMs: number | null;
  startedAt: string;
}

export interface LeadInboxRow {
  id: string;
  createdAt: string;
  channel: LeadChannel;
  verified: boolean;
  isTest: boolean;
  companyName: string;
  companyDomain: string | null;
  picFullName: string;
  picEmail: string;
  picPhoneE164: string;
  trainingTopic: string | null;
  estimatedPax: number | null;
  deliveryPreference: string | null;
  status: LeadStatus;
  duplicateOf: string | null;
  convertedPackageId: string | null;
  packageCode: string | null;
  classifierModel: string | null;
  l1: L1Verdict | null;
}

type Raw = {
  id: string;
  created_at: Date | string;
  channel_source: string;
  intake: { verified?: boolean; isTest?: boolean } | null;
  company_name: string;
  company_domain: string | null;
  pic_full_name: string;
  pic_email: string;
  pic_phone_e164: string;
  training_topic: string | null;
  estimated_pax: number | null;
  delivery_preference: string | null;
  status: string;
  duplicate_of: string | null;
  converted_package_id: string | null;
  package_code: string | null;
  classifier_model: string | null;
  run_id: string | null;
  run_status: string | null;
  run_tier: string | null;
  run_started_at: Date | string | null;
  output: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const field = (o: unknown, key: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined);

function verdictOf(r: Raw): L1Verdict | null {
  if (!r.run_id || !r.run_started_at) return null;
  const out = r.output ?? {};
  const prov = r.provenance ?? {};
  const abstain = field(out, "abstain");
  return {
    runId: r.run_id,
    runStatus: r.run_status ?? "RUNNING",
    mode: str(prov.mode),
    provider: str(prov.provider),
    model: str(prov.model),
    fallbackReason: str(prov.fallbackReason),
    tier: r.run_tier ?? "L1",
    intent: str(field(field(out, "intent"), "value")),
    intentConfidence: num(field(field(out, "intent"), "confidence")),
    pLevy: num(field(field(out, "pLevy"), "value")),
    urgency: num(field(field(out, "urgency"), "value")),
    route: str(out.route),
    reason: str(out.reason),
    abstain:
      abstain && typeof abstain === "object"
        ? { reason: String(field(abstain, "reason") ?? ""), missing: Array.isArray(field(abstain, "missing")) ? (field(abstain, "missing") as unknown[]).map(String) : [] }
        : null,
    latencyMs: num(out.latencyMs) ?? num(prov.latencyMs),
    startedAt: new Date(r.run_started_at).toISOString(),
  };
}

export async function listLeadInbox(opts: { status?: LeadStatus; id?: string; limit?: number } = {}): Promise<LeadInboxRow[]> {
  const where: SQL[] = [];
  if (opts.status) where.push(sql`l.status = ${assertLeadStatus(opts.status)}`);
  if (opts.id) where.push(sql`l.id = ${opts.id}::uuid`);
  const filter = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const result = await rows<Raw>(
    db(),
    sql`select l.id, l.created_at, l.channel_source, l.tna_profile -> 'intake' as intake, l.company_name, l.company_domain,
               l.pic_full_name, l.pic_email, l.pic_phone_e164, l.training_topic, l.estimated_pax, l.delivery_preference,
               l.status, l.duplicate_of, l.converted_package_id, p.package_code, l.classifier_model,
               r.id as run_id, r.status as run_status, r.tier as run_tier, r.started_at as run_started_at, r.output, r.provenance
          from tpms.lead_records l
          left join tpms.training_packages p on p.id = l.converted_package_id
          left join lateral (
            select id, status, tier, started_at, output, provenance from tpms.agent_runs
             where lead_id = l.id and agent = ${L1_AGENT}
             order by started_at desc limit 1
          ) r on true
          ${filter}
         order by l.created_at desc
         limit ${limit}`,
  );
  return result.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    channel: r.channel_source as LeadChannel,
    verified: r.intake?.verified ?? false,
    isTest: r.intake?.isTest ?? false,
    companyName: r.company_name,
    companyDomain: r.company_domain,
    picFullName: r.pic_full_name,
    picEmail: r.pic_email,
    picPhoneE164: r.pic_phone_e164,
    trainingTopic: r.training_topic,
    estimatedPax: r.estimated_pax,
    deliveryPreference: r.delivery_preference,
    status: assertLeadStatus(r.status),
    duplicateOf: r.duplicate_of,
    convertedPackageId: r.converted_package_id,
    packageCode: r.package_code,
    classifierModel: r.classifier_model,
    l1: verdictOf(r),
  }));
}

/** One lead's inbox row (the detail page's header facts), or undefined. */
export async function leadInboxRow(id: string): Promise<LeadInboxRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await listLeadInbox({ id, limit: 1 });
  return row;
}

/** Every agent run on a lead (L1 classifier, micro-TNA writer…), newest first, for provenance chips. */
export interface LeadAgentRun {
  id: string;
  agent: string;
  tier: string;
  status: string;
  provenance: Record<string, unknown>;
  startedAt: string;
}

export async function leadAgentRuns(leadId: string): Promise<LeadAgentRun[]> {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return [];
  const result = await rows<{ id: string; agent: string; tier: string; status: string; provenance: Record<string, unknown>; started_at: Date | string }>(
    db(),
    sql`select id, agent, tier, status, provenance, started_at from tpms.agent_runs where lead_id = ${leadId}::uuid order by started_at desc limit 50`,
  );
  return result.map((r) => ({ id: r.id, agent: r.agent, tier: r.tier, status: r.status, provenance: r.provenance ?? {}, startedAt: new Date(r.started_at).toISOString() }));
}
