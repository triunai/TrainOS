import { sql, type SQL } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ActorType } from "../domain/stages";
import { DomainError, fromDatabaseError } from "../domain/errors";
import { pool } from "./pool";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

declare global {
  // eslint-disable-next-line no-var
  var __tpmsDb: Db | undefined;
}

export function db(): Db {
  if (!globalThis.__tpmsDb) {
    globalThis.__tpmsDb = drizzle(pool(), { schema });
  }
  return globalThis.__tpmsDb;
}

export function resetDbHandle(): void {
  globalThis.__tpmsDb = undefined;
}

export interface Actor {
  type: ActorType;
  id: string;
}

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", id: "sys_daemon" };

export interface AuditContext {
  reasonCode: string;
  reasonDetails?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stamps the transaction with who is acting and why. The database triggers
 * read these (`tpms.*` settings, transaction-local) when they write the audit
 * ledger, and refuse any package update that arrives without them.
 */
export async function setAuditContext(tx: Executor, actor: Actor, ctx: AuditContext): Promise<void> {
  await tx.execute(sql`select
    set_config('tpms.actor_type', ${actor.type}, true),
    set_config('tpms.actor_id', ${actor.id}, true),
    set_config('tpms.reason_code', ${ctx.reasonCode}, true),
    set_config('tpms.reason_details', ${ctx.reasonDetails ?? ""}, true),
    set_config('tpms.metadata', ${ctx.metadata ? JSON.stringify(ctx.metadata) : ""}, true)`);
}

/**
 * Run `fn` in one transaction with the audit context set. A database guard
 * refusal comes back as a DomainError (R2), everything else is rethrown as is.
 */
export async function withTx<T>(actor: Actor, ctx: AuditContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db().transaction(async (tx) => {
      await setAuditContext(tx, actor, ctx);
      return fn(tx);
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    let current: unknown = error;
    while (current) {
      const mapped = fromDatabaseError(current);
      if (mapped) throw mapped;
      current = (current as { cause?: unknown }).cause;
    }
    throw error;
  }
}

/** Typed raw query. Every table reference in `query` must be `tpms.`-qualified. */
export async function rows<T>(executor: Executor, query: SQL): Promise<T[]> {
  const result = await executor.execute(query);
  return result.rows as T[];
}

export async function one<T>(executor: Executor, query: SQL): Promise<T | undefined> {
  const result = await rows<T>(executor, query);
  return result[0];
}

export { schema };
