import { sql } from "drizzle-orm";
import { type Actor, type Tx, db, one, rows, withTx } from "@/server/db/client";
import { recordAudit } from "@/server/audit/ledger";
import { DomainError, isDomainError } from "@/server/domain/errors";
import { sha256Hex } from "@/server/lib/crypto";
import { enqueue } from "@/server/queue/queue";
import { normalise, splitWebhook } from "./normalise";
import type { IntakeMeta, LeadChannel, NormalisedLead } from "./types";

/**
 * Lead intake: the webhook request path.
 *
 * Platforms retry a webhook they did not see acknowledged fast (Meta within
 * seconds), so this path does only what must be durable before the 200:
 * store the raw payload, store the lead, write the audit row and enqueue
 * triage — one transaction, no model call, no outbound HTTP. Classification,
 * Graph enrichment and WhatsApp all happen in the `lead.triage` task.
 *
 * Two different "duplicates":
 *   REPLAY — the same payload again (a retry). Its canonical SHA-256 already
 *            exists, so nothing new is stored and the original lead returns.
 *   DEDUPE — a new submission from a company or phone number we already have
 *            an open lead for in the last 90 days. It IS stored (the operator
 *            sees it) with status DUPLICATE and `duplicate_of` the original.
 */
export const INGEST_ACTOR: Actor = { type: "SYSTEM", id: "sys_ingestion" };
export const DEDUPE_WINDOW_DAYS = 90;

export interface IngestOptions {
  /** The request proved its origin (signature / shared key). Recorded; see triage for its effect. */
  verified: boolean;
  receivedAt?: Date;
  /** Who is recording the lead; an operator for MANUAL entry, the system otherwise. */
  actor?: Actor;
}

export type IngestResult =
  | { status: "INGESTED"; reason: "NEW"; leadId: string; rawPayloadId: string; duplicateOf: null; triageTaskId: string | null }
  | {
      status: "DUPLICATE";
      reason: "REPLAY" | "DEDUPE_DOMAIN" | "DEDUPE_PHONE";
      leadId: string;
      rawPayloadId: string;
      duplicateOf: string | null;
      triageTaskId: null;
    }
  | { status: "REJECTED"; reason: "INVALID_PAYLOAD"; leadId: null; rawPayloadId: string | null; code: string; message: string };

// ---------------------------------------------------------------- hashing

/** Key-sorted JSON: the same payload hashes the same whatever order a platform serialised it in. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

const SECRET_KEY = /^(google_key|access_token|app_secret|secret|password|token|api_key|x-tpms-.*)$/i;

/**
 * Credentials that arrive inside a payload (Google's `google_key`) never
 * reach the database. Redaction happens before hashing, so a retry of the
 * same payload still hashes identically.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redactSecrets(v)]),
    );
  }
  return value;
}

export function payloadHash(channel: LeadChannel, redacted: unknown): string {
  return sha256Hex(canonicalJson({ channel, payload: redacted }));
}

// ---------------------------------------------------------------- ingest

export async function ingestLead(channel: LeadChannel, rawPayload: unknown, opts: IngestOptions): Promise<IngestResult> {
  const redacted = redactSecrets(rawPayload);
  const hash = payloadHash(channel, redacted);
  const receivedAt = opts.receivedAt ?? new Date();
  const actor = opts.actor ?? INGEST_ACTOR;

  let lead: NormalisedLead;
  try {
    lead = normalise(channel, rawPayload);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return reject(channel, redacted, hash, receivedAt, error);
  }

  return withTx(actor, { reasonCode: "SYSTEM_LEAD_INGESTED" }, async (tx) => {
    const inserted = await one<{ id: string }>(
      tx,
      sql`insert into tpms.raw_lead_payloads (source_channel, raw_payload, sha256_hash, ad_click_identifiers, created_at)
          values (${channel}, ${JSON.stringify(redacted)}::jsonb, ${hash},
                  ${JSON.stringify({ ...lead.adClickIds, ...lead.platformIds })}::jsonb, ${receivedAt})
          on conflict (sha256_hash) do nothing
          returning id`,
    );
    if (!inserted) return replay(tx, hash);

    const original = await findOpenLead(tx, lead, receivedAt);
    const client = await matchClient(tx, lead);
    const intake: IntakeMeta = {
      verified: opts.verified,
      channel,
      platformIds: lead.platformIds,
      owner: lead.owner,
      isTest: lead.isTest,
      needsEnrichment: lead.needsEnrichment,
    };
    const status = original ? "DUPLICATE" : "LEAD_INGESTED";

    const row = await one<{ id: string }>(
      tx,
      sql`insert into tpms.lead_records (
            raw_payload_id, client_id, duplicate_of, company_name, company_domain, ssm_registration_number,
            pic_full_name, pic_email, pic_phone_e164, training_topic, message, channel_source, campaign_id, ad_id,
            has_whatsapp_opt_in, estimated_pax, delivery_preference, tna_profile, status, created_at)
          values (${inserted.id}::uuid, ${client?.id ?? null}::uuid, ${original?.id ?? null}::uuid, ${lead.companyName},
                  ${lead.companyDomain}, ${lead.ssm}, ${lead.picName}, ${lead.picEmail}, ${lead.picPhoneE164},
                  ${lead.topic}, ${lead.message}, ${channel}, ${lead.campaignId}, ${lead.adId}, ${lead.whatsappOptIn},
                  ${lead.estimatedPax}, ${lead.deliveryPreference}, ${JSON.stringify({ intake })}::jsonb, ${status}, ${receivedAt})
          returning id`,
    );
    if (!row) throw new Error("lead insert returned no row");

    if (original) {
      await tx.execute(sql`update tpms.raw_lead_payloads set status = 'DUPLICATE' where id = ${inserted.id}::uuid`);
    }
    // PDPA: the ledger is append-only and cannot be erased, so it carries no
    // personal data — the lead row holds the contact details, the ledger the facts.
    await recordAudit(tx, {
      entityType: "LEAD",
      entityId: row.id,
      reasonCode: "SYSTEM_LEAD_INGESTED",
      details: `${channel} lead for ${lead.companyName}${original ? " (duplicate)" : ""}`,
      metadata: {
        channel,
        verified: opts.verified,
        raw_payload_id: inserted.id,
        sha256: hash,
        status,
        duplicate_of: original?.id ?? null,
        matched_by: original?.matchedBy ?? null,
        client_id: client?.id ?? null,
        company_domain: lead.companyDomain,
        campaign_id: lead.campaignId,
        ad_id: lead.adId,
        ad_click_ids: lead.adClickIds,
        is_test: lead.isTest,
        needs_enrichment: lead.needsEnrichment,
        owner_is_staff: lead.owner !== null,
      },
    });

    if (original) {
      return {
        status: "DUPLICATE" as const,
        reason: original.matchedBy === "DOMAIN" ? ("DEDUPE_DOMAIN" as const) : ("DEDUPE_PHONE" as const),
        leadId: row.id,
        rawPayloadId: inserted.id,
        duplicateOf: original.id,
        triageTaskId: null,
      };
    }
    const triageTaskId = await enqueue(tx, { type: "lead.triage", payload: { leadId: row.id }, idempotencyKey: `triage:${row.id}` });
    return { status: "INGESTED" as const, reason: "NEW" as const, leadId: row.id, rawPayloadId: inserted.id, duplicateOf: null, triageTaskId };
  });
}

/** Split a webhook body into leads and ingest each. One bad item never sinks the others. */
export async function ingestWebhook(channel: LeadChannel, body: unknown, opts: IngestOptions): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const item of splitWebhook(channel, body)) {
    results.push(await ingestLead(channel, item, opts));
  }
  return results;
}

/** An operator typing a lead in (phone call, walk-in, event badge scan). */
export async function createManualLead(input: Record<string, unknown>, actor: Actor): Promise<IngestResult> {
  if (actor.type !== "USER") throw new DomainError("MANUAL_LEAD_REQUIRES_OPERATOR", "Only an operator can record a manual lead");
  return ingestLead("MANUAL", { ...input, entered_by: actor.id, entered_at: new Date().toISOString() }, { verified: true, actor });
}

async function replay(tx: Tx, hash: string): Promise<IngestResult> {
  const existing = await one<{ raw_id: string; lead_id: string | null }>(
    tx,
    sql`select r.id as raw_id, l.id as lead_id
          from tpms.raw_lead_payloads r
          left join tpms.lead_records l on l.raw_payload_id = r.id
         where r.sha256_hash = ${hash}
         order by l.created_at asc nulls last
         limit 1`,
  );
  if (!existing) throw new Error("raw payload conflict without a stored row");
  if (!existing.lead_id) {
    return {
      status: "REJECTED",
      reason: "INVALID_PAYLOAD",
      leadId: null,
      rawPayloadId: existing.raw_id,
      code: "ALREADY_REJECTED",
      message: "This payload was received before and rejected",
    };
  }
  return { status: "DUPLICATE", reason: "REPLAY", leadId: existing.lead_id, rawPayloadId: existing.raw_id, duplicateOf: null, triageTaskId: null };
}

/**
 * The open lead a new submission duplicates, if any. Free-mail domains are
 * never a company domain (the normaliser nulls them), so two gmail.com
 * strangers only match on the same phone number. Archived and converted
 * leads do not swallow a new enquiry: spam from a domain last month must not
 * hide a real request today, and a converted client asking again is new
 * business. Concurrent submissions for the same key serialise on an
 * advisory lock so both cannot become "the original".
 */
export async function findOpenLead(
  tx: Tx,
  lead: Pick<NormalisedLead, "companyDomain" | "picPhoneE164">,
  receivedAt: Date,
  excludeId?: string,
): Promise<{ id: string; matchedBy: "DOMAIN" | "PHONE" } | null> {
  const domain = lead.companyDomain?.toLowerCase() ?? null;
  const phone = lead.picPhoneE164 || null;
  const keys = [domain ? `domain:${domain}` : null, phone ? `phone:${phone}` : null].filter((k): k is string => !!k).sort();
  if (keys.length === 0) return null;
  for (const key of keys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tpms.lead-dedupe:${key}`}, 0))`);
  }
  const found = await one<{ id: string; matched_by: "DOMAIN" | "PHONE" }>(
    tx,
    sql`select id,
               case when ${domain}::text is not null and lower(company_domain) = ${domain}::text then 'DOMAIN' else 'PHONE' end as matched_by
          from tpms.lead_records
         where status not in ('DUPLICATE', 'ARCHIVED', 'CONVERTED')
           and (${excludeId ?? null}::uuid is null or id <> ${excludeId ?? null}::uuid)
           and created_at >= ${receivedAt}::timestamptz - make_interval(days => ${DEDUPE_WINDOW_DAYS})
           and created_at <= ${receivedAt}::timestamptz
           and ((${domain}::text is not null and lower(company_domain) = ${domain}::text)
             or (${phone}::text is not null and pic_phone_e164 = ${phone}::text))
         order by created_at asc
         limit 1`,
  );
  return found ? { id: found.id, matchedBy: found.matched_by } : null;
}

async function matchClient(tx: Tx, lead: NormalisedLead): Promise<{ id: string } | null> {
  if (!lead.companyDomain && !lead.ssm) return null;
  const found = await one<{ id: string }>(
    tx,
    sql`select id from tpms.corporate_clients
         where (${lead.companyDomain}::text is not null and lower(company_domain) = lower(${lead.companyDomain}::text))
            or (${lead.ssm}::text is not null and ssm_registration = ${lead.ssm}::text)
         order by (lower(company_domain) = lower(${lead.companyDomain}::text)) desc nulls last
         limit 1`,
  );
  return found ?? null;
}

/** An unreadable payload is kept (status REJECTED) so an operator can see what the platform sent. */
async function reject(channel: LeadChannel, redacted: unknown, hash: string, receivedAt: Date, error: DomainError): Promise<IngestResult> {
  const stored = await rows<{ id: string }>(
    db(),
    sql`insert into tpms.raw_lead_payloads (source_channel, raw_payload, sha256_hash, status, created_at)
        values (${channel}, ${JSON.stringify(redacted ?? null)}::jsonb, ${hash}, 'REJECTED', ${receivedAt})
        on conflict (sha256_hash) do update set status = tpms.raw_lead_payloads.status
        returning id`,
  );
  return {
    status: "REJECTED",
    reason: "INVALID_PAYLOAD",
    leadId: null,
    rawPayloadId: stored[0]?.id ?? null,
    code: error.code,
    message: error.message,
  };
}
