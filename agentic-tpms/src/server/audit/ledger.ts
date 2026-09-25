import { desc, eq, and, sql } from "drizzle-orm";
import { type Executor, db, rows, schema } from "../db/client";
import type { AuditRow } from "../db/schema";

/**
 * Service-layer audit writes for events that are not a package stage change
 * (those are written by the database trigger, which cannot be bypassed).
 * Both paths go through `tpms.audit_record`, so there is one writer and one
 * hash chain.
 */
export async function recordAudit(
  executor: Executor,
  entry: {
    entityType: string;
    entityId: string;
    reasonCode: string;
    details?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const result = await rows<{ id: string }>(
    executor,
    sql`select tpms.audit_record(${entry.entityType}, ${entry.entityId}::uuid, ${entry.reasonCode},
        ${entry.details ?? ""}, ${JSON.stringify(entry.metadata ?? {})}::jsonb) as id`,
  );
  return result[0].id;
}

export async function listAudit(opts: { entityId?: string; entityType?: string; limit?: number } = {}): Promise<AuditRow[]> {
  const where = [
    opts.entityId ? eq(schema.auditLedger.entityId, opts.entityId) : undefined,
    opts.entityType ? eq(schema.auditLedger.entityType, opts.entityType) : undefined,
  ].filter(Boolean);
  return db()
    .select()
    .from(schema.auditLedger)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.auditLedger.seq))
    .limit(opts.limit ?? 200);
}

/** Every audit row that touches a package: its own rows plus vault, decision and PV rows that name it. */
export async function listPackageAudit(packageId: string, limit = 300): Promise<AuditRow[]> {
  return rows<AuditRow>(
    db(),
    sql`select log_id as "logId", seq, entity_type as "entityType", entity_id as "entityId", machine,
               from_stage as "fromStage", to_stage as "toStage", actor_type as "actorType", actor_id as "actorId",
               reason_code as "reasonCode", reason_details as "reasonDetails", metadata_diff as "metadataDiff",
               prev_checkpoint as "prevCheckpoint", sha256_checkpoint as "sha256Checkpoint", created_at as "createdAt"
          from tpms.audit_ledger
         where entity_id = ${packageId}::uuid
            or metadata_diff ->> 'package_id' = ${packageId}
         order by seq desc
         limit ${limit}`,
  );
}

export interface ChainVerdict {
  ok: boolean;
  rows: number;
  firstBrokenSeq: number | null;
  head: string | null;
}

export async function verifyChain(executor: Executor = db()): Promise<ChainVerdict> {
  const result = await rows<{ seq: number; ok: boolean; stored: string }>(
    executor,
    sql`select seq, ok, stored from tpms.audit_verify_chain()`,
  );
  const broken = result.find((r) => !r.ok);
  return {
    ok: !broken,
    rows: result.length,
    firstBrokenSeq: broken ? Number(broken.seq) : null,
    head: result.length ? result[result.length - 1].stored : null,
  };
}

