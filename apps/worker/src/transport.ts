/**
 * The transport — the one place that speaks SQL.
 *
 * Everything above this file calls migration 012's functions through
 * {@link SqlTransport}, which is why the suite can mock the SQL functions at
 * the transport rather than standing up a database.
 *
 * **Why a direct Postgres connection and not PostgREST.** 012 grants the
 * worker surface to `service_role` on functions in the `app` schema
 * (`012:2718-2727`), and `supabase/config.toml` exposes `public`, `core` and
 * `graphql_public` — not `app`. A PostgREST `/rest/v1/rpc/claim_jobs` call
 * therefore cannot reach `app.claim_jobs` whatever key it carries. Until
 * either `app` is exposed or `core` wrappers exist, the worker connects to
 * Postgres directly and assumes the `service_role` identity for the session,
 * so the grants in 012 are the ones actually enforced.
 */

import { Pool, type PoolConfig } from "pg";

export interface SqlTransport {
  /**
   * One statement, positional parameters, rows back.
   *
   * Deliberately not a query builder: every caller in this app is a call to a
   * named SECURITY DEFINER function, and a builder would only hide that.
   */
  query<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}

export interface PostgresTransportOptions {
  connectionString: string;
  /**
   * The role the session assumes before any statement runs. 012's grants name
   * `service_role`; connecting as the owner and staying there would run the
   * worker with privileges 012 never gave it and would hide a missing grant
   * until production.
   */
  role?: string;
  max?: number;
  /** Supabase requires TLS; `rejectUnauthorized` is false for the pooler's cert chain. */
  ssl?: PoolConfig["ssl"];
  statementTimeoutMs?: number;
}

export class PostgresTransport implements SqlTransport {
  private readonly pool: Pool;

  constructor(opts: PostgresTransportOptions) {
    const role = opts.role ?? "service_role";
    this.pool = new Pool({
      connectionString: opts.connectionString,
      max: opts.max ?? 4,
      ssl: opts.ssl,
      statement_timeout: opts.statementTimeoutMs ?? 30_000,
    });
    // Per connection, not per query: a pooled connection is reused, and a role
    // set once per checkout would be a role set once per hundred statements.
    this.pool.on("connect", (client) => {
      void client.query(`SET ROLE ${quoteIdentifier(role)}`).catch(() => {
        // Surfaced by the first real statement failing its grant check, which
        // is a far more legible error than one raised inside a pool event.
      });
    });
  }

  async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    const result = await this.pool.query(text, params as unknown[]);
    return result.rows as Row[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * A role name is an identifier, not a parameter — `SET ROLE $1` is a syntax
 * error — so it is quoted rather than bound. The allow-list is the shape
 * check: anything that is not a plain identifier is refused outright rather
 * than escaped and hoped for.
 */
export function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to SET ROLE to ${JSON.stringify(name)}: not a plain identifier`);
  }
  return `"${name}"`;
}
