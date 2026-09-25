import { sql } from "drizzle-orm";
import { db, rows } from "@/server/db/client";

/**
 * Read model for the outbox screen (UI-2): draft requests the worker has not
 * finished. `requestDraftSequence` only enqueues, so without this the
 * operator who imported a list sees nothing until the batch appears.
 * Completed requests are not listed — their batch is.
 */
export interface DraftRequest {
  taskId: string;
  status: "QUEUED" | "PROCESSING" | "FAILED";
  targets: number;
  campaignNote: string | null;
  requestedBy: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

const OPEN = ["QUEUED", "PROCESSING", "FAILED"] as const;

export async function listDraftRequests(limit = 20): Promise<DraftRequest[]> {
  const result = await rows<{
    id: string;
    status: string;
    targets: number | null;
    campaign_note: string | null;
    requested_by: string | null;
    attempts: number;
    last_error: string | null;
    created_at: Date | string;
  }>(
    db(),
    sql`select id, status, jsonb_array_length(coalesce(payload -> 'targets', '[]'::jsonb))::int as targets,
               payload ->> 'campaignNote' as campaign_note, payload -> 'requestedBy' ->> 'id' as requested_by,
               attempts, last_error, created_at
          from tpms.task_queue
         where task_type = 'outbound.draft_sequence' and status in ('QUEUED', 'PROCESSING', 'FAILED')
         order by created_at desc
         limit ${Math.min(Math.max(limit, 1), 100)}`,
  );
  return result.map((r) => {
    if (!(OPEN as readonly string[]).includes(r.status)) throw new Error(`Unknown task status: ${r.status}`);
    return {
      taskId: r.id,
      status: r.status as DraftRequest["status"],
      targets: r.targets ?? 0,
      campaignNote: r.campaign_note,
      requestedBy: r.requested_by,
      attempts: r.attempts,
      lastError: r.last_error,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

/** Each batch's campaign note and drafter (kept on its rows' provenance), for the batch list. */
export async function batchNotes(batchIds: string[]): Promise<Record<string, { campaignNote: string | null; draftedBy: string | null }>> {
  const ids = batchIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return {};
  const result = await rows<{ batch_id: string; campaign_note: string | null; drafted_by: string | null }>(
    db(),
    sql`select distinct on (batch_id) batch_id, provenance ->> 'campaignNote' as campaign_note, provenance ->> 'draftedBy' as drafted_by
          from tpms.outbound_campaign_outbox
         where batch_id = any(${`{${ids.join(",")}}`}::uuid[])
         order by batch_id, created_at, id`,
  );
  return Object.fromEntries(result.map((r) => [r.batch_id, { campaignNote: r.campaign_note, draftedBy: r.drafted_by }]));
}
