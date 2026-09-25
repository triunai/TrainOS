import pg from "pg";
import { env } from "../env";

/**
 * The single connection pool. NUMERIC comes back as a string from node-postgres
 * by default so money never passes through a float on the way out of the
 * database; `money.ts` owns the conversion.
 */
declare global {
  // eslint-disable-next-line no-var
  var __tpmsPool: pg.Pool | undefined;
}

// DATE columns stay as 'YYYY-MM-DD' strings: a calendar date has no time zone,
// and turning it into a JS Date at local midnight is how a training day slips.
pg.types.setTypeParser(1082, (value) => value);
// BIGINT (audit seq, counts) fits in a double for any realistic ledger.
pg.types.setTypeParser(20, (value) => Number(value));

export function pool(): pg.Pool {
  if (!globalThis.__tpmsPool) {
    globalThis.__tpmsPool = new pg.Pool({
      connectionString: env().DATABASE_URL,
      // Convenience only: every query in this codebase names `tpms.` explicitly
      // (Drizzle via pgSchema, raw SQL by hand), because a transaction-mode
      // pooler such as Supabase's does not honour session-level settings.
      options: "-c search_path=tpms,extensions,public",
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalThis.__tpmsPool;
}

export async function closePool(): Promise<void> {
  const current = globalThis.__tpmsPool;
  globalThis.__tpmsPool = undefined;
  if (current) await current.end();
}
